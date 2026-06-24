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
  popular: boolean;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    priceYearly: 1000,
    teamRange: "1–15 teams",
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
    popular: false,
    features: [
      "Unlimited teams",
      "Everything in Pro",
      "Dedicated onboarding",
      "Custom integrations",
    ],
  },
];

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
