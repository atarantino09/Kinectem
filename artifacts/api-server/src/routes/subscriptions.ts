import { Router, type IRouter } from "express";
import { db, promoCodes, orgSubscriptions } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
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

const router: IRouter = Router();

const ONE_MINUTE = 60 * 1000;

// ---------------------------------------------------------------------------
// Plan catalog + launch window
//
// Prices mirror the public marketing pricing page. Stripe is not connected
// yet — checkout records the chosen plan + promo so it can be wired to Stripe
// later. During the free launch window every new subscription stays
// "trialing" and real billing begins on BILLING_STARTS_AT.
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
    teamRange: "1–15 teams",
    maxTeams: PLAN_TEAM_LIMITS.starter,
    popular: false,
    features: [
      "Up to 15 teams",
      "Game recaps & highlights",
      "Player & parent profiles",
      "COPPA-compliant safety tools",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    priceYearly: 1750,
    teamRange: "16–40 teams",
    maxTeams: PLAN_TEAM_LIMITS.pro,
    popular: true,
    features: [
      "Up to 40 teams",
      "Everything in Starter",
      "AI Assist for recap writing",
      "Priority support",
    ],
  },
  {
    id: "elite",
    name: "Elite",
    priceYearly: 2500,
    teamRange: "41+ teams",
    maxTeams: PLAN_TEAM_LIMITS.elite,
    popular: false,
    features: [
      "Unlimited teams",
      "Everything in Pro",
      "Dedicated onboarding",
      "Custom integrations",
    ],
  },
];

const PLAN_IDS = PLAN_CATALOG.map((p) => p.id) as [PlanTier, ...PlanTier[]];

// Annual billing begins on this date. Until then the platform is free.
const BILLING_STARTS_AT = "2026-10-01T00:00:00.000Z";

const promoValidateLimiter = rateLimit({
  name: "promo-validate",
  windowMs: ONE_MINUTE,
  max: 20,
  keys: (req) => [ipKey(req)],
  message: "Too many promo code attempts. Please wait a moment and try again.",
});

// Resolve a redeemable promo code by its (case-insensitive) code. Returns the
// row only when it is active, not expired, and under its redemption cap.
async function findRedeemablePromo(rawCode: string) {
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
  if (row.maxRedemptions != null && row.redemptionCount >= row.maxRedemptions) {
    return null;
  }
  return row;
}

function publicPromo(row: NonNullable<Awaited<ReturnType<typeof findRedeemablePromo>>>) {
  return {
    code: row.code,
    description: row.description,
    discountType: row.discountType,
    discountValue: row.discountValue,
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
  promo: { code: string; discountType: string; discountValue: number } | null,
) {
  if (!sub) return null;
  return {
    id: sub.id,
    organizationId: sub.organizationId,
    plan: sub.plan,
    status: sub.status,
    promo,
    billingStartsAt: sub.billingStartsAt?.toISOString() ?? null,
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

    const plan = (sub?.plan as PlanTier | undefined) ?? DEFAULT_PLAN;
    const teamsLimit = teamLimitForPlan(plan);
    const teamsUsed = await countActiveTeams(orgId);

    res.json({
      subscription: serializeSubscription(sub, promo),
      plans: PLAN_CATALOG,
      billingStartsAt: BILLING_STARTS_AT,
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
    const orgId = req.params.orgId;
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
    const { plan, promoCode } = parsed.data;

    let promoRow: Awaited<ReturnType<typeof findRedeemablePromo>> = null;
    if (promoCode) {
      promoRow = await findRedeemablePromo(promoCode);
      if (!promoRow) {
        apiError(res, 400, "That promo code isn't valid.", {
          code: "PROMO_INVALID",
        });
        return;
      }
    }

    const newPromoId = promoRow?.id ?? null;

    // Upsert the subscription and keep promo redemption counts in lockstep in
    // a single transaction: when the applied promo changes we decrement the
    // old code and increment the new one so `maxRedemptions` is actually
    // enforced over time.
    const sub = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ promoCodeId: orgSubscriptions.promoCodeId })
        .from(orgSubscriptions)
        .where(eq(orgSubscriptions.organizationId, orgId))
        .limit(1);
      const oldPromoId = existing?.promoCodeId ?? null;

      const [row] = await tx
        .insert(orgSubscriptions)
        .values({
          organizationId: orgId,
          plan,
          status: "trialing",
          promoCodeId: newPromoId,
          billingStartsAt: new Date(BILLING_STARTS_AT),
        })
        .onConflictDoUpdate({
          target: orgSubscriptions.organizationId,
          set: {
            plan,
            promoCodeId: newPromoId,
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
        }
      }
      return row;
    });

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
// Admin promo-code management.
// ---------------------------------------------------------------------------
function adminPromo(row: typeof promoCodes.$inferSelect) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    discountType: row.discountType,
    discountValue: row.discountValue,
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

const CreatePromoBody = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Code must be at least 2 characters")
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Use only letters, numbers, dashes, or underscores"),
  description: z.string().trim().max(280).optional().nullable(),
  discountType: z.enum(["percent", "amount"]),
  discountValue: z.number().int().min(1, "Discount must be at least 1"),
  active: z.boolean().optional(),
  maxRedemptions: z.number().int().min(1).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

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
    const b = parsed.data;
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
          discountType: b.discountType,
          discountValue: b.discountValue,
          active: b.active ?? true,
          maxRedemptions: b.maxRedemptions ?? null,
          expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
          createdById: me?.id ?? null,
        })
        .returning();
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
  description: z.string().trim().max(280).optional().nullable(),
  discountType: z.enum(["percent", "amount"]).optional(),
  discountValue: z.number().int().min(1).optional(),
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
    // Guard percent discounts after merging the patch with the stored row, so
    // a percent code can never end up above 100 regardless of which field is
    // being changed.
    const effectiveType = b.discountType ?? current.discountType;
    const effectiveValue = b.discountValue ?? current.discountValue;
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
