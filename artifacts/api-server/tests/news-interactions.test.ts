// Task #867 — "In the News" posts are full interaction targets:
// reactions, comments, and shares on `news-<uuid>` ids, plus a detail
// read at GET /posts/news-<uuid> so the comment button has a page.
import { afterEach, describe, expect, it } from "vitest";
import { db, teamNewsLinks, notifications, postReactions, postComments, postShares } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { app, loginAs, request } from "./helpers";

async function getOrgAndTeam(name = "Varsity Football") {
  const orgs = await request(app).get("/api/v1/organizations");
  const org = orgs.body.data[0];
  const teamsRes = await request(app).get(
    `/api/v1/organizations/${org.id}/teams`,
  );
  const team = teamsRes.body.data.find(
    (t: { name: string }) => t.name === name,
  );
  if (!team) throw new Error(`team ${name} not in seed`);
  return { org, team };
}

let n = 0;
const createdNews: string[] = [];

async function seedNewsLink(
  teamId: string,
  addedByUserId: string | null,
  gameDate: string | null = null,
) {
  n += 1;
  const [row] = await db
    .insert(teamNewsLinks)
    .values({
      teamId,
      addedByUserId,
      url: `https://news.example.com/story-${Date.now()}-${n}`,
      title: `Local team wins big ${n}`,
      sourceName: "The Example Gazette",
      description: "A thrilling game recap from the local paper.",
      gameDate,
    })
    .returning();
  createdNews.push(row.id);
  return row;
}

afterEach(async () => {
  const ids = createdNews.splice(0);
  if (ids.length === 0) return;
  await db.delete(postReactions).where(inArray(postReactions.postRefId, ids));
  await db.delete(postComments).where(inArray(postComments.postRefId, ids));
  await db.delete(postShares).where(inArray(postShares.postRefId, ids));
  await db.delete(teamNewsLinks).where(inArray(teamNewsLinks.id, ids));
});

