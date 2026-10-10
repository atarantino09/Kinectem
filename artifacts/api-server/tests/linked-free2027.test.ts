import { describe, expect, it, vi } from "vitest";
import { db, organizations, orgSubscriptions, promoCodes, promoUsage, competitionReferrals, tournaments, competitionReferralCodes } from "@workspace/db";
import { eq } from "drizzle-orm";
import { loginAs } from "./helpers";
import { FREE2027_FIRST_CHARGE } from "../src/lib/free-access-promo";

const { getStripeClient } = vi.hoisted(() => ({ getStripeClient: vi.fn() }));
vi.mock("../src/lib/stripeClient.js", () => ({ getStripeClient, isStripeConfigured: () => false }));

async function fixture(cap?: number) {
  getStripeClient.mockResolvedValue(null);
  const { agent } = await loginAs((u) => u.role === "admin");
  const created = await agent.post("/api/v1/admin/promo-codes").send({
    code: "CLUB-SOURCE", linkedOffer: "free2027", description: "Club campaign",
    ...(cap ? { maxRedemptions: cap } : {}),
  });
  expect(created.status).toBe(201);
  const [org, other] = await db.insert(organizations).values([{ name: "Linked source org" }, { name: "Other source org" }]).returning();
  const url = `/api/v1/organizations/${org.id}/subscription`;
  return { agent, org, other, promo: created.body.promo, url };
}

function stripeFixture(orgId: string) {
  const live = {
    id: "sub_linked", customer: "cus_linked", metadata: { orgId },
    status: "trialing", trial_end: Date.parse("2026-12-01T00:00Z") / 1000,
    discounts: ["old_coupon"],
    items: { data: [{ quantity: 1, current_period_end: Date.parse("2027-12-01T00:00Z") / 1000,
      price: { currency: "usd", unit_amount: 100000, recurring: { interval: "year", interval_count: 1 } } }] },
  };
  const stripe = {
    invoices: { list: vi.fn().mockResolvedValue({ data: [], has_more: false }) },
    subscriptions: {
      list: vi.fn().mockResolvedValue({ data: [live], has_more: false }),
      retrieve: vi.fn().mockImplementation(async () => live),
      update: vi.fn().mockImplementation(async (_id, terms) => { live.trial_end = terms.trial_end; live.discounts = []; return live; }),
    },
    checkout: { sessions: { retrieve: vi.fn().mockImplementation(async () => ({
      metadata: { orgId }, customer: live.customer, subscription: live,
    })) } },
  };
  getStripeClient.mockResolvedValue(stripe);
  return { live, stripe };
}

