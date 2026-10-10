import { Router, type IRouter } from "express";
import { db, organizations, orgAdminLists, orgSubscriptions, promoCodes, promoUsage } from "@workspace/db";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../lib/auth";
import { asyncHandler } from "../lib/async-handler";
import { apiError } from "../lib/spec-helpers";
import { availableFreeUntil, FREE2027_CODE, FREE2027_FIRST_CHARGE } from "../lib/free-access-promo";
import { verifyUnpaidBilling } from "../lib/free-access-stripe";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import type { PlanTier } from "../lib/stripe-billing";

const router: IRouter = Router();
router.use("/admin/free2027", requireAdmin);
const limiter = rateLimit({ name: "admin-free2027", windowMs: 60_000, max: 500, keys: (req) => [ipKey(req)] });
const idsBody = z.object({ organizationIds: z.array(z.string().uuid()).min(1).max(10) });
const targetsBody = z.object({
  organizationIds: z.array(z.string().uuid()).min(1).max(2000).optional(),
  listId: z.string().uuid().optional(),
}).refine((b) => Boolean(b.organizationIds) !== Boolean(b.listId), "Choose organizations or one saved list.");

router.post("/admin/free2027/targets", limiter, asyncHandler(async (req, res): Promise<void> => {
  const parsed = targetsBody.safeParse(req.body);
  if (!parsed.success) { apiError(res, 400, "Choose organizations or one saved list.", { code: "VALIDATION_FAILED" }); return; }
  if (parsed.data.listId) {
    const [list] = await db.select().from(orgAdminLists).where(eq(orgAdminLists.id, parsed.data.listId));
    if (!list) { apiError(res, 404, "Saved organization list not found.", { code: "NOT_FOUND" }); return; }
  }
  const targets = await db.select({ organizationId: organizations.id, organizationName: organizations.name })
    .from(organizations).where(parsed.data.listId
      ? eq(organizations.adminListId, parsed.data.listId)
      : inArray(organizations.id, [...new Set(parsed.data.organizationIds!)]))
    .orderBy(asc(organizations.name)).limit(2001);
  if (targets.length > 2000) { apiError(res, 400, "Choose at most 2,000 organizations at once.", { code: "BATCH_TOO_LARGE" }); return; }
  res.json({ data: targets });
}));

type Outcome = { organizationId: string; organizationName: string; status: string; reason: string };

