import { describe, expect, it } from "vitest";
import {
  db,
  organizationAdmins,
  organizations,
  orgAdminLists,
  promoCodes,
  rosterEntries,
  teams,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { loginAs, request, app } from "./helpers";

const ADMIN_EMAIL = "andrew@kinectem.com";

describe("POST /api/v1/admin/org-bulk-import", () => {
  it("validates, creates, groups, and stages a promo atomically", async () => {
    const { agent } = await loginAs((user) => user.email === ADMIN_EMAIL);
    const suffix = Date.now().toString(36);
    const promoCode = `bulk${suffix}`;
    const listName = `Partner Batch ${suffix}`;
    const firstName = `Bulk North ${suffix}`;
    const secondName = `Bulk South ${suffix}`;

    const promoResponse = await agent.post("/api/v1/admin/promo-codes").send({
      code: promoCode,
      description: "Bulk import attribution",
      discountType: "percent",
      discountValue: 20,
      active: true,
    });
    expect(promoResponse.status).toBe(201);

    const payload = {
      listName,
      promoCode: promoCode.toUpperCase(),
      organizations: [
        { name: firstName, teams: ["North U12", "North U14"] },
        { name: secondName, teams: ["South U10"] },
      ],
    };
    const preview = await agent
      .post("/api/v1/admin/org-bulk-import/validate")
      .send(payload);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data.valid).toBe(true);
    expect(preview.body.data.list).toBeNull();

    const imported = await agent.post("/api/v1/admin/org-bulk-import").send(payload);
    expect(imported.status).toBe(201);
    expect(imported.body.data).toMatchObject({
      organizationCount: 2,
      teamCount: 3,
      promoCode,
      list: { name: listName },
    });
    expect(imported.body.data.organizations).toHaveLength(2);
    expect(imported.body.data.organizations[0].token).toEqual(expect.any(String));

    const overview = await agent.get("/api/v1/admin/organizations?promoOnly=true");
    expect(overview.status).toBe(200);
    expect(
      overview.body.data.find(
        (row: { organizationId: string }) =>
          row.organizationId === imported.body.data.organizations[0].id,
      ),
    ).toMatchObject({
      promoCode: null,
      pendingPromoCode: promoCode,
      promoDiscountType: "percent",
      promoDiscountValue: 20,
    });

    const [list] = await db
      .select()
      .from(orgAdminLists)
      .where(eq(orgAdminLists.id, imported.body.data.list.id))
      .limit(1);
    expect(list?.name).toBe(listName);

    const createdOrgIds = imported.body.data.organizations.map(
      (organization: { id: string }) => organization.id,
    );
    const [promo] = await db
      .select({ id: promoCodes.id })
      .from(promoCodes)
      .where(eq(promoCodes.code, promoCode))
      .limit(1);
    for (const orgId of createdOrgIds) {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      expect(org?.adminListId).toBe(list.id);
      expect(org?.pendingPromoCodeId).toBe(promo.id);
      expect(org?.claimToken).toEqual(expect.any(String));
      expect(org?.createdViaQuickSetupAt).toBeNull();
      const owners = await db
        .select()
        .from(organizationAdmins)
        .where(eq(organizationAdmins.organizationId, orgId));
      expect(owners).toHaveLength(0);
      const orgTeams = await db
        .select()
        .from(teams)
        .where(eq(teams.organizationId, orgId));
      for (const team of orgTeams) {
        const roster = await db
          .select()
          .from(rosterEntries)
          .where(eq(rosterEntries.teamId, team.id));
        expect(roster).toHaveLength(0);
      }
    }

    const claim = await request(app).get(
      `/api/v1/org-claim-links/${imported.body.data.organizations[0].token}`,
    );
    expect(claim.status).toBe(200);
    expect(claim.body.promo.code).toBe(promoCode);

    const redeemed = await agent
      .put(`/api/v1/organizations/${createdOrgIds[0]}/subscription`)
      .send({ plan: "starter", promoCode });
    expect(redeemed.status).toBe(200);
    const [redeemedOrg] = await db
      .select({ pendingPromoCodeId: organizations.pendingPromoCodeId })
      .from(organizations)
      .where(eq(organizations.id, createdOrgIds[0]))
      .limit(1);
    expect(redeemedOrg?.pendingPromoCodeId).toBeNull();
  });

  it("reuses a named list and never partially creates a conflicting batch", async () => {
    const { agent } = await loginAs((user) => user.email === ADMIN_EMAIL);
    const suffix = `${Date.now().toString(36)}b`;
    const promoCode = `bulk${suffix}`;
    const listName = `Existing Partner List ${suffix}`;
    const existingName = `Existing Bulk Org ${suffix}`;
    const shouldNotExist = `Rolled Back Bulk Org ${suffix}`;

    await agent.post("/api/v1/admin/promo-codes").send({
      code: promoCode,
      discountType: "amount",
      discountValue: 100,
      active: true,
    });
    const createdList = await agent
      .post("/api/v1/admin/org-lists")
      .send({ name: listName });
    expect(createdList.status).toBe(201);
    await agent
      .post("/api/v1/admin/org-quick-setup")
      .send({ name: existingName, teams: [] });

    const preview = await agent
      .post("/api/v1/admin/org-bulk-import/validate")
      .send({
        listName: listName.toLowerCase(),
        promoCode,
        organizations: [
          { name: existingName.toLowerCase(), teams: [] },
          { name: shouldNotExist, teams: ["Team One"] },
        ],
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.valid).toBe(false);
    expect(preview.body.data.list.id).toBe(createdList.body.data.id);
    expect(preview.body.data.issues[0].message).toMatch(/already exists/i);

    const attempted = await agent.post("/api/v1/admin/org-bulk-import").send({
      listName,
      promoCode,
      organizations: [
        { name: existingName, teams: [] },
        { name: shouldNotExist, teams: ["Team One"] },
      ],
    });
    expect(attempted.status).toBe(409);
    const [rolledBack] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.name, shouldNotExist))
      .limit(1);
    expect(rolledBack).toBeUndefined();
  });

  it("validates and creates organizations without a promo code", async () => {
    const { agent } = await loginAs((user) => user.email === ADMIN_EMAIL);
    const suffix = Date.now().toString(36);
    const listName = `No Promo Batch ${suffix}`;
    const organizationName = `No Promo Org ${suffix}`;
    const payload = {
      listName,
      organizations: [
        { name: organizationName, teams: ["No Promo Team"] },
      ],
    };

    const preview = await agent
      .post("/api/v1/admin/org-bulk-import/validate")
      .send(payload);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data.valid).toBe(true);
    expect(preview.body.data.promo).toBeNull();

    const imported = await agent.post("/api/v1/admin/org-bulk-import").send(payload);
    expect(imported.status).toBe(201);
    expect(imported.body.data).toMatchObject({
      organizationCount: 1,
      teamCount: 1,
      promoCode: null,
      list: { name: listName },
    });

    const createdOrgId = imported.body.data.organizations[0].id;
    const [org] = await db
      .select({ pendingPromoCodeId: organizations.pendingPromoCodeId })
      .from(organizations)
      .where(eq(organizations.id, createdOrgId))
      .limit(1);
    expect(org?.pendingPromoCodeId).toBeNull();
  });

  it("collapses repeated team names into one team per organization", async () => {
    const { agent } = await loginAs((user) => user.email === ADMIN_EMAIL);
    const suffix = Date.now().toString(36);
    const promoCode = `repeat${suffix}`;
    const listName = `Repeated Team Batch ${suffix}`;
    const organizationName = `Repeated Team Org ${suffix}`;
    const payload = {
      listName,
      promoCode,
      organizations: [
        {
          name: organizationName,
          teams: ["Bobcats 2015/2016 Boys", "Lightning", " bobcats 2015/2016 boys "],
        },
      ],
    };

    const promo = await agent.post("/api/v1/admin/promo-codes").send({
      code: promoCode,
      discountType: "percent",
      discountValue: 15,
      active: true,
    });
    expect(promo.status).toBe(201);

    const preview = await agent
      .post("/api/v1/admin/org-bulk-import/validate")
      .send(payload);
    expect(preview.status).toBe(200);
    expect(preview.body.data.valid).toBe(true);
    expect(preview.body.data.organizations[0].teams).toEqual([
      "Bobcats 2015/2016 Boys",
      "Lightning",
    ]);

    const imported = await agent.post("/api/v1/admin/org-bulk-import").send(payload);
    expect(imported.status).toBe(201);
    expect(imported.body.data.teamCount).toBe(2);
    expect(imported.body.data.organizations[0].teams).toHaveLength(2);

    const createdOrgId = imported.body.data.organizations[0].id;
    const createdTeams = await db
      .select({ name: teams.name })
      .from(teams)
      .where(eq(teams.organizationId, createdOrgId));
    expect(createdTeams.map((team) => team.name)).toEqual([
      "Bobcats 2015/2016 Boys",
      "Lightning",
    ]);
  });

  it("rejects malformed batches and non-admin callers", async () => {
    const { agent } = await loginAs((user) => user.email === ADMIN_EMAIL);
    const invalid = await agent.post("/api/v1/admin/org-bulk-import").send({
      listName: "Invalid batch",
      promoCode: "not-real",
      organizations: [
        { name: "Repeated Team Batch", teams: ["Blue", "blue"] },
      ],
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("BULK_IMPORT_INVALID");

    const anon = await request(app).post("/api/v1/admin/org-bulk-import").send({
      listName: "Unauthorized",
      promoCode: "nope",
      organizations: [{ name: "Unauthorized Org", teams: [] }],
    });
    expect(anon.status).toBe(401);
  });

  it("does not over-assign a redemption-limited promo code", async () => {
    const { agent } = await loginAs((user) => user.email === ADMIN_EMAIL);
    const suffix = Date.now().toString(36);
    const promoCode = `cap${suffix}`;
    const created = await agent.post("/api/v1/admin/promo-codes").send({
      code: promoCode,
      discountType: "percent",
      discountValue: 10,
      maxRedemptions: 1,
      active: true,
    });
    expect(created.status).toBe(201);

    const response = await agent
      .post("/api/v1/admin/org-bulk-import/validate")
      .send({
        listName: `Capped Batch ${suffix}`,
        promoCode,
        organizations: [
          { name: `Capped One ${suffix}`, teams: [] },
          { name: `Capped Two ${suffix}`, teams: [] },
        ],
      });
    expect(response.status).toBe(200);
    expect(response.body.data.valid).toBe(false);
    expect(response.body.data.issues[0].message).toMatch(/enough remaining redemptions/i);

    const reservedName = `Reserved Capped Org ${suffix}`;
    const reserved = await agent.post("/api/v1/admin/org-bulk-import").send({
      listName: `Capped Batch ${suffix}`,
      promoCode,
      organizations: [{ name: reservedName, teams: [] }],
    });
    expect(reserved.status).toBe(201);
    const reservedOrgId = reserved.body.data.organizations[0].id;

    const unrelatedName = `Unrelated Capped Org ${suffix}`;
    const unrelated = await agent
      .post("/api/v1/admin/org-quick-setup")
      .send({ name: unrelatedName, teams: [] });
    expect(unrelated.status).toBe(201);
    const unreservedRedemption = await agent
      .put(`/api/v1/organizations/${unrelated.body.data.id}/subscription`)
      .send({ plan: "starter", promoCode });
    expect(unreservedRedemption.status).toBe(409);

    const reservedRedemption = await agent
      .put(`/api/v1/organizations/${reservedOrgId}/subscription`)
      .send({ plan: "starter", promoCode });
    expect(reservedRedemption.status).toBe(200);
    const [converted] = await db
      .select({ pendingPromoCodeId: organizations.pendingPromoCodeId })
      .from(organizations)
      .where(eq(organizations.id, reservedOrgId))
      .limit(1);
    expect(converted?.pendingPromoCodeId).toBeNull();
  });
});