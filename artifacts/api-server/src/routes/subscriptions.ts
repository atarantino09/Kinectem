import { Router, type IRouter } from "express";
import { db, promoCodes, promoUsage, orgSubscriptions, organizations } from "@workspace/db";
import { desc, eq, sql, isNotNull, isNull, or, and, gte, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  PLAN_TEAM_LIMITS,
  DEFAULT_PLAN,
  teamLimitForPlan,
  countActiveTeams,
} from "../lib/plan-limits";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { requireAuth, requireAdmin } from "../lib/auth";
import { apiError } from "../lib/spec-helpers";
import { canManageOrganization } from "../lib/permissions";
import { checkReferral, attachReferral } from "../lib/competition-referrals";
import {
  createCardOnFileCheckout,
  readCheckoutSession,
  ensureStripeTrialEndAtPolicy,
  cancelStripeSubscription,
  billingStartDate,
  billingStartAtOrAfterPolicy,
  FREE_PERIOD_DAYS,
} from "../lib/stripe-billing";
import { parseUsageFilters, usageCsv, type UsageRow } from "../lib/promo-usage-report";
import { resolvePromoBilling } from "../lib/promo-billing-status";
import { availableFreeUntil, FREE2027_FIRST_CHARGE, isFree2027Offer, validateLinkedTerms } from "../lib/free-access-promo";
import { processFree2027 } from "./admin-free-access";
import { verifyUnpaidBilling } from "../lib/free-access-stripe";

const router: IRouter = Router();

const ONE_MINUTE = 60 * 1000;

// ---------------------------------------------------------------------------
// Plan catalog + launch window
//
// Prices mirror the public marketing pricing page. Every organization gets
// New organizations receive FREE_PERIOD_DAYS (90) free from creation. Legacy
// organizations cannot be charged before the Nov 1 floor. In both cases the
// first charge lands on billingStartDate(org.createdAt).
// ---------------------------------------------------------------------------
type PlanTier = "starter" | "pro" | "elite";

const PLAN_CATALOG: Array<{
  id: PlanTier;
  name: string;
  priceYearly: number;
  teamRange: string;
  maxTeams: number | null;
  popular: boolean;
  features: string[];
}> = [
  {
    id: "starter",
    name: "Starter",
    priceYearly: 1000,
    teamRange: "For organizations with 1–15 teams",
    maxTeams: PLAN_TEAM_LIMITS.starter,
    popular: false,
    features: [
      "Up to 15 teams",
      "Unlimited players & profiles",
      "Unlimited game recaps",
      "COPPA-compliant guardian controls",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    priceYearly: 1750,
    teamRange: "For organizations with 16–40 teams",
    maxTeams: PLAN_TEAM_LIMITS.pro,
    popular: true,
    features: [
      "Up to 40 teams",
      "Everything in Starter",
      "Unlimited players & profiles",
      "COPPA-compliant guardian controls",
    ],
  },
  {
    id: "elite",
    name: "Elite",
    priceYearly: 2500,
    teamRange: "For organizations with 41+ teams",
    maxTeams: PLAN_TEAM_LIMITS.elite,
    popular: false,
    features: [
      "Unlimited teams (41+)",
      "Everything in Pro",
      "Unlimited players & profiles",
      "COPPA-compliant guardian controls",
    ],
  },
];

const PLAN_IDS = PLAN_CATALOG.map((p) => p.id) as [PlanTier, ...PlanTier[]];

// Fetch the org's creation instant (null when the org doesn't exist).
async function orgCreatedAt(orgId: string): Promise<Date | null> {
  const [org] = await db
    .select({ createdAt: organizations.createdAt })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return org?.createdAt ?? null;
}

const promoValidateLimiter = rateLimit({
  name: "promo-validate",
  windowMs: ONE_MINUTE,
  max: 20,
  keys: (req) => [ipKey(req)],
  message: "Too many promo code attempts. Please wait a moment and try again.",
});

const billingCheckoutLimiter = rateLimit({
  name: "billing-checkout",
  windowMs: ONE_MINUTE,
  max: 10,
  keys: (req) => [ipKey(req)],
  message: "Too many checkout attempts. Please wait a moment and try again.",
});

// Resolve a redeemable promo code by its (case-insensitive) code. Returns the
// row only when it is active, not expired, and under its redemption cap.
export async function findRedeemablePromo(rawCode: string) {
  const code = rawCode.trim().toLowerCase();
  if (!code) return null;
  const [row] = await db
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.code, code))
    .limit(1);
  if (!row) return null;
  if (!row.active) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  if (row.discountType === "free_until") {
    try { availableFreeUntil(row); } catch { return null; }
  }
  if (row.maxRedemptions != null && row.redemptionCount >= row.maxRedemptions) {
    return null;
  }
  return row;
}

function publicPromo(row: NonNullable<Awaited<ReturnType<typeof findRedeemablePromo>>>) {
  return {
    code: row.code,
    description: row.description,
    linkedOffer: row.linkedOffer,
    discountType: row.discountType,
    discountValue: row.discountValue,
    freeUntil: row.freeUntil?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// POST /promo-codes/validate — check a code without redeeming it.
// ---------------------------------------------------------------------------
const ValidateBody = z.object({
  code: z.string().trim().min(1, "Enter a promo code").max(64),
});

router.post(
  "/promo-codes/validate",
  requireAuth,
  promoValidateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = ValidateBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.errors[0]?.message ?? "Invalid code.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    const row = await findRedeemablePromo(parsed.data.code);
    if (!row) {
      apiError(res, 404, "That promo code isn't valid.", {
        code: "PROMO_INVALID",
      });
      return;
    }
    res.json({ valid: true, promo: publicPromo(row) });
  }),
);

// ---------------------------------------------------------------------------
// GET /organizations/:orgId/subscription — current plan + catalog.
// ---------------------------------------------------------------------------
function serializeSubscription(
  sub: typeof orgSubscriptions.$inferSelect | undefined,
  promo: { code: string; discountType: string; discountValue: number; freeUntil?: string | null } | null,
) {
  if (!sub) return null;
  return {
    id: sub.id,
    organizationId: sub.organizationId,
    plan: sub.plan,
    status: sub.status,
    promo: sub.freeUntil && sub.freeAccessPromo ? sub.freeAccessPromo : promo,
    hasCardOnFile: Boolean(sub.stripeSubscriptionId),
    billingStartsAt: sub.billingStartsAt?.toISOString() ?? null,
    freeUntil: sub.freeUntil?.toISOString() ?? null,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
  };
}

