import { afterAll, describe, expect, it } from "vitest";
import {
  db,
  organizations,
  partnerImportCandidates,
  partnerImportDecisions,
  partnerImportSuggestions,
  partnerImportRows,
  partnerLandingPages,
  partnerOrganizationMemberships,
  organizationFollowers,
  organizationFollowOptouts,
  organizationRosterOutreach,
  stagedCoachInvites,
  teamNewsLinks,
  teams,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { app, loginAs, request } from "./helpers";

const pageIds: string[] = [];
const organizationIds: string[] = [];

afterAll(async () => {
  if (pageIds.length) {
    await db.delete(partnerLandingPages).where(inArray(partnerLandingPages.id, pageIds));
  }
  if (organizationIds.length) {
    await db.delete(organizations).where(inArray(organizations.id, organizationIds));
  }
});

describe("partner import collision decisions", () => {
  it("returns ranked evidence and applies a partner-scoped use_existing decision idempotently", async () => {
    const { agent } = await loginAs((user) => user.role === "admin");
    const suffix = Date.now().toString(36);
    const [page] = await db.insert(partnerLandingPages).values({
      slug: `import-decisions-${suffix}`,
      officialName: "Import Decisions Test",
      associationLabel: "Association",
    }).returning();
    pageIds.push(page.id);
    const [existing] = await db.insert(organizations).values({
      name: `Evidence Club ${suffix}`,
      city: "Westfield",
      state: "NJ",
    }).returning();
    organizationIds.push(existing.id);
    const [existingTeam] = await db.insert(teams).values({
      organizationId: existing.id,
      name: `Existing Team ${suffix}`,
    }).returning();
    expect((await db.select().from(teams).where(eq(teams.organizationId, existing.id)))).toHaveLength(1);

    const validation = await agent.post(
      `/api/v1/admin/partner-pages/${page.id}/import/validate`,
    ).send({
      organizations: [{ name: existing.name, sourceColumn: "club_name" }],
    });
    expect(validation.status, JSON.stringify(validation.body)).toBe(200);
    const row = validation.body.data.rows[0];
    expect(row.decisionRequired).toBe(true);
    expect(row.candidates[0]).toMatchObject({
      id: existing.id,
      matchKind: "exact",
      teamCount: 1,
      pageMember: false,
    });
    expect(row.candidates[0].evidence.exactName).toBe(true);

    const imported = await agent.post(
      `/api/v1/admin/partner-pages/${page.id}/import`,
    ).send({
      idempotencyKey: `decision-${suffix}`,
      organizations: [{
        name: existing.name,
        action: "use_existing",
        existingOrganizationId: existing.id,
      }],
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    const operationId = imported.body.data.operationId as string;
    const [membership] = await db.select().from(partnerOrganizationMemberships)
      .where(eq(partnerOrganizationMemberships.partnerPageId, page.id));
    expect(membership.organizationId).toBe(existing.id);

    const [storedRow] = await db.select().from(partnerImportRows)
      .where(eq(partnerImportRows.operationId, operationId));
    expect(storedRow.sourceName).toBe(existing.name);
    const [storedCandidate] = await db.select().from(partnerImportCandidates)
      .where(eq(partnerImportCandidates.importRowId, storedRow.id));
    expect(storedCandidate).toMatchObject({
      organizationId: existing.id,
      matchKind: "exact",
      status: "selected",
    });
    const [decision] = await db.select().from(partnerImportDecisions)
      .where(eq(partnerImportDecisions.importRowId, storedRow.id));
    expect(decision.decision).toBe("use_existing");

    const replay = await agent.post(
      `/api/v1/admin/partner-pages/${page.id}/import`,
    ).send({
      idempotencyKey: `decision-${suffix}`,
      organizations: [{
        name: existing.name,
        action: "keep_distinct",
      }],
    });
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body.data.operationId).toBe(operationId);
    const memberships = await db.select().from(partnerOrganizationMemberships)
      .where(eq(partnerOrganizationMemberships.partnerPageId, page.id));
    expect(memberships).toHaveLength(1);
    expect(memberships[0].organizationId).toBe(existing.id);

    const rememberedName = `Reversible Choice ${suffix}`;
    const priorImport = await agent.post(`/api/v1/admin/partner-pages/${page.id}/import`).send({
      idempotencyKey: `prior-${suffix}`,
      organizations: [{ name: rememberedName, action: "skip" }],
    });
    const latestImport = await agent.post(`/api/v1/admin/partner-pages/${page.id}/import`).send({
      idempotencyKey: `latest-${suffix}`,
      organizations: [{ name: rememberedName, action: "keep_distinct" }],
    });
    expect(priorImport.status).toBe(201);
    expect(latestImport.status).toBe(201);
    const [latestRow] = await db.select().from(partnerImportRows)
      .where(eq(partnerImportRows.operationId, latestImport.body.data.operationId));
    const reversed = await agent.post(
      `/api/v1/admin/partner-pages/${page.id}/import/decisions/${latestRow.id}/revert`,
    );
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect(reversed.body.data.reversible.restoredPriorDecision.decision).toBe("skip");
    const [restoredSuggestion] = await db.select().from(partnerImportSuggestions)
      .where(and(
        eq(partnerImportSuggestions.partnerPageId, page.id),
        eq(partnerImportSuggestions.normalizedName, rememberedName.toLowerCase()),
      ));
    expect(restoredSuggestion.decision).toBe("skip");

    const [collisionOrg] = await db.insert(organizations).values({
      name: `Guarded Collision ${suffix}`,
    }).returning();
    organizationIds.push(collisionOrg.id);
    const rejectedCreate = await agent.post(`/api/v1/admin/partner-pages/${page.id}/import`).send({
      idempotencyKey: `guarded-create-${suffix}`,
      organizations: [{ name: collisionOrg.name, action: "create" }],
    });
    expect(rejectedCreate.status, JSON.stringify(rejectedCreate.body)).toBe(409);
    const explicitDistinct = await agent.post(`/api/v1/admin/partner-pages/${page.id}/import`).send({
      idempotencyKey: `guarded-distinct-${suffix}`,
      organizations: [{ name: collisionOrg.name, action: "keep_distinct" }],
    });
    expect(explicitDistinct.status, JSON.stringify(explicitDistinct.body)).toBe(201);
    await expect(
      db.select().from(teams).where(eq(teams.id, existingTeam.id)),
    ).resolves.toHaveLength(1);
    const detail = await agent.get(`/api/v1/admin/partner-pages/${page.id}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data.members[0]).toEqual(expect.objectContaining({
      duplicateCandidates: expect.any(Array),
      protection: expect.anything(),
      cleanup: expect.objectContaining({
        allowed: expect.any(Boolean),
      }),
    }));
  });
});

describe("partner import replacement safety", () => {
  it("does not create teams or delete an import source that has activity", async () => {
    const { agent, user } = await loginAs((candidate) => candidate.role === "admin");
    const suffix = Date.now().toString(36);
    const [page] = await db.insert(partnerLandingPages).values({
      slug: `import-safety-${suffix}`,
      officialName: "Import Safety Test",
      associationLabel: "Association",
    }).returning();
    pageIds.push(page.id);
    const imported = await agent.post(
      `/api/v1/admin/partner-pages/${page.id}/import`,
    ).send({
      idempotencyKey: `source-${suffix}`,
      organizations: [
        {
          name: `Protected Source ${suffix}`,
          action: "create",
          teams: ["Protected Team", "protected team"],
        },
        { name: `Sibling Source ${suffix}` },
      ],
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    const operationId = imported.body.data.operationId as string;
    const operationMemberships = await db.select().from(partnerOrganizationMemberships)
      .where(eq(partnerOrganizationMemberships.importOperationId, operationId))
      .orderBy(partnerOrganizationMemberships.position);
    const sourceMembership = operationMemberships[0]!;
    const siblingMembership = operationMemberships[1]!;
    await db.insert(organizationFollowers).values({
      organizationId: sourceMembership.organizationId,
      userId: user.id,
    });
    const retainedTeams = await db.select().from(teams)
      .where(eq(teams.organizationId, sourceMembership.organizationId));
    expect(retainedTeams).toHaveLength(1);
    await db.insert(organizationFollowOptouts).values({
      organizationId: sourceMembership.organizationId,
      userId: user.id,
    });
    await db.insert(organizationRosterOutreach).values({
      organizationId: sourceMembership.organizationId,
      teamId: retainedTeams[0].id,
    });
    await db.insert(stagedCoachInvites).values({
      organizationId: sourceMembership.organizationId,
      teamId: retainedTeams[0].id,
      email: `coach-${suffix}@example.test`,
    });
    await db.insert(teamNewsLinks).values({
      teamId: retainedTeams[0].id,
      addedByUserId: user.id,
      url: `https://news.example.test/${suffix}`,
      title: "Protected team news",
    });
    const [replacementOrg] = await db.insert(organizations).values({
      name: `Replacement ${suffix}`,
    }).returning();
    organizationIds.push(replacementOrg.id);
    const preview = await agent.post(
      `/api/v1/admin/partner-pages/${page.id}/members/${sourceMembership.id}/replace/preview`,
    ).send({ organizationId: replacementOrg.id });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.impact.canReplace).toBe(true);
    expect(preview.body.impact.protected).toBe(true);
    expect(preview.body.impact.cleanup).toEqual(expect.arrayContaining([
      "organization_dependencies",
      "team_dependencies",
    ]));

    const replacement = await agent.post(
      `/api/v1/admin/partner-pages/${page.id}/members/${sourceMembership.id}/replace`,
    ).send({
      idempotencyKey: `replace-${suffix}`,
      organizationId: replacementOrg.id,
    });
    expect(replacement.status, JSON.stringify(replacement.body)).toBe(200);
    expect(replacement.body.data.sourceRetainedDirectoryOnly).toBe(true);
    organizationIds.push(sourceMembership.organizationId);
    organizationIds.push(siblingMembership.organizationId);
    const [updatedMembership] = await db.select().from(partnerOrganizationMemberships)
      .where(eq(partnerOrganizationMemberships.id, sourceMembership.id));
    expect(updatedMembership.organizationId).toBe(replacementOrg.id);
    expect(updatedMembership.visible).toBe(true);
    expect(updatedMembership.position).toBe(sourceMembership.position);
    const replacementReplay = await agent.post(
      `/api/v1/admin/partner-pages/${page.id}/members/${sourceMembership.id}/replace`,
    ).send({
      idempotencyKey: `replace-${suffix}`,
      organizationId: replacementOrg.id,
    });
    expect(replacementReplay.status, JSON.stringify(replacementReplay.body)).toBe(200);
    expect(replacementReplay.body).toEqual(replacement.body);
    const [laterReplacementOrg] = await db.insert(organizations).values({
      name: `Later Replacement ${suffix}`,
    }).returning();
    organizationIds.push(laterReplacementOrg.id);
    const laterReplacement = await agent.post(
      `/api/v1/admin/partner-pages/${page.id}/members/${sourceMembership.id}/replace`,
    ).send({
      idempotencyKey: `replace-later-${suffix}`,
      organizationId: laterReplacementOrg.id,
    });
    expect(laterReplacement.status, JSON.stringify(laterReplacement.body)).toBe(200);
    expect(laterReplacement.body.data.updated.organizationId).toBe(laterReplacementOrg.id);
    const [unchangedSibling] = await db.select().from(partnerOrganizationMemberships)
      .where(eq(partnerOrganizationMemberships.id, siblingMembership.id));
    expect(unchangedSibling.organizationId).toBe(siblingMembership.organizationId);
    expect(unchangedSibling.visible).toBe(siblingMembership.visible);
    // The source has activity and remains canonical; importantly, no team
    // rows were created by the import.
    await expect(
      db.select().from(organizations).where(eq(organizations.id, sourceMembership.organizationId)),
    ).resolves.toHaveLength(1);
  });

  it("deletes a clean exact-provenance empty-team source but retains protected sources", async () => {
    const { agent } = await loginAs((candidate) => candidate.role === "admin");
    const suffix = Date.now().toString(36);
    const [page] = await db.insert(partnerLandingPages).values({
      slug: `import-clean-${suffix}`,
      officialName: "Import Clean Source Test",
      associationLabel: "Association",
    }).returning();
    pageIds.push(page.id);
    const imported = await agent.post(`/api/v1/admin/partner-pages/${page.id}/import`).send({
      idempotencyKey: `clean-source-${suffix}`,
      organizations: [{ name: `Clean Source ${suffix}`, action: "create" }],
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    const [sourceMembership] = await db.select().from(partnerOrganizationMemberships)
      .where(eq(partnerOrganizationMemberships.importOperationId, imported.body.data.operationId));
    const [replacementOrg] = await db.insert(organizations).values({
      name: `Clean Replacement ${suffix}`,
    }).returning();
    organizationIds.push(replacementOrg.id, sourceMembership.organizationId);
    const preview = await agent.post(
      `/api/v1/admin/partner-pages/${page.id}/members/${sourceMembership.id}/replace/preview`,
    ).send({ organizationId: replacementOrg.id });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.impact.protected).toBe(false);
    expect(preview.body.impact.cleanup).toEqual([]);
    const replaced = await agent.post(
      `/api/v1/admin/partner-pages/${page.id}/members/${sourceMembership.id}/replace`,
    ).send({
      idempotencyKey: `clean-replace-${suffix}`,
      organizationId: replacementOrg.id,
    });
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
    await expect(
      db.select().from(organizations).where(eq(organizations.id, sourceMembership.organizationId)),
    ).resolves.toHaveLength(0);
  });
});