export async function processFree2027(
  orgId: string, actor: { id: string; name: string; email: string | null },
  action: "preview" | "apply", selectedPlan?: PlanTier,
): Promise<Outcome> {
        return db.transaction(async (tx): Promise<Outcome> => {
          // The same org-first lock order is used by owner redemption.
          const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for("update");
          if (!org) return { organizationId: orgId, organizationName: "Deleted organization", status: "blocked", reason: "Organization no longer exists." };
          const base = { organizationId: org.id, organizationName: org.name };
          const [sub] = await tx.select().from(orgSubscriptions)
            .where(eq(orgSubscriptions.organizationId, orgId)).for("update");
          if (sub?.stripeSubscriptionId && selectedPlan && selectedPlan !== sub.plan) {
            return { ...base, status: "blocked", reason: "Keep your current plan when applying FREE2027 to a saved card." };
          }
          const lockedPromos = await tx.select().from(promoCodes)
            .where(sub?.promoCodeId ? or(eq(promoCodes.code, FREE2027_CODE), eq(promoCodes.id, sub.promoCodeId)) : eq(promoCodes.code, FREE2027_CODE))
            .orderBy(asc(promoCodes.id)).for("update");
          const promo = lockedPromos.find((p) => p.code === FREE2027_CODE);
          if (!promo || !promo.active || promo.discountType !== "free_until" ||
            promo.freeUntil?.toISOString() !== FREE2027_FIRST_CHARGE ||
            (promo.expiresAt && promo.expiresAt.getTime() <= Date.now())) {
            return { ...base, status: "blocked", reason: "FREE2027 is unavailable or its terms have changed." };
          }
          const freeUntil = availableFreeUntil(promo)!;
          if (!sub?.stripeSubscriptionId && !sub?.stripeCustomerId && sub &&
            (sub.status === "active" || sub.status === "past_due")) {
            return { ...base, status: "blocked", reason: "An existing billing history needs verification before applying free access." };
          }
          const check = await verifyUnpaidBilling({
            orgId, subscriptionId: sub?.stripeSubscriptionId ?? null, customerId: sub?.stripeCustomerId ?? null,
            plan: sub?.plan ?? "starter", freeUntil, apply: false,
          });
          if (check.status !== "eligible") return { ...base, ...check };
          const already = sub
            ? sub.promoCodeId === promo.id && sub.freeUntil?.getTime() === freeUntil.getTime()
            : org.pendingPromoCodeId === promo.id;
          if (already && !sub?.stripeSubscriptionId && (!selectedPlan || selectedPlan === sub?.plan)) return { ...base, status: "unchanged", reason: "FREE2027 is already assigned." };
          if (action === "preview") return {
            ...base, status: "eligible", reason: sub
              ? `${check.reason} Full-price annual billing starts August 1, 2027.`
              : "Assign FREE2027 now; the owner chooses a plan and adds a card later.",
          };
          // Unlimited by default, but honor an operator's later cap change.
          if (promo.maxRedemptions != null) {
            const [pending] = await tx.select({ count: sql<number>`count(*)::int` }).from(organizations)
              .where(eq(organizations.pendingPromoCodeId, promo.id));
            const alreadyReserved = org.pendingPromoCodeId === promo.id || sub?.promoCodeId === promo.id;
            if (promo.redemptionCount + pending.count + (alreadyReserved ? 0 : 1) > promo.maxRedemptions) {
              return { ...base, status: "blocked", reason: "The promo redemption limit has been reached." };
            }
          }
          if (!sub) {
            await tx.update(organizations).set({ pendingPromoCodeId: promo.id }).where(eq(organizations.id, orgId));
            return { ...base, status: "staged", reason: "FREE2027 assigned. It will apply when the owner chooses a plan." };
          }
          if (sub.stripeSubscriptionId) {
            const synced = await verifyUnpaidBilling({
              orgId, subscriptionId: sub.stripeSubscriptionId, customerId: sub.stripeCustomerId,
              plan: sub.plan, freeUntil, apply: true,
            });
            if (synced.status !== "eligible") return { ...base, ...synced };
            if (already) return { ...base, status: "unchanged", reason: "FREE2027 is already assigned; Stripe billing is aligned." };
          }
          // Usage history must be closed before a new snapshot is inserted.
          await tx.update(promoUsage).set({ endedAt: new Date(), endReason: "promo_changed" })
            .where(and(eq(promoUsage.organizationId, orgId), sql`${promoUsage.endedAt} IS NULL`));
          await tx.update(orgSubscriptions).set({
            promoCodeId: promo.id, freeUntil, billingStartsAt: freeUntil,
            plan: selectedPlan ?? sub.plan,
            status: "trialing", trialReminderSentAt: null, updatedAt: new Date(),
          }).where(eq(orgSubscriptions.id, sub.id));
          await tx.update(organizations).set({ pendingPromoCodeId: null }).where(eq(organizations.id, orgId));
          if (sub.promoCodeId !== promo.id) {
            if (sub.promoCodeId) await tx.update(promoCodes)
              .set({ redemptionCount: sql`greatest(0, ${promoCodes.redemptionCount} - 1)` }).where(eq(promoCodes.id, sub.promoCodeId));
            await tx.update(promoCodes).set({ redemptionCount: sql`${promoCodes.redemptionCount} + 1` }).where(eq(promoCodes.id, promo.id));
          }
          await tx.insert(promoUsage).values({
            promoCodeId: promo.id, organizationId: orgId, actorUserId: actor.id,
            code: promo.code, organizationName: org.name, actorName: actor.name,
            actorEmail: actor.email, plan: selectedPlan ?? sub.plan, discountType: "free_until",
            discountValue: 0, freeUntil, appliedAt: new Date(),
          });
          return { ...base, status: "applied", reason: "Free through July 31, 2027. First full-price annual charge August 1, 2027." };
        });
}
for (const action of ["preview", "apply"] as const) {
  router.post(`/admin/free2027/${action}`, limiter, asyncHandler(async (req, res): Promise<void> => {
    const parsed = idsBody.safeParse(req.body);
    if (!parsed.success) { apiError(res, 400, "Choose up to 10 organizations per batch.", { code: "VALIDATION_FAILED" }); return; }
    const results: Outcome[] = [];
    for (const orgId of [...new Set(parsed.data.organizationIds)]) {
      try {
        const outcome = await processFree2027(orgId, req.sessionUser!, action);
        results.push(outcome);
      } catch {
        req.log.error({ organizationId: orgId, action }, "FREE2027 operation failed; safe to retry");
        results.push({ organizationId: orgId, organizationName: "Organization", status: "blocked",
          reason: "Could not complete this organization. Retry; no successful application was recorded." });
      }
    }
    res.json({ data: results });
  }));
}
export default router;
