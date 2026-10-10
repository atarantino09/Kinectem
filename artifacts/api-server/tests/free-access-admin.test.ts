import { describe, expect, it, vi } from "vitest";
import { db, organizations, orgAdminLists, orgSubscriptions, promoCodes, promoUsage } from "@workspace/db";
import { eq } from "drizzle-orm";
import { app, loginAs, request } from "./helpers";
import { FREE2027_FIRST_CHARGE } from "../src/lib/free-access-promo";
vi.mock("../src/lib/stripeClient.js", () => ({
  getStripeClient: vi.fn().mockResolvedValue(null), isStripeConfigured: () => false,
}));

async function fixture() {
  const { agent, user } = await loginAs((u) => u.role === "admin");
  await agent.post("/api/v1/admin/promo-codes").send({
    code: "FREE2027", discountType: "free_until", discountValue: 0,
  });
  const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.code, "free2027"));
  const [list] = await db.insert(orgAdminLists).values({ name: "FREE2027 fixture list", createdById: user.id }).returning();
  const [plain, trial, paid] = await db.insert(organizations).values([
    { name: "Unclaimed fixture", slug: `gift-${crypto.randomUUID()}`, adminListId: list.id },
    { name: "Unpaid fixture", slug: `gift-${crypto.randomUUID()}`, adminListId: list.id },
    { name: "Previously billed fixture", slug: `gift-${crypto.randomUUID()}` },
  ]).returning();
  await db.insert(orgSubscriptions).values([
    { organizationId: trial.id, plan: "starter", status: "trialing", billingStartsAt: new Date("2026-12-01T00:00Z") },
    { organizationId: paid.id, plan: "pro", status: "active", billingStartsAt: new Date("2026-09-01T00:00Z") },
  ]);
  return { agent, promo, plain, trial, paid, list };
}
describe("FREE2027 admin and owner application", () => {
  it("requires platform-admin permission for bulk application", async () => {
    const res = await request(app).post("/api/v1/admin/free2027/preview").send({ organizationIds: [crypto.randomUUID()] });
    expect(res.status).toBe(401);
    const { agent } = await loginAs((u) => u.role === "coach");
    expect((await agent.post("/api/v1/admin/free2027/apply").send({ organizationIds: [crypto.randomUUID()] })).status).toBe(403);
  });
  it("resolves a saved list and previews without changing any organization", async () => {
    const { agent, plain, trial, paid, list } = await fixture();
    const targets = await agent.post("/api/v1/admin/free2027/targets").send({ listId: list.id });
    expect(targets.status).toBe(200);
    expect(targets.body.data.map((r: { organizationId: string }) => r.organizationId).sort()).toEqual([plain.id, trial.id].sort());
    const preview = await agent.post("/api/v1/admin/free2027/preview").send({ organizationIds: [plain.id, trial.id, paid.id] });
    expect(preview.body.data.map((r: { status: string }) => r.status)).toEqual(["eligible", "eligible", "blocked"]);
    const [unchanged] = await db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, trial.id));
    expect(unchanged.billingStartsAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(unchanged.promoCodeId).toBeNull();
  });
  it("applies to unpaid orgs, stages unclaimed orgs, and is idempotent without touching previously billed orgs", async () => {
    const { agent, promo, plain, trial, paid } = await fixture();
    const organizationIds = [plain.id, trial.id, paid.id];
    const applied = await agent.post("/api/v1/admin/free2027/apply").send({ organizationIds });
    expect(applied.status).toBe(200);
    expect(applied.body.data.map((r: { status: string }) => r.status)).toEqual(["staged", "applied", "blocked"]);
    const [sub] = await db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, trial.id));
    expect(sub.freeUntil?.toISOString()).toBe(FREE2027_FIRST_CHARGE);
    expect(sub.billingStartsAt?.toISOString()).toBe(FREE2027_FIRST_CHARGE);
    expect(sub.plan).toBe("starter");
    const [staged] = await db.select().from(organizations).where(eq(organizations.id, plain.id));
    expect(staged.pendingPromoCodeId).toBe(promo.id);
    const repeated = await agent.post("/api/v1/admin/free2027/apply").send({ organizationIds });
    expect(repeated.body.data.map((r: { status: string }) => r.status)).toEqual(["unchanged", "unchanged", "blocked"]);
    const [code] = await db.select().from(promoCodes).where(eq(promoCodes.id, promo.id));
    expect(code.redemptionCount).toBe(1);
    const usage = await db.select().from(promoUsage).where(eq(promoUsage.organizationId, trial.id));
    expect(usage).toHaveLength(1);
    expect(usage[0].freeUntil?.toISOString()).toBe(FREE2027_FIRST_CHARGE);
    const [untouched] = await db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, paid.id));
    expect(untouched.status).toBe("active"); expect(untouched.promoCodeId).toBeNull();
  });
  it("validates the public code and changes an existing unpaid subscription through the normal plan endpoint", async () => {
    const { agent, trial } = await fixture();
    const checked = await agent.post("/api/v1/promo-codes/validate").send({ code: " FREE2027 " });
    expect(checked.status).toBe(200);
    expect(checked.body.promo).toMatchObject({ discountType: "free_until", discountValue: 0, freeUntil: FREE2027_FIRST_CHARGE });
    const chosen = await agent.put(`/api/v1/organizations/${trial.id}/subscription`).send({ plan: "starter", promoCode: "FREE2027" });
    expect(chosen.status).toBe(200);
    expect(chosen.body.subscription.freeUntil).toBe(FREE2027_FIRST_CHARGE);
    const loaded = await agent.get(`/api/v1/organizations/${trial.id}/subscription`);
    expect(loaded.body.billingStartsAt).toBe(FREE2027_FIRST_CHARGE);
  });
  it("keeps the exact date even when it is earlier than a new org's ordinary 90-day trial", async () => {
    const { agent, plain } = await fixture();
    await db.update(organizations).set({ createdAt: new Date("2027-06-20T00:00Z") }).where(eq(organizations.id, plain.id));
    const chosen = await agent.put(`/api/v1/organizations/${plain.id}/subscription`).send({ plan: "starter", promoCode: "FREE2027" });
    expect(chosen.status).toBe(200);
    expect(chosen.body.subscription.billingStartsAt).toBe(FREE2027_FIRST_CHARGE);
    expect((await agent.get(`/api/v1/organizations/${plain.id}/subscription`)).body.billingStartsAt).toBe(FREE2027_FIRST_CHARGE);
  });
  it("preserves a granted billing date when the promo is later deleted", async () => {
    const { agent, plain, promo } = await fixture();
    await agent.put(`/api/v1/organizations/${plain.id}/subscription`).send({ plan: "starter", promoCode: "FREE2027" });
    await db.delete(promoCodes).where(eq(promoCodes.id, promo.id));
    const saved = await agent.put(`/api/v1/organizations/${plain.id}/subscription`).send({ plan: "starter", promoCode: null });
    expect(saved.status).toBe(200);
    expect(saved.body.subscription.billingStartsAt).toBe(FREE2027_FIRST_CHARGE);
    expect(saved.body.subscription.freeUntil).toBe(FREE2027_FIRST_CHARGE);
  });
});
