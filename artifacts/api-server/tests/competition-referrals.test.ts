import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { db, organizations, orgSubscriptions, tournaments, competitionReferrals, competitionReferralPayments, promoCodes } from "@workspace/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import app from "../src/app";
import { loginAs } from "./helpers";
import { FREE2027_FIRST_CHARGE } from "../src/lib/free-access-promo";
import { commissionForInvoice, recordReferralInvoice } from "../src/lib/competition-referrals";
vi.mock("../src/lib/stripeClient", () => ({ getStripeClient: vi.fn().mockResolvedValue(null) }));

async function fixture() {
  const { agent, user } = await loginAs((u) => u.role === "admin");
  await db.insert(promoCodes).values({ code: "free2027", discountType: "free_until", discountValue: 0,
    freeUntil: new Date(FREE2027_FIRST_CHARGE) }).onConflictDoNothing();
  const [competition] = await db.insert(tournaments).values({
    name: "Referral Test Cup", slug: `ref-test-${crypto.randomUUID()}`, startDate: "2026-10-10", endDate: "2026-10-12", ownerUserId: user.id,
  }).returning();
  const [org] = await db.insert(organizations).values({ name: "Referred Test Club", slug: `ref-org-${crypto.randomUUID()}` }).returning();
  const report = await agent.get(`/api/v1/competitions/${competition.id}/referrals`);
  expect(report.status).toBe(200);
  return { agent, competition, org, code: report.body.referralCode as string };
}
const invoice = (id = "in_first", paidAt = Date.parse(FREE2027_FIRST_CHARGE) / 1000 + 3600) => ({
  id, status: "paid", amount_paid: 100000, total_excluding_tax: 100000, currency: "usd", billing_reason: "subscription_cycle",
  parent: { subscription_details: { subscription: "sub_referral_test" } },
  status_transitions: { paid_at: paidAt },
}) as Stripe.Invoice;

