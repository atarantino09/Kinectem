import { beforeEach, describe, expect, it } from "vitest";
import { articles, db, guardianLinks, teams } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { app, loginAs, request } from "./helpers";

async function footballTeam() {
  const orgs = await request(app).get("/api/v1/organizations");
  const org = orgs.body.data[0] as { id: string };
  const teams = await request(app).get(`/api/v1/organizations/${org.id}/teams`);
  const team = teams.body.data.find((row: { name: string }) => row.name === "Varsity Football") as {
    id: string;
  };
  return { org, team };
}

async function createPlan(status: "draft" | "published" = "published") {
  const { team } = await footballTeam();
  const { agent } = await loginAs("coach@kinectem.demo");
  const response = await agent.post(`/api/v1/teams/${team.id}/practice-plans`).send({
    title: `Practice plan ${Date.now()}`,
    body: "Warmup, drills, then film review.",
    practiceDates: ["2026-09-08", "2026-09-10"],
    status,
  });
  expect(response.status).toBe(201);
  return { team, postId: response.body.id as string };
}

describe("private practice plans", () => {
  beforeEach(async () => {
    // Lisa is the active guardian of Marcus, an accepted Varsity Football
    // player. Use an idempotent insert because some guardian tests may seed
    // the same relationship.
    const { user: lisa } = await loginAs("lisa@kinectem.demo");
    const { user: marcus } = await loginAs("marcus@kinectem.demo");
    const existing = await db.select({ id: guardianLinks.id }).from(guardianLinks)
      .where(and(eq(guardianLinks.guardianId, lisa.id), eq(guardianLinks.childId, marcus.id)))
      .limit(1);
    if (!existing.length) {
      await db.insert(guardianLinks).values({
        guardianId: lisa.id,
        childId: marcus.id,
        relationshipType: "parent",
        status: "active",
        consentGrantedAt: new Date(),
      });
    }
  });

  it("keeps list and detail private while allowing the internal audience", async () => {
    const { team, postId } = await createPlan();
    const anonymousList = await request(app).get(`/api/v1/teams/${team.id}/practice-plans`);
    const anonymousDetail = await request(app).get(`/api/v1/posts/${postId}`);
    expect(anonymousList.status).toBe(404);
    expect(anonymousDetail.status).toBe(404);

    // Daniela follows the team but is not rostered; followers never gain
    // access to internal team material.
    const { agent: follower } = await loginAs("daniela@kinectem.demo");
    expect((await follower.get(`/api/v1/teams/${team.id}/practice-plans`)).status).toBe(404);
    expect((await follower.get(`/api/v1/posts/${postId}`)).status).toBe(404);

    for (const email of [
      "marcus@kinectem.demo", // accepted player
      "lisa@kinectem.demo", // active guardian of that player
      "coach@kinectem.demo", // accepted coach / org admin
      "sam@kinectem.demo", // org owner / platform admin
    ]) {
      const { agent } = await loginAs(email);
      const list = await agent.get(`/api/v1/teams/${team.id}/practice-plans`);
      const detail = await agent.get(`/api/v1/posts/${postId}`);
      expect(list.status).toBe(200);
      expect(list.body.data.some((p: { id: string }) => p.id === postId)).toBe(true);
      expect(detail.status).toBe(200);
    }
  });

  it("never exposes plans through public feed archives or social endpoints", async () => {
    const { team, postId } = await createPlan();
    const { org } = await footballTeam();
    const { agent: coach } = await loginAs("coach@kinectem.demo");
    const { agent: player, user: marcus } = await loginAs("marcus@kinectem.demo");

    const surfaces = await Promise.all([
      coach.get("/api/v1/feed"),
      request(app).get(`/api/v1/teams/${team.id}/posts`),
      request(app).get(`/api/v1/organizations/${org.id}/posts`),
      request(app).get(`/api/v1/users/${marcus.id}/posts`),
    ]);
    for (const surface of surfaces) {
      expect(surface.body.data?.some((p: { id: string }) => p.id === postId)).toBe(false);
    }
    expect((await player.put(`/api/v1/posts/${postId}/reactions`)).status).toBe(404);
    expect((await player.post(`/api/v1/posts/${postId}/comments`).send({ body: "Nice" })).status).toBe(404);
  });

  it("makes drafts and all mutations manager-only, including generic article routes", async () => {
    const { team, postId } = await createPlan("draft");
    const { agent: player } = await loginAs("marcus@kinectem.demo");
    const { agent: coach } = await loginAs("coach@kinectem.demo");

    expect((await player.get(`/api/v1/posts/${postId}`)).status).toBe(404);
    const playerDrafts = await player.get("/api/v1/drafts");
    expect(playerDrafts.body.data.some((p: { id: string }) => p.id === postId)).toBe(false);
    expect((await player.patch(`/api/v1/posts/${postId}`).send({ title: "Nope" })).status).toBe(403);
    expect((await player.post(`/api/v1/posts/${postId}/publish`)).status).toBe(403);

    expect((await coach.get(`/api/v1/posts/${postId}`)).status).toBe(200);
    const staffDrafts = await coach.get("/api/v1/drafts");
    expect(staffDrafts.body.data.some((p: { id: string }) => p.id === postId)).toBe(true);
    expect((await coach.patch(`/api/v1/teams/${team.id}/practice-plans/${postId.replace("article-", "")}`)
      .send({ title: "Updated plan" })).status).toBe(200);
  });

  it("persists the explicit article kind used by the serializer and migration", async () => {
    const { postId } = await createPlan();
    const articleId = postId.replace("article-", "");
    const [stored] = await db.select({ articleKind: articles.articleKind }).from(articles)
      .where(eq(articles.id, articleId));
    expect(stored.articleKind).toBe("practice_plan");
    const { agent } = await loginAs("coach@kinectem.demo");
    const detail = await agent.get(`/api/v1/posts/${postId}`);
    expect(detail.body.articleKind).toBe("practice_plan");
  });

  it("requires and persists one or more valid practice dates", async () => {
    const { team } = await footballTeam();
    const { agent } = await loginAs("coach@kinectem.demo");
    const missing = await agent.post(`/api/v1/teams/${team.id}/practice-plans`).send({
      title: "No date",
      body: "Details",
    });
    expect(missing.status).toBe(400);

    const created = await agent.post(`/api/v1/teams/${team.id}/practice-plans`).send({
      title: "Two sessions",
      body: "Details",
      practiceDates: ["2026-09-10", "2026-09-08"],
    });
    expect(created.status).toBe(201);
    expect(created.body.practiceDates).toEqual(["2026-09-08", "2026-09-10"]);

    const list = await agent.get(`/api/v1/teams/${team.id}/practice-plans`);
    const row = list.body.data.find((plan: { id: string }) => plan.id === created.body.id);
    expect(row.practiceDates).toEqual(["2026-09-08", "2026-09-10"]);
  });

  it("accepts private photos and YouTube links but rejects other video links", async () => {
    const { team } = await footballTeam();
    const { agent } = await loginAs("coach@kinectem.demo");
    const photo = "data:image/png;base64,iVBORw0KGgo=";
    const created = await agent.post(`/api/v1/teams/${team.id}/practice-plans`).send({
      title: "Practice media",
      body: "Watch before practice.",
      practiceDates: ["2026-09-08"],
      photoUrls: [photo],
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(created.status).toBe(201);
    expect(created.body.photoUrls).toEqual([photo]);
    expect(created.body.videoUrl).toContain("youtube.com/watch");

    const rejected = await agent.post(`/api/v1/teams/${team.id}/practice-plans`).send({
      title: "Bad link",
      body: "Details",
      practiceDates: ["2026-09-08"],
      videoUrl: "https://example.com/video",
    });
    expect(rejected.status).toBe(400);
  });

  it("requires management of the exact team for AI practice-plan assistance", async () => {
    const { user: marcus } = await loginAs("marcus@kinectem.demo");
    const [unmanagedTeam] = await db.insert(teams).values({
      name: `Private AI target ${Date.now()}`,
      sport: "Football",
      season: "Test",
      createdById: marcus.id,
    }).returning();
    const { agent: coach } = await loginAs("coach@kinectem.demo");
    const denied = await coach.post("/api/v1/ai/assist").send({
      mode: "draft",
      postType: "long",
      notes: "Practice emphasis",
      practicePlan: true,
      teamId: unmanagedTeam.id,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("AI_FORBIDDEN");

    // A selected team is mandatory; an otherwise eligible coach cannot use
    // the ordinary recap path to generate a practice plan without one.
    const missingTeam = await coach.post("/api/v1/ai/assist").send({
      mode: "draft",
      postType: "long",
      notes: "Practice emphasis",
      practicePlan: true,
    });
    expect(missingTeam.status).toBe(403);
    expect(missingTeam.body.code).toBe("AI_FORBIDDEN");
  });
});