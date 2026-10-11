import { describe, expect, it } from "vitest";
import { db, articles, highlights, orgPosts, organizations, teams, teamNewsLinks } from "@workspace/db";
import { sql } from "drizzle-orm";
import { app, findUser, loginAs, request } from "./helpers";

async function inventoryFixture() {
  const author = await findUser((user) => user.email === "coach@kinectem.demo");
  const [org] = await db.insert(organizations).values({
    name: "Inventory fixture club", type: "club", sport: "Soccer", city: "Brooklyn", state: "NY",
  }).returning();
  const [team] = await db.insert(teams).values({
    name: "Inventory fixture team", organizationId: org.id, sport: "Basketball",
  }).returning();
  const createdAt = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T12:00:00Z`);
  const [game] = await db.insert(articles).values({
    teamId: team.id, authorId: author.id, title: "Inventory game recap",
    body: "Goal by @[Fixture Player](user:00000000-0000-0000-0000-000000000001).",
    createdAt: createdAt(1),
  }).returning();
  await db.insert(articles).values([
    { teamId: team.id, authorId: author.id, title: "Inventory combined recap", recapKind: "combined", createdAt: createdAt(2) },
    // Minimal historical metadata also occurs on legacy records.
    { teamId: team.id, authorId: author.id, title: "Inventory historical recap", historical: sql`'{}'::jsonb`, createdAt: createdAt(3) },
    { teamId: team.id, authorId: author.id, title: "Inventory private plan", articleKind: "practice_plan", status: "draft", createdAt: createdAt(4) },
  ]);
  await db.insert(highlights).values({
    teamId: team.id, uploaderId: author.id, title: "Inventory pending highlight",
    approvalStatus: "pending", createdAt: createdAt(5),
  });
  await db.insert(orgPosts).values({
    organizationId: org.id, authorId: author.id, title: "Inventory hidden org post",
    hiddenAt: createdAt(6), createdAt: createdAt(6),
  });
  await db.insert(teamNewsLinks).values({
    teamId: team.id, addedByUserId: author.id, title: "Inventory news",
    url: "https://example.com/inventory", createdAt: createdAt(7),
  });
  return { org, team, author, game };
}

describe("platform post inventory", () => {
  it("rejects anonymous visitors, ordinary users, and masquerading admins", async () => {
    expect((await request(app).get("/api/v1/admin/posts")).status).toBe(401);
    const { agent: ordinary, user } = await loginAs("coach@kinectem.demo");
    expect((await ordinary.get("/api/v1/admin/posts")).status).toBe(403);
    const { agent } = await loginAs((user) => user.role === "admin");
    const start = await agent.post(`/api/v1/admin/masquerade/${user.id}/start`);
    expect(start.status).toBe(200);
    expect((await agent.get("/api/v1/admin/posts")).status).toBe(403);
  });

  it("includes every source and labels drafts, private plans, pending and hidden posts", async () => {
    const { org, game, author } = await inventoryFixture();
    const { agent } = await loginAs((user) => user.role === "admin");
    const response = await agent.get("/api/v1/admin/posts").query({ organizationId: org.id });
    expect(response.status).toBe(200);
    expect(response.body.pagination).toMatchObject({ totalCount: 7, limit: 25, offset: 0, hasMore: false });
    expect(response.body.data.map((post: { type: string }) => post.type).sort()).toEqual([
      "combined_recap", "game_recap", "highlight", "historical_recap", "news", "org_post", "practice_plan",
    ]);
    expect(response.body.data).toContainEqual(expect.objectContaining({
      id: `article-${game.id}`, excerpt: "Goal by Fixture Player.",
      sport: "soccer", location: "Brooklyn, NY", author: expect.objectContaining({ id: author.id }),
    }));
    expect(response.body.data).toContainEqual(expect.objectContaining({ type: "practice_plan", status: "draft" }));
    expect(response.body.data).toContainEqual(expect.objectContaining({ type: "highlight", status: "pending" }));
    expect(response.body.data).toContainEqual(expect.objectContaining({ type: "org_post", hidden: true }));
    expect(response.body.facets.organizations).toContainEqual({ id: org.id, name: org.name });
    expect(response.body.facets.sports).toContain("soccer");
    expect(response.body.facets.locations).toContain("Brooklyn, NY");
    expect(response.body.facets.postTypes).toHaveLength(7);
  });

  it("combines filters, searches authors/titles, and retains facets for empty results", async () => {
    const { org } = await inventoryFixture();
    const { agent } = await loginAs((user) => user.role === "admin");
    const filtered = await agent.get("/api/v1/admin/posts").query({
      organizationId: org.id, sport: "Soccer", location: "brooklyn", postType: "combined_recap", q: "Inventory",
    });
    expect(filtered.status).toBe(200);
    expect(filtered.body.pagination.totalCount).toBe(1);
    expect(filtered.body.data[0].type).toBe("combined_recap");
    const empty = await agent.get("/api/v1/admin/posts").query({ organizationId: org.id, location: "%" });
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);
    expect(empty.body.pagination).toMatchObject({ totalCount: 0, hasMore: false });
    expect(empty.body.facets.organizations).toContainEqual({ id: org.id, name: org.name });
  });

  it("paginates the merged sources and supports every requested sorting dimension", async () => {
    const { org } = await inventoryFixture();
    const { agent } = await loginAs((user) => user.role === "admin");
    const first = await agent.get("/api/v1/admin/posts").query({ organizationId: org.id, limit: 2 });
    const second = await agent.get("/api/v1/admin/posts").query({ organizationId: org.id, limit: 2, offset: 2 });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.pagination).toMatchObject({ totalCount: 7, hasMore: true, offset: 0 });
    expect(second.body.pagination).toMatchObject({ totalCount: 7, hasMore: true, offset: 2 });
    expect(new Set([...first.body.data, ...second.body.data].map((post: { id: string }) => post.id)).size).toBe(4);
    expect(first.body.data[0].type).toBe("news");
    const oldest = await agent.get("/api/v1/admin/posts").query({ organizationId: org.id, sort: "oldest" });
    expect(oldest.body.data[0].type).toBe("game_recap");
    for (const sort of ["sport", "location", "organization", "post_type"]) {
      const response = await agent.get("/api/v1/admin/posts").query({ organizationId: org.id, sort });
      expect(response.status).toBe(200);
      expect(response.body.pagination.totalCount).toBe(7);
      if (sort === "post_type") expect(response.body.data[0].type).toBe("combined_recap");
    }
  });

  it("keeps independent/profile-only highlights with no team or organization", async () => {
    const author = await findUser((user) => user.email === "coach@kinectem.demo");
    const [post] = await db.insert(highlights).values({
      uploaderId: author.id, title: "Inventory independent clip",
    }).returning();
    const { agent } = await loginAs((user) => user.role === "admin");
    const response = await agent.get("/api/v1/admin/posts").query({ organizationId: "none", q: post.title });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([expect.objectContaining({
      id: `highlight-${post.id}`, team: null, organization: null,
    })]);
    expect(response.body.facets.organizations).toContainEqual(expect.objectContaining({ id: "none" }));
  });

  it("validates pagination, types, sorting and organization IDs", async () => {
    const { agent } = await loginAs((user) => user.role === "admin");
    for (const query of [{ limit: 500 }, { offset: -1 }, { postType: "unknown" }, { sort: "DROP TABLE users" }, { organizationId: "not-a-uuid" }]) {
      expect((await agent.get("/api/v1/admin/posts").query(query)).status).toBe(400);
    }
  });
});
