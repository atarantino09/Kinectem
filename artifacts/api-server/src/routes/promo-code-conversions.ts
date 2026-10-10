import { Router, type IRouter } from "express";
import { db, organizations, orgSubscriptions, promoCodes, promoUsage, promoCodeConversions } from "@workspace/db";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../lib/auth";
import { asyncHandler } from "../lib/async-handler";
import { apiError } from "../lib/spec-helpers";
import { availableFreeUntil, FREE2027_CODE } from "../lib/free-access-promo";
import { codeFingerprint, recipientFingerprint, grantMatches, currentTerms, proposedTerms, conversionGrant, promoSnapshot } from "../lib/promo-conversion";
import { verifyUnpaidBilling } from "../lib/free-access-stripe";
import { rateLimit, ipKey } from "../middlewares/rate-limit";

const router: IRouter = Router();
router.use("/admin/promo-code-conversions", requireAdmin);
router.use("/admin/promo-codes/:id/free2027", requireAdmin);
const limiter = rateLimit({ name: "admin-promo-conversions", windowMs: 60_000, max: 500, keys: (req) => [ipKey(req)] });
const ids = z.object({ organizationIds: z.array(z.string().uuid()).min(1).max(10) });
const reviewBody = z.object({
  pricing: z.enum(["keep_discount", "full_price"]),
  settings: z.object({
    description: z.string().trim().max(1000).nullable(),
    maxRedemptions: z.number().int().min(1).nullable(),
    expiresAt: z.string().datetime().nullable(),
  }),
});
function fail(res: Parameters<typeof apiError>[0], message: string, status = 409) {
  apiError(res, status, message, { code: "PROMO_CONVERSION_BLOCKED" });
}
function available(review: typeof promoCodeConversions.$inferSelect | undefined, actorId: string) {
  return review && review.actorUserId === actorId && review.promoCodeId &&
    (review.savedAt || review.createdAt.getTime() > Date.now() - 60 * 60 * 1000);
}
function publicRecipient(row: typeof promoCodeConversions.$inferSelect["recipients"][number]) {
  const { fingerprint: _fingerprint, reviewEligible: _eligible, ...result } = row;
  return result;
}

router.post("/admin/promo-codes/:id/free2027/review", limiter, asyncHandler(async (req, res): Promise<void> => {
  const body = reviewBody.safeParse(req.body);
  if (!body.success) { fail(res, "Choose August billing and valid promo settings.", 400); return; }
  const [source] = await db.select().from(promoCodes).where(eq(promoCodes.id, req.params.id as string));
  if (!source) { fail(res, "Promo code not found.", 404); return; }
  if (source.code === FREE2027_CODE) { fail(res, "FREE2027 itself always bills full price. Convert a custom code instead.", 400); return; }
  let grant;
  try {
    grant = conversionGrant(source, body.data.pricing);
    availableFreeUntil({ discountType: "free_until", freeUntil: new Date(grant.freeUntil) });
  } catch (err) { fail(res, err instanceof Error ? err.message : "Invalid conversion terms.", 400); return; }
  const targets = await db.select({ org: organizations, sub: orgSubscriptions }).from(organizations)
    .leftJoin(orgSubscriptions, eq(orgSubscriptions.organizationId, organizations.id))
    .where(or(eq(orgSubscriptions.promoCodeId, source.id),
      and(eq(organizations.pendingPromoCodeId, source.id), isNull(orgSubscriptions.promoCodeId))))
    .orderBy(asc(organizations.id)).limit(2001);
  if (targets.length > 2000) { fail(res, "At most 2,000 current organizations can be reviewed at once.", 400); return; }
  const recipients = targets.map(({ org, sub }) => ({
    organizationId: org.id, organizationName: org.name, fingerprint: recipientFingerprint(org, sub ?? undefined, source),
    status: "pending", reason: "Eligibility has not been checked.",
    currentTerms: currentTerms(org, sub ?? undefined, source), proposedTerms: proposedTerms(grant, sub?.plan),
  }));
  const [review] = await db.insert(promoCodeConversions).values({
    promoCodeId: source.id, actorUserId: req.sessionUser!.id, code: source.code,
    codeFingerprint: codeFingerprint(source), grant, settings: body.data.settings, recipients,
  }).returning();
  res.json({ reviewId: review.id, terms: proposedTerms(grant), data: recipients.map(publicRecipient) });
}));

