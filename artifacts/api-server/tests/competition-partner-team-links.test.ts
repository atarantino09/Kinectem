import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, organizations, organizationAdmins, teams, tournaments, tournamentParticipants,
  tournamentMatches, partnerLandingPages, partnerOrganizationMemberships,
  rosterEntries, competitionFollowers, teamFollowers, scheduleEvents,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";
import { rankTeamSuggestions, teamNameScore } from "../src/lib/partner-team-suggestions";

const orgIds: string[] = [];
const competitionIds: string[] = [];
const pageIds: string[] = [];
afterEach(async () => {
  if (competitionIds.length) await db.delete(tournaments).where(inArray(tournaments.id, competitionIds.splice(0)));
  if (pageIds.length) await db.delete(partnerLandingPages).where(inArray(partnerLandingPages.id, pageIds.splice(0)));
  if (orgIds.length) await db.delete(organizations).where(inArray(organizations.id, orgIds.splice(0)));
});

async function fixture() {
  const admin = await loginAs((user) => user.role === "admin");
  const coach = await loginAs("coach@kinectem.demo");
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const orgs = await db.insert(organizations).values([
    { name: `Partner Club ${suffix}`, claimToken: `prelink-first-${suffix}` },
    { name: `Partner Club ${suffix}`, claimToken: `prelink-second-${suffix}` },
    { name: `Unrelated Club ${suffix}` },
  ]).returning();
  orgIds.push(...orgs.map((org) => org.id));
  const clubTeams = await db.insert(teams).values([
    { name: "Rovers", organizationId: orgs[0].id, sport: "Soccer", gender: "Boys" },
    { name: "Rovers", organizationId: orgs[1].id, sport: "Soccer", gender: "Girls" },
    { name: "Outside", organizationId: orgs[2].id, sport: "Soccer" },
    { name: "Archived", organizationId: orgs[0].id, sport: "Soccer", archivedAt: new Date() },
  ]).returning();
  const [page] = await db.insert(partnerLandingPages).values({
    officialName: `Partner ${suffix}`, associationLabel: "League", slug: `prelink-${suffix}`,
  }).returning();
  pageIds.push(page.id);
  await db.insert(partnerOrganizationMemberships).values(orgs.slice(0, 2).map((org) => ({
    partnerPageId: page.id, organizationId: org.id,
  })));
  const [competition] = await db.insert(tournaments).values({
    name: `Prelink Cup ${suffix}`, slug: `prelink-cup-${suffix}`, type: "league",
    startDate: "2026-10-01", endDate: "2026-10-31",
    autoApproveClaims: false, ownerUserId: coach.user.id,
  }).returning();
  competitionIds.push(competition.id);
  const slots = await db.insert(tournamentParticipants).values([
    { tournamentId: competition.id, name: "Rovers", nameKey: "rovers", gender: "Boys" },
    { tournamentId: competition.id, name: "Rovers", nameKey: "rovers", gender: "Girls" },
    { tournamentId: competition.id, name: "Different slot", nameKey: "different slot" },
    { tournamentId: competition.id, name: "Archived", nameKey: "archived" },
    { tournamentId: competition.id, name: "Outside", nameKey: "outside" },
  ]).returning();
  const [match] = await db.insert(tournamentMatches).values({
    tournamentId: competition.id, matchNumber: "1", matchDate: "2026-10-10", startTime: "09:00",
    homeParticipantId: slots[0].id, awayParticipantId: slots[1].id, venue: "Original Field",
  }).returning();
  const base = `/api/v1/admin/competitions/${competition.id}`;
  const assignments = [
    { participantId: slots[0].id, teamId: clubTeams[0].id },
    { participantId: slots[1].id, teamId: clubTeams[1].id },
  ];
  return { admin, coach, orgs, clubTeams, page, competition, slots, match, base, assignments };
}