router.get(
  "/organizations/:orgId/subscription",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated", { code: "UNAUTHENTICATED" });
      return;
    }
    const orgId = req.params.orgId;
    if (!(await canManageOrganization(me.id, orgId))) {
      apiError(res, 403, "You don't manage this organization.", {
        code: "FORBIDDEN",
      });
      return;
    }
    const [sub] = await db
      .select()
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.organizationId, orgId))
      .limit(1);

    let promo: { code: string; discountType: string; discountValue: number; freeUntil?: string | null } | null =
      null;
    if (sub?.promoCodeId) {
      const [row] = await db
        .select()
        .from(promoCodes)
        .where(eq(promoCodes.id, sub.promoCodeId))
        .limit(1);
      if (row) {
        promo = {
          code: row.code,
          discountType: row.discountType,
          discountValue: row.discountValue,
          freeUntil: row.freeUntil?.toISOString() ?? null,
        };
      }
    }

    if (sub?.freeAccessPromo && sub.freeUntil) promo = sub.freeAccessPromo;

    // Staged promo + plan tier from admin creation — auto-applied /
    // pre-selected client-side when the org hasn't already chosen its own.
    // Promo only surfaced while still redeemable.
    let pendingPromo: ReturnType<typeof publicPromo> | null = null;
    let pendingPlan: PlanTier | null = null;
    if (!sub || !sub.promoCodeId) {
      const [org] = await db
        .select({
          pendingPromoCodeId: organizations.pendingPromoCodeId,
          pendingPlan: organizations.pendingPlan,
        })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      // Task #856 — staged tier only matters until the org picks its own plan.
      if (!sub && org?.pendingPlan) {
        pendingPlan = org.pendingPlan as PlanTier;
      }
      if (!sub?.promoCodeId && org?.pendingPromoCodeId) {
        const [row] = await db
          .select()
          .from(promoCodes)
          .where(eq(promoCodes.id, org.pendingPromoCodeId))
          .limit(1);
        if (
          row &&
          row.active &&
          (!row.expiresAt || row.expiresAt.getTime() > Date.now()) &&
          (row.maxRedemptions == null || row.redemptionCount < row.maxRedemptions)
        ) {
          pendingPromo = publicPromo(row);
        }
      }
    }

    const plan = (sub?.plan as PlanTier | undefined) ?? DEFAULT_PLAN;
    const teamsLimit = teamLimitForPlan(plan);
    const teamsUsed = await countActiveTeams(orgId);
    const createdAt = await orgCreatedAt(orgId);

    // Prefer the persisted date (what reminders + Stripe actually use); the
    // computed fallback only covers orgs that haven't picked a plan yet. The
    // computed value has a rolling now+49h floor, so re-deriving it on every
    // request would let the displayed date drift.
    const billingStartsAt = sub?.freeUntil ?? (createdAt
      ? sub?.billingStartsAt
        ? billingStartAtOrAfterPolicy(createdAt, sub.billingStartsAt)
        : billingStartDate(createdAt)
      : null);

    res.json({
      subscription: serializeSubscription(sub, promo),
      // Extra-spec: staged promo + plan tier from admin creation (see above).
      pendingPromo,
      pendingPlan,
      plans: PLAN_CATALOG,
      // The org's real policy charge date (including the legacy floor).
      billingStartsAt: billingStartsAt?.toISOString() ?? null,
      freePeriodDays: FREE_PERIOD_DAYS,
      usage: {
        plan,
        teamsUsed,
        teamsLimit,
        teamsRemaining:
          teamsLimit == null ? null : Math.max(0, teamsLimit - teamsUsed),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// PUT /organizations/:orgId/subscription — choose / change plan (+ promo).
// ---------------------------------------------------------------------------
const SubscribeBody = z.object({
  referralCode: z.string().trim().min(1).max(64).optional(),
  plan: z.enum(PLAN_IDS),
  promoCode: z
    .string()
    .trim()
    .max(64)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

router.put(
  "/organizations/:orgId/subscription",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated", { code: "UNAUTHENTICATED" });
      return;
    }
    const orgId = req.params.orgId as string;
    if (!(await canManageOrganization(me.id, orgId))) {
      apiError(res, 403, "You don't manage this organization.", {
        code: "FORBIDDEN",
      });
      return;
    }
    const parsed = SubscribeBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.errors[0]?.message ?? "Invalid plan.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    const { plan, promoCode, referralCode } = parsed.data;

    const [currentPromo] = await db
      .select()
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.organizationId, orgId))
      .limit(1);
    const currentPromoId = currentPromo?.promoCodeId ?? null;
    const [orgPromoState] = await db
      .select({ pendingPromoCodeId: organizations.pendingPromoCodeId })
      .from(organizations)
      .where(eq(organizations.id, orgId as string))
      .limit(1);
    let promoRow: Awaited<ReturnType<typeof findRedeemablePromo>> = null;
    if (promoCode) {
      promoRow = await findRedeemablePromo(promoCode);
      // A capped promo may appear fully redeemed because this organization
      // already owns one of its staged reservations. Let the transaction
      // validate and consume that reservation instead of rejecting it here.
      if (!promoRow) {
        const [reservedPromo] = await db
          .select()
          .from(promoCodes)
          .where(eq(promoCodes.code, promoCode.trim().toLowerCase()))
          .limit(1);
        if (!reservedPromo && currentPromo?.freeAccessPromo?.code === promoCode.trim().toLowerCase() &&
            currentPromo.freeUntil && !currentPromo.promoCodeId) {
          const saved = await db.transaction(async (tx) => {
            const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for("update");
            const [sub] = await tx.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, orgId)).for("update");
            if (!org || !sub?.freeUntil || sub.promoCodeId || sub.freeAccessPromo?.code !== promoCode.trim().toLowerCase()) return null;
            if (sub.stripeSubscriptionId && sub.plan !== plan) return null;
            if ((!sub.stripeSubscriptionId && !sub.stripeCustomerId && ["active", "past_due"].includes(sub.status))) return null;
            const verified = await verifyUnpaidBilling({ orgId, subscriptionId: sub.stripeSubscriptionId,
              customerId: sub.stripeCustomerId, plan: sub.plan, freeUntil: sub.freeUntil, apply: Boolean(sub.stripeSubscriptionId) });
            if (verified.status !== "eligible") return null;
            const referral = await checkReferral(tx, orgId, referralCode);
            await attachReferral(tx, org, referral);
            const [updated] = await tx.update(orgSubscriptions).set({ plan, updatedAt: new Date() })
              .where(eq(orgSubscriptions.id, sub.id)).returning();
            return updated;
          });
          if (!saved) { apiError(res, 409, "The saved free-access billing state needs review.", { code: "FREE_ACCESS_BLOCKED" }); return; }
          res.json({ subscription: serializeSubscription(saved, saved.freeAccessPromo) }); return;
        }
        if (
          reservedPromo &&
          (reservedPromo.id === orgPromoState?.pendingPromoCodeId ||
            reservedPromo.id === currentPromoId) &&
          reservedPromo.active &&
          (!reservedPromo.expiresAt ||
            reservedPromo.expiresAt.getTime() > Date.now())
        ) {
          promoRow = reservedPromo;
        }
      }
      if (!promoRow) {
        apiError(res, 400, "That promo code isn't valid.", {
          code: "PROMO_INVALID",
        });
        return;
      }
    }

    const newPromoId = promoRow?.id ?? null;
    if (referralCode && !isFree2027Offer(promoRow)) {
      apiError(res, 400, "Use FREE2027 or a linked free-access code and enter the competition referral tag separately.", { code: "VALIDATION_FAILED" });
      return;
    }

    // Once a Stripe subscription exists (card on file), its price, coupon,
    // and trial_end are already fixed in Stripe. Changing the local plan or
    // promo here would silently diverge from what Stripe will charge — so
    // lock edits and direct the user to cancel billing first (free during
    // the trial), then re-pick a plan and re-checkout.
    const [current] = await db
      .select()
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.organizationId, orgId))
      .limit(1);
    if (
      current?.stripeSubscriptionId &&
      (current.plan !== plan || (current.promoCodeId ?? null) !== newPromoId) &&
      !isFree2027Offer(promoRow)
    ) {
      apiError(
        res,
        409,
        "You already have a card on file for your current plan. Cancel billing first (free during your trial), then pick a new plan.",
        { code: "PLAN_LOCKED" },
      );
      return;
    }

    const createdAt = await orgCreatedAt(orgId);
    if (!createdAt) {
      apiError(res, 404, "Organization not found.", { code: "NOT_FOUND" });
      return;
    }
    if (promoRow && isFree2027Offer(promoRow)) {
      let applied;
      try { applied = await processFree2027(orgId as string, me, "apply", plan, referralCode, promoRow.code); }
      catch (err) {
        apiError(res, current ? 400 : 409, err instanceof Error ? err.message : "Could not save referral attribution.", { code: "REFERRAL_INVALID" });
        return;
      }
      if (!["applied", "unchanged"].includes(applied.status)) {
        apiError(res, 409, applied.reason, { code: "FREE_ACCESS_BLOCKED" }); return;
      }
      const [updated] = await db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, orgId as string));
      res.json({ subscription: serializeSubscription(updated, publicPromo(promoRow)) }); return;
    }
    let offerUntil: Date | null;
    try { offerUntil = promoRow ? availableFreeUntil(promoRow)
      : !newPromoId && current?.promoCodeId == null ? current?.freeUntil ?? null : null; }
    catch { apiError(res, 400, "This free-access offer has expired or is too close to billing.", { code: "PROMO_EXPIRED" }); return; }
    const startsAt = offerUntil ?? billingStartDate(createdAt);

    // Upsert the subscription and keep promo redemption counts in lockstep in
    // a single transaction: when the applied promo changes we decrement the
    // old code and increment the new one so `maxRedemptions` is actually
    // enforced over time.
    const subscriptionResult = await db.transaction(async (tx) => {
      const orgResult = await tx.execute<{
        pending_promo_code_id: string | null;
      }>(sql`
        SELECT pending_promo_code_id
        FROM organizations
        WHERE id = ${orgId as string}
        FOR UPDATE
      `);
      const lockedOrg = (orgResult.rows ?? orgResult)[0] as
        | { pending_promo_code_id: string | null }
        | undefined;
      let referral;
      try { referral = await checkReferral(tx, orgId as string, referralCode); }
      catch (err) {
        return { error: err instanceof Error ? err.message : "Invalid competition referral." } as const;
      }
      const [existing] = await tx
        .select({
          promoCodeId: orgSubscriptions.promoCodeId,
          plan: orgSubscriptions.plan,
          stripeSubscriptionId: orgSubscriptions.stripeSubscriptionId,
          freeUntil: orgSubscriptions.freeUntil,
          freeAccessPromo: orgSubscriptions.freeAccessPromo,
        })
        .from(orgSubscriptions)
        .where(eq(orgSubscriptions.organizationId, orgId))
        .limit(1);
      const oldPromoId = existing?.promoCodeId ?? null;
      if (
        existing?.stripeSubscriptionId &&
        (existing.plan !== plan || oldPromoId !== newPromoId)
      ) {
        return { error: "Cancel billing before changing your plan or promo.", locked: true } as const;
      }

      let appliedPromo: {
        code: string;
        discount_type: "percent" | "amount" | "free_until";
        discount_value: number;
        free_until: Date | null;
      } | null = null;
      if (newPromoId) {
        type LockedPromo = {
          id: string;
          code: string;
          discount_type: "percent" | "amount" | "free_until";
          discount_value: number;
          free_until: Date | null;
          active: boolean;
          expires_at: Date | null;
          max_redemptions: number | null;
          redemption_count: number;
        };
        const promoResult = await tx.execute<LockedPromo>(sql`
          SELECT id, code, discount_type, discount_value, free_until,
                 active, expires_at, max_redemptions, redemption_count
          FROM promo_codes
          WHERE id = ${newPromoId} OR id = ${oldPromoId}
          ORDER BY id
          FOR UPDATE
        `);
        const lockedPromo = (promoResult.rows ?? promoResult).find((row) => row.id === newPromoId) as
          | LockedPromo
          | undefined;
        if (
          !lockedPromo ||
          !lockedPromo.active ||
          (lockedPromo.expires_at &&
            new Date(lockedPromo.expires_at).getTime() <= Date.now())
        ) {
          return {
            error: "That promo code is no longer active.",
          } as const;
        }
        appliedPromo = lockedPromo;
        if (lockedPromo.discount_type === "free_until") {
          const lockedUntil = availableFreeUntil({ discountType: "free_until", freeUntil: lockedPromo.free_until ? new Date(lockedPromo.free_until) : null });
          if (lockedUntil?.getTime() !== offerUntil?.getTime()) {
            return { error: "The promo terms changed. Reload and try again." } as const;
          }
        }
        if (lockedPromo.max_redemptions != null) {
          const [pending] = await tx
            .select({ count: sql<number>`count(*)` })
            .from(organizations)
            .where(eq(organizations.pendingPromoCodeId, newPromoId));
          const hasThisReservation =
            lockedOrg?.pending_promo_code_id === newPromoId;
          const isAlreadyRedeemed = oldPromoId === newPromoId;
          const committed =
            lockedPromo.redemption_count + Number(pending?.count ?? 0);
          const additionalCapacity =
            hasThisReservation || isAlreadyRedeemed ? 0 : 1;
          if (
            committed + additionalCapacity >
            lockedPromo.max_redemptions
          ) {
            return {
              error:
                "That promo code has reached its redemption limit.",
            } as const;
          }
        }
      }

      const [row] = await tx
        .insert(orgSubscriptions)
        .values({
          organizationId: orgId,
          plan,
          status: "trialing",
          promoCodeId: newPromoId,
          billingStartsAt: startsAt,
          freeUntil: offerUntil,
        })
        .onConflictDoUpdate({
          target: orgSubscriptions.organizationId,
          set: {
            plan,
            promoCodeId: newPromoId,
            // Stamp the charge date exactly once. Existing rows are reconciled
            // by the legacy-floor migration; preserving later stored dates
            // avoids moving the date on repeated plan edits.
            billingStartsAt: offerUntil || existing?.freeUntil
              ? startsAt : sql`COALESCE(${orgSubscriptions.billingStartsAt}, ${startsAt})`,
            freeUntil: offerUntil,
            freeAccessPromo: offerUntil
              ? appliedPromo ? { code: appliedPromo.code, discountType: "free_until" as const,
                discountValue: 0, freeUntil: offerUntil.toISOString() } : existing?.freeAccessPromo ?? null
              : null,
            trialReminderSentAt: offerUntil ? null : undefined,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (oldPromoId !== newPromoId) {
        if (oldPromoId) {
          await tx
            .update(promoCodes)
            .set({
              redemptionCount: sql`GREATEST(0, ${promoCodes.redemptionCount} - 1)`,
            })
            .where(eq(promoCodes.id, oldPromoId));
        }
        if (newPromoId) {
          await tx
            .update(promoCodes)
            .set({ redemptionCount: sql`${promoCodes.redemptionCount} + 1` })
            .where(eq(promoCodes.id, newPromoId));
          const [org] = await tx
            .select({ name: organizations.name })
            .from(organizations)
            .where(eq(organizations.id, orgId))
            .limit(1);
          // The subscription UPDATE trigger closes the previous application
          // before this insert. Snapshots remain even after entity deletion.
          await tx.insert(promoUsage).values({
            promoCodeId: newPromoId,
            organizationId: orgId,
            actorUserId: me.id,
            code: appliedPromo!.code,
            organizationName: org!.name,
            actorName: me.name,
            actorEmail: me.email,
            plan,
            discountType: appliedPromo!.discount_type,
            discountValue: appliedPromo!.discount_value,
            freeUntil: offerUntil,
            appliedAt: new Date(),
          });
        }
      }
      // A staged promo is a one-time handoff hint. Once the organization
      // chooses its subscription (including choosing no promo), clear it in
      // the same transaction so admin reporting never shows a redeemed code as
      // both staged and applied.
      await tx
        .update(organizations)
        .set({ pendingPromoCodeId: null })
        .where(eq(organizations.id, orgId as string));
      if (referral) {
        const [org] = await tx.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, orgId as string));
        if (org) await attachReferral(tx, org, referral);
      }
      return row;
    });
    if (
      subscriptionResult &&
      typeof subscriptionResult === "object" &&
      "error" in subscriptionResult
    ) {
      apiError(res, 409, subscriptionResult.error, {
        code: "locked" in subscriptionResult ? "PLAN_LOCKED" : "PROMO_INVALID",
      });
      return;
    }
    const sub = subscriptionResult;

    const promo = promoRow
      ? {
          code: promoRow.code,
          discountType: promoRow.discountType,
          discountValue: promoRow.discountValue,
        }
      : null;

    res.json({ subscription: serializeSubscription(sub, promo) });
  }),
);

