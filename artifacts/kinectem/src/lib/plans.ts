// Subscription plan catalog. Prices mirror the public marketing pricing page.
// The server is the source of truth (GET /organizations/:orgId/subscription
// returns the same catalog); this client copy is used for instant rendering
// before that request resolves.
export type PlanTier = "starter" | "pro" | "elite";

export type Plan = {
  id: PlanTier;
  name: string;
  priceYearly: number;
  teamRange: string;
  // Max active teams allowed on this tier. `null` = unlimited (Elite).
  maxTeams: number | null;
  popular: boolean;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    priceYearly: 1000,
    teamRange: "For organizations with 1–15 teams",
    maxTeams: 15,
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
    maxTeams: 40,
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
    maxTeams: null,
    popular: false,
    features: [
      "Unlimited teams (41+)",
      "Everything in Pro",
      "Unlimited players & profiles",
      "COPPA-compliant guardian controls",
    ],
  },
];

// Plan usage for an org, mirrored from GET /organizations/:orgId/subscription.
export type OrgPlanUsage = {
  plan: PlanTier;
  teamsUsed: number;
  teamsLimit: number | null;
  teamsRemaining: number | null;
};

// The tier directly above `tier`, or null if already on the top (Elite) tier.
export function nextPlan(tier: PlanTier): Plan | null {
  const idx = PLANS.findIndex((p) => p.id === tier);
  if (idx < 0 || idx >= PLANS.length - 1) return null;
  return PLANS[idx + 1];
}

export type AppliedPromo = {
  code: string;
  description?: string | null;
  discountType: "percent" | "amount";
  discountValue: number;
};

// Returns the discounted annual price (in whole dollars) after applying a
// promo. Mirrors the server's interpretation of discountType.
export function applyPromo(priceYearly: number, promo: AppliedPromo | null): number {
  if (!promo) return priceYearly;
  if (promo.discountType === "percent") {
    return Math.max(0, Math.round(priceYearly * (1 - promo.discountValue / 100)));
  }
  return Math.max(0, priceYearly - promo.discountValue);
}

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}