describe("independent FREE2027 competition attribution", () => {
  it("protects private signup reports and resolves only referral tags publicly", async () => {
    const f = await fixture();
    expect((await request(app).get(`/api/v1/competitions/${f.competition.id}/referrals`)).status).toBe(401);
    const { agent: outsider } = await loginAs((u) => u.role === "coach");
    expect((await outsider.get(`/api/v1/competitions/${f.competition.id}/referrals`)).status).toBe(403);
    const publicResult = await request(app).get(`/api/v1/competition-referrals/resolve/${f.code.toUpperCase()}`);
    expect(publicResult.status).toBe(200);
    expect(publicResult.body.competitionName).toBe(f.competition.name);
    expect((await request(app).get("/api/v1/competition-referrals/resolve/FREE2027")).status).toBe(400);
    expect((await f.agent.post(`/api/v1/competitions/${f.competition.id}/referrals/sync-payments`)).status).toBe(503);
  });
  it("stages and bulk credits an org once, including an org already assigned FREE2027", async () => {
    const f = await fixture();
    await f.agent.post("/api/v1/admin/free2027/apply").send({ organizationIds: [f.org.id] });
    const preview = await f.agent.post("/api/v1/admin/free2027/preview").send({ organizationIds: [f.org.id], referralCode: f.code });
    expect(preview.body.data[0].status).toBe("eligible");
    expect(await db.select().from(competitionReferrals)).toHaveLength(0);
    const applied = await f.agent.post("/api/v1/admin/free2027/apply").send({ organizationIds: [f.org.id], referralCode: f.code });
    expect(applied.body.data[0].status).toBe("applied");
    await f.agent.post("/api/v1/admin/free2027/apply").send({ organizationIds: [f.org.id], referralCode: f.code });
    expect(await db.select().from(competitionReferrals)).toHaveLength(1);
    const report = await f.agent.get(`/api/v1/competitions/${f.competition.id}/referrals`);
    expect(report.body.data[0].status).toBe("awaiting_plan");
    expect(report.body.data[0].commissionCents).toBe(0);
  });
  it("saves a referral atomically with initial plan selection, persists after promo deletion, and blocks replacement", async () => {
    const f = await fixture();
    const save = await f.agent.put(`/api/v1/organizations/${f.org.id}/subscription`)
      .send({ plan: "starter", promoCode: "FREE2027", referralCode: f.code });
    expect(save.status).toBe(200);
    expect(save.body.subscription.freeUntil).toBe(FREE2027_FIRST_CHARGE);
    const repeat = await f.agent.put(`/api/v1/organizations/${f.org.id}/subscription`)
      .send({ plan: "starter", promoCode: "FREE2027", referralCode: f.code });
    expect(repeat.status).toBe(200);
    expect(repeat.body.subscription.id).toBeTruthy();
    const second = await fixture();
    const conflict = await f.agent.put(`/api/v1/organizations/${f.org.id}/subscription`)
      .send({ plan: "starter", promoCode: "FREE2027", referralCode: second.code });
    expect(conflict.status).toBe(400);
    expect(conflict.body.error).toContain("already credited");
    await db.delete(promoCodes).where(eq(promoCodes.code, "free2027"));
    const [ref] = await db.select().from(competitionReferrals).where(eq(competitionReferrals.organizationId, f.org.id));
    expect(ref.referralCode).toBe(f.code);
    const report = await f.agent.get(`/api/v1/competitions/${f.competition.id}/referrals`);
    expect(report.body.data[0].expectedCommissionCents).toBe(15000);
    expect(report.body.data[0].commissionCents).toBe(0);
  });
  it("rejects invalid referrals before applying free access", async () => {
    const f = await fixture();
    const response = await f.agent.put(`/api/v1/organizations/${f.org.id}/subscription`)
      .send({ plan: "starter", promoCode: "FREE2027", referralCode: "ref-0000000000000000" });
    expect(response.status).toBe(409);
    expect(await db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, f.org.id))).toHaveLength(0);
    const wrongOffer = await f.agent.put(`/api/v1/organizations/${f.org.id}/subscription`).send({ plan: "starter", referralCode: f.code });
    expect(wrongOffer.status).toBe(400);
  });
  it("records only the first collected full-price annual invoice, idempotently and despite out-of-order events", async () => {
    const f = await fixture();
    await f.agent.put(`/api/v1/organizations/${f.org.id}/subscription`).send({ plan: "starter", promoCode: "FREE2027", referralCode: f.code });
    await db.update(orgSubscriptions).set({ stripeSubscriptionId: "sub_referral_test" }).where(eq(orgSubscriptions.organizationId, f.org.id));
    const zero = { ...invoice("in_zero"), amount_paid: 0 };
    await recordReferralInvoice(zero);
    await recordReferralInvoice({ ...invoice("in_discount"), amount_paid: 75000 });
    await recordReferralInvoice({ ...invoice("in_discount_with_tax"), amount_paid: 100000, total_excluding_tax: 75000 });
    await recordReferralInvoice(invoice("in_before_offer", Date.parse("2026-10-10T12:00Z") / 1000));
    expect(await db.select().from(competitionReferralPayments)).toHaveLength(0);
    await recordReferralInvoice(invoice("in_renewal", Date.parse("2028-08-01T05:00Z") / 1000));
    await recordReferralInvoice(invoice());
    await recordReferralInvoice(invoice());
    await recordReferralInvoice(invoice("in_later", Date.parse("2029-08-01T05:00Z") / 1000));
    const payments = await db.select().from(competitionReferralPayments);
    expect(payments).toHaveLength(1);
    expect(payments[0].stripeInvoiceId).toBe("in_first");
    expect(payments[0].commissionCents).toBe(15000);
    const report = await f.agent.get(`/api/v1/competitions/${f.competition.id}/referrals`);
    expect(report.body.data[0].status).toBe("earned");
  });
  it("never credits a different subscription or tax, unpaid invoices, or proration invoices", () => {
    expect(commissionForInvoice(invoice(), "sub_other", 1500)).toBeNull();
    expect(commissionForInvoice({ ...invoice(), status: "open" }, "sub_referral_test", 1500)).toBeNull();
    expect(commissionForInvoice({ ...invoice(), billing_reason: "subscription_update" }, "sub_referral_test", 1500)).toBeNull();
    expect(commissionForInvoice({ ...invoice(), amount_paid: 110000, total_excluding_tax: 100000 }, "sub_referral_test", 1500)?.commissionCents).toBe(15000);
  });
});