// ---------------------------------------------------------------------------
// POST /organizations/:orgId/billing/checkout-session — start the "add a card
// on file" flow. Returns a Stripe Checkout URL. The card is saved now and the
// first charge runs automatically on its policy billing date; nothing is
// charged today. The org must have chosen a plan first (PUT subscription).
// ---------------------------------------------------------------------------
router.post(
  "/organizations/:orgId/billing/checkout-session",
  requireAuth,
  billingCheckoutLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated", { code: "UNAUTHENTICATED" });
      return;
    }
    const orgId = req.params.orgId;
    if (!(await canManageOrganization(me.id, orgId))) {
      apiError(res, 403, "You don't manage this organization.", {
        code: "FORBIDDEN",
      });
      return;
    }
    const [sub] = await db
      .select()
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.organizationId, orgId))
      .limit(1);
    if (!sub) {
      apiError(res, 400, "Choose a plan before adding a card.", {
        code: "NO_PLAN",
      });
      return;
    }

    let promo:
      | { code: string; discountType: "percent" | "amount" | "free_until"; discountValue: number }
      | null = null;
    if (sub.promoCodeId) {
      const [row] = await db
        .select()
        .from(promoCodes)
        .where(eq(promoCodes.id, sub.promoCodeId))
        .limit(1);
      if (row) {
        promo = {
          code: row.code,
          discountType: row.discountType,
          discountValue: row.discountValue,
        };
      }
    }
    if (sub.freeUntil && sub.freeAccessPromo) promo = sub.freeAccessPromo;

    const createdAt = await orgCreatedAt(orgId);
    if (!createdAt) {
      apiError(res, 404, "Organization not found.", { code: "NOT_FOUND" });
      return;
    }

    const result = await createCardOnFileCheckout({
      orgId,
      plan: sub.plan,
      customerEmail: me.email ?? null,
      existingCustomerId: sub.stripeCustomerId,
      promo,
      orgCreatedAt: createdAt,
      // Persisted charge date is the source of truth — keeps the Stripe
      // trial_end aligned with the date the UI and reminder emails show
      // (matters for legacy orgs whose date was migration-stamped).
      billingStartsAt: sub.billingStartsAt ?? null,
      freeUntil: sub.freeUntil,
    });
    if ("error" in result) {
      const msg =
        result.error === "STRIPE_NOT_CONFIGURED"
          ? "Card payments aren't available right now. Please try again later."
          : "Couldn't start checkout. Please try again.";
      apiError(res, 503, msg, { code: result.error });
      return;
    }
    // Persist the exact date sent to Stripe before returning the Checkout URL.
    // This keeps UI/reminders aligned even if the user completes Checkout but
    // closes the tab before the success-redirect reconciliation runs.
    await db
      .update(orgSubscriptions)
      .set({ billingStartsAt: result.trialEnd, updatedAt: new Date() })
      .where(eq(orgSubscriptions.organizationId, orgId));
    res.json({ url: result.url });
  }),
);

