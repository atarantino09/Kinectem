import { db, orgSubscriptions } from "@workspace/db";
import { inArray } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripeClient } from "./stripeClient.js";
import { logger } from "./logger.js";
import type { UsageRow } from "./promo-usage-report.js";

export type BillingResult = {
  billingStatus: "not_billed" | "discounted_paid" | "discounted_no_charge" |
    "paid_without_discount" | "discount_on_unpaid_invoice" | "unknown" | "verification_unavailable";
  billedAt: Date | null;
  actualDiscountCents: number | null;
};

const result = (billingStatus: BillingResult["billingStatus"], invoice?: Stripe.Invoice, amount?: number): BillingResult => ({
  billingStatus,
  billedAt: invoice?.status_transitions?.paid_at
    ? new Date(invoice.status_transitions.paid_at * 1000) : null,
  actualDiscountCents: amount ?? null,
});

function couponIds(code: string, discountType: string) {
  const base = `kinectem_promo_${code}`;
  // Earlier percent coupons did not have the first-year suffix.
  return discountType === "percent" ? [base, `${base}_y1`] : [base];
}

export function billingResultFromInvoices(row: UsageRow, invoices: Stripe.Invoice[]): BillingResult {
  const expected = couponIds(row.code, row.discountType);
  let unpaid: { invoice: Stripe.Invoice; amount: number } | undefined;
  let paidWithoutDiscount: Stripe.Invoice | undefined;
  let unresolved = false;
  for (const invoice of invoices) {
    const matched = invoice.total_discount_amounts?.filter(({ discount }) => {
      if (typeof discount === "string" || !("source" in discount)) {
        unresolved = true;
        return false;
      }
      const coupon = discount.source.coupon;
      const id = typeof coupon === "string" ? coupon : coupon?.id;
      return id != null && expected.includes(id);
    }) ?? [];
    const amount = matched.reduce((sum, item) => sum + item.amount, 0);
    if (amount > 0) {
      if (invoice.status === "paid") {
        return result(invoice.amount_paid > 0 ? "discounted_paid" : "discounted_no_charge", invoice, amount);
      }
      unpaid ??= { invoice, amount };
    } else if (invoice.status === "paid" && invoice.amount_paid > 0) {
      paidWithoutDiscount ??= invoice;
    }
  }
  if (unpaid) return result("discount_on_unpaid_invoice", unpaid.invoice, unpaid.amount);
  if (unresolved) return result("verification_unavailable");
  if (paidWithoutDiscount) return result("paid_without_discount", paidWithoutDiscount);
  return result("not_billed");
}

export async function resolvePromoBilling(rows: UsageRow[]): Promise<Map<string, BillingResult>> {
  const output = new Map<string, BillingResult>();
  if (rows.length === 0) return output;
  const orgIds = [...new Set(rows.map((row) => row.organizationId))];
  const subs = await db.select({
    organizationId: orgSubscriptions.organizationId,
    stripeSubscriptionId: orgSubscriptions.stripeSubscriptionId,
  }).from(orgSubscriptions).where(inArray(orgSubscriptions.organizationId, orgIds));
  const byOrg = new Map(subs.map((sub) => [sub.organizationId, sub]));
  const ids = [...new Set(subs.map((sub) => sub.stripeSubscriptionId).filter((id): id is string => !!id))];
  const stripe = ids.length ? await getStripeClient() : null;
  const invoices = new Map<string, Stripe.Invoice[] | null>();
  for (let i = 0; stripe && i < ids.length; i += 4) {
    await Promise.all(ids.slice(i, i + 4).map(async (id) => {
      try {
        const page = await stripe.invoices.list({
          subscription: id,
          limit: 100,
          expand: ["data.total_discount_amounts.discount"],
        });
        // Don't silently claim "not billed" if older invoices are outside the page.
        invoices.set(id, page.has_more ? null : page.data);
      } catch (err) {
        logger.warn({ err, subscriptionId: id }, "Could not verify promo billing against Stripe");
        invoices.set(id, null);
      }
    }));
  }
  for (const row of rows) {
    const sub = byOrg.get(row.organizationId);
    const id = sub?.stripeSubscriptionId;
    output.set(row.id, !sub ? result("unknown")
      : !id ? result(row.endedAt ? "unknown" : "not_billed")
      : !stripe || !invoices.get(id) ? result("verification_unavailable")
      : billingResultFromInvoices(row, invoices.get(id)!));
  }
  return output;
}