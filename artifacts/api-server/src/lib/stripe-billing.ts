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

// Every organization gets a rolling free period: 90 days from the moment the
// org is created. Card-on-file subscriptions are created with a trial that
// ends at that instant, so Stripe collects the card now and runs the first
// charge automatically on day 90 — nothing is charged today.
export const FREE_PERIOD_DAYS = 90;

// Stripe Checkout requires trial_end to be at least 48 hours in the future.
// For orgs already older than (90 days - 48h) we floor the trial end at the
// smallest safe value so checkout still succeeds and the charge kicks in at
// the next minimum Stripe allows.
const MIN_TRIAL_END_MS = 49 * 60 * 60 * 1000; // 48h Stripe minimum + 1h buffer

// The instant an org's card is charged: creation + 90 days, floored at the
// Stripe-safe minimum from `now`.
export function billingStartDate(orgCreatedAt: Date, now = new Date()): Date {
  const target = new Date(
    orgCreatedAt.getTime() + FREE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
  );
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
  discountType: "percent" | "amount";
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
  // When the org was created — drives the 90-day trial end.
  orgCreatedAt: Date;
  // The persisted charge date (org_subscriptions.billing_starts_at). When
  // set, it is the source of truth for trial_end so Stripe matches what the
  // UI and reminder emails display. Falls back to the computed date.
  billingStartsAt?: Date | null;
};

// The trial_end sent to Stripe: the persisted charge date when one exists
// (so Stripe stays aligned with the date the UI/reminders show), otherwise
// the computed 90-day date — always floored at Stripe's minimum from now.
function checkoutTrialEnd(input: CheckoutInput, now = new Date()): Date {
  const target =
    input.billingStartsAt ?? billingStartDate(input.orgCreatedAt, now);
  const floor = new Date(now.getTime() + MIN_TRIAL_END_MS);
  return target.getTime() > floor.getTime() ? target : floor;
}

// Create a Checkout Session that saves a card on file and schedules the first
// charge for 90 days after the org was created. No charge happens today.
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
        trial_end: Math.floor(checkoutTrialEnd(input).getTime() / 1000),
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