// ---------------------------------------------------------------------------
// POST /organizations/:orgId/billing/reconcile — finalize after Checkout. The
// success redirect carries the session id; we read it back from Stripe and
// persist the customer + subscription ids and status onto the org.
// ---------------------------------------------------------------------------
const ReconcileBody = z.object({
  sessionId: z.string().trim().min(1).max(255),
});

router.post(
  "/organizations/:orgId/billing/reconcile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated", { code: "UNAUTHENTICATED" });
      return;
    }
    const orgId = req.params.orgId;
    if (!(await canManageOrganization(me.id, orgId))) {
      apiError(res, 403, "You don't manage this organization.", {
        code: "FORBIDDEN",
      });
      return;
    }
    const parsed = ReconcileBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, "Missing checkout session.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    const info = await readCheckoutSession(parsed.data.sessionId);
    if ("error" in info) {
      apiError(res, 503, "Couldn't verify checkout. Please try again.", {
        code: info.error,
      });
      return;
    }
    // Guard: the session must belong to this org. Fail closed — a session
    // with no orgId stamped on it cannot be trusted to belong here.
    if (info.orgId !== orgId) {
      apiError(res, 403, "This checkout doesn't belong to this organization.", {
        code: "FORBIDDEN",
      });
      return;
    }

    const createdAt = await orgCreatedAt(orgId);
    let effectiveTrialEnd = info.trialEnd;
    const [currentSub] = await db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, orgId));
    // An administrator may assign the offer while an older Checkout tab is
    // still open. Align that verified, unpaid subscription before accepting it.
    if (currentSub?.freeUntil) {
      if (!info.subscriptionId || !info.customerId || !info.trialEnd ||
          (currentSub.stripeSubscriptionId && currentSub.stripeSubscriptionId !== info.subscriptionId) ||
          (currentSub.stripeCustomerId && currentSub.stripeCustomerId !== info.customerId)) {
        apiError(res, 409, "Could not verify the free-access subscription and saved customer.", { code: "FREE_ACCESS_DATE_MISMATCH" }); return;
      }
      const aligned = await verifyUnpaidBilling({
        orgId: orgId as string, subscriptionId: info.subscriptionId, customerId: info.customerId,
        plan: currentSub.plan, freeUntil: currentSub.freeUntil, apply: true,
      });
      if (aligned.status !== "eligible") {
        apiError(res, 409, aligned.reason, { code: "FREE_ACCESS_DATE_MISMATCH" }); return;
      }
      effectiveTrialEnd = currentSub.freeUntil;
    }
    if (
      createdAt &&
      info.subscriptionId &&
      info.trialEnd &&
      info.status === "trialing"
    ) {
      const synced = await ensureStripeTrialEndAtPolicy({
        subscriptionId: info.subscriptionId,
        status: info.status,
        trialEnd: effectiveTrialEnd!,
        orgCreatedAt: createdAt,
        freeUntil: currentSub?.freeUntil,
      });
      if ("error" in synced) {
        apiError(
          res,
          503,
          "Couldn't align the scheduled billing date. Please try again.",
          { code: synced.error },
        );
        return;
      }
      effectiveTrialEnd = synced.trialEnd;
    }

    const set: Partial<typeof orgSubscriptions.$inferInsert> = {
      status: currentSub?.freeUntil ? "trialing" : info.status,
      updatedAt: new Date(),
    };
    if (info.customerId) set.stripeCustomerId = info.customerId;
    if (info.subscriptionId) set.stripeSubscriptionId = info.subscriptionId;
    // Stripe's trial_end is the actual charge instant. Keep it as the local
    // source of truth, but never let an old/malformed Checkout Session move a
    // legacy organization back below its first-charge floor.
    if (effectiveTrialEnd) {
      set.billingStartsAt = currentSub?.freeUntil ? effectiveTrialEnd : createdAt
        ? billingStartAtOrAfterPolicy(createdAt, effectiveTrialEnd)
        : effectiveTrialEnd;
    }

    const [sub] = await db
      .update(orgSubscriptions)
      .set(set)
      .where(eq(orgSubscriptions.organizationId, orgId))
      .returning();

    let promo: { code: string; discountType: string; discountValue: number } | null =
      null;
    if (sub?.promoCodeId) {
      const [row] = await db
        .select()
        .from(promoCodes)
        .where(eq(promoCodes.id, sub.promoCodeId))
        .limit(1);
      if (row) {
        promo = {
          code: row.code,
          discountType: row.discountType,
          discountValue: row.discountValue,
        };
      }
    }
    res.json({ subscription: serializeSubscription(sub, promo) });
  }),
);

