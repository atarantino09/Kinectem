import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, organizations, organizationAdmins, teams, rosterEntries, tournaments, tournamentParticipants, tournamentMatches, teamHiddenCompetitionGames } from "@workspace/db";
import { loginAs, request, app } from "./helpers";

const competitionIds: string[] = [], organizationIds: string[] = [];
afterEach(async () => {
  if (competitionIds.length) await db.delete(tournaments).where(inArray(tournaments.id, competitionIds.splice(0)));
  if (organizationIds.length) {
    const ids = organizationIds.splice(0);
    await db.delete(teams).where(inArray(teams.organizationId, ids));
    await db.delete(organizations).where(inArray(organizations.id, ids));
  }
});

async function fixture(coachOnly = false) {
  const actor = await loginAs("coach@kinectem.demo"), outsider = await loginAs("marcus@kinectem.demo");
  const suffix = randomUUID();
  const [org] = await db.insert(organizations).values({ name: `Removal test ${suffix}` }).returning();
  organizationIds.push(org.id);
  const clubTeams = await db.insert(teams).values([
    { name: "Our team page", organizationId: org.id, sport: "Soccer" },
    { name: "Opponent page", organizationId: org.id, sport: "Soccer" },
  ]).returning();
  if (coachOnly) await db.insert(rosterEntries).values({
    teamId: clubTeams[0].id, userId: actor.user.id, name: "Removal coach", role: "coach", position: "coach", status: "accepted",
  });
  else await db.insert(organizationAdmins).values({ organizationId: org.id, userId: actor.user.id, role: "admin" });
  const [competition] = await db.insert(tournaments).values({
    name: `Removal cup ${suffix}`, slug: `removal-cup-${suffix}`, type: "league",
    startDate: "2026-10-01", endDate: "2026-10-31", ownerUserId: outsider.user.id,
  }).returning();
  competitionIds.push(competition.id);
  const slots = await db.insert(tournamentParticipants).values([
    { tournamentId: competition.id, name: "Original imported team", nameKey: "original", teamId: clubTeams[0].id, claimedByUserId: actor.user.id, claimedAt: new Date() },
    { tournamentId: competition.id, name: "Original opponent", nameKey: "opponent", teamId: clubTeams[1].id, claimedByUserId: outsider.user.id, claimedAt: new Date() },
    { tournamentId: competition.id, name: "Unrelated team", nameKey: "unrelated" },
  ]).returning();
  const games = await db.insert(tournamentMatches).values([1, 2, 3].map((n) => ({
    tournamentId: competition.id, matchNumber: String(n), matchDate: "2026-10-10", startTime: "10:00",
    homeParticipantId: n === 3 ? slots[1].id : slots[0].id,
    awayParticipantId: n === 3 ? slots[2].id : slots[1].id,
  }))).returning();
  const url = `/api/v1/teams/${clubTeams[0].id}/competitions/${competition.id}/remove`;
  const payload = { reviewed: true, confirmation: "REMOVE", assignments: [{ participantId: slots[0].id, claimedAt: slots[0].claimedAt!.toISOString() }] };
  return { actor, outsider, clubTeams, competition, slots, games, url, payload };
}

