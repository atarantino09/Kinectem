import { describe, expect, it } from "vitest";
import {
  articles,
  contentReports,
  db,
  organizationAdmins,
  organizationClaimRequests,
  organizations,
  orgAdminLists,
  orgSubscriptions,
  partnerLandingPages,
  partnerOrganizationMemberships,
  postComments,
  postReactions,
  postShares,
  promoCodes,
  rosterEntries,
  teams,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
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

    const imported = await agent
      .post("/api/v1/admin/org-bulk-import")
      .send(payload);
    expect(imported.status).toBe(201);
    expect(imported.body.data).toMatchObject({
      organizationCount: 2,
      teamCount: 3,
      promoCode,
      list: { name: listName },
    });
    expect(imported.body.data.organizations).toHaveLength(2);
    expect(imported.body.data.organizations[0].token).toEqual(
      expect.any(String),
    );

    const overview = await agent.get(
      "/api/v1/admin/organizations?promoOnly=true",
    );
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
      organizations: [{ name: organizationName, teams: ["No Promo Team"] }],
    };

    const preview = await agent
      .post("/api/v1/admin/org-bulk-import/validate")
      .send(payload);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data.valid).toBe(true);
    expect(preview.body.data.promo).toBeNull();

    const imported = await agent
      .post("/api/v1/admin/org-bulk-import")
      .send(payload);
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
          teams: [
            "Bobcats 2015/2016 Boys",
            "Lightning",
            " bobcats 2015/2016 boys ",
          ],
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

    const imported = await agent
      .post("/api/v1/admin/org-bulk-import")
      .send(payload);
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
      organizations: [{ name: "Repeated Team Batch", teams: ["Blue", "blue"] }],
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("BULK_IMPORT_INVALID");

    const anon = await request(app)
      .post("/api/v1/admin/org-bulk-import")
      .send({
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
    expect(response.body.data.issues[0].message).toMatch(
      /enough remaining redemptions/i,
    );

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

describe("POST /api/v1/admin/org-claim-links/bulk-delete", () => {
  it("requires platform-admin authorization, a bounded scope, and exact confirmation", async () => {
    const { agent } = await loginAs((user) => user.email === ADMIN_EMAIL);
    const created = await agent
      .post("/api/v1/admin/org-claim-links")
      .send({ name: `Delete confirmation ${Date.now()}` });
    expect(created.status).toBe(201);
    const organizationId = created.body.data.id;

    const anonymous = await request(app)
      .post("/api/v1/admin/org-claim-links/bulk-delete")
      .send({
        organizationIds: [organizationId],
        confirm: "DELETE UNCLAIMED ORGANIZATIONS",
      });
    expect(anonymous.status).toBe(401);

    const malformed = await agent
      .post("/api/v1/admin/org-claim-links/bulk-delete")
      .send({
        organizationIds: [organizationId],
        listId: "00000000-0000-4000-8000-000000000001",
        confirm: "DELETE UNCLAIMED ORGANIZATIONS",
      });
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe("INVALID_BULK_DELETE");

    const wrongConfirmation = await agent
      .post("/api/v1/admin/org-claim-links/bulk-delete")
      .send({ organizationIds: [organizationId], confirm: "delete" });
    expect(wrongConfirmation.status).toBe(400);
    expect(wrongConfirmation.body.code).toBe("CONFIRMATION_REQUIRED");
    expect(
      await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId)),
    ).toHaveLength(1);
  });

  it("deletes selected ownerless organizations and their dependent and polymorphic data", async () => {
    const { agent, user } = await loginAs(
      (seedUser) => seedUser.email === ADMIN_EMAIL,
    );
    const created = await agent.post("/api/v1/admin/org-quick-setup").send({
      name: `Cascade delete ${Date.now()}`,
      teams: [{ name: "Cascade Team" }],
    });
    expect(created.status).toBe(201);
    const organizationId = created.body.data.id;
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.organizationId, organizationId));
    const [article] = await db
      .insert(articles)
      .values({
        teamId: team.id,
        authorId: user.id,
        title: "Temporary recap",
        body: "Temporary",
      })
      .returning();
    const [comment] = await db
      .insert(postComments)
      .values({
        postKind: "article",
        postRefId: article.id,
        authorId: user.id,
        body: "Temporary comment",
      })
      .returning();
    await db.insert(contentReports).values({
      reporterUserId: user.id,
      contentType: "comment",
      contentId: comment.id,
      reason: "Temporary report",
    });
    await db.insert(postReactions).values({
      postKind: "article",
      postRefId: article.id,
      userId: user.id,
    });
    await db.insert(postShares).values({
      postKind: "article",
      postRefId: article.id,
      sharerUserId: user.id,
    });
    await db.insert(organizationClaimRequests).values({
      organizationId,
      requestedByUserId: user.id,
      status: "declined",
    });
    await db.insert(orgSubscriptions).values({
      organizationId,
      plan: "starter",
    });
    const [partnerPage] = await db
      .insert(partnerLandingPages)
      .values({
        slug: `cascade-${Date.now()}`,
        officialName: "Cascade Partner",
        associationLabel: "League",
        createdById: user.id,
      })
      .returning();
    await db.insert(partnerOrganizationMemberships).values({
      partnerPageId: partnerPage.id,
      organizationId,
    });

    const response = await agent
      .post("/api/v1/admin/org-claim-links/bulk-delete")
      .send({
        organizationIds: [organizationId],
        confirm: "DELETE UNCLAIMED ORGANIZATIONS",
      });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data).toMatchObject({
      requestedCount: 1,
      deletedCount: 1,
      protectedCount: 0,
      missingCount: 0,
      listDeleted: false,
    });
    expect(
      await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(contentReports)
        .where(eq(contentReports.contentId, comment.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(teams).where(eq(teams.id, team.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(postComments)
        .where(
          and(
            eq(postComments.postKind, "article"),
            eq(postComments.postRefId, article.id),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(postReactions)
        .where(eq(postReactions.postRefId, article.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(postShares)
        .where(eq(postShares.postRefId, article.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(partnerOrganizationMemberships)
        .where(
          eq(partnerOrganizationMemberships.organizationId, organizationId),
        ),
    ).toHaveLength(0);
  });

  it("deletes a named list with its ownerless organizations but protects a newly claimed row", async () => {
    const { agent, user: admin } = await loginAs(
      (user) => user.email === ADMIN_EMAIL,
    );
    const { user: owner } = await loginAs(
      (user) => user.email === "daniela@kinectem.demo",
    );
    const suffix = Date.now().toString(36);
    const listName = `Delete List ${suffix}`;
    const createdList = await agent
      .post("/api/v1/admin/org-lists")
      .send({ name: listName });
    const listId = createdList.body.data.id;
    const doomed = await agent
      .post("/api/v1/admin/org-claim-links")
      .send({ name: `Doomed ${suffix}`, listId });
    const protectedOrg = await agent
      .post("/api/v1/admin/org-claim-links")
      .send({ name: `Protected ${suffix}`, listId });
    await db.insert(organizationAdmins).values({
      organizationId: protectedOrg.body.data.id,
      userId: owner.id,
      role: "owner",
    });

    const wrong = await agent
      .post("/api/v1/admin/org-claim-links/bulk-delete")
      .send({ listId, deleteList: true, confirm: listName.toLowerCase() });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe("CONFIRMATION_REQUIRED");

    const response = await agent
      .post("/api/v1/admin/org-claim-links/bulk-delete")
      .send({ listId, deleteList: true, confirm: listName });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data).toMatchObject({
      deletedCount: 1,
      protectedCount: 1,
      listDeleted: true,
    });
    expect(response.body.data.protected[0].id).toBe(protectedOrg.body.data.id);
    expect(
      await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, doomed.body.data.id)),
    ).toHaveLength(0);
    const [survivor] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, protectedOrg.body.data.id));
    expect(survivor.adminListId).toBeNull();
    expect(
      await db.select().from(orgAdminLists).where(eq(orgAdminLists.id, listId)),
    ).toHaveLength(0);
    expect(admin.role).toBe("admin");
  });
});
