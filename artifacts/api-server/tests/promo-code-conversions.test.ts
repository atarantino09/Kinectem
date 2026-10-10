import { describe, expect, it, vi } from "vitest";
import { db, organizations, orgSubscriptions, promoCodes, promoUsage } from "@workspace/db";
import { eq } from "drizzle-orm";
import { loginAs } from "./helpers";
import { FREE2027_FIRST_CHARGE } from "../src/lib/free-access-promo";
import { firstAnnualCouponId } from "../src/lib/stripe-billing";

const { getStripeClient } = vi.hoisted(() => ({ getStripeClient: vi.fn() }));
vi.mock("../src/lib/stripeClient.js", () => ({ getStripeClient, isStripeConfigured: () => false }));
const settings = { description: "Partner campaign", maxRedemptions: null, expiresAt: null };
async function fixture(discountType = "percent", discountValue = 25) {
  getStripeClient.mockResolvedValue(null);
  const { agent, user } = await loginAs((u) => u.role === "admin");
  const response = await agent.post("/api/v1/admin/promo-codes").send({ code: "conversion-source", discountType, discountValue });
  expect(response.status).toBe(201);
  const promo = response.body.promo;
  const [org] = await db.insert(organizations).values({ name: "Conversion fixture" }).returning();
  const selected = await agent.put(`/api/v1/organizations/${org.id}/subscription`).send({ plan: "starter", promoCode: promo.code });
  expect(selected.status).toBe(200);
  return { agent, user, promo, org };
}
async function review(f: Awaited<ReturnType<typeof fixture>>, pricing = "keep_discount") {
  const result = await f.agent.post(`/api/v1/admin/promo-codes/${f.promo.id}/free2027/review`).send({ pricing, settings });
  expect(result.status).toBe(200);
  return result.body;
}
async function preview(f: Awaited<ReturnType<typeof fixture>>, r: { reviewId: string; data: { organizationId: string }[] }) {
  return f.agent.post(`/api/v1/admin/promo-code-conversions/${r.reviewId}/preview`).send({ organizationIds: r.data.map((row) => row.organizationId) });
}
async function confirm(f: Awaited<ReturnType<typeof fixture>>, reviewId: string) {
  return f.agent.post(`/api/v1/admin/promo-code-conversions/${reviewId}/confirm`).send({});
}
async function apply(f: Awaited<ReturnType<typeof fixture>>, reviewId: string, organizationIds = [f.org.id]) {
  return f.agent.post(`/api/v1/admin/promo-code-conversions/${reviewId}/apply`).send({ organizationIds });
}
function stripeFixture(orgId: string) {
  const live: any = { id: "sub_conversion", customer: "cus_conversion", metadata: { orgId },
    status: "trialing", trial_end: Date.parse("2026-12-01T00:00Z") / 1000, discounts: [],
    items: { data: [{ quantity: 1, current_period_end: Date.parse("2027-12-01T00:00Z") / 1000,
      price: { currency: "usd", unit_amount: 100000, recurring: { interval: "year", interval_count: 1 } } }] } };
  const coupons = new Map<string, any>();
  const stripe = {
    invoices: { list: vi.fn().mockResolvedValue({ data: [], has_more: false }) },
    coupons: {
      retrieve: vi.fn().mockImplementation(async (id) => { if (!coupons.has(id)) throw Object.assign(new Error("missing"), { code: "resource_missing" }); return coupons.get(id); }),
      create: vi.fn().mockImplementation(async (value) => { coupons.set(value.id, value); return value; }),
    },
    subscriptions: {
      retrieve: vi.fn().mockImplementation(async () => live),
      list: vi.fn().mockResolvedValue({ data: [live], has_more: false }),
      update: vi.fn().mockImplementation(async (_id, terms) => {
        live.trial_end = terms.trial_end;
        live.discounts = terms.discounts ? [{ source: { coupon: coupons.get(terms.discounts[0].coupon) } }] : [];
        return live;
      }),
    },
    prices: { list: vi.fn().mockResolvedValue({ data: [{ id: "price_fixture" }] }) },
    checkout: { sessions: {
      create: vi.fn().mockResolvedValue({ url: "https://example.test/checkout" }),
      retrieve: vi.fn().mockImplementation(async () => ({ metadata: { orgId }, customer: live.customer, subscription: live })),
    } },
  };
  getStripeClient.mockResolvedValue(stripe);
  return { stripe, live, coupons };
}