describe("team competition schedule removal", () => {
  it.each([false, true])("lets org admins or accepted coaches remove only one game, preserving source and opponents (%s)", async (coachOnly) => {
    const f = await fixture(coachOnly);
    const response = await f.actor.agent.post(f.url).send({ ...f.payload, matchId: f.games[0].id });
    expect(response.status).toBe(200);
    const own = await f.actor.agent.get(`/api/v1/teams/${f.clubTeams[0].id}/tournament-schedule`);
    expect(own.body.data[0].matches.map((m: { id: string }) => m.id)).toEqual([f.games[1].id]);
    const publicOwn = await request(app).get(`/api/v1/teams/${f.clubTeams[0].id}/tournament-schedule`);
    expect(publicOwn.body.data[0].matches).toHaveLength(1);
    expect(publicOwn.body.data[0].assignmentSnapshot).toBeUndefined();
    const opponent = await request(app).get(`/api/v1/teams/${f.clubTeams[1].id}/tournament-schedule`);
    expect(opponent.body.data[0].matches.map((m: { id: string }) => m.id)).toContain(f.games[0].id);
    const [source] = await db.select().from(tournamentParticipants).where(eq(tournamentParticipants.id, f.slots[0].id));
    expect(source.teamId).toBe(f.clubTeams[0].id);
    expect((await db.select().from(tournamentMatches).where(eq(tournamentMatches.tournamentId, f.competition.id)))).toHaveLength(3);
  });

  it("releases the whole assignment, preserving original identities and games and clearing exclusions for re-claim", async () => {
    const f = await fixture();
    await f.actor.agent.post(f.url).send({ ...f.payload, matchId: f.games[0].id });
    expect((await f.actor.agent.post(f.url).send(f.payload)).status).toBe(200);
    const [original, opponent] = await Promise.all(f.slots.slice(0, 2).map(async (p) =>
      (await db.select().from(tournamentParticipants).where(eq(tournamentParticipants.id, p.id)))[0]));
    expect(original).toMatchObject({ name: "Original imported team", nameKey: "original", teamId: null, claimedByUserId: null, claimedAt: null, pendingTeamId: null });
    expect(opponent.teamId).toBe(f.clubTeams[1].id);
    expect((await request(app).get(`/api/v1/teams/${f.clubTeams[0].id}/tournament-schedule`)).body.data).toEqual([]);
    expect(await db.select().from(teamHiddenCompetitionGames).where(eq(teamHiddenCompetitionGames.teamId, f.clubTeams[0].id))).toHaveLength(0);
    expect(await db.select().from(tournamentMatches).where(eq(tournamentMatches.tournamentId, f.competition.id))).toHaveLength(3);
    const [team] = await db.select().from(teams).where(eq(teams.id, f.clubTeams[0].id));
    expect(team.organizationId).toBe(f.clubTeams[0].organizationId);
    const claimed = await f.actor.agent.post(`/api/v1/competitions/${f.competition.slug}/claim`).send({
      participantId: original.id, existingTeamId: f.clubTeams[0].id,
    });
    expect(claimed.status).toBe(201);
    expect((await f.actor.agent.get(`/api/v1/teams/${f.clubTeams[0].id}/tournament-schedule`)).body.data[0].matches).toHaveLength(2);
  });

  it("requires authentication, team management and both confirmations, even for the competition owner", async () => {
    const f = await fixture();
    expect((await request(app).post(f.url).send(f.payload)).status).toBe(401);
    expect((await f.outsider.agent.post(f.url).send(f.payload)).status).toBe(403);
    for (const payload of [{ ...f.payload, reviewed: false }, { ...f.payload, confirmation: "remove" }, { ...f.payload, assignments: [] }]) {
      expect((await f.actor.agent.post(f.url).send(payload)).status).toBe(400);
    }
    expect((await f.actor.agent.post(f.url).send({ ...f.payload, matchId: f.games[2].id })).status).toBe(404);
    const [source] = await db.select().from(tournamentParticipants).where(eq(tournamentParticipants.id, f.slots[0].id));
    expect(source.teamId).toBe(f.clubTeams[0].id);
  });

  it("rejects stale assignment snapshots and duplicate release races without affecting another team", async () => {
    const f = await fixture();
    expect((await f.actor.agent.post(f.url).send({
      ...f.payload, assignments: [{ participantId: f.slots[1].id, claimedAt: f.slots[1].claimedAt!.toISOString() }],
    })).status).toBe(409);
    expect((await f.actor.agent.post(f.url).send({
      ...f.payload, assignments: [{ participantId: f.slots[0].id, claimedAt: null }],
    })).status).toBe(409);
    const results = await Promise.all([f.actor.agent.post(f.url).send(f.payload), f.actor.agent.post(f.url).send(f.payload)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [opponent] = await db.select().from(tournamentParticipants).where(and(eq(tournamentParticipants.id, f.slots[1].id)));
    expect(opponent.teamId).toBe(f.clubTeams[1].id);
  });

  it("keeps an empty manager group after the last individual game is removed, so the whole entry can still be released", async () => {
    const f = await fixture();
    for (const game of f.games.slice(0, 2)) expect((await f.actor.agent.post(f.url).send({ ...f.payload, matchId: game.id })).status).toBe(200);
    const manager = await f.actor.agent.get(`/api/v1/teams/${f.clubTeams[0].id}/tournament-schedule`);
    expect(manager.body.data[0].matches).toEqual([]);
    expect(manager.body.data[0].assignmentSnapshot[0].participantId).toBe(f.slots[0].id);
    expect((await request(app).get(`/api/v1/teams/${f.clubTeams[0].id}/tournament-schedule`)).body.data).toEqual([]);
    expect((await f.actor.agent.post(f.url).send(f.payload)).status).toBe(200);
  });
});
