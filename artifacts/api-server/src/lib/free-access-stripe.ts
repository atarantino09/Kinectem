import { getStripeClient } from "./stripeClient.js";
import { PLAN_YEARLY_USD, type PlanTier, firstAnnualCouponId, ensureFirstAnnualCoupon, couponMatchesFirstAnnual } from "./stripe-billing.js";
import type { FirstAnnualDiscount } from "./free-access-promo.js";
import { firstAnnualTerms } from "./free-access-promo.js";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";

export type FreeAccessDecision = {
  status: "eligible" | "skipped" | "blocked";
  reason: string;
};

/** Fail closed: an unverified subscription is never treated as unpaid. */
export async function verifyUnpaidBilling(input: {
  orgId: string; subscriptionId: string | null; customerId: string | null;
  plan: PlanTier; freeUntil: Date; apply: boolean;
  firstAnnualDiscount?: FirstAnnualDiscount | null; promoCode?: string; operationId?: string;
}): Promise<FreeAccessDecision> {
  if (!input.subscriptionId && !input.customerId) {
    return { status: "eligible", reason: "No card on file; free access can be applied." };
  }
  const stripe = await getStripeClient();
  if (!stripe) return { status: "blocked", reason: "Stripe is not connected. No billing or access dates were changed." };
  try {
    const live = input.subscriptionId
      ? await stripe.subscriptions.retrieve(input.subscriptionId, { expand: ["discounts.source.coupon"] }) : null;
    if (live && live.metadata.orgId !== input.orgId) {
      return { status: "blocked", reason: "The Stripe subscription could not be verified as belonging to this organization." };
    }
    const customerId = live
      ? typeof live.customer === "string" ? live.customer : live.customer.id
      : input.customerId!;
    if (input.customerId && customerId !== input.customerId) {
      return { status: "blocked", reason: "The organization's saved customer does not match its Stripe subscription." };
    }
    let after: string | undefined;
    do {
      const page = await stripe.invoices.list({
        customer: customerId, status: "paid", limit: 100, ...(after ? { starting_after: after } : {}),
      });
      if (page.data.some((invoice) => invoice.amount_paid > 0)) {
        return { status: "skipped", reason: "This organization has already paid. Its subscription was left unchanged." };
      }
      if (!page.has_more) break;
      const next = page.data.at(-1)?.id;
      if (!next || next === after) return { status: "blocked", reason: "Could not verify the complete payment history." };
      after = next;
    } while (true);
    const open = await stripe.invoices.list({ customer: customerId, status: "open", limit: 100 });
    if (open.data.some((invoice) => invoice.amount_remaining > 0) || open.has_more) {
      return { status: "blocked", reason: "An unpaid invoice is already open. Billing needs review before postponing collection." };
    }
    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    if (subscriptions.has_more || subscriptions.data.some((subscription) =>
      subscription.id !== live?.id && !["canceled", "incomplete_expired"].includes(subscription.status))) {
      return { status: "blocked", reason: "Another live subscription was found for this customer. Billing needs review to avoid duplicate charges." };
    }
    if (!live) return { status: "eligible", reason: "No payments found; free access can be applied." };
    if (!["trialing", "active"].includes(live.status) || live.schedule || live.cancel_at || live.cancel_at_period_end || live.pending_update) {
      return { status: "blocked", reason: "This subscription needs billing review; existing cancellations and schedules were not changed." };
    }
    const items = live.items.data;
    const nextCharge = live.status === "trialing" ? live.trial_end : items[0]?.current_period_end;
    if (!nextCharge || nextCharge * 1000 < Date.now() + 15 * 60 * 1000) {
      return { status: "blocked", reason: "The first charge may already be processing. No changes were made." };
    }
    if (items.length !== 1 || (items[0].quantity ?? 1) !== 1 ||
      items[0].price.currency !== "usd" ||
      items[0].price.unit_amount !== PLAN_YEARLY_USD[input.plan] * 100 ||
      items[0].price.recurring?.interval !== "year" ||
      items[0].price.recurring.interval_count !== 1) {
      return { status: "blocked", reason: "The saved Stripe price does not match this plan's full annual price. Billing needs review." };
    }
    const discount = input.firstAnnualDiscount;
    if (discount && !input.promoCode) return { status: "blocked", reason: "The retained discount source is missing." };
    const expectedCoupon = discount ? firstAnnualCouponId(input.promoCode!, discount) : null;
    const matchesDiscount = (subscription: Stripe.Subscription) => {
      if (!discount) return subscription.discounts.length === 0;
      if (subscription.discounts.length !== 1) return false;
      const d = subscription.discounts[0];
      if (typeof d === "string") return false;
      const coupon = d.source.coupon;
      return typeof coupon === "object" && coupon !== null &&
        coupon.id === expectedCoupon && couponMatchesFirstAnnual(coupon as Stripe.Coupon, discount);
    };
    if (input.apply && (live.status !== "trialing" || live.trial_end !== Math.floor(input.freeUntil.getTime() / 1000) || !matchesDiscount(live))) {
      const couponId = discount ? await ensureFirstAnnualCoupon(stripe, input.promoCode!, discount) : null;
      const updated = await stripe.subscriptions.update(live.id, {
        trial_end: Math.floor(input.freeUntil.getTime() / 1000),
        discounts: couponId ? [{ coupon: couponId }] : "",
        proration_behavior: "none",
      }, { idempotencyKey: `free-access-${input.orgId}-${input.operationId ?? randomUUID()}` });
      const confirmed = await stripe.subscriptions.retrieve(updated.id, { expand: ["discounts.source.coupon"] });
      if (confirmed.status !== "trialing" || confirmed.metadata.orgId !== input.orgId ||
          (typeof confirmed.customer === "string" ? confirmed.customer : confirmed.customer.id) !== customerId ||
          confirmed.trial_end !== Math.floor(input.freeUntil.getTime() / 1000) || !matchesDiscount(confirmed)) {
        return { status: "blocked", reason: "Stripe did not confirm the billing date and first annual invoice terms. Retry or review billing." };
      }
    }
    return { status: "eligible", reason: `Unpaid subscription: ${firstAnnualTerms(discount)}.` };
  } catch {
    return { status: "blocked", reason: "Could not verify or update Stripe billing. No successful application was recorded; retry after connecting Stripe." };
  }
}