describe("reviewed current-code conversion", () => {
  it.each([["keep_discount", { discountType: "percent", discountValue: 25 }], ["full_price", null]])(
    "converts current subscriptions and staged orgs with %s, without another redemption", async (pricing, expected) => {
      const f = await fixture();
      const [staged] = await db.insert(organizations).values({ name: "Staged conversion", pendingPromoCodeId: f.promo.id }).returning();
      const r = await review(f, pricing as string);
      expect(r.data).toHaveLength(2);
      const before = await f.agent.get(`/api/v1/organizations/${f.org.id}/subscription`);
      expect(before.body.subscription.promo.discountType).toBe("percent");
      expect((await confirm(f, r.reviewId)).status).toBe(409);
      expect((await preview(f, r)).body.data.every((row: any) => row.status === "eligible")).toBe(true);
      expect((await confirm(f, r.reviewId)).status).toBe(200);
      const converted = await apply(f, r.reviewId, [f.org.id, staged.id]);
      expect(converted.body.data.map((row: any) => row.status)).toEqual(["applied", "staged"]);
      expect((await apply(f, r.reviewId)).body.data[0].status).toBe("applied");
      const after = await f.agent.get(`/api/v1/organizations/${f.org.id}/subscription`);
      expect(after.body.subscription).toMatchObject({ freeUntil: FREE2027_FIRST_CHARGE,
        promo: { code: f.promo.code, firstAnnualDiscount: expected } });
      const [code] = await db.select().from(promoCodes).where(eq(promoCodes.id, f.promo.id));
      expect(code.redemptionCount).toBe(1);
      const usages = await db.select().from(promoUsage).where(eq(promoUsage.organizationId, f.org.id));
      expect(usages).toHaveLength(1);
      expect(usages[0].firstAnnualDiscount).toEqual(expected);
      const chosen = await f.agent.put(`/api/v1/organizations/${staged.id}/subscription`).send({ plan: "starter", promoCode: f.promo.code });
      expect(chosen.status).toBe(200);
      expect(chosen.body.subscription.promo.firstAnnualDiscount).toEqual(expected);
    });

  it("retains 100% and dollar discounts for the first invoice and future new signups", async () => {
    for (const [type, value] of [["percent", 100], ["amount", 200]] as const) {
      const f = await fixture(type, value);
      const r = await review(f);
      await preview(f, r); await confirm(f, r.reviewId); await apply(f, r.reviewId);
      const [next] = await db.insert(organizations).values({ name: "Next signup" }).returning();
      const redeemed = await f.agent.put(`/api/v1/organizations/${next.id}/subscription`).send({ plan: "starter", promoCode: f.promo.code });
      expect(redeemed.status).toBe(200);
      expect(redeemed.body.subscription.promo.firstAnnualDiscount).toEqual({ discountType: type, discountValue: value });
      if (value === 100) expect(r.terms).toContain("$0");
      // Free the code identity so this single test can cover both kinds.
      await db.delete(promoCodes).where(eq(promoCodes.id, f.promo.id));
    }
  });

  it("refuses widening, stale organization state and stale code settings", async () => {
    const f = await fixture(), r = await review(f);
    await preview(f, r);
    const [other] = await db.insert(organizations).values({ name: "Never reviewed" }).returning();
    expect((await apply(f, r.reviewId, [other.id])).body.data[0].status).toBe("blocked");
    await f.agent.patch(`/api/v1/admin/promo-codes/${f.promo.id}`).send({ description: "Changed after review" });
    expect((await confirm(f, r.reviewId)).status).toBe(409);
    const fresh = await review(f, "full_price");
    await preview(f, fresh); await confirm(f, fresh.reviewId);
    await db.update(orgSubscriptions).set({ plan: "pro", updatedAt: new Date() }).where(eq(orgSubscriptions.organizationId, f.org.id));
    const blocked = await apply(f, fresh.reviewId);
    expect(blocked.body.data[0]).toMatchObject({ status: "blocked", reason: "The organization changed. Start a new review." });
    const unchanged = await f.agent.get(`/api/v1/organizations/${f.org.id}/subscription`);
    expect(unchanged.body.subscription.promo.discountType).toBe("percent");
  });

  it("does not target historical users who changed codes or grant access to non-admins", async () => {
    const f = await fixture();
    const otherCode = await f.agent.post("/api/v1/admin/promo-codes").send({ code: "other-source", discountType: "percent", discountValue: 10 });
    await f.agent.put(`/api/v1/organizations/${f.org.id}/subscription`).send({ plan: "starter", promoCode: otherCode.body.promo.code });
    expect((await review(f)).data).toHaveLength(0);
    const { agent } = await loginAs((u) => u.role !== "admin");
    expect((await agent.post(`/api/v1/admin/promo-codes/${f.promo.id}/free2027/review`).send({ pricing: "full_price", settings })).status).toBe(403);
  });

  it("paid and unverifiable cards keep their original terms when future code defaults change", async () => {
    const f = await fixture();
    await db.update(orgSubscriptions).set({ stripeSubscriptionId: "sub_conversion", stripeCustomerId: "cus_conversion" }).where(eq(orgSubscriptions.organizationId, f.org.id));
    const { stripe } = stripeFixture(f.org.id);
    stripe.invoices.list.mockResolvedValue({ data: [{ amount_paid: 100 }], has_more: false } as any);
    const r = await review(f, "full_price");
    expect((await preview(f, r)).body.data[0].status).toBe("skipped");
    await confirm(f, r.reviewId);
    expect((await apply(f, r.reviewId)).body.data[0].status).toBe("blocked");
    const saved = await f.agent.get(`/api/v1/organizations/${f.org.id}/subscription`);
    expect(saved.body.subscription.promo).toMatchObject({ discountType: "percent", discountValue: 25 });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    getStripeClient.mockResolvedValue(null);
    const fresh = await review(f, "full_price");
    expect((await preview(f, fresh)).body.data[0].status).toBe("blocked");
  });

  it("saved cards retain a verified once-only coupon, reconcile safely, and cannot create a second subscription", async () => {
    const f = await fixture();
    await db.update(orgSubscriptions).set({ stripeSubscriptionId: "sub_conversion", stripeCustomerId: "cus_conversion" }).where(eq(orgSubscriptions.organizationId, f.org.id));
    const { stripe, live } = stripeFixture(f.org.id);
    const r = await review(f); await preview(f, r);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(stripe.coupons.create).not.toHaveBeenCalled();
    await confirm(f, r.reviewId);
    expect((await apply(f, r.reviewId)).body.data[0].status).toBe("applied");
    expect(live.trial_end).toBe(Date.parse(FREE2027_FIRST_CHARGE) / 1000);
    expect(live.discounts[0].source.coupon).toMatchObject({ id: firstAnnualCouponId(f.promo.code, { discountType: "percent", discountValue: 25 }), duration: "once", percent_off: 25 });
    const updateCount = stripe.subscriptions.update.mock.calls.length;
    expect((await f.agent.post(`/api/v1/organizations/${f.org.id}/billing/reconcile`).send({ sessionId: "cs_fixture" })).status).toBe(200);
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(updateCount);
    expect((await f.agent.post(`/api/v1/organizations/${f.org.id}/billing/checkout-session`).send({})).status).toBe(409);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("coupon failure is blocked without losing the org's promise, and the same reviewed batch can retry", async () => {
    const f = await fixture();
    await db.update(orgSubscriptions).set({ stripeSubscriptionId: "sub_conversion", stripeCustomerId: "cus_conversion" }).where(eq(orgSubscriptions.organizationId, f.org.id));
    const { stripe } = stripeFixture(f.org.id);
    const r = await review(f); await preview(f, r); await confirm(f, r.reviewId);
    const successfulCreate = stripe.coupons.create.getMockImplementation()!;
    stripe.coupons.create.mockRejectedValue(new Error("provider down"));
    expect((await apply(f, r.reviewId)).body.data[0].status).toBe("blocked");
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect((await f.agent.get(`/api/v1/organizations/${f.org.id}/subscription`)).body.subscription.promo.discountType).toBe("percent");
    stripe.coupons.create.mockImplementation(successfulCreate);
    expect((await apply(f, r.reviewId)).body.data[0].status).toBe("applied");
  });

  it("granted and staged policies survive changing defaults and deleting their source code", async () => {
    const f = await fixture();
    const [staged] = await db.insert(organizations).values({ name: "Detached staged fixture", pendingPromoCodeId: f.promo.id }).returning();
    const r = await review(f); await preview(f, r); await confirm(f, r.reviewId);
    await apply(f, r.reviewId, [f.org.id, staged.id]);
    // Change the default to full price without converting the reviewed recipients.
    const future = await review(f, "full_price"); await preview(f, future); await confirm(f, future.reviewId);
    const beforeDelete = await f.agent.get(`/api/v1/organizations/${f.org.id}/subscription`);
    expect(beforeDelete.body.subscription.promo.firstAnnualDiscount.discountValue).toBe(25);
    expect((await f.agent.delete(`/api/v1/admin/promo-codes/${f.promo.id}`)).status).toBe(200);
    const stagedGet = await f.agent.get(`/api/v1/organizations/${staged.id}/subscription`);
    expect(stagedGet.body.pendingPromo).toMatchObject({ code: f.promo.code, firstAnnualDiscount: { discountValue: 25 } });
    const chosen = await f.agent.put(`/api/v1/organizations/${staged.id}/subscription`).send({ plan: "starter", promoCode: f.promo.code });
    expect(chosen.status).toBe(200);
    expect(chosen.body.subscription.promo).toMatchObject({ code: f.promo.code, firstAnnualDiscount: { discountValue: 25 }, freeUntil: FREE2027_FIRST_CHARGE });
  });

  it("checkout uses the saved first-invoice policy and fails closed when its coupon cannot be verified", async () => {
    const f = await fixture();
    const r = await review(f); await preview(f, r); await confirm(f, r.reviewId); await apply(f, r.reviewId);
    const { stripe } = stripeFixture(f.org.id);
    stripe.coupons.retrieve.mockRejectedValue(Object.assign(new Error("access denied"), { code: "authentication_error" }));
    expect((await f.agent.post(`/api/v1/organizations/${f.org.id}/billing/checkout-session`).send({})).status).toBe(503);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    stripe.coupons.retrieve.mockRejectedValue(Object.assign(new Error("not found"), { code: "resource_missing" }));
    const checkout = await f.agent.post(`/api/v1/organizations/${f.org.id}/billing/checkout-session`).send({});
    expect(checkout.status).toBe(200);
    expect(stripe.checkout.sessions.create.mock.calls[0][0]).toMatchObject({
      subscription_data: { trial_end: Date.parse(FREE2027_FIRST_CHARGE) / 1000 },
      discounts: [{ coupon: firstAnnualCouponId(f.promo.code, { discountType: "percent", discountValue: 25 }) }],
    });
    expect(stripe.coupons.create.mock.calls[0][0]).toMatchObject({ duration: "once", percent_off: 25 });
  });
});
