import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  articles, db, organizationAdmins, organizations, teams, tournaments,
  tournamentMatches, tournamentParticipants, competitionBrackets,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { app, loginAs, request } from "./helpers";
import { matchEligibility } from "../src/lib/season-competition-sources";
import { buildSeasonRecapPrompt } from "../src/lib/ai";

const { generateMock } = vi.hoisted(() => ({
  generateMock: vi.fn().mockResolvedValue("The team faced four opponents across the weekend."),
}));
vi.mock("../src/lib/ai", async () => ({
  ...await vi.importActual<typeof import("../src/lib/ai")>("../src/lib/ai"),
  generateSeasonRecapText: generateMock,
}));

async function fixture() {
  const author = await loginAs("coach@kinectem.demo");
  const [org] = await db.insert(organizations).values({ name: "Combined weekend club" }).returning();
  await db.insert(organizationAdmins).values({ organizationId: org.id, userId: author.user.id, role: "owner" });
  const [team] = await db.insert(teams).values({ organizationId: org.id, name: "Weekend Wolves" }).returning();
  const [competition, league] = await db.insert(tournaments).values([
    { name: "Weekend Cup", slug: "weekend-combined-cup", startDate: "2026-10-03", endDate: "2026-10-04", ownerUserId: author.user.id, createdById: author.user.id },
    { name: "Overlapping League", slug: "overlap-combined-league", startDate: "2026-08-01", endDate: "2026-12-31", ownerUserId: author.user.id, createdById: author.user.id },
  ]).returning();
  const [bracket] = await db.insert(competitionBrackets).values({
    tournamentId: competition.id, label: "U12 Girls Black", labelKey: "u12 girls black",
  }).returning();
  const [slot, opponent] = await db.insert(tournamentParticipants).values([
    { tournamentId: competition.id, name: team.name, nameKey: "wolves", teamId: team.id, bracketId: bracket.id },
    { tournamentId: competition.id, name: "Tigers", nameKey: "tigers" },
  ]).returning();
  await db.insert(tournamentParticipants).values({ tournamentId: league.id, name: team.name, nameKey: "wolves", teamId: team.id });
  const games = await db.insert(tournamentMatches).values([
    ...["2026-10-03", "2026-10-03", "2026-10-04", "2026-10-04"].map((day, i) => ({
      tournamentId: competition.id, matchNumber: `${i + 1}`, matchDate: day,
      homeParticipantId: slot.id, awayParticipantId: opponent.id, status: "completed",
      homeScoreOfficial: 3, awayScoreOfficial: 1, startTime: i % 2 ? "15:00" : "09:00",
    })),
    { tournamentId: competition.id, matchNumber: "5", matchDate: "2026-10-03", homeParticipantId: slot.id, awayParticipantId: opponent.id, status: "scheduled" },
    { tournamentId: competition.id, matchNumber: "6", matchDate: "2099-10-03", homeParticipantId: slot.id, awayParticipantId: opponent.id, status: "scheduled" },
    { tournamentId: competition.id, matchNumber: "7", matchDate: "2026-10-03", homeParticipantId: slot.id, awayParticipantId: opponent.id, status: "canceled" },
    { tournamentId: competition.id, matchNumber: "8", matchDate: "2026-10-03", homeParticipantId: opponent.id, awayParticipantId: opponent.id, status: "completed" },
  ]).returning();
  const recaps = await db.insert(articles).values(games.slice(0, 4).map((g, i) => ({
    teamId: team.id, authorId: author.user.id, competitionId: competition.id,
    competitionGameId: g.id, title: `Weekend recap ${i + 1}`, body: "The team kept working together.",
    summary: "Our third game of the day was a win.", status: "published" as const,
    gameDate: new Date("2026-10-05T00:00:00Z"), publishedAt: new Date("2026-10-05T12:00:00Z"),
    teamScore: 9, opponentScore: 9,
  }))).returning();
  return { ...author, team, competition, league, bracket, slot, games, recaps };
}

