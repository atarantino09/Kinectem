import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  articles, db, organizations, organizationAdmins, teams, tournaments,
  tournamentParticipants, tournamentMatches,
  rosterEntries, teamHiddenCompetitionGames,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const remove of cleanup.splice(0).reverse()) await remove();
});

async function fixture() {
  const author = await loginAs("coach@kinectem.demo");
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [org] = await db.insert(organizations).values({
    name: `Unlisted recap club ${suffix}`,
    logoUrl: "https://example.test/author-club-logo.png",
    brandPrimaryColor: "#234567",
    brandSecondaryColor: "#fedcba",
  }).returning();
  cleanup.push(() => db.delete(organizations).where(eq(organizations.id, org.id)));
  await db.insert(organizationAdmins).values({ organizationId: org.id, userId: author.user.id, role: "owner" });
  const [team] = await db.insert(teams).values({ organizationId: org.id, name: `Playoff team ${suffix}` }).returning();
  cleanup.push(() => db.delete(teams).where(eq(teams.id, team.id)));
  const [competition] = await db.insert(tournaments).values({
    name: `Playoff Cup ${suffix}`, slug: `playoff-cup-${suffix}`,
    startDate: "2026-08-01", endDate: "2026-08-03",
    ownerUserId: author.user.id, createdById: author.user.id,
    brandColor: "#123456", secondaryColor: "#abcdef",
    logoUrl: "https://example.test/playoff-logo.png",
  }).returning();
  cleanup.push(() => db.delete(tournaments).where(eq(tournaments.id, competition.id)));
  const [slot] = await db.insert(tournamentParticipants).values({
    tournamentId: competition.id, teamId: team.id, name: team.name,
    nameKey: team.name.toLowerCase(), claimedByUserId: author.user.id, claimedAt: new Date(),
  }).returning();
  const payload = {
    postType: "long", teamId: team.id, competitionId: competition.id,
    competitionGameId: null, title: "Unlisted playoff win",
    body: "A playoff game that was not imported into the schedule.",
    status: "draft",
  };
  return { author: author.agent, user: author.user, team, competition, slot, payload };
}

async function trackRecap(postId: string) {
  const id = postId.replace(/^article-/, "");
  cleanup.push(() => db.delete(articles).where(eq(articles.id, id)));
  return id;
}

