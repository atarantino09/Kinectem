import { describe, it, expect } from "vitest";
import { db, organizations, orgSubscriptions, promoCodes, promoUsage } from "@workspace/db";
import { eq } from "drizzle-orm";
import { request, app, loginAs } from "./helpers";
import { csvCell, parseUsageFilters, usageCsv } from "../src/lib/promo-usage-report";
import { billingResultFromInvoices } from "../src/lib/promo-billing-status";
import type Stripe from "stripe";

async function makeOrg(name: string) {
  const [org] = await db.insert(organizations).values({ name }).returning();
  return org;
}

describe("promo usage history and report", () => {
  it("requires a platform administrator and validates UTC date ranges", async () => {
    const guest = await request(app).get("/api/v1/admin/promo-usage");
    expect(guest.status).toBe(401);
    const { agent: ordinary } = await loginAs((u) => u.role === "athlete" && !!u.email);
    expect((await ordinary.get("/api/v1/admin/promo-usage")).status).toBe(403);
    expect((await ordinary.get("/api/v1/admin/promo-usage?format=csv")).status).toBe(403);
    const { agent } = await loginAs((u) => u.role === "admin" && !!u.email);
    for (const query of ["?from=2026-02-30", "?from=2026-04-01&to=2026-03-31", "?page=-1"]) {
      expect((await agent.get(`/api/v1/admin/promo-usage${query}`)).status).toBe(400);
    }
    const empty = await agent.get("/api/v1/admin/promo-usage?format=csv");
    expect(empty.status).toBe(200);
    expect(empty.text).toContain("Applied at (UTC)");
  });

  it("records one event per changed applied code, not per plan edit or staged code", async () => {
    const { agent, user } = await loginAs((u) => u.role === "admin" && !!u.email);
    const org = await makeOrg("Report Org");
    const first = await agent.post("/api/v1/admin/promo-codes").send({
      code: "report25", discountType: "percent", discountValue: 25,
    });
    const second = await agent.post("/api/v1/admin/promo-codes").send({
      code: "report10", discountType: "amount", discountValue: 10,
    });
    expect(first.status).toBeLessThan(300);
    expect(second.status).toBeLessThan(300);
    await db.update(organizations).set({ pendingPromoCodeId: first.body.promo.id }).where(eq(organizations.id, org.id));
    expect((await agent.get("/api/v1/admin/promo-usage")).body.total).toBe(0);

    const url = `/api/v1/organizations/${org.id}/subscription`;
    expect((await agent.put(url).send({ plan: "starter", promoCode: "report25" })).status).toBe(200);
    expect((await agent.put(url).send({ plan: "pro", promoCode: "report25" })).status).toBe(200);
    let report = (await agent.get("/api/v1/admin/promo-usage")).body;
    expect(report.total).toBe(1);
    expect(report.data[0]).toMatchObject({
      code: "report25", organizationName: org.name, actorEmail: user.email,
      plan: "starter", discountValue: 25, endReason: null,
    });
    expect(report.data[0].appliedAt).toBeTruthy();

    expect((await agent.put(url).send({ plan: "pro", promoCode: "report10" })).status).toBe(200);
    expect((await agent.put(url).send({ plan: "pro", promoCode: null })).status).toBe(200);
    report = (await agent.get("/api/v1/admin/promo-usage")).body;
    expect(report.total).toBe(2);
    expect(report.data.find((r: { code: string }) => r.code === "report25").endReason).toBe("replaced");
    expect(report.data.find((r: { code: string }) => r.code === "report10").endReason).toBe("removed");
    expect((await db.select().from(promoCodes).where(eq(promoCodes.id, first.body.promo.id)))[0].redemptionCount).toBe(0);
  });

  it("serializes concurrent changes and retains snapshots across deletion", async () => {
    const { agent } = await loginAs((u) => u.role === "admin" && !!u.email);
    const org = await makeOrg("Deleted Org");
    const created = await agent.post("/api/v1/admin/promo-codes").send({
      code: "snapshot", discountType: "percent", discountValue: 20,
    });
    const url = `/api/v1/organizations/${org.id}/subscription`;
    const results = await Promise.all([
      agent.put(url).send({ plan: "starter", promoCode: "snapshot" }),
      agent.put(url).send({ plan: "starter", promoCode: "snapshot" }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect((await agent.get("/api/v1/admin/promo-usage")).body.total).toBe(1);
    expect((await agent.delete(`/api/v1/admin/promo-codes/${created.body.promo.id}`)).status).toBe(200);
    await db.delete(organizations).where(eq(organizations.id, org.id));
    const report = (await agent.get("/api/v1/admin/promo-usage")).body;
    expect(report.data[0]).toMatchObject({ code: "snapshot", organizationName: "Deleted Org", endReason: "removed" });
  });

  it("does not record a losing concurrent application under a one-use cap", async () => {
    const { agent } = await loginAs((u) => u.role === "admin" && !!u.email);
    const [a, b] = await Promise.all([makeOrg("Cap A"), makeOrg("Cap B")]);
    const created = await agent.post("/api/v1/admin/promo-codes").send({
      code: "oneonly", discountType: "percent", discountValue: 30, maxRedemptions: 1,
    });
    expect(created.status).toBeLessThan(300);
    const result = await Promise.all([a, b].map((org) =>
      agent.put(`/api/v1/organizations/${org.id}/subscription`).send({ plan: "starter", promoCode: "oneonly" }),
    ));
    expect(result.filter((r) => r.status === 200)).toHaveLength(1);
    expect([400, 409]).toContain(result.find((r) => r.status !== 200)?.status);
    expect((await agent.get("/api/v1/admin/promo-usage")).body.total).toBe(1);
    const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.id, created.body.promo.id));
    expect(promo.redemptionCount).toBe(1);
    const winningOrg = result[0].status === 200 ? a : b;
    expect((await agent.put(`/api/v1/organizations/${winningOrg.id}/subscription`)
      .send({ plan: "pro", promoCode: "oneonly" })).status).toBe(200);
    expect((await agent.get("/api/v1/admin/promo-usage")).body.total).toBe(1);
  });

  it("uses inclusive UTC days and explicitly excludes unknown-date legacy applications", async () => {
    const { agent } = await loginAs((u) => u.role === "admin" && !!u.email);
    const org = await makeOrg("Old Org");
    const [promo] = await db.insert(promoCodes).values({
      code: "legacy", discountType: "percent", discountValue: 5,
    }).returning();
    // A subscription older than the code cannot provide a plausible proxy date.
    await db.insert(orgSubscriptions).values({
      organizationId: org.id, plan: "starter", promoCodeId: promo.id,
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    await db.insert(promoUsage).values({
      promoCodeId: promo.id, organizationId: org.id, code: promo.code,
      organizationName: org.name, plan: "starter", discountType: "percent", discountValue: 5,
    });
    const all = await agent.get("/api/v1/admin/promo-usage");
    expect(all.body.data[0].appliedAt).toBeNull();
    expect(all.body.data[0].actorName).toBeNull();
    const csv = await agent.get("/api/v1/admin/promo-usage?format=csv");
    expect(csv.text).toContain("Legacy — exact time unknown");
    const filtered = await agent.get("/api/v1/admin/promo-usage?from=2026-01-01&to=2026-12-31");
    expect(filtered.body.total).toBe(0);
    expect(filtered.body.legacyExcluded).toBe(true);
    expect(filtered.body.legacyTotal).toBe(1);
    expect(filtered.body.legacy[0].code).toBe("legacy");
    const datedCsv = await agent.get("/api/v1/admin/promo-usage?format=csv&from=2026-01-01&to=2026-12-31");
    expect(datedCsv.text).toContain("Unknown — not attributable to selected range");
    expect(datedCsv.text).toContain("Unknown (before tracking)");
    expect(datedCsv.text).toContain('"legacy"');

    // Preserve exact instants at both edges of a UTC day.
    await db.update(promoUsage).set({ appliedAt: new Date("2026-03-31T23:59:59.999Z") }).where(eq(promoUsage.organizationId, org.id));
    expect((await agent.get("/api/v1/admin/promo-usage?from=2026-03-31&to=2026-03-31")).body.total).toBe(1);
    expect((await agent.get("/api/v1/admin/promo-usage?from=2026-04-01&to=2026-04-01")).body.total).toBe(0);
    await db.update(promoUsage).set({ appliedAt: new Date("2026-04-01T00:00:00.000Z") }).where(eq(promoUsage.organizationId, org.id));
    expect((await agent.get("/api/v1/admin/promo-usage?from=2026-04-01&to=2026-04-01")).body.total).toBe(1);
  });

  it("places pre-tracking applications in their subscription-creation quarter as estimates", async () => {
    const { agent } = await loginAs((u) => u.role === "admin" && !!u.email);
    const org = await makeOrg("Q3 Legacy Org");
    const [promo] = await db.insert(promoCodes).values({
      code: "q3legacy", discountType: "percent", discountValue: 20,
      createdAt: new Date("2026-07-01T00:00:00Z"),
    }).returning();
    const creation = new Date("2026-08-14T18:00:00Z");
    await db.insert(orgSubscriptions).values({
      organizationId: org.id, plan: "starter", promoCodeId: promo.id,
      createdAt: creation,
    });
    await db.insert(promoUsage).values({
      promoCodeId: promo.id, organizationId: org.id, code: promo.code,
      organizationName: org.name, plan: "starter", discountType: "percent",
      discountValue: 20,
    });
    const q3 = await agent.get("/api/v1/admin/promo-usage?from=2026-07-01&to=2026-09-30");
    expect(q3.status, q3.text).toBe(200);
    expect(q3.body.total).toBe(1);
    expect(q3.body.legacyTotal).toBe(0);
    expect(q3.body.data[0]).toMatchObject({
      code: "q3legacy", appliedAt: creation.toISOString(), datePrecision: "estimated",
      billingStatus: "not_billed",
    });
    const q2 = await agent.get("/api/v1/admin/promo-usage?from=2026-04-01&to=2026-06-30");
    expect(q2.body.total).toBe(0);
    expect(q2.body.legacyTotal).toBe(0);
    const csv = await agent.get("/api/v1/admin/promo-usage?format=csv&from=2026-07-01&to=2026-09-30");
    expect(csv.text).toContain("Estimated — subscription created");
    expect(csv.text).toContain(creation.toISOString());
  });

  it("exports more than a page with headers, quoted data, and formula protection", async () => {
    const { agent } = await loginAs((u) => u.role === "admin" && !!u.email);
    const org = await makeOrg("Safe Org");
    const rows = Array.from({ length: 27 }, (_, index) => ({
      organizationId: org.id, organizationName: `Org ${index}`,
      code: "safe", plan: "starter" as const, discountType: "percent" as const,
      discountValue: 5, appliedAt: new Date(`2026-01-${String(index + 1).padStart(2, "0")}T12:00:00Z`),
      endedAt: new Date("2026-02-01T00:00:00Z"), endReason: "removed",
    }));
    await db.insert(promoUsage).values(rows);
    expect((await agent.get("/api/v1/admin/promo-usage")).body.data).toHaveLength(25);
    const csv = await agent.get("/api/v1/admin/promo-usage?format=csv&from=2026-01-01&to=2026-01-31");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("Billing result");
    expect(csv.text).toContain("Paid at (UTC)");
    expect(csv.text.split("\r\n")).toHaveLength(29); // header + 27 + trailing newline
    expect(csvCell(' =HYPERLINK("bad")')).toBe('"\' =HYPERLINK(""bad"")"');
    expect(usageCsv([{ ...rows[0], id: "id", actorUserId: null, promoCodeId: null, actorName: "=cmd", actorEmail: null, endReason: "removed" }])).toContain("\"'=cmd\"");
    expect(parseUsageFilters({ from: "2026-02-29" })).toBeNull();
  });

  it("marks a promo billed only when its coupon actually discounted a paid invoice", () => {
    const usage = {
      id: "usage", code: "EARLY", organizationId: "org", organizationName: "Org",
      actorName: null, actorEmail: null, appliedAt: new Date(), plan: "starter",
      discountType: "percent", discountValue: 25, endedAt: null, endReason: null,
    };
    const invoice = (couponId: string, status: "paid" | "open", paid: number) => ({
      status, amount_paid: paid, status_transitions: { paid_at: status === "paid" ? 1780000000 : null },
      total_discount_amounts: [{
        amount: 2500, discount: { source: { type: "coupon", coupon: couponId } },
      }],
    }) as unknown as Stripe.Invoice;
    expect(billingResultFromInvoices(usage, [])).toMatchObject({ billingStatus: "not_billed" });
    expect(billingResultFromInvoices(usage, [invoice("kinectem_promo_EARLY_y1", "open", 0)]))
      .toMatchObject({ billingStatus: "discount_on_unpaid_invoice" });
    expect(billingResultFromInvoices(usage, [invoice("kinectem_promo_EARLY_y1", "paid", 7500)]))
      .toMatchObject({ billingStatus: "discounted_paid", actualDiscountCents: 2500 });
    expect(billingResultFromInvoices(usage, [invoice("kinectem_promo_OTHER_y1", "paid", 7500)]))
      .toMatchObject({ billingStatus: "paid_without_discount" });
    expect(billingResultFromInvoices(usage, [invoice("kinectem_promo_EARLY_y1", "paid", 0)]))
      .toMatchObject({ billingStatus: "discounted_no_charge" });
  });
});