describe("competition combined recap sources", () => {
  beforeEach(() => generateMock.mockClear());
  it("lists overlapping and finished linked competitions with authoritative match dates and scores", async () => {
    const f = await fixture();
    const list = await f.agent.get(`/api/v1/teams/${f.team.id}/season-recap/competitions`).expect(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining([f.competition.id, f.league.id]));
    const result = await f.agent.get(`/api/v1/teams/${f.team.id}/season-recap/recaps?competitionId=${f.competition.id}`).expect(200);
    expect(result.body.matches).toHaveLength(7);
    expect(result.body.matches.find((m: { id: string }) => m.id === f.games[0].id)).toMatchObject({
      gameDate: "2026-10-03", teamScore: 3, opponentScore: 1, recapId: f.recaps[0].id,
    });
    expect(result.body.matches.find((m: { id: string }) => m.id === f.games[4].id)).toMatchObject({ requiresConfirmation: true, recapId: null });
    expect(result.body.matches.find((m: { id: string }) => m.id === f.games[5].id)).toMatchObject({ eligible: false });
    expect(result.body.matches.find((m: { id: string }) => m.id === f.games[6].id)).toMatchObject({ eligible: false });
  });

  it("generates two Saturday and two Sunday sources even when all recaps were written Monday", async () => {
    const f = await fixture();
    const response = await f.agent.post(`/api/v1/teams/${f.team.id}/season-recap/generate`).send({
      competitionId: f.competition.id, matchIds: f.games.slice(0, 4).map((g) => g.id),
      recapIds: [], newsIds: [],
    }).expect(200);
    expect(response.body.competitionId).toBe(f.competition.id);
    const input = generateMock.mock.calls[0][0];
    expect(input.recaps.map((r: { gameDate: string }) => r.gameDate)).toEqual([
      "2026-10-03", "2026-10-03", "2026-10-04", "2026-10-04",
    ]);
    expect(input.recaps.every((r: { teamScore: number }) => r.teamScore === 3)).toBe(true);
    const prompt = buildSeasonRecapPrompt(input);
    expect(prompt.system).toContain("publication, and generation dates are NEVER game dates");
    expect(prompt.system).toContain("third game of the day");
    expect(prompt.user).not.toContain("Game date: 2026-10-05");
    expect(prompt.user).not.toContain("Game 3:");
  });

  it("also resolves linked schedule dates in the ordinary recap mode and deduplicates one match", async () => {
    const f = await fixture();
    const [duplicate] = await db.insert(articles).values({
      teamId: f.team.id, authorId: f.user.id, title: "Second story of the same match",
      body: "A second story", status: "published", competitionId: f.competition.id,
      competitionGameId: f.games[0].id, gameDate: new Date("2026-10-05T00:00:00Z"),
    }).returning();
    const list = await f.agent.get(`/api/v1/teams/${f.team.id}/season-recap/recaps?start=2026-10-03&end=2026-10-04`).expect(200);
    expect(list.body.data).toHaveLength(5);
    expect(list.body.data[0].gameDate).toContain("2026-10-03");
    await f.agent.post(`/api/v1/teams/${f.team.id}/season-recap/generate`).send({
      startDate: "2026-10-03", endDate: "2026-10-04",
      recapIds: [...f.recaps.map((r) => r.id), duplicate.id], newsIds: [],
    }).expect(200);
    expect(generateMock.mock.calls[0][0].recaps).toHaveLength(4);
    expect(generateMock.mock.calls[0][0].recaps.every((r: { teamScore: number }) => r.teamScore === 3)).toBe(true);
  });

  it("retains undated posts as unknown, never substituting their publication date", async () => {
    const f = await fixture();
    const [undated] = await db.insert(articles).values({
      teamId: f.team.id, authorId: f.user.id, title: "Undated game",
      body: "A match against Tigers.", status: "published", publishedAt: new Date("2026-10-05T12:00:00Z"),
    }).returning();
    await f.agent.post(`/api/v1/teams/${f.team.id}/season-recap/generate`).send({
      startDate: "2026-10-03", endDate: "2026-10-04", recapIds: [undated.id], newsIds: [],
    }).expect(200);
    expect(generateMock.mock.calls[0][0].recaps[0].gameDate).toBeNull();
    expect(buildSeasonRecapPrompt(generateMock.mock.calls[0][0]).user).toContain("Game date: unknown");
  });

  it("requires explicit confirmation for a schedule-only match and does not manufacture a score or story", async () => {
    const f = await fixture();
    const payload = { competitionId: f.competition.id, matchIds: [f.games[4].id], recapIds: [], newsIds: [] };
    await f.agent.post(`/api/v1/teams/${f.team.id}/season-recap/generate`).send(payload).expect(400);
    expect(generateMock).not.toHaveBeenCalled();
    await f.agent.post(`/api/v1/teams/${f.team.id}/season-recap/generate`).send({
      ...payload, confirmedPlayedMatchIds: [f.games[4].id],
    }).expect(200);
    expect(generateMock.mock.calls[0][0].recaps[0]).toMatchObject({
      teamScore: null, opponentScore: null, summary: null, gameDate: "2026-10-03",
    });
  });

  it("does not treat an unlinked future-dated published post as a completed game", async () => {
    const f = await fixture();
    const [future] = await db.insert(articles).values({
      teamId: f.team.id, authorId: f.user.id, title: "Future preview",
      body: "Looking ahead.", status: "published", gameDate: new Date("2099-10-05T00:00:00Z"),
    }).returning();
    const sources = await f.agent.get(`/api/v1/teams/${f.team.id}/season-recap/recaps?end=2099-12-31`).expect(200);
    expect(sources.body.data.map((r: { id: string }) => r.id)).not.toContain(future.id);
    await f.agent.post(`/api/v1/teams/${f.team.id}/season-recap/generate`).send({
      recapIds: [future.id], newsIds: [], endDate: "2099-12-31",
    }).expect(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("rejects malformed, foreign-team, future, canceled, and mismatched competition IDs before AI egress", async () => {
    const f = await fixture();
    for (const id of [f.games[5].id, f.games[6].id, f.games[7].id, "invalid"]) {
      await f.agent.post(`/api/v1/teams/${f.team.id}/season-recap/generate`).send({
        competitionId: f.competition.id, matchIds: [id], recapIds: [], newsIds: [],
      }).expect(400);
    }
    await f.agent.post(`/api/v1/teams/${f.team.id}/season-recap/generate`).send({
      competitionId: f.league.id, matchIds: [f.games[0].id], recapIds: [], newsIds: [],
    }).expect(400);
    const outsider = await loginAs("daniela@kinectem.demo");
    await outsider.agent.get(`/api/v1/teams/${f.team.id}/season-recap/competitions`).expect(403);
    await outsider.agent.post(`/api/v1/teams/${f.team.id}/season-recap/generate`).send({
      competitionId: f.competition.id, matchIds: [f.games[0].id],
    }).expect(403);
    await request(app).get(`/api/v1/teams/${f.team.id}/season-recap/competitions`).expect(401);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("publishes a combined recap with competition-level and bracket attribution, without auto-featuring it", async () => {
    const f = await fixture();
    const posted = await f.agent.post("/api/v1/posts").send({
      postType: "long", context: { type: "team", id: f.team.id },
      recapKind: "combined", title: "Our weekend", body: "Two Saturday and two Sunday games.",
      competitionId: f.competition.id, competitionGameId: null,
    }).expect(201);
    const [saved] = await db.select().from(articles).where(eq(articles.id, posted.body.id.replace(/^article-/, "")));
    expect(saved).toMatchObject({
      competitionId: f.competition.id, competitionGameId: null,
      bracketId: f.bracket.id, recapKind: "combined", featured: false,
    });
  });

  it("does not bypass the organization's recap approval opt-in", async () => {
    const f = await fixture();
    const member = await loginAs("daniela@kinectem.demo");
    const { rosterEntries } = await import("@workspace/db");
    await db.insert(rosterEntries).values({
      teamId: f.team.id, userId: member.user.id, role: "coach", position: "coach", status: "accepted",
    });
    await db.update(organizations).set({ requireRecapApproval: true }).where(eq(organizations.id, f.team.organizationId!));
    const posted = await member.agent.post("/api/v1/posts").send({
      postType: "long", context: { type: "team", id: f.team.id },
      recapKind: "combined", title: "Weekend approval review", body: "Saturday and Sunday games.",
      competitionId: f.competition.id, competitionGameId: null,
    }).expect(201);
    expect(posted.body.requiresApproval).toBe(true);
    const [saved] = await db.select().from(articles).where(eq(articles.id, posted.body.id.replace(/^article-/, "")));
    expect(saved.status).toBe("pending_approval");
    expect(saved.featured).toBe(false);
  });

  it("marks postponed and future matches unavailable and undated completed games honestly", () => {
    expect(matchEligibility({ status: "postponed", matchDate: "2026-10-03" }, true, true).eligible).toBe(false);
    expect(matchEligibility({ status: "completed", matchDate: "2099-10-03" }, true, true).eligible).toBe(false);
    expect(matchEligibility({ status: "completed", matchDate: null }, false, false)).toMatchObject({ eligible: true, requiresConfirmation: false });
  });
});