// ---------------------------------------------------------------------------
// POST /organizations/:orgId/billing/cancel — cancel the scheduled billing.
// During the free period this cancels the Stripe subscription (still trialing,
// so nothing was ever charged) and removes the card on file. The org keeps its
// chosen plan and stays usable through the free period.
// ---------------------------------------------------------------------------
router.post(
  "/organizations/:orgId/billing/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated", { code: "UNAUTHENTICATED" });
      return;
    }
    const orgId = req.params.orgId;
    if (!(await canManageOrganization(me.id, orgId))) {
      apiError(res, 403, "You don't manage this organization.", {
        code: "FORBIDDEN",
      });
      return;
    }
    const [sub] = await db
      .select()
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.organizationId, orgId))
      .limit(1);
    if (!sub?.stripeSubscriptionId) {
      // Nothing scheduled — idempotent success.
      res.json({ ok: true, canceled: false });
      return;
    }
    // Cancel-free is a free-period-only escape hatch: once the subscription
    // has been charged (status past "trialing"), self-serve cancel would
    // rewrite paid state — direct those orgs to support instead.
    if (sub.status !== "trialing") {
      apiError(
        res,
        409,
        "Your subscription is already active. Contact support to make billing changes.",
        { code: "SUBSCRIPTION_ACTIVE" },
      );
      return;
    }
    const result = await cancelStripeSubscription(sub.stripeSubscriptionId);
    if ("error" in result) {
      apiError(res, 503, "Couldn't cancel billing. Please try again.", {
        code: result.error,
      });
      return;
    }
    await db
      .update(orgSubscriptions)
      .set({
        stripeSubscriptionId: null,
        status: "trialing",
        updatedAt: new Date(),
      })
      .where(eq(orgSubscriptions.organizationId, orgId));
    res.json({ ok: true, canceled: true });
  }),
);

