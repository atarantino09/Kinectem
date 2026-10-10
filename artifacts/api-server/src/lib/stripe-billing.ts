import type Stripe from "stripe";
import { getStripeClient } from "./stripeClient.js";
import { MIN_CHECKOUT_LEAD_MS } from "./free-access-promo.js";

export type PlanTier = "starter" | "pro" | "elite";

// Yearly list price (whole USD) per tier. MUST stay in lockstep with the
// PLAN_CATALOG in routes/subscriptions.ts and the marketing pricing page.
export const PLAN_YEARLY_USD: Record<PlanTier, number> = {
  starter: 1000,
  pro: 1750,
  elite: 2500,
};

const PLAN_PRODUCT_NAME: Record<PlanTier, string> = {
  starter: "Kinectem Starter",
  pro: "Kinectem Pro",
  elite: "Kinectem Elite",
};

// Organizations created on/after the rollout cutoff get a rolling free period:
// 90 days from creation. Organizations that already existed when this policy
// shipped keep the same rolling calculation but cannot receive their first
// charge before the explicit legacy floor.
export const FREE_PERIOD_DAYS = 90;
export const LEGACY_BILLING_ROLLOUT_CUTOFF_ISO =
  "2026-08-20T00:00:00.000Z";
export const LEGACY_FIRST_CHARGE_FLOOR_ISO = "2026-11-01T00:00:00.000Z";

const DAY_MS = 24 * 60 * 60 * 1000;

// Stripe Checkout requires trial_end to be at least 48 hours in the future.
// For orgs already older than (90 days - 48h) we floor the trial end at the
// smallest safe value so checkout still succeeds and the charge kicks in at
// the next minimum Stripe allows.
const MIN_TRIAL_END_MS = 49 * 60 * 60 * 1000; // 48h Stripe minimum + 1h buffer

// The product-policy charge date before Stripe's operational minimum is
// applied. This never shortens a rolling 90-day period: legacy orgs receive
// the later of day 90 or Nov 1, while newer orgs receive day 90.
export function policyBillingStartDate(orgCreatedAt: Date): Date {
  const rollingTarget = new Date(
    orgCreatedAt.getTime() + FREE_PERIOD_DAYS * DAY_MS,
  );
  const isLegacy =
    orgCreatedAt.getTime() <
    new Date(LEGACY_BILLING_ROLLOUT_CUTOFF_ISO).getTime();
  if (!isLegacy) return rollingTarget;

  const legacyFloor = new Date(LEGACY_FIRST_CHARGE_FLOOR_ISO);
  return rollingTarget.getTime() > legacyFloor.getTime()
    ? rollingTarget
    : legacyFloor;
}

// Keep a persisted or Stripe-provided date from moving below the policy floor.
// A later persisted date remains authoritative and is never shortened.
export function billingStartAtOrAfterPolicy(
  orgCreatedAt: Date,
  candidate: Date,
): Date {
  const policyTarget = policyBillingStartDate(orgCreatedAt);
  return candidate.getTime() > policyTarget.getTime() ? candidate : policyTarget;
}

// A Stripe trial that is already on/after the product-policy date stays exact.
// If it is below policy, move it to the later of policy or Stripe's current
// minimum. This avoids repeatedly drifting a valid trial forward as `now`
// advances while still making an old sub-policy trial safe to update.
export function stripeTrialEndAtOrAfterPolicy(
  orgCreatedAt: Date,
  candidate: Date,
  now = new Date(),
): Date {
  const policyTarget = policyBillingStartDate(orgCreatedAt);
  if (candidate.getTime() >= policyTarget.getTime()) return candidate;

  const stripeFloor = new Date(now.getTime() + MIN_TRIAL_END_MS);
  return policyTarget.getTime() > stripeFloor.getTime()
    ? policyTarget
    : stripeFloor;
}

// The first date that can safely be sent to a new Stripe Checkout Session:
// product policy, then Stripe's minimum from `now`.
export function billingStartDate(orgCreatedAt: Date, now = new Date()): Date {
  const target = policyBillingStartDate(orgCreatedAt);
  const floor = new Date(now.getTime() + MIN_TRIAL_END_MS);
  return target.getTime() > floor.getTime() ? target : floor;
}

// Public base URL of the app (no trailing slash). Mirrors email.ts.
function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://localhost:5173")
  ).replace(/\/+$/, "");
}

// The web app is served under /app/. Checkout returns the admin here.
export function orgSubscribeUrl(orgId: string): string {
  return `${appBaseUrl()}/app/organizations/${orgId}/subscribe`;
}