describe("competition-only game recaps", () => {
  it.each(["author", "manager"])("returns empty and all-hidden competition groups to accepted %s staff without revealing hidden games", async (position) => {
    const f = await fixture();
    const staff = await loginAs("marcus@kinectem.demo");
    await db.insert(rosterEntries).values({
      teamId: f.team.id, userId: staff.user.id, role: "player", status: "accepted", position,
    });
    const path = `/api/v1/teams/${f.team.id}/tournament-schedule`;
    const empty = await staff.agent.get(path);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([
      expect.objectContaining({ tournamentId: f.competition.id, matches: [] }),
    ]);
    expect(empty.body.data[0]).not.toHaveProperty("assignmentSnapshot");
    const [game] = await db.insert(tournamentMatches).values({
      tournamentId: f.competition.id, matchNumber: "hidden", matchDate: "2026-08-01",
      homeParticipantId: f.slot.id,
    }).returning();
    await db.insert(teamHiddenCompetitionGames).values({
      teamId: f.team.id, competitionGameId: game.id, hiddenByUserId: f.user.id,
    });
    const hidden = await staff.agent.get(path);
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toEqual([
      expect.objectContaining({ tournamentId: f.competition.id, matches: [] }),
    ]);
    expect(hidden.body.data[0]).not.toHaveProperty("assignmentSnapshot");
    expect((await request(app).get(path)).body.data).toEqual([]);
    const managed = await f.author.get(path);
    expect(managed.body.data[0].matches).toEqual([expect.objectContaining({ id: game.id, hidden: true })]);
    const created = await staff.agent.post("/api/v1/posts").send(f.payload);
    expect(created.status).toBe(201);
    await trackRecap(created.body.id);
    expect((await staff.agent.post(`/api/v1/posts/${created.body.id}/publish`)).status).toBe(200);
  });

  it("saves, reopens and publishes an unlisted playoff with branding and ordinary operator curation", async () => {
    const f = await fixture();
    const schedule = await f.author.get(`/api/v1/teams/${f.team.id}/tournament-schedule`);
    expect(schedule.status).toBe(200);
    expect(schedule.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ tournamentId: f.competition.id, matches: [] }),
    ]));
    const created = await f.author.post("/api/v1/posts").send(f.payload);
    expect(created.status).toBe(201);
    const articleId = await trackRecap(created.body.id);
    const date = "2026-08-10T12:00:00.000Z"; // playoff after the imported window
    const saved = await f.author.patch(`/api/v1/posts/${created.body.id}`).send({
      body: "A hard-fought playoff victory.", gameDate: date,
      competitionId: f.competition.id, competitionGameId: null,
    });
    expect(saved.status).toBe(200);
    const reopened = await f.author.get(`/api/v1/posts/${created.body.id}`);
    expect(reopened.status).toBe(200);
    expect(reopened.body.competition).toMatchObject({
      id: f.competition.id, name: f.competition.name,
      logoUrl: f.competition.logoUrl, brandColor: "#123456", secondaryColor: "#abcdef",
    });
    expect((await f.author.patch(`/api/v1/posts/${created.body.id}`).send({ title: "Playoff champion" })).status).toBe(200);
    expect((await f.author.post(`/api/v1/posts/${created.body.id}/publish`)).status).toBe(200);
    const [stored] = await db.select().from(articles).where(eq(articles.id, articleId));
    expect(stored).toMatchObject({
      competitionId: f.competition.id, competitionGameId: null, status: "published", featured: false,
    });
    expect(stored.gameDate?.toISOString()).toBe(date);
    const published = await request(app).get(`/api/v1/posts/${created.body.id}`);
    expect(published.status).toBe(200);
    expect(published.body.competition.id).toBe(f.competition.id);
    const queue = await f.author.get(`/api/v1/competitions/${f.competition.id}/recaps`);
    expect(queue.status).toBe(200);
    expect(queue.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: articleId, featured: false, groupingSource: "recap" }),
    ]));
    const before = await request(app).get(`/api/v1/competitions/${f.competition.slug}`);
    expect(before.body.featuredRecaps).toEqual([]);
    const featured = await f.author.post(`/api/v1/competitions/${f.competition.id}/recaps/${articleId}/feature`).send({ featured: true });
    expect(featured.status).toBe(200);
    const after = await request(app).get(`/api/v1/competitions/${f.competition.slug}`);
    expect(after.body.featuredRecaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: created.body.id, groupingSource: "recap", effectiveGameDate: "2026-08-10",
        organization: expect.objectContaining({
          id: f.team.organizationId,
          logoUrl: "https://example.test/author-club-logo.png",
          brandPrimaryColor: "#234567",
          brandSecondaryColor: "#fedcba",
        }),
      }),
    ]));
    await db.update(teams).set({ organizationId: null }).where(eq(teams.id, f.team.id));
    const independent = await request(app).get(`/api/v1/competitions/${f.competition.slug}`);
    expect(independent.status).toBe(200);
    expect(independent.body.featuredRecaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.body.id, organization: null }),
    ]));
  });

  it("honors an explicitly unlisted game even on a listed match date, and preserves untouched optional links", async () => {
    const f = await fixture();
    const [game] = await db.insert(tournamentMatches).values({
      tournamentId: f.competition.id, matchNumber: "1", matchDate: "2026-08-01",
      homeParticipantId: f.slot.id,
    }).returning();
    const created = await f.author.post("/api/v1/posts").send({
      ...f.payload, gameDate: "2026-08-01T12:00:00.000Z",
    });
    expect(created.status).toBe(201);
    const id = await trackRecap(created.body.id);
    async function storedGame() {
      const [row] = await db.select().from(articles).where(eq(articles.id, id));
      return row.competitionGameId;
    }
    expect(await storedGame()).toBeNull();
    // Bracket/competition autosaves must not guess a match after reopening.
    expect((await f.author.patch(`/api/v1/posts/${created.body.id}`).send({ competitionId: f.competition.id })).status).toBe(200);
    expect(await storedGame()).toBeNull();
    expect((await f.author.patch(`/api/v1/posts/${created.body.id}`).send({
      competitionId: f.competition.id, competitionGameId: game.id,
    })).status).toBe(200);
    expect(await storedGame()).toBe(game.id);
    expect((await f.author.patch(`/api/v1/posts/${created.body.id}`).send({ competitionId: f.competition.id, body: "New detail" })).status).toBe(200);
    expect(await storedGame()).toBe(game.id);
    expect((await f.author.patch(`/api/v1/posts/${created.body.id}`).send({
      competitionId: f.competition.id, competitionGameId: null,
    })).status).toBe(200);
    expect(await storedGame()).toBeNull();
    const automatic = await f.author.post("/api/v1/posts").send({
      ...f.payload, competitionGameId: undefined, gameDate: "2026-08-01T12:00:00.000Z",
    });
    expect(automatic.status).toBe(201);
    const autoId = await trackRecap(automatic.body.id);
    const [auto] = await db.select().from(articles).where(eq(articles.id, autoId));
    expect(auto.competitionGameId).toBe(game.id);
  });

  it("rejects unclaimed competition links on both create and draft patch and rejects non-authors", async () => {
    const f = await fixture();
    const [other] = await db.insert(tournaments).values({
      name: "Unclaimed Cup", slug: `unclaimed-${f.competition.id}`,
      startDate: "2026-08-01", endDate: "2026-08-03",
    }).returning();
    cleanup.push(() => db.delete(tournaments).where(eq(tournaments.id, other.id)));
    const denied = await f.author.post("/api/v1/posts").send({ ...f.payload, competitionId: other.id });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("competition_not_claimed");
    const created = await f.author.post("/api/v1/posts").send(f.payload);
    expect(created.status).toBe(201);
    const id = await trackRecap(created.body.id);
    const deniedPatch = await f.author.patch(`/api/v1/posts/${created.body.id}`).send({ competitionId: other.id });
    expect(deniedPatch.status).toBe(403);
    const [stored] = await db.select().from(articles).where(eq(articles.id, id));
    expect(stored.competitionId).toBe(f.competition.id);
    const outsider = await loginAs("marcus@kinectem.demo");
    expect((await outsider.agent.post("/api/v1/posts").send(f.payload)).status).toBe(403);
    expect((await outsider.agent.patch(`/api/v1/posts/${created.body.id}`).send({ competitionId: other.id })).status).toBe(403);
  });
});
