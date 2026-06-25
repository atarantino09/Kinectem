import type Stripe from "stripe";
import { getStripeClient } from "./stripeClient.js";

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

// Annual billing begins here. Card-on-file subscriptions are created with a
// trial that ends at this instant, so Stripe collects the card now and runs the
// first charge automatically on this date — nothing is charged today.
export const BILLING_STARTS_AT = "2026-10-01T00:00:00.000Z";

function billingTrialEndUnix(): number {
  return Math.floor(new Date(BILLING_STARTS_AT).getTime() / 1000);
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
  discountType: "percent" | "amount";
  discountValue: number;
};

// Idempotently ensure a Stripe coupon mirrors an app promo code, keyed by a
// stable id. Returns the coupon id, or null when it can't be expressed.
async function ensurePromoCouponId(
  stripe: Stripe,
  promo: PromoInput,
): Promise<string | null> {
  const couponId = `kinectem_promo_${promo.code}`;
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
        duration: "forever",
        name: `Promo ${promo.code}`,
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
};

// Create a Checkout Session that saves a card on file and schedules the first
// charge for BILLING_STARTS_AT (Oct 1). No charge happens today.
export async function createCardOnFileCheckout(
  input: CheckoutInput,
): Promise<{ url: string } | { error: string }> {
  const stripe = await getStripeClient();
  if (!stripe) return { error: "STRIPE_NOT_CONFIGURED" };

  try {
    const priceId = await ensurePlanPriceId(stripe, input.plan);

    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
    if (input.promo) {
      const couponId = await ensurePromoCouponId(stripe, input.promo);
      if (couponId) discounts = [{ coupon: couponId }];
    }

    const successUrl = `${orgSubscribeUrl(input.orgId)}?billing=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${orgSubscribeUrl(input.orgId)}?billing=canceled`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(input.existingCustomerId
        ? { customer: input.existingCustomerId }
        : input.customerEmail
          ? { customer_email: input.customerEmail }
          : {}),
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_end: billingTrialEndUnix(),
        metadata: { orgId: input.orgId, plan: input.plan },
      },
      ...(discounts ? { discounts } : {}),
      client_reference_id: input.orgId,
      metadata: { orgId: input.orgId, plan: input.plan },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    if (!session.url) return { error: "CHECKOUT_FAILED" };
    return { url: session.url };
  } catch {
    // Provisioning a price/coupon or creating the session failed (transient
    // Stripe error, bad key, etc.). Surface a controlled error to the caller.
    return { error: "CHECKOUT_FAILED" };
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
    };
  } catch {
    // Invalid/expired session id or a transient Stripe error.
    return { error: "CHECKOUT_VERIFY_FAILED" };
  }
}