for (const action of ["preview", "apply"] as const) {
  router.post(`/admin/promo-code-conversions/:reviewId/${action}`, limiter, asyncHandler(async (req, res): Promise<void> => {
    const body = ids.safeParse(req.body);
    if (!body.success) { fail(res, "Choose up to 10 reviewed organizations.", 400); return; }
    const results = [];
    for (const orgId of [...new Set(body.data.organizationIds)]) {
      const outcome = await db.transaction(async (tx) => {
        // All org writes use the shared org -> review -> promo lock ordering.
        const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for("update");
        const [review] = await tx.select().from(promoCodeConversions)
          .where(eq(promoCodeConversions.id, req.params.reviewId as string)).for("update");
        if (!available(review, req.sessionUser!.id)) throw new Error("Review expired or not found. Start a new review.");
        const recipient = review!.recipients.find((r) => r.organizationId === orgId);
        if (!recipient) throw new Error("Organization was not in this review.");
        if (action === "preview" && review!.savedAt) throw new Error("This review is already confirmed.");
        if (action === "apply" && !review!.savedAt) throw new Error("Confirm the reviewed code before applying it.");
        if (action === "apply" && ["applied", "staged", "unchanged"].includes(recipient.status)) return publicRecipient(recipient);
        if (action === "apply" && !recipient.reviewEligible) throw new Error("Organization was not eligible in this review.");
        const [source] = await tx.select().from(promoCodes).where(eq(promoCodes.id, review!.promoCodeId!)).for("update");
        const [sub] = await tx.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, orgId)).for("update");
        let status = "blocked", reason = "The organization changed. Start a new review.";
        if (!source || codeFingerprint(source) !== review!.codeFingerprint) {
          reason = "The promo code changed. Start a new review.";
        } else if (org && recipientFingerprint(org, sub, source) === recipient.fingerprint &&
          (sub?.promoCodeId === source.id || (!sub?.promoCodeId && org.pendingPromoCodeId === source.id))) {
          const already = grantMatches(org, sub, review!.grant);
          let check = { status: "eligible", reason: "No card on file." };
          if (sub && !sub.stripeCustomerId && !sub.stripeSubscriptionId && ["active", "past_due"].includes(sub.status)) {
            check = { status: "blocked", reason: "Existing payment history cannot be verified; no terms changed." };
          } else {
            try {
              const freeUntil = availableFreeUntil({ discountType: "free_until", freeUntil: new Date(review!.grant.freeUntil) })!;
              check = await verifyUnpaidBilling({
                orgId, subscriptionId: sub?.stripeSubscriptionId ?? null, customerId: sub?.stripeCustomerId ?? null,
                plan: sub?.plan ?? "starter", freeUntil, apply: action === "apply",
                firstAnnualDiscount: review!.grant.firstAnnualDiscount, promoCode: review!.grant.code, operationId: review!.id,
              });
            } catch { check = { status: "blocked", reason: "The fixed billing date is unavailable. No terms changed." }; }
          }
          status = check.status; reason = check.reason;
          if (status === "eligible") {
            status = already ? "unchanged" : action === "preview" ? "eligible" : sub ? "applied" : "staged";
            reason = already ? "Already assigned these terms; no billing or attribution changes." : proposedTerms(review!.grant, sub?.plan);
            if (action === "apply" && !already) {
              if (sub) {
                const freeUntil = new Date(review!.grant.freeUntil);
                await tx.update(orgSubscriptions).set({
                  freeUntil, billingStartsAt: freeUntil, freeAccessPromo: review!.grant, promoSnapshot: review!.grant,
                  status: "trialing", trialReminderSentAt: null, updatedAt: new Date(),
                }).where(eq(orgSubscriptions.id, sub.id));
                // Keep the original usage application identity and date; only its current terms change.
                await tx.update(promoUsage).set({
                  discountType: "free_until", discountValue: 0, freeUntil,
                  firstAnnualDiscount: review!.grant.firstAnnualDiscount ?? null,
                }).where(and(eq(promoUsage.organizationId, orgId), isNull(promoUsage.endedAt), eq(promoUsage.promoCodeId, source.id)));
              } else {
                await tx.update(organizations).set({ pendingPromoSnapshot: review!.grant }).where(eq(organizations.id, orgId));
              }
            }
          }
        }
        const next = { ...recipient, status, reason, ...(action === "preview" ? { reviewEligible: status === "eligible" } : {}) };
        await tx.update(promoCodeConversions).set({
          recipients: review!.recipients.map((r) => r.organizationId === orgId ? next : r),
        }).where(eq(promoCodeConversions.id, review!.id));
        return publicRecipient(next);
      }).catch((err) => ({
        organizationId: orgId, organizationName: "Organization", status: "blocked",
        reason: "Could not complete this organization. Retry safely, or start a new review if its billing changed.",
      }));
      results.push(outcome);
    }
    res.json({ data: results });
  }));
}

