import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  organizations,
  teams,
  tournaments,
  tournamentMatches,
  tournamentParticipants,
} from "@workspace/db";
import { soloTeamRecapWindowOpen } from "../src/lib/permissions";
import { app, request } from "./helpers";

const createdTeamIds: string[] = [];
const createdCompetitionIds: string[] = [];
let sequence = 0;

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function addCompetition(
  teamId: string,
  startOffset: number,
  endOffset: number,
) {
  sequence += 1;
  const [competition] = await db
    .insert(tournaments)
    .values({
      slug: `recap-window-${Date.now()}-${sequence}`,
      name: `Recap window ${sequence}`,
      type: startOffset < -20 ? "league" : "tournament",
      startDate: dateOffset(startOffset),
      endDate: dateOffset(endOffset),
    })
    .returning();
  createdCompetitionIds.push(competition.id);

  const [participant] = await db
    .insert(tournamentParticipants)
    .values({
      tournamentId: competition.id,
      teamId,
      name: `Window team ${sequence}`,
      nameKey: `window team ${sequence}`,
    })
    .returning();

  return { competition, participant };
}

async function makeSoloTeam() {
  sequence += 1;
  const [team] = await db
    .insert(teams)
    .values({ name: `Solo recap ${Date.now()}-${sequence}`, organizationId: null })
    .returning();
  createdTeamIds.push(team.id);
  return team;
}

async function makeOrganizationTeam() {
  const [organization] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (!organization) throw new Error("Expected a seeded organization");
  sequence += 1;
  const [team] = await db
    .insert(teams)
    .values({
      name: `Organization recap ${Date.now()}-${sequence}`,
      organizationId: organization.id,
    })
    .returning();
  createdTeamIds.push(team.id);
  return team;
}

afterEach(async () => {
  vi.useRealTimers();
  if (createdCompetitionIds.length > 0) {
    await db
      .delete(tournaments)
      .where(inArray(tournaments.id, createdCompetitionIds.splice(0)));
  }
  if (createdTeamIds.length > 0) {
    await db
      .delete(teams)
      .where(inArray(teams.id, createdTeamIds.splice(0)));
  }
});

describe("standalone-team competition recap window", () => {
  it("opens exactly at UTC midnight on the day before competition start", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-10T23:59:59.999Z"));
    const team = await makeSoloTeam();
    await addCompetition(team.id, 2, 4);
    expect(await soloTeamRecapWindowOpen(team.id)).toBe(false);
    vi.setSystemTime(new Date("2026-06-11T00:00:00.000Z"));
    expect(await soloTeamRecapWindowOpen(team.id)).toBe(true);
  });

  it("denies two days before start, opens the day before, and denies after end", async () => {
    const team = await makeSoloTeam();
    const { competition } = await addCompetition(team.id, 2, 3);
    expect(await soloTeamRecapWindowOpen(team.id)).toBe(false);

    await db
      .update(tournaments)
      .set({ startDate: dateOffset(1), endDate: dateOffset(2) })
      .where(eq(tournaments.id, competition.id));
    expect(await soloTeamRecapWindowOpen(team.id)).toBe(true);

    await db
      .update(tournaments)
      .set({ startDate: dateOffset(0), endDate: dateOffset(0) })
      .where(eq(tournaments.id, competition.id));
    expect(await soloTeamRecapWindowOpen(team.id)).toBe(true);

    await db
      .update(tournaments)
      .set({ startDate: dateOffset(-2), endDate: dateOffset(0) })
      .where(eq(tournaments.id, competition.id));
    expect(await soloTeamRecapWindowOpen(team.id)).toBe(true);

    await db
      .update(tournaments)
      .set({ startDate: dateOffset(-2), endDate: dateOffset(-1) })
      .where(eq(tournaments.id, competition.id));
    expect(await soloTeamRecapWindowOpen(team.id)).toBe(false);
  });

  it("uses competition dates for short events, long leagues, and overlaps", async () => {
    const shortTeam = await makeSoloTeam();
    await addCompetition(shortTeam.id, -1, 0);
    expect(await soloTeamRecapWindowOpen(shortTeam.id)).toBe(true);

    const leagueTeam = await makeSoloTeam();
    await addCompetition(leagueTeam.id, -90, 30);
    expect(await soloTeamRecapWindowOpen(leagueTeam.id)).toBe(true);

    const overlapTeam = await makeSoloTeam();
    await addCompetition(overlapTeam.id, -30, -10);
    await addCompetition(overlapTeam.id, -1, 5);
    expect(await soloTeamRecapWindowOpen(overlapTeam.id)).toBe(true);
  });

  it("exposes the competition end date for solo teams", async () => {
    const team = await makeSoloTeam();
    const { competition, participant } = await addCompetition(team.id, -2, 21);
    await db.insert(tournamentMatches).values({
      tournamentId: competition.id,
      matchNumber: "1",
      matchDate: dateOffset(0),
      homeParticipantId: participant.id,
    });

    const response = await request(app).get(
      `/api/v1/teams/${team.id}/tournament-schedule`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].recapFreeUntil).toBe(dateOffset(21));
  });

  it("keeps the expiration null for organization-backed teams", async () => {
    const team = await makeOrganizationTeam();
    const { competition, participant } = await addCompetition(team.id, -2, 21);
    await db.insert(tournamentMatches).values({
      tournamentId: competition.id,
      matchNumber: "1",
      matchDate: dateOffset(0),
      homeParticipantId: participant.id,
    });

    const response = await request(app).get(
      `/api/v1/teams/${team.id}/tournament-schedule`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data[0].recapFreeUntil).toBeNull();
  });
});