// Idempotently ensure a yearly recurring Price exists for a plan, keyed by a
// stable lookup_key, and return its id.
async function ensurePlanPriceId(
  stripe: Stripe,
  plan: PlanTier,
): Promise<string> {
  const lookupKey = `kinectem_${plan}_yearly`;
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  if (existing.data[0]) return existing.data[0].id;

  const product = await stripe.products.create({
    name: PLAN_PRODUCT_NAME[plan],
    metadata: { kinectem_plan: plan },
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: PLAN_YEARLY_USD[plan] * 100,
    recurring: { interval: "year" },
    lookup_key: lookupKey,
  });
  return price.id;
}

type PromoInput = {
  code: string;
  discountType: "percent" | "amount" | "free_until";
  discountValue: number;
};

// Idempotently ensure a Stripe coupon mirrors an app promo code, keyed by a
// stable id. Returns the coupon id, or null when it can't be expressed.
//
// Discounts apply to the FIRST YEAR ONLY: plans bill yearly, so a
// duration:"once" coupon discounts the first invoice (year 1) and renewals
// bill at full list price. Percent coupons use a `_y1` id suffix because
// earlier builds created `kinectem_promo_<code>` with duration:"forever" —
// the versioned id guarantees those legacy coupons are never reattached.
async function ensurePromoCouponId(
  stripe: Stripe,
  promo: PromoInput,
): Promise<string | null> {
  const couponId =
    promo.discountType === "percent"
      ? `kinectem_promo_${promo.code}_y1`
      : `kinectem_promo_${promo.code}`;
  try {
    const existing = (await stripe.coupons.retrieve(couponId)) as Stripe.Coupon & {
      deleted?: boolean;
    };
    if (!existing.deleted) return couponId;
  } catch {
    // Not found — fall through to create.
  }
  try {
    if (promo.discountType === "percent") {
      const pct = Math.min(100, Math.max(1, promo.discountValue));
      await stripe.coupons.create({
        id: couponId,
        percent_off: pct,
        duration: "once",
        name: `Promo ${promo.code} (first year)`,
      });
    } else {
      await stripe.coupons.create({
        id: couponId,
        amount_off: Math.max(1, promo.discountValue) * 100,
        currency: "usd",
        duration: "once",
        name: `Promo ${promo.code}`,
      });
    }
    return couponId;
  } catch {
    return null;
  }
}

export type CheckoutInput = {
  orgId: string;
  plan: PlanTier;
  customerEmail: string | null;
  existingCustomerId: string | null;
  promo: PromoInput | null;
  // When the org was created — drives the rolling trial and legacy floor.
  orgCreatedAt: Date;
  // The persisted charge date (org_subscriptions.billing_starts_at). When
  // set, it is the source of truth for trial_end so Stripe matches what the
  // UI and reminder emails display. Falls back to the computed date.
  billingStartsAt?: Date | null;
  freeUntil?: Date | null;
};

// The trial_end sent to Stripe: the persisted charge date when one exists,
// never earlier than the policy target, and always floored at Stripe's
// minimum from now.
export function checkoutTrialEnd(input: CheckoutInput, now = new Date()): Date {
  if (input.freeUntil) {
    if (input.freeUntil.getTime() <= now.getTime() + MIN_CHECKOUT_LEAD_MS) {
      throw new Error("The free-access billing date is too close or has passed.");
    }
    return input.freeUntil;
  }
  const candidate =
    input.billingStartsAt ?? policyBillingStartDate(input.orgCreatedAt);
  const policySafeCandidate = billingStartAtOrAfterPolicy(
    input.orgCreatedAt,
    candidate,
  );
  const stripeFloor = new Date(now.getTime() + MIN_TRIAL_END_MS);
  return policySafeCandidate.getTime() > stripeFloor.getTime()
    ? policySafeCandidate
    : stripeFloor;
}

// Create a Checkout Session that saves a card on file and schedules the first
// charge for the org's policy billing date. No charge happens today.
export async function createCardOnFileCheckout(
  input: CheckoutInput,
): Promise<{ url: string; trialEnd: Date } | { error: string }> {
  const stripe = await getStripeClient();
  if (!stripe) return { error: "STRIPE_NOT_CONFIGURED" };

  try {
    const priceId = await ensurePlanPriceId(stripe, input.plan);
    // Stripe stores trial_end at whole-second precision. Persist and return the
    // exact same instant we send so local state cannot differ by milliseconds.
    const trialEnd = new Date(
      Math.floor(checkoutTrialEnd(input).getTime() / 1000) * 1000,
    );

    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
    if (input.promo && input.promo.discountType !== "free_until" && !input.freeUntil) {
      const couponId = await ensurePromoCouponId(stripe, input.promo);
      if (couponId) discounts = [{ coupon: couponId }];
    }

    const successUrl = `${orgSubscribeUrl(input.orgId)}?billing=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${orgSubscribeUrl(input.orgId)}?billing=canceled`;
    const metadata = {
      orgId: input.orgId, plan: input.plan,
      ...(input.promo ? { promoCode: input.promo.code } : {}),
      ...(input.freeUntil ? { freeUntil: input.freeUntil.toISOString() } : {}),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(input.existingCustomerId
        ? { customer: input.existingCustomerId }
        : input.customerEmail
          ? { customer_email: input.customerEmail }
          : {}),
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_end: Math.floor(trialEnd.getTime() / 1000),
        metadata,
      },
      ...(discounts ? { discounts } : {}),
      client_reference_id: input.orgId,
      metadata,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    if (!session.url) return { error: "CHECKOUT_FAILED" };
    return { url: session.url, trialEnd };
  } catch {
    // Provisioning a price/coupon or creating the session failed (transient
    // Stripe error, bad key, etc.). Surface a controlled error to the caller.
    return { error: "CHECKOUT_FAILED" };
  }
}