// ---------------------------------------------------------------------------
// Admin promo-code management.
// ---------------------------------------------------------------------------
function adminPromo(row: typeof promoCodes.$inferSelect) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    linkedOffer: row.linkedOffer,
    discountType: row.discountType,
    discountValue: row.discountValue,
    freeUntil: row.freeUntil?.toISOString() ?? null,
    active: row.active,
    maxRedemptions: row.maxRedemptions,
    redemptionCount: row.redemptionCount,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get(
  "/admin/promo-codes",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(promoCodes)
      .orderBy(desc(promoCodes.createdAt));
    res.json({ data: rows.map(adminPromo) });
  }),
);

// Dates filter application instants in inclusive UTC calendar days. For
// pre-tracking current promos, subscription creation is the best available
// estimate when the subscription was created after the code existed.
// Everything else without a trustworthy date remains in a separate bucket.
router.get(
  "/admin/promo-usage",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const filters = parseUsageFilters(req.query);
    if (!filters) {
      apiError(res, 400, "Use valid UTC dates (YYYY-MM-DD), with start before end.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    const from = filters.from ? new Date(`${filters.from}T00:00:00Z`) : null;
    const toExclusive = filters.to
      ? new Date(Date.parse(`${filters.to}T00:00:00Z`) + 86_400_000)
      : null;
    // Raw aliases are deliberate: interpolating Drizzle columns inside a
    // sql`` expression can render unqualified names across these joins.
    const effectiveAt = sql<Date>`coalesce("promo_usage"."applied_at",
      CASE WHEN "promo_usage"."ended_at" IS NULL
        AND "org_subscriptions"."promo_code_id" = "promo_usage"."promo_code_id"
        AND "org_subscriptions"."created_at" >= "promo_codes"."created_at"
      THEN "org_subscriptions"."created_at" AT TIME ZONE 'UTC' END)`;
    const joins = () => db.select({ usage: promoUsage, effectiveAt })
      .from(promoUsage)
      .leftJoin(orgSubscriptions, eq(orgSubscriptions.organizationId, promoUsage.organizationId))
      .leftJoin(promoCodes, eq(promoCodes.id, promoUsage.promoCodeId));
    const where = from || toExclusive
      ? and(from ? gte(effectiveAt, from) : undefined,
          toExclusive ? lt(effectiveAt, toExclusive) : undefined)
      : undefined;
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(promoUsage)
      .leftJoin(orgSubscriptions, eq(orgSubscriptions.organizationId, promoUsage.organizationId))
      .leftJoin(promoCodes, eq(promoCodes.id, promoUsage.promoCodeId))
      .where(where);
    const select = joins().where(where)
      .orderBy(sql`${effectiveAt} DESC NULLS LAST`, desc(promoUsage.id));
    const rows = filters.format === "csv"
      ? await select
      : await select.limit(25).offset((filters.page - 1) * 25);
    const filtered = Boolean(from || toExclusive);
    const [{ total: undatedTotal }] = filtered
      ? await db.select({ total: sql<number>`count(*)` }).from(promoUsage)
          .leftJoin(orgSubscriptions, eq(orgSubscriptions.organizationId, promoUsage.organizationId))
          .leftJoin(promoCodes, eq(promoCodes.id, promoUsage.promoCodeId))
          .where(isNull(effectiveAt))
      : [{ total: 0 }];
    const undated = filtered
      ? filters.format === "csv"
        ? await joins().where(isNull(effectiveAt))
            .orderBy(desc(promoUsage.id))
        : await joins().where(isNull(effectiveAt))
            .orderBy(desc(promoUsage.id)).limit(25)
      : [];
    const toUsage = (row: (typeof rows)[number]): UsageRow => ({
      ...row.usage,
      // Raw SQL expressions arrive as timestamp strings, unlike Drizzle's
      // mapped timestamp columns.
      appliedAt: row.effectiveAt ? new Date(row.effectiveAt as unknown as string) : null,
      datePrecision: row.usage.appliedAt ? "exact" : row.effectiveAt ? "estimated" : "unknown",
    });
    const rawReport = rows.map(toUsage);
    const rawLegacy = undated.map(toUsage);
    // Snapshots survive deletion; only Stripe invoices prove paid billing.
    const billing = await resolvePromoBilling([...rawReport, ...rawLegacy]);
    const report: UsageRow[] = rawReport.map((row) => ({ ...row, ...billing.get(row.id) }));
    const legacy: UsageRow[] = rawLegacy.map((row) => ({ ...row, ...billing.get(row.id) }));
    if (filters.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="promo-usage.csv"');
      res.send(usageCsv([...report, ...legacy], filtered));
      return;
    }
    const serialize = (row: UsageRow) => ({
      ...row,
      appliedAt: row.appliedAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      billedAt: row.billedAt?.toISOString() ?? null,
    });
    res.json({
      data: report.map(serialize),
      legacy: legacy.map(serialize),
      legacyTotal: Number(undatedTotal),
      total: Number(total),
      page: filters.page,
      pageSize: 25,
      legacyExcluded: filtered,
      timezone: "UTC",
    });
  }),
);

