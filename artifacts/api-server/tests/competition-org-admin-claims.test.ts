import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  organizationAdmins,
  organizations,
  teams,
  tournamentParticipants,
  tournaments,
} from "@workspace/db";
import { loginAs } from "./helpers";

const createdCompetitionIds: string[] = [];
const createdOrganizationIds: string[] = [];

afterEach(async () => {
  if (createdCompetitionIds.length > 0) {
    await db
      .delete(tournaments)
      .where(inArray(tournaments.id, createdCompetitionIds.splice(0)));
  }
  if (createdOrganizationIds.length > 0) {
    const organizationIds = createdOrganizationIds.splice(0);
    await db
      .delete(teams)
      .where(inArray(teams.organizationId, organizationIds));
    await db
      .delete(organizations)
      .where(inArray(organizations.id, organizationIds));
  }
});

async function setupClubAndCompetition(autoApproveClaims = true) {
  const admin = await loginAs("coach@kinectem.demo");
  const outsider = await loginAs("marcus@kinectem.demo");
  const suffix = `${Date.now()}-${Math.random()}`;

  const [organization] = await db
    .insert(organizations)
    .values({ name: `Claim Club ${suffix}` })
    .returning();
  createdOrganizationIds.push(organization.id);
  await db.insert(organizationAdmins).values({
    organizationId: organization.id,
    userId: admin.user.id,
    role: "admin",
  });
  const clubTeams = await db
    .insert(teams)
    .values([
      {
        organizationId: organization.id,
        name: `Claim Team A ${suffix}`,
        sport: "Soccer",
      },
      {
        organizationId: organization.id,
        name: `Claim Team B ${suffix}`,
        sport: "Soccer",
      },
    ])
    .returning();

  const competitionResponse = await admin.agent
    .post("/api/v1/competitions")
    .send({
      name: `Claim Cup ${suffix}`,
      type: "tournament",
      startDate: "2026-09-10",
      endDate: "2026-09-12",
      autoApproveClaims,
    });
  expect(competitionResponse.status).toBe(201);
  createdCompetitionIds.push(competitionResponse.body.id);
  if (!autoApproveClaims) {
    const update = await admin.agent
      .patch(`/api/v1/competitions/${competitionResponse.body.id}`)
      .send({ autoApproveClaims: false });
    expect(update.status).toBe(200);
    expect(update.body.autoApproveClaims).toBe(false);
  }
  const slots = await db
    .insert(tournamentParticipants)
    .values([
      {
        tournamentId: competitionResponse.body.id,
        name: clubTeams[0].name,
        nameKey: clubTeams[0].name.toLowerCase(),
      },
      {
        tournamentId: competitionResponse.body.id,
        name: clubTeams[1].name,
        nameKey: clubTeams[1].name.toLowerCase(),
      },
      {
        tournamentId: competitionResponse.body.id,
        name: `Outsider Slot ${suffix}`,
        nameKey: `outsider slot ${suffix}`.toLowerCase(),
      },
    ])
    .returning();

  return {
    admin,
    outsider,
    organization,
    clubTeams,
    slots,
    slug: competitionResponse.body.slug as string,
  };
}