router.post("/admin/promo-code-conversions/:reviewId/confirm", limiter, asyncHandler(async (req, res): Promise<void> => {
  const [initial] = await db.select().from(promoCodeConversions).where(eq(promoCodeConversions.id, req.params.reviewId as string));
  if (!available(initial, req.sessionUser!.id)) { fail(res, "Review expired or not found. Start a new review."); return; }
  const result = await db.transaction(async (tx) => {
    const orgIds = initial!.recipients.map((r) => r.organizationId);
    if (orgIds.length) await tx.select({ id: organizations.id }).from(organizations)
      .where(inArray(organizations.id, orgIds)).orderBy(asc(organizations.id)).for("update");
    const [review] = await tx.select().from(promoCodeConversions).where(eq(promoCodeConversions.id, initial!.id)).for("update");
    if (!available(review, req.sessionUser!.id)) return { error: "Review expired. Start again." };
    if (review!.savedAt) return { saved: true };
    if (review!.recipients.some((r) => r.status === "pending")) return { error: "Check every reviewed organization before confirming." };
    const [source] = await tx.select().from(promoCodes).where(eq(promoCodes.id, review!.promoCodeId!)).for("update");
    if (!source || codeFingerprint(source) !== review!.codeFingerprint) return { error: "The code changed. Start a new review." };
    try { availableFreeUntil({ discountType: "free_until", freeUntil: new Date(review!.grant.freeUntil) }); }
    catch { return { error: "The fixed billing date is unavailable. No terms changed." }; }
    // Failed/paid orgs must continue to see their original promise after the
    // future-code defaults change. Normal new redemptions also snapshot terms.
    await tx.update(orgSubscriptions).set({ promoSnapshot: promoSnapshot(source) })
      .where(and(inArray(orgSubscriptions.organizationId, orgIds), eq(orgSubscriptions.promoCodeId, source.id), isNull(orgSubscriptions.promoSnapshot), isNull(orgSubscriptions.freeAccessPromo)));
    await tx.update(organizations).set({ pendingPromoSnapshot: promoSnapshot(source) })
      .where(and(inArray(organizations.id, orgIds), eq(organizations.pendingPromoCodeId, source.id), isNull(organizations.pendingPromoSnapshot)));
    const [updated] = await tx.update(promoCodes).set({
      linkedOffer: "free2027", discountType: "free_until", discountValue: 0,
      freeUntil: new Date(review!.grant.freeUntil), firstAnnualDiscount: review!.grant.firstAnnualDiscount ?? null,
      ...review!.settings, expiresAt: review!.settings.expiresAt ? new Date(review!.settings.expiresAt) : null, updatedAt: new Date(),
    }).where(eq(promoCodes.id, source.id)).returning();
    await tx.update(promoCodeConversions).set({ codeFingerprint: codeFingerprint(updated), savedAt: new Date() })
      .where(eq(promoCodeConversions.id, review!.id));
    return { saved: true };
  });
  if ("error" in result) { fail(res, result.error!); return; }
  res.json(result);
}));
export default router;