// ---------------------------------------------------------------------------
// Admin organizations + subscriptions overview.
//
// Lists every organization left-joined to its (optional) subscription and the
// applied or staged promo code, so admins can see each org's plan, status, and
// whether a discount is in play — all in one place. `?promoOnly=true` narrows
// the list to orgs that have a promo code applied or waiting for redemption.
// Sorted most-recently-subscribed
// first, with un-subscribed orgs last.
// ---------------------------------------------------------------------------
const pendingPromoCodes = alias(promoCodes, "pending_promo_codes");

type AdminOrgRow = {
  orgId: string;
  orgName: string;
  plan: (typeof orgSubscriptions.$inferSelect)["plan"] | null;
  status: (typeof orgSubscriptions.$inferSelect)["status"] | null;
  billingStartsAt: Date | null;
  subscriptionUpdatedAt: Date | null;
  subscriptionCreatedAt: Date | null;
  promoCode: string | null;
  pendingPromoCode: string | null;
  promoDiscountType: (typeof promoCodes.$inferSelect)["discountType"] | null;
  promoDiscountValue: number | null;
  promoExpiresAt: Date | null;
  promoFreeUntil?: Date | null;
  grantedFreeUntil?: Date | null;
  freeAccessPromo?: typeof orgSubscriptions.$inferSelect["freeAccessPromo"];
  pendingPromoFreeUntil?: Date | null;
  pendingPromoDiscountType:
    | (typeof promoCodes.$inferSelect)["discountType"]
    | null;
  pendingPromoDiscountValue: number | null;
  pendingPromoExpiresAt: Date | null;
};

function adminOrgRow(r: AdminOrgRow) {
  return {
    organizationId: r.orgId,
    organizationName: r.orgName,
    plan: r.plan,
    status: r.status,
    billingStartsAt: r.billingStartsAt?.toISOString() ?? null,
    promoFreeUntil: (r.grantedFreeUntil ?? r.promoFreeUntil ?? r.pendingPromoFreeUntil)?.toISOString() ?? null,
    subscribedAt:
      (r.subscriptionUpdatedAt ?? r.subscriptionCreatedAt)?.toISOString() ??
      null,
    promoCode: r.freeAccessPromo?.code ?? r.promoCode,
    pendingPromoCode: r.pendingPromoCode,
    promoDiscountType:
      r.freeAccessPromo?.discountType ?? r.promoDiscountType ?? r.pendingPromoDiscountType,
    promoDiscountValue:
      r.freeAccessPromo?.discountValue ?? r.promoDiscountValue ?? r.pendingPromoDiscountValue,
    promoExpiresAt:
      (r.promoExpiresAt ?? r.pendingPromoExpiresAt)?.toISOString() ?? null,
  };
}

router.get(
  "/admin/organizations",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const promoOnly =
      req.query.promoOnly === "true" || req.query.promoOnly === "1";
    const rows = await db
      .select({
        orgId: organizations.id,
        orgName: organizations.name,
        plan: orgSubscriptions.plan,
        status: orgSubscriptions.status,
        billingStartsAt: orgSubscriptions.billingStartsAt,
        subscriptionUpdatedAt: orgSubscriptions.updatedAt,
        subscriptionCreatedAt: orgSubscriptions.createdAt,
        promoCode: promoCodes.code,
        pendingPromoCode: pendingPromoCodes.code,
        promoDiscountType: promoCodes.discountType,
        promoDiscountValue: promoCodes.discountValue,
        promoExpiresAt: promoCodes.expiresAt,
        promoFreeUntil: promoCodes.freeUntil,
        grantedFreeUntil: orgSubscriptions.freeUntil,
        freeAccessPromo: orgSubscriptions.freeAccessPromo,
        pendingPromoFreeUntil: pendingPromoCodes.freeUntil,
        pendingPromoDiscountType: pendingPromoCodes.discountType,
        pendingPromoDiscountValue: pendingPromoCodes.discountValue,
        pendingPromoExpiresAt: pendingPromoCodes.expiresAt,
      })
      .from(organizations)
      .leftJoin(
        orgSubscriptions,
        eq(orgSubscriptions.organizationId, organizations.id),
      )
      .leftJoin(promoCodes, eq(promoCodes.id, orgSubscriptions.promoCodeId))
      .leftJoin(
        pendingPromoCodes,
        eq(pendingPromoCodes.id, organizations.pendingPromoCodeId),
      )
      .where(
        promoOnly
          ? or(
              isNotNull(orgSubscriptions.promoCodeId),
              isNotNull(orgSubscriptions.freeAccessPromo),
              isNotNull(organizations.pendingPromoCodeId),
            )
          : undefined,
      )
      .orderBy(sql`${orgSubscriptions.updatedAt} DESC NULLS LAST`);
    res.json({ data: rows.map(adminOrgRow) });
  }),
);

