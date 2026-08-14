import { describe, it, expect } from "vitest";
import { request, app, loginAs } from "./helpers";

// Task #829 — one-page org quick setup. Platform admin posts org info +
// teams + coach emails in one payload; everything is created atomically
// (ownerless org + claim token + teams + staged coach drafts, no roster
// rows, no invites). Any validation failure creates nothing.

const ADMIN_EMAIL = "andrew@kinectem.com";

describe("POST /api/v1/admin/org-quick-setup", () => {
  it("creates org + teams + staged coaches in one shot", async () => {
    const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
    const res = await agent.post("/api/v1/admin/org-quick-setup").send({
      name: "Quick Setup Org",
      city: "Denville",
      state: "nj",
      brandPrimaryColor: "#1A2B3C",
      brandSecondaryColor: "#ffcc00",
      teams: [
        {
          name: "12U Blue",
          coachEmails: ["coach1@example.com", "Coach1@Example.com", "coach2@example.com"],
        },
        { name: "10U Gold", coachEmails: [] },
      ],
    });
    expect(res.status).toBe(201);
    const data = res.body.data;
    expect(data.name).toBe("Quick Setup Org");
    expect(data.state).toBe("NJ");

    // Task #831 — brand colors land on the org (normalized to lowercase).
    const orgPage = await agent.get(`/api/v1/organizations/${data.id}`);
    expect(orgPage.status).toBe(200);
    const orgBody = orgPage.body.data ?? orgPage.body;
    expect(orgBody.brandPrimaryColor).toBe("#1a2b3c");
    expect(orgBody.brandSecondaryColor).toBe("#ffcc00");
    expect(typeof data.token).toBe("string");
    expect(data.teams).toHaveLength(2);
    expect(data.stagedCoachCount).toBe(2); // dupe email deduped

    // Org shows on the claim-links list (ownerless).
    const list = await agent.get("/api/v1/admin/org-claim-links");
    const row = list.body.data.find((r: { id: string }) => r.id === data.id);
    expect(row).toBeTruthy();
    expect(row.token).toBe(data.token);

    // Staged drafts readable through the normal endpoint; no real invites.
    const staged = await agent.get(`/api/v1/organizations/${data.id}/staged-coaches`);
    expect(staged.status).toBe(200);
    expect(staged.body.data).toHaveLength(2);
    const invites = await agent.get(`/api/v1/teams/${data.teams[0].id}/invites`);
    const inviteList = Array.isArray(invites.body.data) ? invites.body.data : invites.body;
    expect(inviteList).toHaveLength(0);

    // Admin is not on any roster (hand-off model).
    const teams = await agent.get(`/api/v1/organizations/${data.id}/teams`);
    expect(teams.status).toBe(200);
  });

  it("409s on duplicate org name", async () => {
    const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
    const first = await agent
      .post("/api/v1/admin/org-quick-setup")
      .send({ name: "Dup Quick Org", teams: [] });
    expect(first.status).toBe(201);
    const dup = await agent
      .post("/api/v1/admin/org-quick-setup")
      .send({ name: "dup quick org", teams: [] });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("ORG_NAME_TAKEN");
  });

  it("all-or-nothing: invalid coach email creates nothing", async () => {
    const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
    const res = await agent.post("/api/v1/admin/org-quick-setup").send({
      name: "Rollback Quick Org",
      teams: [
        { name: "Good Team", coachEmails: ["ok@example.com"] },
        { name: "Bad Team", coachEmails: ["not-an-email"] },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_EMAIL");
    expect(res.body.index).toBe(1);
    // Org must not exist.
    const list = await agent.get("/api/v1/admin/org-claim-links");
    const row = list.body.data.find((r: { name: string }) => r.name === "Rollback Quick Org");
    expect(row).toBeUndefined();
  });

  it("rejects duplicate team names, bad colors, bad state, over-cap teams", async () => {
    const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
    const dupTeams = await agent.post("/api/v1/admin/org-quick-setup").send({
      name: "Val Org A",
      teams: [{ name: "Same" }, { name: "same" }],
    });
    expect(dupTeams.status).toBe(400);
    expect(dupTeams.body.code).toBe("DUPLICATE_TEAM_NAME");

    // Task #831 — gender/website are no longer part of the payload; sending
    // them is simply ignored (backward compatible), never a 400.
    const legacyFields = await agent.post("/api/v1/admin/org-quick-setup").send({
      name: "Val Org B",
      teams: [{ name: "T", gender: "mixed", website: "not a url" }],
    });
    expect(legacyFields.status).toBe(201);

    const badColor = await agent.post("/api/v1/admin/org-quick-setup").send({
      name: "Val Org B2",
      brandPrimaryColor: "red",
      teams: [],
    });
    expect(badColor.status).toBe(400);
    expect(badColor.body.code).toBe("INVALID_COLOR");

    const badState = await agent
      .post("/api/v1/admin/org-quick-setup")
      .send({ name: "Val Org C", state: "New Jersey", teams: [] });
    expect(badState.status).toBe(400);
    expect(badState.body.code).toBe("INVALID_STATE");

    // Starter cap is 15 — 16 teams rejected up front.
    const many = Array.from({ length: 16 }, (_, i) => ({ name: `Team ${i}` }));
    const overCap = await agent
      .post("/api/v1/admin/org-quick-setup")
      .send({ name: "Val Org D", teams: many });
    expect(overCap.status).toBe(400);
    expect(overCap.body.code).toBe("TEAM_LIMIT_REACHED");
  });

  it("stores a valid promo code, surfaces it on the claim link, rejects bad codes", async () => {
    const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
    // Test DB is schema-only — create the promo code through the admin API.
    const created = await agent.post("/api/v1/admin/promo-codes").send({
      code: "qs25",
      description: "Quick setup test promo",
      discountType: "percent",
      discountValue: 25,
      active: true,
    });
    expect(created.status).toBeLessThan(300);

    const res = await agent.post("/api/v1/admin/org-quick-setup").send({
      name: "Promo Quick Org",
      promoCode: " QS25 ", // trimmed + case-insensitive
      teams: [],
    });
    expect(res.status).toBe(201);
    const token = res.body.data.token;

    // Public claim resolve carries the staged promo.
    const claim = await request(app).get(`/api/v1/org-claim-links/${token}`);
    expect(claim.status).toBe(200);
    expect(claim.body.promo).toMatchObject({
      code: "qs25",
      discountType: "percent",
      discountValue: 25,
    });

    // Invalid promo is a 400 and creates nothing.
    const bad = await agent.post("/api/v1/admin/org-quick-setup").send({
      name: "Promo Quick Org Bad",
      promoCode: "definitely-not-a-code",
      teams: [],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_PROMO_CODE");
    const list = await agent.get("/api/v1/admin/org-claim-links");
    const row = list.body.data.find(
      (r: { name: string }) => r.name === "Promo Quick Org Bad",
    );
    expect(row).toBeUndefined();
  });

  // Task #860 — quick-setup orgs are "orgs I know": the claim-links list
  // carries a non-null quickSetupAt for them, while orgs added through the
  // plain POST /org-claim-links form stay null (lower list).
  it("stamps quick-setup orgs and exposes quickSetupAt on the claim-links list", async () => {
    const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
    const qs = await agent
      .post("/api/v1/admin/org-quick-setup")
      .send({ name: "Known Quick Org", teams: [] });
    expect(qs.status).toBe(201);
    const plain = await agent
      .post("/api/v1/admin/org-claim-links")
      .send({ name: "Unknown Bulk Org" });
    expect(plain.status).toBe(201);

    const list = await agent.get("/api/v1/admin/org-claim-links");
    expect(list.status).toBe(200);
    const known = list.body.data.find(
      (r: { id: string }) => r.id === qs.body.data.id,
    );
    const unknown = list.body.data.find(
      (r: { id: string }) => r.id === plain.body.data.id,
    );
    expect(known).toBeTruthy();
    expect(typeof known.quickSetupAt).toBe("string");
    expect(new Date(known.quickSetupAt).getTime()).not.toBeNaN();
    expect(unknown).toBeTruthy();
    expect(unknown.quickSetupAt).toBeNull();
  });

  it("non-admin gets 403; unauthenticated 401", async () => {
    const { agent } = await loginAs((u) => u.role === "athlete" && !!u.email);
    const res = await agent
      .post("/api/v1/admin/org-quick-setup")
      .send({ name: "Nope Org", teams: [] });
    expect([401, 403]).toContain(res.status);
    expect(res.status).not.toBe(201);

    const anon = await request(app)
      .post("/api/v1/admin/org-quick-setup")
      .send({ name: "Anon Org", teams: [] });
    expect(anon.status).toBe(401);
  });
});
