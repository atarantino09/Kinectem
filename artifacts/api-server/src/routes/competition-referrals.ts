import { Router, type IRouter } from "express";
import { db, tournaments, competitionReferrals, orgSubscriptions } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { canManageOrganization } from "../lib/permissions";
import { canOperateCompetition } from "../lib/competition-permissions";
import { asyncHandler } from "../lib/async-handler";
import { apiError } from "../lib/spec-helpers";
import { referralCodeFor, resolveReferral, competitionReferralReport, recordReferralInvoice } from "../lib/competition-referrals";
import { getStripeClient } from "../lib/stripeClient";
import { rateLimit, ipKey } from "../middlewares/rate-limit";

const router: IRouter = Router();
const limiter = rateLimit({ name: "competition-referrals", max: 60, windowMs: 60_000, keys: (req) => [ipKey(req)] });
router.get("/competition-referrals/resolve/:code", limiter, asyncHandler(async (req, res): Promise<void> => {
  if (typeof req.params.code !== "string" || !/^ref-[a-f0-9]{16}$/i.test(req.params.code)) {
    apiError(res, 400, "Enter a competition referral tag, not a promo code.", { code: "VALIDATION_FAILED" }); return;
  }
  try {
    const competition = await db.transaction((tx) => resolveReferral(tx, req.params.code as string));
    res.json({ competitionId: competition.id, competitionName: competition.name, referralCode: competition.code });
  } catch {
    apiError(res, 404, "Competition referral tag not found.", { code: "NOT_FOUND" });
  }
}));
router.get("/organizations/:orgId/competition-referral", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const id = String(req.params.orgId);
  if (!z.string().uuid().safeParse(id).success) { apiError(res, 400, "Invalid organization.", { code: "VALIDATION_FAILED" }); return; }
  if (!req.sessionUser || !(await canManageOrganization(req.sessionUser.id, id))) {
    apiError(res, 403, "You don't manage this organization.", { code: "FORBIDDEN" }); return;
  }
  const [row] = await db.select({ competitionName: competitionReferrals.competitionName, referralCode: competitionReferrals.referralCode })
    .from(competitionReferrals).where(eq(competitionReferrals.organizationId, id));
  res.json({ referral: row ?? null });
}));

for (const sync of [false, true]) {
  const path = `/competitions/:competitionId/referrals${sync ? "/sync-payments" : ""}`;
  const handler = asyncHandler(async (req, res): Promise<void> => {
    const id = String(req.params.competitionId);
    if (!z.string().uuid().safeParse(id).success) { apiError(res, 400, "Invalid competition.", { code: "VALIDATION_FAILED" }); return; }
    const [competition] = await db.select().from(tournaments).where(eq(tournaments.id, id));
    if (!competition) { apiError(res, 404, "Competition not found.", { code: "NOT_FOUND" }); return; }
    if (!req.sessionUser || !(await canOperateCompetition(req.sessionUser, competition))) {
      apiError(res, 403, "Only competition administrators can view referrals.", { code: "FORBIDDEN" }); return;
    }
    let checkedSubscriptions = 0;
    if (sync) {
      const stripe = await getStripeClient();
      if (!stripe) { apiError(res, 503, "Stripe is not connected. Signups are tracked, but collected payments cannot be verified yet.", { code: "STRIPE_NOT_CONFIGURED" }); return; }
      const refs = await db.select({ sub: orgSubscriptions }).from(competitionReferrals)
        .innerJoin(orgSubscriptions, eq(orgSubscriptions.organizationId, competitionReferrals.organizationId))
        .where(eq(competitionReferrals.competitionId, id)).limit(501);
      if (refs.length > 500) { apiError(res, 400, "This referral report needs an administrator-assisted payment sync.", { code: "BATCH_TOO_LARGE" }); return; }
      for (const { sub } of refs) {
        if (!sub.stripeSubscriptionId || !sub.stripeCustomerId) continue;
        checkedSubscriptions++;
        // Read from Stripe only. Chronological ordering ensures first paid invoice wins.
        const invoices = [];
        for await (const invoice of stripe.invoices.list({ customer: sub.stripeCustomerId, subscription: sub.stripeSubscriptionId, status: "paid", limit: 100 })) {
          invoices.push(invoice);
          if (invoices.length > 1000) throw new Error("Invoice history too large; payment sync needs review.");
        }
        invoices.sort((a, b) => (a.status_transitions.paid_at ?? a.created) - (b.status_transitions.paid_at ?? b.created));
        for (const invoice of invoices) await recordReferralInvoice(invoice);
      }
    }
    res.json({ referralCode: await referralCodeFor(id), competitionName: competition.name,
      commissionPercent: 15, ...(sync ? { checkedSubscriptions } : {}), data: await competitionReferralReport(id) });
  });
  if (sync) router.post(path, requireAuth, limiter, handler);
  else router.get(path, requireAuth, limiter, handler);
}
export default router;