describe("platform-admin partner team schedule linking", () => {
  it("ranks across the entire directory before limiting, retaining duplicate club identities", async () => {
    const f = await fixture();
    await db.update(organizations).set({ name: "AAA Suggestion Club" }).where(eq(organizations.id, f.orgs[0].id));
    await db.update(organizations).set({ name: "ZZZ Suggestion Club" }).where(eq(organizations.id, f.orgs[1].id));
    await db.insert(teams).values(Array.from({ length: 205 }, (_, i) => ({
      name: `000 Unrelated ${String(i).padStart(3, "0")}`, sport: "Soccer", organizationId: f.orgs[0].id,
    })));
    const base = `${f.base}/partner-team-options?pageId=${f.page.id}`;
    const first = await f.admin.agent.get(base);
    expect(first.body.data).toHaveLength(200);
    expect(first.body.data.some((t: { id: string }) => t.id === f.clubTeams[1].id)).toBe(false);
    const suggested = await f.admin.agent.get(`${base}&suggestFor=${f.slots[0].id}`);
    expect(suggested.status).toBe(200);
    expect(suggested.body.data.map((t: { id: string }) => t.id)).toEqual([f.clubTeams[0].id, f.clubTeams[1].id]);
    expect(suggested.body.data.map((t: { organizationId: string }) => t.organizationId)).toEqual([f.orgs[0].id, f.orgs[1].id]);
    expect(suggested.body.data.map((t: { gender: string }) => t.gender)).toEqual(["Boys", "Girls"]);
    expect(suggested.body.hasMoreMatches).toBe(false);
    const filtered = await f.admin.agent.get(`${base}&organizationId=${f.orgs[1].id}&suggestFor=${f.slots[0].id}`);
    expect(filtered.body.data.map((t: { id: string }) => t.id)).toEqual([f.clubTeams[1].id]);
    const outside = await f.admin.agent.get(`${base}&suggestFor=${f.slots[4].id}`);
    expect(outside.body.data).toEqual([]);
    const unchanged = await db.select().from(tournamentParticipants).where(eq(tournamentParticipants.id, f.slots[0].id));
    expect(unchanged[0].teamId).toBeNull();
  });

  it("keeps suggestion permissions, source availability, directory scope and destination statuses intact", async () => {
    const f = await fixture();
    const base = `${f.base}/partner-team-options?pageId=${f.page.id}`;
    expect((await f.coach.agent.get(`${base}&suggestFor=${f.slots[0].id}`)).status).toBe(403);
    expect((await request(app).get(`${base}&suggestFor=${f.slots[0].id}`)).status).toBe(401);
    for (const suffix of ["suggestFor=bad", `suggestFor=${f.slots[0].id}&cursor=bad`,
      `suggestFor=${f.slots[0].id}&q=Rovers`, `suggestFor=${f.slots[0].id}&suggestFor=${f.slots[1].id}`]) {
      expect((await f.admin.agent.get(`${base}&${suffix}`)).status).toBe(400);
    }
    expect((await f.admin.agent.get(`${base}&suggestFor=${f.slots[0].id}&organizationId=${f.orgs[2].id}`)).status).toBe(404);
    await db.update(tournamentParticipants).set({ teamId: f.clubTeams[0].id }).where(eq(tournamentParticipants.id, f.slots[2].id));
    await db.update(tournamentParticipants).set({ pendingTeamId: f.clubTeams[1].id }).where(eq(tournamentParticipants.id, f.slots[4].id));
    const statuses = await f.admin.agent.get(`${base}&suggestFor=${f.slots[0].id}`);
    expect(statuses.body.data.map((t: { slotStatus: string }) => t.slotStatus).sort()).toEqual(["linked", "pending"]);
    const archived = await f.admin.agent.get(`${base}&suggestFor=${f.slots[3].id}`);
    expect(archived.body.data[0].archived).toBe(true);
    expect((await f.admin.agent.get(`${base}&suggestFor=${f.slots[2].id}`)).status).toBe(404);
    expect((await f.admin.agent.get(`${base}&suggestFor=${f.slots[4].id}`)).status).toBe(404);
    await db.update(tournamentParticipants).set({ hiddenAt: new Date() }).where(eq(tournamentParticipants.id, f.slots[0].id));
    expect((await f.admin.agent.get(`${base}&suggestFor=${f.slots[0].id}`)).status).toBe(404);
  });

  it("ranks exact names above reordered words and excludes unrelated pages without inventing confidence", async () => {
    const f = await fixture();
    await db.update(tournamentParticipants).set({ name: "Rovers Gold" }).where(eq(tournamentParticipants.id, f.slots[0].id));
    const candidates = await db.insert(teams).values([
      { name: "Rovers Gold", sport: "Soccer", organizationId: f.orgs[0].id },
      { name: "Gold Rovers", sport: "Soccer", organizationId: f.orgs[0].id },
      { name: "Totally Unrelated", sport: "Soccer", organizationId: f.orgs[0].id },
    ]).returning();
    const result = await f.admin.agent.get(`${f.base}/partner-team-options?pageId=${f.page.id}&suggestFor=${f.slots[0].id}`);
    expect(result.status).toBe(200);
    const ids = result.body.data.map((t: { id: string }) => t.id);
    expect(ids[0]).toBe(candidates[0].id);
    expect(ids).toContain(candidates[1].id);
    expect(ids).not.toContain(candidates[2].id);
    expect(result.body.data.every((t: { score?: number }) => t.score === undefined)).toBe(true);
  });
  it("ranks readable names without merging duplicate identities or inferring gender", () => {
    const ranked = rankTeamSuggestions("Róvers FC", [
      { id: "partial", name: "Rovers Academy FC", gender: "Boys" },
      { id: "exact-b", name: "Rovers-FC", gender: "Girls" },
      { id: "unrelated", name: "Comets FC", gender: "Boys" },
      { id: "exact-a", name: "Rovers FC", gender: "Boys" },
    ]);
    expect(ranked.slice(0, 2).map((team) => team.id).sort()).toEqual(["exact-a", "exact-b"]);
    expect(ranked.at(-1)?.id).toBe("partial");
    expect(teamNameScore("Rovers U14 Boys", "Comets U14 Boys")).toBe(0);
    expect(teamNameScore("", "Rovers")).toBe(0);
  });

  it("suggests matches beyond the first options page, keeps duplicate clubs distinct, and never crosses the directory boundary", async () => {
    const f = await fixture();
    await db.insert(teams).values(Array.from({ length: 205 }, (_, i) => ({
      name: `A filler ${String(i).padStart(3, "0")}`, organizationId: f.orgs[0].id, sport: "Soccer",
    })));
    await db.update(teams).set({ name: "Rovers" }).where(eq(teams.id, f.clubTeams[2].id));
    const first = await f.admin.agent.get(`${f.base}/partner-team-options?pageId=${f.page.id}`);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.data.some((team: { id: string }) => team.id === f.clubTeams[0].id)).toBe(false);
    const url = `${f.base}/partner-team-options?pageId=${f.page.id}&suggestedFor=${f.slots[0].id}`;
    const response = await f.admin.agent.get(url);
    expect(response.status, response.text).toBe(200);
    expect(response.body.hasMore).toBe(false);
    expect(response.body.data.map((team: { id: string }) => team.id).sort())
      .toEqual(f.clubTeams.slice(0, 2).map((team) => team.id).sort());
    expect(response.body.data.map((team: { organizationId: string }) => team.organizationId).sort())
      .toEqual(f.orgs.slice(0, 2).map((org) => org.id).sort());
    const unchanged = await db.select().from(tournamentParticipants).where(eq(tournamentParticipants.id, f.slots[0].id));
    expect(unchanged[0].teamId).toBeNull();
    for (const extra of ["&q=Rovers", `&organizationId=${f.orgs[0].id}`, "&cursor=abc", "&suggestedFor=invalid"]) {
      expect((await f.admin.agent.get(url + extra)).status).toBe(400);
    }
    const [other] = await db.insert(tournaments).values({
      name: "Other cup", slug: `other-${f.competition.id}`, type: "league",
      startDate: "2026-10-01", endDate: "2026-10-31",
    }).returning();
    competitionIds.push(other.id);
    expect((await f.admin.agent.get(url.replace(f.competition.id, other.id))).status).toBe(404);
    expect((await f.coach.agent.get(url)).status).toBe(403);
    expect((await request(app).get(url)).status).toBe(401);
  });

  it("returns unavailable status on suggestions without loosening write restrictions", async () => {
    const f = await fixture();
    await db.update(teams).set({ name: "Rovers" }).where(eq(teams.id, f.clubTeams[3].id));
    await db.update(tournamentParticipants).set({ teamId: f.clubTeams[0].id })
      .where(eq(tournamentParticipants.id, f.slots[0].id));
    await db.update(tournamentParticipants).set({ pendingTeamId: f.clubTeams[1].id })
      .where(eq(tournamentParticipants.id, f.slots[1].id));
    const response = await f.admin.agent.get(
      `${f.base}/partner-team-options?pageId=${f.page.id}&suggestedFor=${f.slots[0].id}`,
    );
    expect(response.body.data).toContainEqual(expect.objectContaining({ id: f.clubTeams[0].id, slotStatus: "linked" }));
    expect(response.body.data).toContainEqual(expect.objectContaining({ id: f.clubTeams[1].id, slotStatus: "pending" }));
    expect(response.body.data).toContainEqual(expect.objectContaining({ id: f.clubTeams[3].id, archived: true }));
  });

  it("finds ownerless and claimed clubs, with distinct identities and unavailable-team status", async () => {
    const f = await fixture();
    await db.insert(organizationAdmins).values({
      organizationId: f.orgs[1].id, userId: f.coach.user.id, role: "owner",
    });
    const options = await f.admin.agent.get(`${f.base}/partner-team-options?pageId=${f.page.id}`);
    expect(options.status, options.text).toBe(200);
    expect(options.headers["cache-control"]).toContain("no-store");
    expect(options.body.hasMore).toBe(false);
    expect(options.body.data).toHaveLength(3);
    for (const team of f.clubTeams.slice(0, 2)) {
      expect(options.body.data).toContainEqual(expect.objectContaining({
        id: team.id, name: "Rovers", organizationId: team.organizationId,
        gender: team.gender, archived: false, slotStatus: null,
      }));
    }
    expect(options.body.data).toContainEqual(expect.objectContaining({ id: f.clubTeams[3].id, archived: true }));
    const search = await f.admin.agent.get(`${f.base}/partner-team-options?pageId=${f.page.id}&q=Archived`);
    expect(search.body.data.map((team: { id: string }) => team.id)).toEqual([f.clubTeams[3].id]);
    const literal = await f.admin.agent.get(`${f.base}/partner-team-options?pageId=${f.page.id}&q=%25`);
    expect(literal.body.data).toEqual([]);
  });

  it("links across clubs immediately without ownership/follower/calendar side effects and preserves live schedules through handoff", async () => {
    const f = await fixture();
    const beforeTeams = await db.select().from(teams).where(inArray(teams.id, f.clubTeams.map((team) => team.id)));
    const beforeOrgs = await db.select().from(organizations).where(inArray(organizations.id, f.orgs.map((org) => org.id)));
    const response = await f.admin.agent.post(`${f.base}/partner-team-links`)
      .send({ pageId: f.page.id, assignments: f.assignments });
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({ ok: true, succeeded: 2, failed: 0 });
    const linked = await db.select().from(tournamentParticipants)
      .where(inArray(tournamentParticipants.id, f.slots.slice(0, 2).map((slot) => slot.id)));
    expect(linked.every((slot) => slot.teamId && slot.pendingTeamId == null && slot.claimedByUserId === f.admin.user.id)).toBe(true);
    expect(await db.select().from(teams).where(inArray(teams.id, f.clubTeams.map((team) => team.id)))).toEqual(beforeTeams);
    expect(await db.select().from(organizations).where(inArray(organizations.id, f.orgs.map((org) => org.id)))).toEqual(beforeOrgs);
    expect(await db.select().from(organizationAdmins).where(inArray(organizationAdmins.organizationId, f.orgs.map((org) => org.id)))).toHaveLength(0);
    expect(await db.select().from(rosterEntries).where(inArray(rosterEntries.teamId, f.clubTeams.map((team) => team.id)))).toHaveLength(0);
    expect(await db.select().from(teamFollowers).where(inArray(teamFollowers.teamId, f.clubTeams.map((team) => team.id)))).toHaveLength(0);
    expect(await db.select().from(competitionFollowers).where(eq(competitionFollowers.competitionId, f.competition.id))).toHaveLength(0);
    expect(await db.select().from(scheduleEvents).where(inArray(scheduleEvents.teamId, f.clubTeams.map((team) => team.id)))).toHaveLength(0);
    const publicCompetition = await request(app).get(`/api/v1/competitions/${f.competition.slug}`);
    expect(publicCompetition.body.competition.autoApproveClaims).toBe(false);
    for (let i = 0; i < 2; i++) {
      expect(publicCompetition.body.participants).toContainEqual(expect.objectContaining({
        id: f.slots[i].id, teamId: f.clubTeams[i].id, claimed: true,
      }));
      const schedule = await request(app).get(`/api/v1/teams/${f.clubTeams[i].id}/tournament-schedule`);
      expect(schedule.status).toBe(200);
      expect(schedule.body.data[0].matches).toContainEqual(expect.objectContaining({ id: f.match.id, venue: "Original Field" }));
    }
    await db.update(tournamentMatches).set({ venue: "Moved Field", matchDate: "2026-10-12" })
      .where(eq(tournamentMatches.id, f.match.id));
    // Ownership handoff changes org membership, never participant references.
    await db.insert(organizationAdmins).values({
      organizationId: f.orgs[0].id, userId: f.coach.user.id, role: "owner",
    });
    const afterHandoff = await f.coach.agent.get(`/api/v1/teams/${f.clubTeams[0].id}/tournament-schedule`);
    expect(afterHandoff.body.data[0].matches).toContainEqual(expect.objectContaining({
      id: f.match.id, venue: "Moved Field", matchDate: "2026-10-12",
    }));
    const afterOptions = await f.admin.agent.get(`${f.base}/partner-team-options?pageId=${f.page.id}&q=Rovers`);
    expect(afterOptions.body.data.every((team: { slotStatus: string }) => team.slotStatus === "linked")).toBe(true);
  });

  it("preserves partial successes, requires explicit mismatches, and makes retries non-destructive", async () => {
    const f = await fixture();
    const assignments = [f.assignments[0], { teamId: f.clubTeams[1].id, participantId: f.slots[2].id }];
    const first = await f.admin.agent.post(`${f.base}/partner-team-links`).send({ pageId: f.page.id, assignments });
    expect(first.body).toMatchObject({ succeeded: 1, failed: 1 });
    expect(first.body.results[1]).toMatchObject({ code: "NAME_MISMATCH_ACKNOWLEDGEMENT_REQUIRED" });
    const retry = await f.admin.agent.post(`${f.base}/partner-team-links`).send({
      pageId: f.page.id, assignments: [{ ...assignments[1], nameMismatchAcknowledged: true }],
    });
    expect(retry.body).toMatchObject({ succeeded: 1, failed: 0 });
    const repeated = await f.admin.agent.post(`${f.base}/partner-team-links`).send({
      pageId: f.page.id, assignments: [f.assignments[0]],
    });
    expect(repeated.body.results[0]).toMatchObject({ ok: false, code: "ALREADY_CLAIMED" });
  });

  it("blocks foreign teams, archived teams, hidden slots, removed memberships, and pending claims", async () => {
    const f = await fixture();
    const foreignAndArchived = await f.admin.agent.post(`${f.base}/partner-team-links`).send({
      pageId: f.page.id, assignments: [
        { teamId: f.clubTeams[2].id, participantId: f.slots[4].id },
        { teamId: f.clubTeams[3].id, participantId: f.slots[3].id },
      ],
    });
    expect(foreignAndArchived.body.results.map((result: { code: string }) => result.code))
      .toEqual(["TEAM_NOT_IN_DIRECTORY", "TEAM_ARCHIVED"]);
    await db.update(tournamentParticipants).set({ hiddenAt: new Date() }).where(eq(tournamentParticipants.id, f.slots[0].id));
    await db.update(tournamentParticipants).set({ pendingTeamId: f.clubTeams[1].id }).where(eq(tournamentParticipants.id, f.slots[1].id));
    const hiddenPending = await f.admin.agent.post(`${f.base}/partner-team-links`)
      .send({ pageId: f.page.id, assignments: f.assignments });
    expect(hiddenPending.body.results.map((result: { code: string }) => result.code)).toEqual(["SLOT_UNAVAILABLE", "CLAIM_PENDING"]);
    const pendingTeam = await f.admin.agent.post(`${f.base}/partner-team-links`).send({
      pageId: f.page.id, assignments: [{ teamId: f.clubTeams[1].id, participantId: f.slots[2].id, nameMismatchAcknowledged: true }],
    });
    expect(pendingTeam.body.results[0].code).toBe("TEAM_ALREADY_IN_COMPETITION");
    await db.delete(partnerOrganizationMemberships).where(and(
      eq(partnerOrganizationMemberships.partnerPageId, f.page.id),
      eq(partnerOrganizationMemberships.organizationId, f.orgs[0].id),
    ));
    const removed = await f.admin.agent.post(`${f.base}/partner-team-links`)
      .send({ pageId: f.page.id, assignments: [f.assignments[0]] });
    expect(removed.body.results[0].code).toBe("TEAM_NOT_IN_DIRECTORY");
  });

  it("rejects malformed/duplicate/oversized matches before making any links", async () => {
    const f = await fixture();
    for (const assignments of [
      [], [f.assignments[0], f.assignments[0]],
      [f.assignments[0], { ...f.assignments[1], teamId: f.assignments[0].teamId }],
      [f.assignments[0], { ...f.assignments[1], participantId: f.assignments[0].participantId }],
      Array.from({ length: 101 }, () => f.assignments[0]),
      [{ participantId: "invalid", teamId: f.clubTeams[0].id }],
    ]) {
      const response = await f.admin.agent.post(`${f.base}/partner-team-links`).send({ pageId: f.page.id, assignments });
      expect(response.status).toBe(400);
    }
    const slots = await db.select().from(tournamentParticipants).where(eq(tournamentParticipants.tournamentId, f.competition.id));
    expect(slots.every((slot) => slot.teamId == null)).toBe(true);
  });

  it("rejects anonymous, non-admin, and masqueraded access to both operations", async () => {
    const f = await fixture();
    const optionsUrl = `${f.base}/partner-team-options?pageId=${f.page.id}`;
    const suggestionsUrl = `${optionsUrl}&suggestedFor=${f.slots[0].id}`;
    const clubsUrl = `${f.base}/partner-team-clubs?pageId=${f.page.id}`;
    const postUrl = `${f.base}/partner-team-links`;
    const body = { pageId: f.page.id, assignments: f.assignments };
    expect((await request(app).get(optionsUrl)).status).toBe(401);
    expect((await request(app).get(suggestionsUrl)).status).toBe(401);
    expect((await request(app).get(clubsUrl)).status).toBe(401);
    expect((await request(app).post(postUrl).send(body)).status).toBe(401);
    expect((await f.coach.agent.get(optionsUrl)).status).toBe(403);
    expect((await f.coach.agent.get(suggestionsUrl)).status).toBe(403);
    expect((await f.coach.agent.get(clubsUrl)).status).toBe(403);
    expect((await f.coach.agent.post(postUrl).send(body)).status).toBe(403);
    const start = await f.admin.agent.post(`/api/v1/admin/masquerade/${f.coach.user.id}/start`);
    expect(start.status, start.text).toBe(200);
    expect((await f.admin.agent.get(optionsUrl)).status).toBe(403);
    expect((await f.admin.agent.get(suggestionsUrl)).status).toBe(403);
    expect((await f.admin.agent.get(clubsUrl)).status).toBe(403);
    expect((await f.admin.agent.post(postUrl).send(body)).status).toBe(403);
    expect((await f.admin.agent.post("/api/v1/admin/masquerade/stop")).status).toBe(200);
  });

  it("shares the ordinary claim lock so competing admin/coach submissions cannot double-link a team", async () => {
    const f = await fixture();
    await db.insert(organizationAdmins).values({
      organizationId: f.orgs[0].id, userId: f.coach.user.id, role: "admin",
    });
    const [adminAttempt, coachAttempt] = await Promise.all([
      f.admin.agent.post(`${f.base}/partner-team-links`).send({ pageId: f.page.id, assignments: [f.assignments[0]] }),
      f.coach.agent.post(`/api/v1/competitions/${f.competition.slug}/claim`)
        .send({ participantId: f.slots[2].id, existingTeamId: f.clubTeams[0].id }),
    ]);
    expect(adminAttempt.status, adminAttempt.text).toBe(200);
    expect([201, 409]).toContain(coachAttempt.status);
    const slots = await db.select().from(tournamentParticipants).where(eq(tournamentParticipants.tournamentId, f.competition.id));
    expect(slots.filter((slot) => slot.teamId === f.clubTeams[0].id || slot.pendingTeamId === f.clubTeams[0].id)).toHaveLength(1);
    expect(Number(adminAttempt.body.results[0].ok) + Number(coachAttempt.status === 201)).toBe(1);
  });

  it("bounds directory options and lets admins find teams beyond the initial result limit", async () => {
    const f = await fixture();
    await db.update(organizations).set({ name: "A Busy Club" }).where(eq(organizations.id, f.orgs[0].id));
    await db.update(organizations).set({ name: "Z Later Club" }).where(eq(organizations.id, f.orgs[1].id));
    await db.insert(teams).values(Array.from({ length: 201 }, (_, index) => ({
      organizationId: f.orgs[0].id,
      name: `Search team ${String(index).padStart(4, "0")}`,
    })));
    const initial = await f.admin.agent.get(`${f.base}/partner-team-options?pageId=${f.page.id}`);
    expect(initial.status).toBe(200);
    expect(initial.body.data).toHaveLength(200);
    expect(initial.body.hasMore).toBe(true);
    expect(initial.body.nextCursor).toEqual(expect.any(String));
    expect(initial.body.data.every((team: { organizationId: string }) => team.organizationId === f.orgs[0].id)).toBe(true);
    const clubs = await f.admin.agent.get(`${f.base}/partner-team-clubs?pageId=${f.page.id}`);
    expect(clubs.status, clubs.text).toBe(200);
    expect(clubs.body.data).toEqual([
      expect.objectContaining({ id: f.orgs[0].id, name: "A Busy Club", teamCount: 202 }),
      expect.objectContaining({ id: f.orgs[1].id, name: "Z Later Club", teamCount: 1 }),
    ]);
    const laterClub = await f.admin.agent.get(
      `${f.base}/partner-team-options?pageId=${f.page.id}&organizationId=${f.orgs[1].id}`,
    );
    expect(laterClub.status, laterClub.text).toBe(200);
    expect(laterClub.body.data.map((team: { id: string }) => team.id)).toEqual([f.clubTeams[1].id]);
    expect(laterClub.body.hasMore).toBe(false);
    const narrow = await f.admin.agent.get(`${f.base}/partner-team-options?pageId=${f.page.id}&q=Search%20team%200200`);
    expect(narrow.body.data).toEqual([expect.objectContaining({ name: "Search team 0200" })]);
    expect(narrow.body.hasMore).toBe(false);
    expect(narrow.body.nextCursor).toBeNull();
    const continuation = await f.admin.agent.get(
      `${f.base}/partner-team-options?pageId=${f.page.id}&cursor=${initial.body.nextCursor}`,
    );
    expect(continuation.status, continuation.text).toBe(200);
    expect(continuation.body.data).toHaveLength(4);
    expect(continuation.body.hasMore).toBe(false);
    expect(continuation.body.nextCursor).toBeNull();
    const ids = [...initial.body.data, ...continuation.body.data].map((team: { id: string }) => team.id);
    expect(new Set(ids).size).toBe(204);
    expect(continuation.body.data).toContainEqual(expect.objectContaining({ id: f.clubTeams[1].id }));
    for (const scopeChange of [
      `&organizationId=${f.orgs[0].id}`,
      "&q=Search",
      `&pageId=${crypto.randomUUID()}`,
    ]) {
      const result = await f.admin.agent.get(
        `${f.base}/partner-team-options?pageId=${f.page.id}&cursor=${initial.body.nextCursor}${scopeChange}`,
      );
      expect([400, 404]).toContain(result.status);
    }
    const filtered = await f.admin.agent.get(
      `${f.base}/partner-team-options?pageId=${f.page.id}&organizationId=${f.orgs[0].id}&q=Search`,
    );
    const filteredTail = await f.admin.agent.get(
      `${f.base}/partner-team-options?pageId=${f.page.id}&organizationId=${f.orgs[0].id}&q=Search&cursor=${filtered.body.nextCursor}`,
    );
    expect(filteredTail.status, filteredTail.text).toBe(200);
    expect(filteredTail.body.data).toEqual([expect.objectContaining({ name: "Search team 0200", organizationId: f.orgs[0].id })]);
    expect(filteredTail.body.hasMore).toBe(false);
  });

  it("rejects malformed continuation without bypassing directory or filter validation", async () => {
    const f = await fixture();
    const base = `${f.base}/partner-team-options?pageId=${f.page.id}&cursor=`;
    const malformed = [
      "", "not-json", "!", "a".repeat(8193),
      Buffer.from(JSON.stringify({ id: f.clubTeams[0].id })).toString("base64url"),
      Buffer.from(JSON.stringify({
        scope: JSON.stringify([f.competition.id, f.page.id, "", ""]),
        organizationName: f.orgs[0].name, organizationId: "invalid", name: "Rovers", id: f.clubTeams[0].id,
      })).toString("base64url"),
    ];
    for (const cursor of malformed) {
      expect((await f.admin.agent.get(`${base}${cursor}`)).status).toBe(400);
    }
    expect((await f.admin.agent.get(`${base}abc&cursor=def`)).status).toBe(400);
    expect((await request(app).get(`${base}abc`)).status).toBe(401);
    expect((await f.coach.agent.get(`${base}abc`)).status).toBe(403);
  });

  it("discovers duplicate-named ownerless/claimed clubs separately, excluding empty or archived-only clubs", async () => {
    const f = await fixture();
    await db.insert(organizationAdmins).values({
      organizationId: f.orgs[1].id, userId: f.coach.user.id, role: "owner",
    });
    const [empty] = await db.insert(organizations).values({ name: "Empty directory club" }).returning();
    orgIds.push(empty.id);
    await db.insert(partnerOrganizationMemberships).values([
      { partnerPageId: f.page.id, organizationId: empty.id },
      { partnerPageId: f.page.id, organizationId: f.orgs[2].id },
    ]);
    await db.update(teams).set({ archivedAt: new Date() }).where(eq(teams.id, f.clubTeams[2].id));
    const response = await f.admin.agent.get(`${f.base}/partner-team-clubs?pageId=${f.page.id}`);
    expect(response.status, response.text).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body.data).toHaveLength(2);
    expect(new Set(response.body.data.map((club: { id: string }) => club.id)))
      .toEqual(new Set(f.orgs.slice(0, 2).map((org) => org.id)));
    expect(response.body.data.every((club: { name: string; teamCount: number }) =>
      club.name === f.orgs[0].name && club.teamCount === 1)).toBe(true);
  });

  it("validates club filters and refuses clubs outside the selected directory", async () => {
    const f = await fixture();
    const base = `${f.base}/partner-team-options?pageId=${f.page.id}`;
    for (const filter of ["invalid", "", `${f.orgs[0].id}&organizationId=${f.orgs[1].id}`]) {
      expect((await f.admin.agent.get(`${base}&organizationId=${filter}`)).status).toBe(400);
    }
    expect((await f.admin.agent.get(`${base}&organizationId=${f.orgs[2].id}`)).status).toBe(404);
    const narrowed = await f.admin.agent.get(`${base}&organizationId=${f.orgs[0].id}&q=Rovers`);
    expect(narrowed.body.data.map((team: { id: string }) => team.id)).toEqual([f.clubTeams[0].id]);
    const absent = await f.admin.agent.get(`${base}&organizationId=${f.orgs[0].id}&q=Outside`);
    expect(absent.body.data).toEqual([]);
    expect((await f.admin.agent.get(`${f.base}/partner-team-clubs?pageId=invalid`)).status).toBe(400);
  });

  it("only one admin can claim the same slot, or separate slots for the same destination team", async () => {
    for (const sameSlot of [true, false]) {
      const f = await fixture();
      const second = sameSlot
        ? { teamId: f.clubTeams[1].id, participantId: f.slots[0].id }
        : { teamId: f.clubTeams[0].id, participantId: f.slots[2].id, nameMismatchAcknowledged: true };
      const responses = await Promise.all([f.assignments[0], second].map((assignment) =>
        f.admin.agent.post(`${f.base}/partner-team-links`).send({ pageId: f.page.id, assignments: [assignment] }),
      ));
      expect(responses.every((response) => response.status === 200)).toBe(true);
      expect(responses.reduce((total, response) => total + response.body.succeeded, 0)).toBe(1);
    }
  });
});
