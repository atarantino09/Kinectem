import { afterEach, describe, expect, it } from "vitest";
import {
  articles,
  broadcasts,
  db,
  highlights,
  organizationAdmins,
  organizationRosterOutreach,
  organizations,
  partnerImportOperations,
  partnerLandingPages,
  partnerOrganizationMemberships,
  stagedCoachInvites,
  teamFollowers,
  teams,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { app, loginAs } from "./helpers";
import request, { type Agent } from "supertest";

type Scenario = {
  adminAgent: Agent;
  pageId: string;
  organizationIds: string[];
};

const scenarios: Scenario[] = [];

async function scenario() {
  const { agent: adminAgent } = await loginAs((user) => user.role === "admin");
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const [page] = await db.insert(partnerLandingPages).values({
    slug: `team-bulk-${suffix}`,
    officialName: `Team Bulk ${suffix}`,
    associationLabel: "Association",
  }).returning();
  const [operation] = await db.insert(partnerImportOperations).values({
    partnerPageId: page.id,
    idempotencyKey: `team-bulk-${suffix}`,
  }).returning();
  const [source, target] = await db.insert(organizations).values([
    {
      name: `Bulk Source ${suffix}`,
      partnerImportCreatedByOperationId: operation.id,
    },
    {
      name: `Bulk Target ${suffix}`,
      partnerImportCreatedByOperationId: operation.id,
    },
  ]).returning();
  await db.insert(partnerOrganizationMemberships).values([
    { partnerPageId: page.id, organizationId: source.id, importOperationId: operation.id },
    { partnerPageId: page.id, organizationId: target.id, importOperationId: operation.id },
  ]);
  scenarios.push({ adminAgent, pageId: page.id, organizationIds: [source.id, target.id] });
  return { adminAgent, page, operation, source, target };
}

afterEach(async () => {
  for (const item of scenarios.splice(0)) {
    await db.delete(partnerLandingPages).where(eq(partnerLandingPages.id, item.pageId));
    await db.delete(organizations).where(inArray(organizations.id, item.organizationIds));
  }
});

describe("partner page team bulk actions", () => {
  it("moves ownerless teams between organizations from the same import", async () => {
    const s = await scenario();
    const { user: admin } = await loginAs((u) => u.role === "admin");
    const [team] = await db.insert(teams).values({
      organizationId: s.source.id,
      name: "Imported team",
      partnerImportCreatedByOperationId: s.operation.id,
    }).returning();
    await db.insert(organizationRosterOutreach).values({
      organizationId: s.source.id,
      teamId: team.id,
      sentByUserId: admin.id,
    });
    await db.insert(stagedCoachInvites).values({
      organizationId: s.source.id,
      teamId: team.id,
      email: `coach-${s.page.id}@example.test`,
      createdById: admin.id,
    });
    const [teamBroadcast] = await db.insert(broadcasts).values({
      scope: "team",
      teamId: team.id,
      organizationId: null,
      senderUserId: admin.id,
      body: "Team-scoped announcement",
    }).returning();

    const response = await s.adminAgent
      .post(`/api/v1/admin/partner-pages/${s.page.id}/teams/bulk-action`)
      .send({ teamIds: [team.id], action: "move", targetOrganizationId: s.target.id });

    expect(response.status, response.text).toBe(200);
    expect(response.body.data).toMatchObject({ requested: 1, moved: 1, deleted: 0 });
    const [updated] = await db.select({ organizationId: teams.organizationId })
      .from(teams).where(eq(teams.id, team.id));
    expect(updated?.organizationId).toBe(s.target.id);
    const [outreach] = await db.select({
      organizationId: organizationRosterOutreach.organizationId,
    }).from(organizationRosterOutreach).where(eq(organizationRosterOutreach.teamId, team.id));
    expect(outreach?.organizationId).toBe(s.target.id);
    const [staged] = await db.select({
      organizationId: stagedCoachInvites.organizationId,
    }).from(stagedCoachInvites).where(eq(stagedCoachInvites.teamId, team.id));
    expect(staged?.organizationId).toBe(s.target.id);
    const [broadcast] = await db.select({
      organizationId: broadcasts.organizationId,
    }).from(broadcasts).where(eq(broadcasts.id, teamBroadcast.id));
    expect(broadcast?.organizationId).toBeNull();
  });

  it("requires platform-admin authentication", async () => {
    const s = await scenario();
    const { agent } = await loginAs((u) => u.role === "coach");
    const response = await agent
      .post(`/api/v1/admin/partner-pages/${s.page.id}/teams/bulk-action`)
      .send({ teamIds: [], action: "delete" });
    expect(response.status).toBe(403);
  });

  it("deletes an ownerless member team and its dependent records", async () => {
    const s = await scenario();
    const [team] = await db.insert(teams).values({
      organizationId: s.source.id,
      name: "Disposable team",
    }).returning();
    await db.insert(teamFollowers).values({ teamId: team.id, userId: (await loginAs((u) => u.role === "admin")).user.id });
    const [article] = await db.insert(articles).values({
      teamId: team.id,
      title: "Recap",
      body: "Body",
    }).returning();
    await db.insert(highlights).values({
      teamId: team.id,
      articleId: article.id,
      title: "Highlight",
      videoUrl: "https://example.com/video",
    });

    const response = await s.adminAgent
      .post(`/api/v1/admin/partner-pages/${s.page.id}/teams/bulk-action`)
      .send({ teamIds: [team.id], action: "delete" });

    expect(response.status, response.text).toBe(200);
    expect(response.body.data).toMatchObject({ requested: 1, deleted: 1, moved: 0 });
    expect((await db.select().from(teams).where(eq(teams.id, team.id))).length).toBe(0);
    expect((await db.select().from(articles).where(eq(articles.id, article.id))).length).toBe(0);
    expect((await db.select().from(teamFollowers).where(eq(teamFollowers.teamId, team.id))).length).toBe(0);
  });

  it("protects teams when ownership changes or import provenance no longer matches", async () => {
    const s = await scenario();
    const [claimedTeam, mismatchedTeam] = await db.insert(teams).values([
      {
        organizationId: s.source.id,
        name: "Claimed source team",
        partnerImportCreatedByOperationId: s.operation.id,
      },
      { organizationId: s.source.id, name: "Mismatched provenance team" },
    ]).returning();
    const [differentOperation] = await db.insert(partnerImportOperations).values({
      partnerPageId: s.page.id,
      idempotencyKey: `different-${s.page.id}`,
    }).returning();
    const [differentTarget] = await db.insert(organizations).values({
      name: "Different provenance target",
      partnerImportCreatedByOperationId: differentOperation.id,
    }).returning();
    scenarios[scenarios.length - 1]!.organizationIds.push(differentTarget.id);
    await db.insert(partnerOrganizationMemberships).values({
      partnerPageId: s.page.id,
      organizationId: differentTarget.id,
      importOperationId: differentOperation.id,
    });
    const { user: owner } = await loginAs((u) => u.role === "admin");
    await db.insert(organizationAdmins).values({
      organizationId: s.source.id,
      userId: owner.id,
      role: "owner",
    });
    const adminPage = await s.adminAgent
      .get(`/api/v1/admin/partner-pages/${s.page.id}`);
    expect(adminPage.status, adminPage.text).toBe(200);
    const listedTeams = adminPage.body.data.members
      .flatMap((member: { teams: Array<{ id: string; importOperationId: string | null }> }) =>
        member.teams);
    expect(listedTeams.find((team: { id: string }) => team.id === mismatchedTeam.id))
      .toMatchObject({ id: mismatchedTeam.id, importOperationId: null });

    const response = await s.adminAgent
      .post(`/api/v1/admin/partner-pages/${s.page.id}/teams/bulk-action`)
      .send({
        teamIds: [claimedTeam.id, mismatchedTeam.id],
        action: "move",
        targetOrganizationId: differentTarget.id,
      });

    expect(response.status, response.text).toBe(200);
    expect(response.body.data.moved).toBe(0);
    expect(response.body.data.protected.map((item: { id: string }) => item.id))
      .toEqual(expect.arrayContaining([claimedTeam.id, mismatchedTeam.id]));
    const unchanged = await db.select({ organizationId: teams.organizationId })
      .from(teams).where(inArray(teams.id, [claimedTeam.id, mismatchedTeam.id]));
    expect(unchanged.every((team) => team.organizationId === s.source.id)).toBe(true);

    await db.delete(organizationAdmins).where(eq(organizationAdmins.organizationId, s.source.id));
    const provenanceResponse = await s.adminAgent
      .post(`/api/v1/admin/partner-pages/${s.page.id}/teams/bulk-action`)
      .send({
        teamIds: [mismatchedTeam.id],
        action: "move",
        targetOrganizationId: differentTarget.id,
      });
    expect(provenanceResponse.status, provenanceResponse.text).toBe(200);
    expect(provenanceResponse.body.data.moved).toBe(0);
    expect(provenanceResponse.body.data.protected[0]).toMatchObject({
      id: mismatchedTeam.id,
      reason: "organizations_have_different_import_provenance",
    });
  });
});