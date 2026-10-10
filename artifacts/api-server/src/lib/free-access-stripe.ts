import { getStripeClient } from "./stripeClient.js";
import { PLAN_YEARLY_USD, type PlanTier } from "./stripe-billing.js";

export type FreeAccessDecision = {
  status: "eligible" | "skipped" | "blocked";
  reason: string;
};

/** Fail closed: an unverified subscription is never treated as unpaid. */
export async function verifyUnpaidBilling(input: {
  orgId: string; subscriptionId: string | null; customerId: string | null;
  plan: PlanTier; freeUntil: Date; apply: boolean;
}): Promise<FreeAccessDecision> {
  if (!input.subscriptionId && !input.customerId) {
    return { status: "eligible", reason: "No card on file; free access can be applied." };
  }
  const stripe = await getStripeClient();
  if (!stripe) return { status: "blocked", reason: "Stripe is not connected. No billing or access dates were changed." };
  try {
    const live = input.subscriptionId
      ? await stripe.subscriptions.retrieve(input.subscriptionId) : null;
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
    if (input.apply && (live.status !== "trialing" || live.trial_end !== Math.floor(input.freeUntil.getTime() / 1000) || live.discounts.length > 0)) {
      const updated = await stripe.subscriptions.update(live.id, {
        trial_end: Math.floor(input.freeUntil.getTime() / 1000),
        discounts: "",
        proration_behavior: "none",
      }, { idempotencyKey: `free-access-${input.orgId}-${live.id}-${input.freeUntil.getTime()}` });
      const confirmed = await stripe.subscriptions.retrieve(updated.id);
      if (confirmed.trial_end !== Math.floor(input.freeUntil.getTime() / 1000) || confirmed.discounts.length) {
        return { status: "blocked", reason: "Stripe did not confirm the full-price billing date. Retry or review billing." };
      }
    }
    return { status: "eligible", reason: "Unpaid subscription: first full-price annual charge moves to August 1, 2027." };
  } catch {
    return { status: "blocked", reason: "Could not verify or update Stripe billing. No successful application was recorded; retry after connecting Stripe." };
  }
}