describe("news post interactions (task #867)", () => {
  it("lets a team manager set a news game date and exposes it to the matching Combined Recap window", async () => {
    const { team } = await getOrgAndTeam();
    const coach = await loginAs("coach@kinectem.demo");
    const news = await seedNewsLink(team.id, coach.user.id);

    const update = await coach.agent
      .patch(`/api/v1/teams/${team.id}/news/${news.id}`)
      .send({ gameDate: "2025-09-05" });
    expect(update.status).toBe(200);
    expect(update.body.gameDate).toBe("2025-09-05T00:00:00.000Z");

    const sources = await coach.agent.get(
      `/api/v1/teams/${team.id}/season-recap/recaps?start=2025-09-01&end=2025-09-30`,
    );
    expect(sources.status).toBe(200);
    expect(sources.body.news).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: news.id,
          gameDate: "2025-09-05T00:00:00.000Z",
        }),
      ]),
    );
    expect(sources.body.newsAvailability).toMatchObject({
      datedCount: expect.any(Number),
      undatedCount: expect.any(Number),
    });
  });

  it("requires a team manager and a real date to update news game dates", async () => {
    const { team } = await getOrgAndTeam();
    const coach = await loginAs("coach@kinectem.demo");
    const athlete = await loginAs((user) => user.role === "athlete");
    const news = await seedNewsLink(team.id, coach.user.id);
    const path = `/api/v1/teams/${team.id}/news/${news.id}`;

    expect((await request(app).patch(path).send({ gameDate: "2025-09-05" })).status).toBe(401);
    expect((await athlete.agent.patch(path).send({ gameDate: "2025-09-05" })).status).toBe(403);
    expect((await coach.agent.patch(path).send({ gameDate: "09/05/2025" })).status).toBe(400);
    expect((await coach.agent.patch(path).send({})).status).toBe(400);
    expect(
      (
        await coach.agent
          .patch(
            `/api/v1/teams/00000000-0000-0000-0000-000000000000/news/${news.id}`,
          )
          .send({ gameDate: "2025-09-05" })
      ).status,
    ).toBe(404);
    expect(
      (
        await coach.agent
          .patch(
            `/api/v1/teams/${team.id}/news/00000000-0000-0000-0000-000000000000`,
          )
          .send({ gameDate: "2025-09-05" })
      ).status,
    ).toBe(404);
  });

  it("GET /posts/news-:id returns the news post with stats and newsLink", async () => {
    const { team } = await getOrgAndTeam();
    const coach = await loginAs("coach@kinectem.demo");
    const news = await seedNewsLink(team.id, coach.user.id);

    const res = await coach.agent.get(`/api/v1/posts/news-${news.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(`news-${news.id}`);
    expect(res.body.title).toBe(news.title);
    expect(res.body.newsLink).toMatchObject({ url: news.url });
    expect(res.body.reactionCount).toBe(0);
    expect(res.body.commentCount).toBe(0);
    expect(res.body.shareCount).toBe(0);
    expect(res.body.hasReacted).toBe(false);
  });

  it("404s for a missing news id and a malformed post id", async () => {
    const coach = await loginAs("coach@kinectem.demo");
    const missing = await coach.agent.get(
      "/api/v1/posts/news-00000000-0000-0000-0000-000000000000",
    );
    expect(missing.status).toBe(404);
    const malformed = await coach.agent.put(
      "/api/v1/posts/bogus-abc/reactions",
    );
    expect(malformed.status).toBe(404);
  });

  it("likes a news post, persists the count, is idempotent, and bell-notifies the adder once", async () => {
    const { team } = await getOrgAndTeam();
    const coach = await loginAs("coach@kinectem.demo");
    const news = await seedNewsLink(team.id, coach.user.id);
    const liker = await loginAs(
      (u) => u.role === "athlete" && u.id !== coach.user.id,
    );

    const like = await liker.agent.put(`/api/v1/posts/news-${news.id}/reactions`);
    expect(like.status).toBe(204);
    // Idempotent re-like.
    const again = await liker.agent.put(`/api/v1/posts/news-${news.id}/reactions`);
    expect(again.status).toBe(204);

    const detail = await liker.agent.get(`/api/v1/posts/news-${news.id}`);
    expect(detail.body.reactionCount).toBe(1);
    expect(detail.body.hasReacted).toBe(true);

    // Owner got exactly one like bell.
    const bells = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, coach.user.id));
    const likeBells = bells.filter(
      (b) => b.kind === "like" && b.link === `/posts/news-${news.id}`,
    );
    expect(likeBells).toHaveLength(1);

    // Unlike drops the count.
    const unlike = await liker.agent.delete(
      `/api/v1/posts/news-${news.id}/reactions`,
    );
    expect(unlike.status).toBe(204);
    const after = await liker.agent.get(`/api/v1/posts/news-${news.id}`);
    expect(after.body.reactionCount).toBe(0);
    expect(after.body.hasReacted).toBe(false);
  });

  it("rejects unauthenticated reactions on news posts", async () => {
    const { team } = await getOrgAndTeam();
    const coach = await loginAs("coach@kinectem.demo");
    const news = await seedNewsLink(team.id, coach.user.id);
    const res = await request(app).put(`/api/v1/posts/news-${news.id}/reactions`);
    expect(res.status).toBe(401);
  });

  it("comments on a news post and the count shows up on the detail read", async () => {
    const { team } = await getOrgAndTeam();
    const coach = await loginAs("coach@kinectem.demo");
    const news = await seedNewsLink(team.id, coach.user.id);
    const commenter = await loginAs(
      (u) => u.role === "athlete" && u.id !== coach.user.id,
    );

    const post = await commenter.agent
      .post(`/api/v1/posts/news-${news.id}/comments`)
      .send({ body: "Great story!" });
    expect(post.status).toBe(201);

    const list = await commenter.agent.get(
      `/api/v1/posts/news-${news.id}/comments`,
    );
    expect(list.status).toBe(200);
    const bodies = (list.body.data ?? list.body).map(
      (c: { body: string }) => c.body,
    );
    expect(bodies).toContain("Great story!");

    const detail = await commenter.agent.get(`/api/v1/posts/news-${news.id}`);
    expect(detail.body.commentCount).toBeGreaterThanOrEqual(1);
  });

  it("shares a news post, tracks shareCount/hasShared, and unshare reverts", async () => {
    const { team } = await getOrgAndTeam();
    const coach = await loginAs("coach@kinectem.demo");
    const news = await seedNewsLink(team.id, coach.user.id);
    const sharer = await loginAs(
      (u) => u.role === "athlete" && u.id !== coach.user.id,
    );

    const share = await sharer.agent.post(`/api/v1/posts/news-${news.id}/share`);
    expect(share.status).toBe(204);
    const detail = await sharer.agent.get(`/api/v1/posts/news-${news.id}`);
    expect(detail.body.shareCount).toBe(1);
    expect(detail.body.hasShared).toBe(true);

    const unshare = await sharer.agent.delete(
      `/api/v1/posts/news-${news.id}/share`,
    );
    expect(unshare.status).toBe(204);
    const after = await sharer.agent.get(`/api/v1/posts/news-${news.id}`);
    expect(after.body.shareCount).toBe(0);
    expect(after.body.hasShared).toBe(false);
  });

  it("sharing a missing news id 404s", async () => {
    const sharer = await loginAs((u) => u.role === "athlete");
    const res = await sharer.agent.post(
      "/api/v1/posts/news-00000000-0000-0000-0000-000000000000/share",
    );
    expect(res.status).toBe(404);
  });

  it("GET /posts/news-:id/tags returns an empty tag list", async () => {
    const { team } = await getOrgAndTeam();
    const coach = await loginAs("coach@kinectem.demo");
    const news = await seedNewsLink(team.id, coach.user.id);
    const res = await coach.agent.get(`/api/v1/posts/news-${news.id}/tags`);
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual([]);
  });

  it("team posts include stats on news cards", async () => {
    const { team } = await getOrgAndTeam();
    const coach = await loginAs("coach@kinectem.demo");
    const news = await seedNewsLink(team.id, coach.user.id);
    await coach.agent.put(`/api/v1/posts/news-${news.id}/reactions`);

    const res = await coach.agent.get(`/api/v1/teams/${team.id}/posts`);
    expect(res.status).toBe(200);
    const card = res.body.data.find(
      (p: { id: string }) => p.id === `news-${news.id}`,
    );
    expect(card).toBeTruthy();
    expect(card.reactionCount).toBe(1);
    expect(card.hasReacted).toBe(true);
    expect(card.shareCount).toBe(0);
  });
});