describe("organization admin competition claims", () => {
  it("matches multiple club teams in one request", async () => {
    const { admin, organization, clubTeams, slots, slug } =
      await setupClubAndCompetition();

    const response = await admin.agent
      .post(`/api/v1/competitions/${slug}/claims/bulk`)
      .send({
        organizationId: organization.id,
        assignments: clubTeams.map((team, index) => ({
          teamId: team.id,
          participantId: slots[index].id,
        })),
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        ok: true,
        succeeded: 2,
        failed: 0,
      }),
    );
    expect(response.body.results).toEqual([
      expect.objectContaining({
        ok: true,
        teamId: clubTeams[0].id,
        participantId: slots[0].id,
        pendingApproval: false,
      }),
      expect.objectContaining({
        ok: true,
        teamId: clubTeams[1].id,
        participantId: slots[1].id,
        pendingApproval: false,
      }),
    ]);
  });

  it("requires mismatch acknowledgement and keeps successful bulk matches", async () => {
    const { admin, organization, clubTeams, slots, slug } =
      await setupClubAndCompetition();

    const response = await admin.agent
      .post(`/api/v1/competitions/${slug}/claims/bulk`)
      .send({
        organizationId: organization.id,
        assignments: [
          {
            teamId: clubTeams[0].id,
            participantId: slots[0].id,
          },
          {
            teamId: clubTeams[1].id,
            participantId: slots[2].id,
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        ok: false,
        succeeded: 1,
        failed: 1,
      }),
    );
    expect(response.body.results[0]).toEqual(
      expect.objectContaining({ ok: true, teamId: clubTeams[0].id }),
    );
    expect(response.body.results[1]).toEqual(
      expect.objectContaining({
        ok: false,
        teamId: clubTeams[1].id,
        code: "NAME_MISMATCH_ACKNOWLEDGEMENT_REQUIRED",
      }),
    );

    const retry = await admin.agent
      .post(`/api/v1/competitions/${slug}/claims/bulk`)
      .send({
        organizationId: organization.id,
        assignments: [
          {
            teamId: clubTeams[1].id,
            participantId: slots[2].id,
            nameMismatchAcknowledged: true,
          },
        ],
      });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(
      expect.objectContaining({ ok: true, succeeded: 1, failed: 0 }),
    );
  });

  it("preserves pending approval and rejects non-admin bulk access", async () => {
    const { admin, outsider, organization, clubTeams, slots, slug } =
      await setupClubAndCompetition(false);
    const body = {
      organizationId: organization.id,
      assignments: [
        {
          teamId: clubTeams[0].id,
          participantId: slots[0].id,
        },
      ],
    };

    const forbidden = await outsider.agent
      .post(`/api/v1/competitions/${slug}/claims/bulk`)
      .send(body);
    expect(forbidden.status).toBe(403);

    const response = await admin.agent
      .post(`/api/v1/competitions/${slug}/claims/bulk`)
      .send(body);
    expect(response.status).toBe(200);
    expect(response.body.results[0]).toEqual(
      expect.objectContaining({ ok: true, pendingApproval: true }),
    );

    const [pending] = await db
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.id, slots[0].id));
    expect(pending.teamId).toBeNull();
    expect(pending.pendingTeamId).toBe(clubTeams[0].id);

    const refreshedCompetition = await admin.agent.get(
      `/api/v1/competitions/${slug}`,
    );
    expect(refreshedCompetition.status).toBe(200);
    expect(refreshedCompetition.body.participants).toContainEqual(
      expect.objectContaining({
        id: slots[0].id,
        claimed: false,
        pending: true,
      }),
    );
  });

  it("rejects duplicate teams or slots before applying any matches", async () => {
    const { admin, organization, clubTeams, slots, slug } =
      await setupClubAndCompetition();
    const response = await admin.agent
      .post(`/api/v1/competitions/${slug}/claims/bulk`)
      .send({
        organizationId: organization.id,
        assignments: [
          { teamId: clubTeams[0].id, participantId: slots[0].id },
          { teamId: clubTeams[0].id, participantId: slots[1].id },
        ],
      });
    expect(response.status).toBe(400);

    const unchanged = await db
      .select()
      .from(tournamentParticipants)
      .where(inArray(tournamentParticipants.id, [slots[0].id, slots[1].id]));
    expect(unchanged.every((slot) => slot.teamId == null)).toBe(true);
  });

  it("lists the full club and lets a non-coach org admin claim sibling teams", async () => {
    const { admin, organization, clubTeams, slots, slug } =
      await setupClubAndCompetition();

    const manageable = await admin.agent.get("/api/v1/my/manageable-teams");
    expect(manageable.status).toBe(200);
    for (const team of clubTeams) {
      expect(manageable.body.data).toContainEqual(
        expect.objectContaining({
          id: team.id,
          organizationId: organization.id,
          organizationName: organization.name,
        }),
      );
    }

    for (let index = 0; index < clubTeams.length; index += 1) {
      const claim = await admin.agent
        .post(`/api/v1/competitions/${slug}/claim`)
        .send({
          participantId: slots[index].id,
          existingTeamId: clubTeams[index].id,
        });
      expect(claim.status).toBe(201);
      expect(claim.body).toEqual(
        expect.objectContaining({
          teamId: clubTeams[index].id,
          existingTeam: true,
          pendingApproval: false,
        }),
      );
    }
  });

  it("does not let an unrelated user claim a club team", async () => {
    const { outsider, clubTeams, slots, slug } =
      await setupClubAndCompetition();

    const manageable = await outsider.agent.get("/api/v1/my/manageable-teams");
    expect(manageable.status).toBe(200);
    expect(
      manageable.body.data.some(
        (team: { id: string }) => team.id === clubTeams[0].id,
      ),
    ).toBe(false);

    const claim = await outsider.agent
      .post(`/api/v1/competitions/${slug}/claim`)
      .send({
        participantId: slots[2].id,
        existingTeamId: clubTeams[0].id,
      });
    expect(claim.status).toBe(403);
    expect(claim.body.error).toContain(
      "team coach or an admin of its organization",
    );

    const [unchanged] = await db
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.id, slots[2].id));
    expect(unchanged.teamId).toBeNull();
  });

  it("keeps organizer review enabled for club-admin claims", async () => {
    const { admin, clubTeams, slots, slug } =
      await setupClubAndCompetition(false);

    const claim = await admin.agent
      .post(`/api/v1/competitions/${slug}/claim`)
      .send({
        participantId: slots[0].id,
        existingTeamId: clubTeams[0].id,
      });
    expect(claim.status).toBe(201);
    expect(claim.body.pendingApproval).toBe(true);

    const [pending] = await db
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.id, slots[0].id));
    expect(pending.teamId).toBeNull();
    expect(pending.pendingTeamId).toBe(clubTeams[0].id);
  });
});