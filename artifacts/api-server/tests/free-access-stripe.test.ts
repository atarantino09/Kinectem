import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { getStripeClient } = vi.hoisted(() => ({ getStripeClient: vi.fn() }));
vi.mock("../src/lib/stripeClient.js", () => ({ getStripeClient }));
import { verifyUnpaidBilling } from "../src/lib/free-access-stripe";
import { availableFreeUntil, FREE2027_FIRST_CHARGE } from "../src/lib/free-access-promo";
import { createCardOnFileCheckout } from "../src/lib/stripe-billing";

const input = {
  orgId: "fixture-org", subscriptionId: "sub_fixture", customerId: "cus_fixture",
  plan: "starter" as const, freeUntil: new Date(FREE2027_FIRST_CHARGE), apply: true,
};
function fixture() {
  const live = {
    id: input.subscriptionId, customer: input.customerId, metadata: { orgId: input.orgId },
    status: "trialing", trial_end: Math.floor(new Date("2026-12-01T00:00:00Z").getTime() / 1000),
    discounts: ["coupon_old"], items: { data: [{
      current_period_end: Math.floor(new Date("2027-10-01T00:00Z").getTime() / 1000),
      quantity: 1, price: { currency: "usd", unit_amount: 100000, recurring: { interval: "year", interval_count: 1 } },
    }] },
  };
  const stripe = {
    invoices: { list: vi.fn().mockResolvedValue({ data: [], has_more: false }) },
    subscriptions: {
      list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
      retrieve: vi.fn().mockImplementation(async () => live),
      update: vi.fn().mockImplementation(async (_id, params) => {
        live.trial_end = params.trial_end; live.discounts = []; live.status = "trialing"; return live;
      }),
    },
  };
  getStripeClient.mockResolvedValue(stripe);
  return { stripe, live };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-10T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe("FREE2027 billing safeguards", () => {
  it("allows no-card organizations without calling Stripe", async () => {
    expect((await verifyUnpaidBilling({ ...input, subscriptionId: null, customerId: null })).status).toBe("eligible");
    expect(getStripeClient).not.toHaveBeenCalled();
  });
  it("blocks saved-card orgs when Stripe is disconnected", async () => {
    getStripeClient.mockResolvedValue(null);
    expect((await verifyUnpaidBilling(input)).status).toBe("blocked");
  });
  it("leaves previously paid orgs unchanged, including payments on older invoice pages", async () => {
    const { stripe } = fixture();
    stripe.invoices.list.mockResolvedValueOnce({ data: [{ id: "in_zero", amount_paid: 0 }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: "in_paid", amount_paid: 100000 }], has_more: false });
    expect((await verifyUnpaidBilling(input)).status).toBe("skipped");
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it("defers the unpaid trial and clears all discounts, without proration or a charge", async () => {
    const { stripe } = fixture();
    expect((await verifyUnpaidBilling(input)).status).toBe("eligible");
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_fixture", {
      trial_end: 1817092800, discounts: "", proration_behavior: "none",
    }, expect.any(Object));
  });
  it("never changes Stripe during a preview", async () => {
    const { stripe } = fixture();
    expect((await verifyUnpaidBilling({ ...input, apply: false })).status).toBe("eligible");
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it("allows zero-dollar trial invoices, but blocks outstanding payable invoices", async () => {
    const { stripe } = fixture();
    stripe.invoices.list.mockResolvedValueOnce({ data: [{ amount_paid: 0 }], has_more: false })
      .mockResolvedValueOnce({ data: [{ amount_remaining: 100000 }], has_more: false });
    expect((await verifyUnpaidBilling(input)).status).toBe("blocked");
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it("verifies annual list pricing before changing a saved subscription", async () => {
    const { stripe, live } = fixture(); live.items.data[0].price.unit_amount = 50000;
    expect((await verifyUnpaidBilling(input)).status).toBe("blocked");
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it("does not duplicate provider writes when reapplying an aligned offer", async () => {
    const { stripe, live } = fixture();
    live.trial_end = Math.floor(input.freeUntil.getTime() / 1000); live.discounts = [];
    expect((await verifyUnpaidBilling(input)).status).toBe("eligible");
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it("includes an active subscription whose earlier invoices were all zero dollars", async () => {
    const { live, stripe } = fixture(); live.status = "active";
    stripe.invoices.list.mockResolvedValueOnce({ data: [{ amount_paid: 0 }], has_more: false });
    expect((await verifyUnpaidBilling(input)).status).toBe("eligible");
    expect(stripe.subscriptions.update).toHaveBeenCalledOnce();
  });
  it("blocks orphaned extra subscriptions instead of leaving another charge scheduled", async () => {
    const { stripe } = fixture();
    stripe.subscriptions.list.mockResolvedValue({ data: [{ id: "sub_other", status: "trialing" }], has_more: false });
    expect((await verifyUnpaidBilling(input)).status).toBe("blocked");
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it("blocks mismatched ownership and provider failures", async () => {
    const { stripe, live } = fixture(); live.metadata.orgId = "different-org";
    expect((await verifyUnpaidBilling(input)).status).toBe("blocked");
    live.metadata.orgId = input.orgId; stripe.subscriptions.update.mockRejectedValue(new Error("failure"));
    expect((await verifyUnpaidBilling(input)).status).toBe("blocked");
  });
  it("rejects an expired or invalid date rather than silently moving the first charge", () => {
    expect(() => availableFreeUntil({ discountType: "free_until", freeUntil: new Date("2026-10-11T00:00Z") })).toThrow();
    expect(() => availableFreeUntil({ discountType: "free_until", freeUntil: new Date("invalid") })).toThrow();
  });
  it("uses the exact August 1 date for late-created orgs and never creates a coupon", async () => {
    vi.setSystemTime(new Date("2027-06-01T12:00Z"));
    const create = vi.fn().mockResolvedValue({ url: "https://checkout.stripe.test/free2027" });
    getStripeClient.mockResolvedValue({
      prices: { list: vi.fn().mockResolvedValue({ data: [{ id: "price_starter" }] }) },
      checkout: { sessions: { create } },
    });
    const result = await createCardOnFileCheckout({
      orgId: input.orgId, plan: "starter", customerEmail: "fixture@example.test", existingCustomerId: null,
      promo: { code: "club-source", discountType: "free_until", discountValue: 0 },
      orgCreatedAt: new Date("2027-06-01T00:00Z"), freeUntil: input.freeUntil,
    });
    expect(result).toEqual({ url: "https://checkout.stripe.test/free2027", trialEnd: input.freeUntil });
    expect(create.mock.calls[0][0].subscription_data.trial_end).toBe(1817092800);
    expect(create.mock.calls[0][0].subscription_data.metadata.promoCode).toBe("club-source");
    expect(create.mock.calls[0][0]).not.toHaveProperty("discounts");
  });
});