// Reconcile an already-created Stripe subscription after verifying that its
// Checkout Session belongs to the requested organization. Old sessions made
// before the legacy floor shipped may still carry an early trial_end, so extend
// the live Stripe trial before persisting/displaying the corrected date.
export async function ensureStripeTrialEndAtPolicy(input: {
  subscriptionId: string;
  status: "trialing" | "active" | "past_due" | "canceled";
  trialEnd: Date;
  orgCreatedAt: Date;
  freeUntil?: Date | null;
}): Promise<{ trialEnd: Date } | { error: string }> {
  if (input.status !== "trialing") return { trialEnd: input.trialEnd };
  if (input.freeUntil) {
    if (input.trialEnd.getTime() === input.freeUntil.getTime()) return { trialEnd: input.trialEnd };
    return { error: "FREE_ACCESS_DATE_MISMATCH" };
  }

  const safeTrialEnd = stripeTrialEndAtOrAfterPolicy(
    input.orgCreatedAt,
    input.trialEnd,
  );
  const safeTrialEndUnix = Math.floor(safeTrialEnd.getTime() / 1000);
  const normalizedSafeTrialEnd = new Date(safeTrialEndUnix * 1000);
  if (input.trialEnd.getTime() >= normalizedSafeTrialEnd.getTime()) {
    return { trialEnd: input.trialEnd };
  }

  const stripe = await getStripeClient();
  if (!stripe) return { error: "STRIPE_NOT_CONFIGURED" };
  try {
    await stripe.subscriptions.update(input.subscriptionId, {
      trial_end: safeTrialEndUnix,
      proration_behavior: "none",
    });
    return { trialEnd: normalizedSafeTrialEnd };
  } catch {
    return { error: "TRIAL_SYNC_FAILED" };
  }
}

// Cancel a Stripe subscription immediately. During the free period (trial)
// this cancels with zero charge — the card was never billed. Treats an
// already-canceled/missing subscription as success so the flow is idempotent.
export async function cancelStripeSubscription(
  subscriptionId: string,
): Promise<{ ok: true } | { error: string }> {
  const stripe = await getStripeClient();
  if (!stripe) return { error: "STRIPE_NOT_CONFIGURED" };
  try {
    await stripe.subscriptions.cancel(subscriptionId);
    return { ok: true };
  } catch (err) {
    // Already canceled or gone — treat as success.
    const msg = err instanceof Error ? err.message : "";
    if (/No such subscription|canceled/i.test(msg)) return { ok: true };
    return { error: "CANCEL_FAILED" };
  }
}

// Map a Stripe subscription status to our org_subscriptions enum.
export function mapStripeStatus(
  status: Stripe.Subscription.Status | string | null | undefined,
): "trialing" | "active" | "past_due" | "canceled" {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "trialing";
  }
}

// Retrieve a completed Checkout Session and return the linked org + Stripe ids
// so the caller can persist them onto org_subscriptions.
export async function readCheckoutSession(sessionId: string): Promise<
  | {
      orgId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
      status: "trialing" | "active" | "past_due" | "canceled";
      trialEnd: Date | null;
    }
  | { error: string }
> {
  const stripe = await getStripeClient();
  if (!stripe) return { error: "STRIPE_NOT_CONFIGURED" };

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });
    const sub = session.subscription;
    const subscription =
      sub && typeof sub !== "string" ? (sub as Stripe.Subscription) : null;
    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : (session.customer?.id ?? null);

    return {
      orgId:
        (session.metadata?.orgId as string | undefined) ??
        session.client_reference_id ??
        null,
      customerId,
      subscriptionId: subscription?.id ?? (typeof sub === "string" ? sub : null),
      status: mapStripeStatus(subscription?.status),
      trialEnd: subscription?.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
    };
  } catch {
    // Invalid/expired session id or a transient Stripe error.
    return { error: "CHECKOUT_VERIFY_FAILED" };
  }
}
