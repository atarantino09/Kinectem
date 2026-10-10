import { Router, type IRouter } from "express";
import { db, organizations, organizationAdmins, users, orgAdminLists, orgSubscriptions, promoCodes, promoUsage } from "@workspace/db";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../lib/auth";
import { asyncHandler } from "../lib/async-handler";
import { apiError } from "../lib/spec-helpers";
import { availableFreeUntil, FREE2027_CODE, FREE2027_FIRST_CHARGE, isFree2027Offer, firstAnnualTerms } from "../lib/free-access-promo";
import { promoSnapshot } from "../lib/promo-conversion";
import { verifyUnpaidBilling } from "../lib/free-access-stripe";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import type { PlanTier } from "../lib/stripe-billing";
import { checkReferral, attachReferral } from "../lib/competition-referrals";

const router: IRouter = Router();
router.use("/admin/free2027", requireAdmin);
const limiter = rateLimit({ name: "admin-free2027", windowMs: 60_000, max: 500, keys: (req) => [ipKey(req)] });
router.get("/admin/free2027/organizations", limiter, asyncHandler(async (_req, res): Promise<void> => {
  // Organization pages have no soft-archive state. Include every existing
  // page, including unclaimed pages and organizations without a plan.
  const rows = await db.select({
    organizationId: organizations.id,
    organizationName: organizations.name,
    ownerUserId: organizationAdmins.userId,
    ownerName: users.name,
    ownerLastSignInAt: users.lastSignInAt,
    hasFree2027: sql<boolean>`CASE WHEN promo_codes.id IS NOT NULL AND
      (organizations.pending_promo_code_id = promo_codes.id OR org_subscriptions.promo_code_id = promo_codes.id)
      THEN true ELSE false END`,
  }).from(organizations)
    .leftJoin(organizationAdmins, and(
      eq(organizationAdmins.organizationId, organizations.id),
      eq(organizationAdmins.role, "owner"),
    ))
    .leftJoin(users, eq(users.id, organizationAdmins.userId))
    .leftJoin(orgSubscriptions, eq(orgSubscriptions.organizationId, organizations.id))
    .leftJoin(promoCodes, eq(promoCodes.code, FREE2027_CODE))
    .orderBy(
      sql`CASE WHEN organization_admins.user_id IS NULL THEN 1 ELSE 0 END`,
      sql`users.last_sign_in_at DESC NULLS LAST`,
      asc(organizations.name), asc(organizations.id),
    );
  res.json({ data: rows.map(({ ownerUserId, ownerLastSignInAt, ...row }) => ({
    ...row,
    claimed: ownerUserId !== null,
    ownerLastSignInAt: ownerLastSignInAt?.toISOString() ?? null,
  })) });
}));
const idsBody = z.object({ organizationIds: z.array(z.string().uuid()).min(1).max(10), referralCode: z.string().trim().min(1).max(64).optional() });
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
  action: "preview" | "apply", selectedPlan?: PlanTier, referralCode?: string,
  offerCode = FREE2027_CODE,
): Promise<Outcome> {
        return db.transaction(async (tx): Promise<Outcome> => {
          // The same org-first lock order is used by owner redemption.
          const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for("update");
          if (!org) return { organizationId: orgId, organizationName: "Deleted organization", status: "blocked", reason: "Organization no longer exists." };
          const base = { organizationId: org.id, organizationName: org.name };
          const referral = await checkReferral(tx, org.id, referralCode);
          const [sub] = await tx.select().from(orgSubscriptions)
            .where(eq(orgSubscriptions.organizationId, orgId)).for("update");
          if (sub?.stripeSubscriptionId && selectedPlan && selectedPlan !== sub.plan) {
            return { ...base, status: "blocked", reason: "Keep your current plan when applying FREE2027 to a saved card." };
          }
          const lockedPromos = await tx.select().from(promoCodes)
            .where(sub?.promoCodeId ? or(eq(promoCodes.code, offerCode), eq(promoCodes.id, sub.promoCodeId)) : eq(promoCodes.code, offerCode))
            .orderBy(asc(promoCodes.id)).for("update");
          const promo = lockedPromos.find((p) => p.code === offerCode);
          if (!promo || !isFree2027Offer(promo) || !promo.active || promo.discountType !== "free_until" ||
            promo.freeUntil?.toISOString() !== FREE2027_FIRST_CHARGE ||
            (promo.expiresAt && promo.expiresAt.getTime() <= Date.now())) {
            return { ...base, status: "blocked", reason: "FREE2027 is unavailable or its terms have changed." };
          }
          let freeUntil: Date;
          try { freeUntil = availableFreeUntil(promo)!; }
          catch { return { ...base, status: "blocked", reason: "This free-access offer has expired or is too close to billing." }; }
          // Existing grants, including staged ones, are promises rather than
          // references to mutable code defaults. Only reviewed conversion changes them.
          const savedGrant = sub?.promoCodeId === promo.id ? sub.freeAccessPromo
            : org.pendingPromoCodeId === promo.id && org.pendingPromoSnapshot?.discountType === "free_until"
              ? org.pendingPromoSnapshot : null;
          const firstAnnualDiscount = savedGrant ? savedGrant.firstAnnualDiscount ?? null : promo.firstAnnualDiscount;
          const grant = { ...promoSnapshot(promo), discountType: "free_until" as const,
            freeUntil: freeUntil.toISOString(), firstAnnualDiscount };
          if (!sub?.stripeSubscriptionId && !sub?.stripeCustomerId && sub &&
            (sub.status === "active" || sub.status === "past_due")) {
            return { ...base, status: "blocked", reason: "An existing billing history needs verification before applying free access." };
          }
          const check = await verifyUnpaidBilling({
            orgId, subscriptionId: sub?.stripeSubscriptionId ?? null, customerId: sub?.stripeCustomerId ?? null,
            plan: sub?.plan ?? "starter", freeUntil, apply: false,
            firstAnnualDiscount, promoCode: promo.code,
          });
          if (check.status !== "eligible") return { ...base, ...check };
          const already = sub
            ? sub.promoCodeId === promo.id && sub.freeUntil?.getTime() === freeUntil.getTime()
            : org.pendingPromoCodeId === promo.id;
          if (already && !sub?.stripeSubscriptionId && (sub || !selectedPlan)) {
            const planChanged = Boolean(sub && selectedPlan && selectedPlan !== sub.plan);
            if (action === "apply" && planChanged) {
              await tx.update(orgSubscriptions).set({ plan: selectedPlan!, updatedAt: new Date() }).where(eq(orgSubscriptions.id, sub!.id));
            }
            if (referral?.isNew) {
              if (action === "apply") await attachReferral(tx, org, referral);
              return { ...base, status: action === "preview" ? "eligible" : "applied", reason: `FREE2027 already assigned. ${action === "preview" ? "Credit" : "Credited to"} ${referral.competition.name}; billing terms stay unchanged.` };
            }
            return { ...base, status: planChanged && action === "apply" ? "applied" : "unchanged", reason: "Free access is already assigned; granted terms and source attribution are unchanged." };
          }
          if (action === "preview") return {
            ...base, status: "eligible", reason: sub
              ? `${check.reason} ${firstAnnualTerms(firstAnnualDiscount)}.`
              : `Assign free access now; the owner chooses a plan and adds a card later. ${firstAnnualTerms(firstAnnualDiscount)}.`,
             ...(referral ? { reason: `Free access with referral credit to ${referral.competition.name}. ${firstAnnualTerms(firstAnnualDiscount)}; commission eligibility requires a verified full-price payment.` } : {}),
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
          if (!sub && !selectedPlan) {
            await tx.update(organizations).set({ pendingPromoCodeId: promo.id, pendingPromoSnapshot: grant }).where(eq(organizations.id, orgId));
            await attachReferral(tx, org, referral);
            return { ...base, status: "staged", reason: "FREE2027 assigned. It will apply when the owner chooses a plan." };
          }
          if (sub?.stripeSubscriptionId) {
            const synced = await verifyUnpaidBilling({
              orgId, subscriptionId: sub.stripeSubscriptionId, customerId: sub.stripeCustomerId,
              plan: sub.plan, freeUntil, apply: true,
              firstAnnualDiscount, promoCode: promo.code,
            });
            if (synced.status !== "eligible") return { ...base, ...synced };
            if (already) {
              await attachReferral(tx, org, referral);
              return { ...base, status: referral?.isNew ? "applied" : "unchanged", reason: "FREE2027 is already assigned; Stripe billing is aligned and referral credit is saved." };
            }
          }
          // Usage history must be closed before a new snapshot is inserted.
          await tx.update(promoUsage).set({ endedAt: new Date(), endReason: "promo_changed" })
            .where(and(eq(promoUsage.organizationId, orgId), sql`${promoUsage.endedAt} IS NULL`));
          const subscriptionValues = {
            promoCodeId: promo.id, freeUntil, billingStartsAt: freeUntil,
              freeAccessPromo: grant, promoSnapshot: grant,
             plan: selectedPlan ?? sub!.plan,
             status: "trialing" as const, trialReminderSentAt: null, updatedAt: new Date(),
          };
          if (sub) await tx.update(orgSubscriptions).set(subscriptionValues).where(eq(orgSubscriptions.id, sub.id));
          else await tx.insert(orgSubscriptions).values({ organizationId: orgId, ...subscriptionValues });
           await tx.update(organizations).set({ pendingPromoCodeId: null, pendingPromoSnapshot: null }).where(eq(organizations.id, orgId));
          if (sub?.promoCodeId !== promo.id) {
            if (sub?.promoCodeId) await tx.update(promoCodes)
              .set({ redemptionCount: sql`greatest(0, ${promoCodes.redemptionCount} - 1)` }).where(eq(promoCodes.id, sub.promoCodeId));
            await tx.update(promoCodes).set({ redemptionCount: sql`${promoCodes.redemptionCount} + 1` }).where(eq(promoCodes.id, promo.id));
          }
          await tx.insert(promoUsage).values({
            promoCodeId: promo.id, organizationId: orgId, actorUserId: actor.id,
            code: promo.code, organizationName: org.name, actorName: actor.name,
             actorEmail: actor.email, plan: selectedPlan ?? sub!.plan, discountType: "free_until",
             discountValue: 0, freeUntil, firstAnnualDiscount, appliedAt: new Date(),
          });
          await attachReferral(tx, org, referral);
           return { ...base, status: "applied", reason: `Free through July 31, 2027. ${firstAnnualTerms(firstAnnualDiscount)}.` };
        });
}
for (const action of ["preview", "apply"] as const) {
  router.post(`/admin/free2027/${action}`, limiter, asyncHandler(async (req, res): Promise<void> => {
    const parsed = idsBody.safeParse(req.body);
    if (!parsed.success) { apiError(res, 400, "Choose up to 10 organizations per batch.", { code: "VALIDATION_FAILED" }); return; }
    const results: Outcome[] = [];
    for (const orgId of [...new Set(parsed.data.organizationIds)]) {
      try {
        const outcome = await processFree2027(orgId, req.sessionUser!, action, undefined, parsed.data.referralCode);
        results.push(outcome);
      } catch (err) {
        req.log.error({ organizationId: orgId, action }, "FREE2027 operation failed; safe to retry");
        results.push({ organizationId: orgId, organizationName: "Organization", status: "blocked",
          reason: err instanceof Error && (err.message.startsWith("This organization is already credited") || err.message.startsWith("Competition referral code not found"))
            ? err.message : "Could not complete this organization. Retry; no successful application was recorded." });
      }
    }
    res.json({ data: results });
  }));
}
export default router;