describe("linked FREE2027 source codes", () => {
  it("creates from code alone, lists linkage, preserves it on edit, and never converts ordinary codes", async () => {
    const f = await fixture();
    expect(f.promo).toMatchObject({ code: "club-source", linkedOffer: "free2027", discountType: "free_until",
      discountValue: 0, freeUntil: FREE2027_FIRST_CHARGE });
    const edit = await f.agent.patch(`/api/v1/admin/promo-codes/${f.promo.id}`).send({ description: "Referring coach", maxRedemptions: 8 });
    expect(edit.status).toBe(200);
    expect(edit.body.promo.linkedOffer).toBe("free2027");
    expect((await f.agent.get("/api/v1/admin/promo-codes")).body.data.find((p: { id: string }) => p.id === f.promo.id).linkedOffer).toBe("free2027");
    const ordinary = await f.agent.post("/api/v1/admin/promo-codes").send({ code: "ordinary", discountType: "percent", discountValue: 25 });
    expect(ordinary.body.promo.linkedOffer).toBeNull();
    expect((await f.agent.patch(`/api/v1/admin/promo-codes/${ordinary.body.promo.id}`).send({ linkedOffer: "free2027" })).status).toBe(400);
  });

  it("rejects contradictory terms and attempted linkage changes", async () => {
    const f = await fixture();
    for (const terms of [{ discountType: "percent" }, { discountValue: 100 }, { freeUntil: null }, { freeUntil: "2027-09-01T04:00:00.000Z" }]) {
      expect((await f.agent.post("/api/v1/admin/promo-codes").send({ code: "tampered", linkedOffer: "free2027", ...terms })).status).toBe(400);
      expect((await f.agent.patch(`/api/v1/admin/promo-codes/${f.promo.id}`).send(terms)).status).toBe(400);
    }
    expect((await f.agent.patch(`/api/v1/admin/promo-codes/${f.promo.id}`).send({ linkedOffer: null })).status).toBe(400);
    expect((await f.agent.post("/api/v1/admin/promo-codes").send({ code: "cLuB-sOuRcE", linkedOffer: "free2027" })).status).toBe(409);
  });

  it("preserves case-insensitive custom identity, fixed terms, history and CSV after repeated application and deletion", async () => {
    const f = await fixture();
    expect((await f.agent.post("/api/v1/promo-codes/validate").send({ code: " ClUb-SoUrCe " })).body.promo.linkedOffer).toBe("free2027");
    const chosen = await f.agent.put(f.url).send({ plan: "starter", promoCode: "CLUB-SOURCE" });
    expect(chosen.status).toBe(200);
    expect(chosen.body.subscription.promo.code).toBe("club-source");
    const repeated = await Promise.all(Array.from({ length: 3 }, () => f.agent.put(f.url).send({ plan: "starter", promoCode: "club-source" })));
    expect(repeated.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await f.agent.put(f.url).send({ plan: "pro", promoCode: "club-source" })).status).toBe(200);
    expect(await db.select().from(promoUsage).where(eq(promoUsage.organizationId, f.org.id))).toHaveLength(1);
    expect((await db.select().from(promoCodes).where(eq(promoCodes.id, f.promo.id)))[0].redemptionCount).toBe(1);
    await f.agent.patch(`/api/v1/admin/promo-codes/${f.promo.id}`).send({ description: "Changed campaign" });
    await f.agent.delete(`/api/v1/admin/promo-codes/${f.promo.id}`);
    const loaded = await f.agent.get(f.url);
    expect(loaded.body.subscription.promo).toMatchObject({ code: "club-source", linkedOffer: "free2027", freeUntil: FREE2027_FIRST_CHARGE });
    expect(loaded.body.billingStartsAt).toBe(FREE2027_FIRST_CHARGE);
    expect((await f.agent.put(f.url).send({ plan: "starter", promoCode: "CLUB-SOURCE" })).status).toBe(200);
    const report = await f.agent.get("/api/v1/admin/promo-usage");
    expect(report.body.data.find((r: { code: string }) => r.code === "club-source").freeUntil).toBe(FREE2027_FIRST_CHARGE);
    expect((await f.agent.get("/api/v1/admin/promo-usage?format=csv")).text).toContain("club-source");
    const overview = await f.agent.get("/api/v1/admin/organizations?promoOnly=true");
    expect(overview.body.data.find((r: { organizationId: string }) => r.organizationId === f.org.id)).toMatchObject({ promoCode: "club-source", promoFreeUntil: FREE2027_FIRST_CHARGE });
    expect(await db.select().from(competitionReferrals)).toHaveLength(0);
  });

  it("consumes its own staged reservation at the cap and blocks competing concurrent applications", async () => {
    const f = await fixture(1);
    await db.update(organizations).set({ pendingPromoCodeId: f.promo.id }).where(eq(organizations.id, f.org.id));
    const staged = await f.agent.get(f.url);
    expect(staged.body.pendingPromo.code).toBe("club-source");
    expect((await f.agent.put(`/api/v1/organizations/${f.other.id}/subscription`).send({ plan: "starter", promoCode: "club-source" })).status).toBe(409);
    expect((await f.agent.put(f.url).send({ plan: "starter", promoCode: "club-source" })).status).toBe(200);
    expect((await db.select().from(organizations).where(eq(organizations.id, f.org.id)))[0].pendingPromoCodeId).toBeNull();
    expect((await f.agent.put(f.url).send({ plan: "starter", promoCode: "club-source" })).status).toBe(200);
  });

  it("allows only one new organization when both race for the last redemption", async () => {
    const f = await fixture(1);
    const results = await Promise.all([f.org, f.other].map((org) => f.agent.put(`/api/v1/organizations/${org.id}/subscription`).send({ plan: "starter", promoCode: "club-source" })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await db.select().from(promoCodes).where(eq(promoCodes.id, f.promo.id)))[0].redemptionCount).toBe(1);
  });

  it("locks source-code capacity across admin staging and consumes the winning reservation", async () => {
    const f = await fixture(1);
    const results = await Promise.all(["First staged club", "Second staged club"].map((name) =>
      f.agent.post("/api/v1/admin/org-claim-links").send({ name, promoCode: "CLUB-SOURCE" })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const created = results.find((r) => r.status === 201)!;
    expect((await f.agent.put(`/api/v1/organizations/${created.body.data.id}/subscription`).send({ plan: "starter", promoCode: "club-source" })).status).toBe(200);
    expect((await db.select().from(promoCodes).where(eq(promoCodes.id, f.promo.id)))[0].redemptionCount).toBe(1);
  });

  it("blocks inactive, expired and too-late offers without granting dates", async () => {
    const f = await fixture();
    for (const values of [{ active: false }, { active: true, expiresAt: new Date("2020-01-01") },
      { expiresAt: null, freeUntil: new Date(Date.now() + 3600000) }]) {
      await db.update(promoCodes).set(values).where(eq(promoCodes.id, f.promo.id));
      expect((await f.agent.put(f.url).send({ plan: "starter", promoCode: "club-source" })).status).toBe(400);
    }
    expect(await db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, f.org.id))).toHaveLength(0);
  });

  it("retimes an unpaid saved card without another subscription, charge or coupon, then reconciles the exact date", async () => {
    const f = await fixture();
    await db.insert(orgSubscriptions).values({ organizationId: f.org.id, plan: "starter", stripeCustomerId: "cus_linked", stripeSubscriptionId: "sub_linked" });
    const { live, stripe } = stripeFixture(f.org.id);
    const applied = await f.agent.put(f.url).send({ plan: "starter", promoCode: "CLUB-SOURCE" });
    expect(applied.status).toBe(200);
    expect(applied.body.subscription.promo.code).toBe("club-source");
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_linked", { trial_end: 1817092800, discounts: "", proration_behavior: "none" }, expect.any(Object));
    expect((await f.agent.put(f.url).send({ plan: "starter", promoCode: "club-source" })).status).toBe(200);
    expect(stripe.subscriptions.update).toHaveBeenCalledOnce();
    live.trial_end = Date.parse("2026-12-01T00:00Z") / 1000;
    const reconciled = await f.agent.post(`/api/v1/organizations/${f.org.id}/billing/reconcile`).send({ sessionId: "cs_mock" });
    expect(reconciled.status).toBe(200);
    expect((await f.agent.get(f.url)).body.subscription).toMatchObject({ promo: { code: "club-source" }, freeUntil: FREE2027_FIRST_CHARGE });
    expect(await db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, f.org.id))).toHaveLength(1);
  });

  it("blocks paid, unverifiable and conflicting saved-card states without recording success", async () => {
    const f = await fixture();
    await db.insert(orgSubscriptions).values({ organizationId: f.org.id, plan: "starter", stripeCustomerId: "cus_linked", stripeSubscriptionId: "sub_linked" });
    expect((await f.agent.put(f.url).send({ plan: "starter", promoCode: "club-source" })).status).toBe(409);
    const { stripe } = stripeFixture(f.org.id);
    stripe.invoices.list.mockResolvedValueOnce({ data: [{ amount_paid: 100000 }], has_more: false });
    expect((await f.agent.put(f.url).send({ plan: "starter", promoCode: "club-source" })).status).toBe(409);
    stripe.subscriptions.list.mockResolvedValue({ data: [{ id: "sub_other", status: "active" }], has_more: false });
    expect((await f.agent.put(f.url).send({ plan: "starter", promoCode: "club-source" })).status).toBe(409);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(await db.select().from(promoUsage).where(eq(promoUsage.organizationId, f.org.id))).toHaveLength(0);
  });

  it("keeps competition credit separate and first-attribution-wins with a linked code", async () => {
    const f = await fixture();
    const [competition, other] = await db.insert(tournaments).values([
      { name: "Cup one", slug: crypto.randomUUID(), startDate: "2026-10-10", endDate: "2026-10-12" },
      { name: "Cup two", slug: crypto.randomUUID(), startDate: "2026-10-10", endDate: "2026-10-12" },
    ]).returning();
    await db.insert(competitionReferralCodes).values([{ competitionId: competition.id, code: "ref-cup-one" }, { competitionId: other.id, code: "ref-cup-two" }]);
    expect((await f.agent.put(f.url).send({ plan: "starter", promoCode: "club-source", referralCode: "ref-cup-one" })).status).toBe(200);
    expect((await f.agent.put(f.url).send({ plan: "starter", promoCode: "club-source", referralCode: "ref-cup-two" })).status).toBe(400);
    const [credit] = await db.select().from(competitionReferrals).where(eq(competitionReferrals.organizationId, f.org.id));
    expect(credit.referralCode).toBe("ref-cup-one");
    expect((await f.agent.get(f.url)).body.subscription.promo.code).toBe("club-source");
  });
});