const CreatePromoBody = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Code must be at least 2 characters")
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Use only letters, numbers, dashes, or underscores"),
  description: z.string().trim().max(280).optional().nullable(),
  linkedOffer: z.literal("free2027").optional().nullable(),
  discountType: z.enum(["percent", "amount", "free_until"]).optional(),
  discountValue: z.number().int().min(0).optional(),
  freeUntil: z.string().datetime().optional().nullable(),
  active: z.boolean().optional(),
  maxRedemptions: z.number().int().min(1).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
}).refine(validateLinkedTerms, "Linked FREE2027 terms cannot include a discount or a different billing date.")
  .refine((b) => b.linkedOffer === "free2027" || (b.discountType !== undefined && b.discountValue !== undefined), "Choose a discount type and value.");

router.post(
  "/admin/promo-codes",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = CreatePromoBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.errors[0]?.message ?? "Invalid code.", {
        code: "VALIDATION_FAILED",
        extras: { fields: parsed.error.flatten().fieldErrors },
      });
      return;
    }
    const b = { ...parsed.data,
      discountType: parsed.data.linkedOffer === "free2027" ? "free_until" as const : parsed.data.discountType!,
      discountValue: parsed.data.linkedOffer === "free2027" ? 0 : parsed.data.discountValue!,
    };
    if (b.discountType !== "free_until" && b.discountValue < 1) {
      apiError(res, 400, "Enter a positive discount.", { code: "VALIDATION_FAILED" }); return;
    }
    const freeUntil = b.discountType === "free_until" ? new Date(b.freeUntil ?? FREE2027_FIRST_CHARGE) : null;
    if (freeUntil) {
      try { availableFreeUntil({ discountType: b.discountType, freeUntil }); }
      catch { apiError(res, 400, "Choose a future free-access billing date.", { code: "VALIDATION_FAILED" }); return; }
    }
    if (b.discountType === "percent" && b.discountValue > 100) {
      apiError(res, 400, "Percent discount can't exceed 100.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    const me = req.sessionUser;
    try {
      const [row] = await db
        .insert(promoCodes)
        .values({
          code: b.code.toLowerCase(),
          description: b.description ?? null,
          linkedOffer: b.linkedOffer ?? null,
          discountType: b.discountType,
          discountValue: b.discountType === "free_until" ? 0 : b.discountValue,
          freeUntil,
          active: b.active ?? true,
          maxRedemptions: b.maxRedemptions ?? null,
          expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
          createdById: me?.id ?? null,
        })
        .onConflictDoNothing({ target: promoCodes.code })
        .returning();
      if (!row) {
        apiError(res, 409, "That code already exists.", { code: "CONFLICT" }); return;
      }
      res.status(201).json({ promo: adminPromo(row) });
    } catch (err) {
      if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
        apiError(res, 409, "That code already exists.", { code: "CONFLICT" });
        return;
      }
      throw err;
    }
  }),
);

const UpdatePromoBody = z.object({
  linkedOffer: z.literal("free2027").optional().nullable(),
  description: z.string().trim().max(280).optional().nullable(),
  discountType: z.enum(["percent", "amount", "free_until"]).optional(),
  discountValue: z.number().int().min(0).optional(),
  freeUntil: z.string().datetime().optional().nullable(),
  active: z.boolean().optional(),
  maxRedemptions: z.number().int().min(1).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

router.patch(
  "/admin/promo-codes/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = UpdatePromoBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.errors[0]?.message ?? "Invalid update.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    const b = parsed.data;

    const [current] = await db
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.id, req.params.id))
      .limit(1);
    if (!current) {
      apiError(res, 404, "Promo code not found.", { code: "NOT_FOUND" });
      return;
    }
    if ((b.linkedOffer !== undefined && b.linkedOffer !== current.linkedOffer) ||
        !validateLinkedTerms({ ...b, linkedOffer: current.linkedOffer })) {
      apiError(res, 400, "The FREE2027 linkage and inherited terms cannot be changed. Create a new code instead.", { code: "VALIDATION_FAILED" });
      return;
    }
    // Guard percent discounts after merging the patch with the stored row, so
    // a percent code can never end up above 100 regardless of which field is
    // being changed.
    const effectiveType = b.discountType ?? current.discountType;
    const effectiveValue = b.discountValue ?? current.discountValue;
    const effectiveUntil = effectiveType === "free_until"
      ? new Date(b.freeUntil ?? current.freeUntil ?? FREE2027_FIRST_CHARGE) : null;
    if (effectiveType !== "free_until" && effectiveValue < 1) {
      apiError(res, 400, "Enter a positive discount.", { code: "VALIDATION_FAILED" }); return;
    }
    if (effectiveUntil && (b.discountType !== undefined || b.freeUntil !== undefined)) {
      try { availableFreeUntil({ discountType: effectiveType, freeUntil: effectiveUntil }); }
      catch { apiError(res, 400, "The free-access date must be in the future.", { code: "VALIDATION_FAILED" }); return; }
    }
    if (effectiveType === "percent" && effectiveValue > 100) {
      apiError(res, 400, "Percent discount can't exceed 100.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }

    const set: Partial<typeof promoCodes.$inferInsert> = { updatedAt: new Date() };
    if (b.description !== undefined) set.description = b.description ?? null;
    if (b.discountType !== undefined) set.discountType = b.discountType;
    if (b.discountValue !== undefined) set.discountValue = b.discountValue;
    set.freeUntil = effectiveUntil;
    if (effectiveType === "free_until") set.discountValue = 0;
    if (b.active !== undefined) set.active = b.active;
    if (b.maxRedemptions !== undefined) set.maxRedemptions = b.maxRedemptions ?? null;
    if (b.expiresAt !== undefined) {
      set.expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
    }
    const [row] = await db
      .update(promoCodes)
      .set(set)
      .where(eq(promoCodes.id, req.params.id))
      .returning();
    if (!row) {
      apiError(res, 404, "Promo code not found.", { code: "NOT_FOUND" });
      return;
    }
    res.json({ promo: adminPromo(row) });
  }),
);

router.delete(
  "/admin/promo-codes/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [row] = await db
      .delete(promoCodes)
      .where(eq(promoCodes.id, req.params.id))
      .returning();
    if (!row) {
      apiError(res, 404, "Promo code not found.", { code: "NOT_FOUND" });
      return;
    }
    res.json({ ok: true });
  }),
);

export default router;
