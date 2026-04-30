// Task #344 — Posts surface a per-viewer `currentUserTag` so a tagged
// player can untag themselves directly from a post's three-dot menu.
// These tests cover the server side of that affordance:
//   * The field shows up on GET /posts/:id, /feed, and /users/:id/posts
//     for the tagged player, with the right kind+id+status.
//   * It stays null for the post author, an unrelated viewer, and an
//     anonymous request.
//   * "approved" and "pending" tags both surface; "removed" does not.
//   * Deleting the surfaced tag id via DELETE /article-tags/:id or
//     /highlight-tags/:id (the existing untag endpoint the new menu
//     item calls) clears the field on the next read.

import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  articleTags,
  highlightTags,
  organizations,
  rosterEntries,
  teams,
  users,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";

async function getFootballTeam(): Promise<{ teamId: string; orgId: string }> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, "Westfield Athletic Club"))
    .limit(1);
  if (!org) throw new Error("Westfield org missing from seed");
  const [t] = await db
    .select()
    .from(teams)
    .where(
      and(eq(teams.organizationId, org.id), eq(teams.name, "Varsity Football")),
    )
    .limit(1);
  if (!t) throw new Error("Varsity Football missing from seed");
  return { teamId: t.id, orgId: org.id };
}

async function findUserId(email: string): Promise<string> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) throw new Error(`User ${email} missing from seed`);
  return u.id;
}

// Spin up a published recap on Varsity Football posted by the head
// coach. The auto-tag fan-out tags every roster player on the team,
// so any rostered player has an `articleTags` row we can read back
// via the post payload's currentUserTag.
async function createCoachRecap(opponent: string): Promise<{
  postId: string;
  articleId: string;
}> {
  const { orgId } = await getFootballTeam();
  const { agent: coach } = await loginAs(
    (u) => u.email === "coach@kinectem.demo",
  );
  const res = await coach.post("/api/v1/posts").send({
    postType: "long",
    organizationId: orgId,
    title: `Westfield vs ${opponent}`,
    body: "Test recap for currentUserTag.",
    gameDate: new Date("2025-10-03T19:00:00Z").toISOString(),
    opponentName: opponent,
    gameScore: "10-0",
  });
  if (res.status !== 201) {
    throw new Error(`recap create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const postId = res.body.id as string;
  return { postId, articleId: postId.replace(/^article-/, "") };
}

// Create a highlight uploaded by uploaderEmail and tag taggedEmail.
// Mirrors the helper in tag-delete-permissions.test.ts so the highlight
// path has a fresh (highlightId, tagId) pair to read back.
async function createHighlightWithTag(
  uploaderEmail: string,
  taggedEmail: string,
): Promise<{ postId: string; highlightId: string; tagId: string }> {
  const { teamId } = await getFootballTeam();
  const taggedUserId = await findUserId(taggedEmail);
  // POST /posts/:postId/tags only accepts a literal "player" position.
  await db
    .update(rosterEntries)
    .set({ position: "player", role: "player", status: "accepted" })
    .where(
      and(
        eq(rosterEntries.teamId, teamId),
        eq(rosterEntries.userId, taggedUserId),
      ),
    );
  const { agent: uploader } = await loginAs((u) => u.email === uploaderEmail);
  const res = await uploader.post("/api/v1/posts").send({
    postType: "short",
    teamId,
    title: "currentUserTag fixture clip",
    description: "Highlight used by currentUserTag tests.",
    videoUrl: "https://example.com/current-user-tag-fixture.mp4",
  });
  if (res.status !== 201) {
    throw new Error(
      `highlight create failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  const postId = res.body.id as string;
  const highlightId = postId.replace(/^highlight-/, "");
  const tagRes = await uploader.post(`/api/v1/posts/${postId}/tags`).send({
    tags: [
      {
        taggedEntityType: "user",
        taggedEntityId: taggedUserId,
        direction: "lateral",
      },
    ],
  });
  if (tagRes.status !== 201) {
    throw new Error(
      `tag create failed: ${tagRes.status} ${JSON.stringify(tagRes.body)}`,
    );
  }
  const [t] = await db
    .select()
    .from(highlightTags)
    .where(
      and(
        eq(highlightTags.highlightId, highlightId),
        eq(highlightTags.userId, taggedUserId),
      ),
    )
    .limit(1);
  if (!t) throw new Error("highlight tag did not persist");
  return { postId, highlightId, tagId: t.id };
}

describe("currentUserTag on article post payloads — task #344", () => {
  it("surfaces the tagged viewer's article tag id, kind, and status", async () => {
    const { postId, articleId } = await createCoachRecap("CUT-Article-View");
    const jordanId = await findUserId("jordan@kinectem.demo");
    const [tagRow] = await db
      .select()
      .from(articleTags)
      .where(
        and(
          eq(articleTags.articleId, articleId),
          eq(articleTags.userId, jordanId),
        ),
      )
      .limit(1);
    expect(tagRow).toBeTruthy();

    const { agent: jordan } = await loginAs(
      (u) => u.email === "jordan@kinectem.demo",
    );
    const detail = await jordan.get(`/api/v1/posts/${postId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.currentUserTag).toMatchObject({
      id: tagRow.id,
      kind: "article",
      status: tagRow.status,
    });
  });

  it("returns null for the post author (the coach who wrote the recap)", async () => {
    const { postId } = await createCoachRecap("CUT-Article-Author");
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const detail = await coach.get(`/api/v1/posts/${postId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.currentUserTag).toBeNull();
  });

  it("returns null for an unrelated viewer who is not on the roster", async () => {
    const { postId } = await createCoachRecap("CUT-Article-Outsider");
    const outsiderEmail = `outsider+cut-${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: outsiderEmail,
      password: "test-password-123",
      firstName: "Out",
      lastName: "SiderC",
      role: "athlete",
    });
    const outsider = request.agent(app);
    await outsider
      .post("/api/v1/auth/login")
      .send({ email: outsiderEmail, password: "test-password-123" });
    const detail = await outsider.get(`/api/v1/posts/${postId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.currentUserTag).toBeNull();
  });

  it("returns null for an anonymous (unauthenticated) viewer", async () => {
    const { postId } = await createCoachRecap("CUT-Article-Anon");
    const detail = await request(app).get(`/api/v1/posts/${postId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.currentUserTag).toBeNull();
  });

  it("does not surface a 'removed' tag (only approved/pending)", async () => {
    const { postId, articleId } = await createCoachRecap(
      "CUT-Article-Removed",
    );
    const jordanId = await findUserId("jordan@kinectem.demo");
    // Soft-delete style: flip the auto-tag row to status='removed'.
    // The loader filters to status IN ('approved','pending'), so the
    // viewer should now see no currentUserTag even though a row exists.
    await db
      .update(articleTags)
      .set({ status: "removed" })
      .where(
        and(
          eq(articleTags.articleId, articleId),
          eq(articleTags.userId, jordanId),
        ),
      );
    const { agent: jordan } = await loginAs(
      (u) => u.email === "jordan@kinectem.demo",
    );
    const detail = await jordan.get(`/api/v1/posts/${postId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.currentUserTag).toBeNull();
  });

  it("clears currentUserTag after the viewer self-untags via DELETE /article-tags/:id", async () => {
    const { postId, articleId } = await createCoachRecap("CUT-Article-Untag");
    const jordanId = await findUserId("jordan@kinectem.demo");
    const [tagRow] = await db
      .select()
      .from(articleTags)
      .where(
        and(
          eq(articleTags.articleId, articleId),
          eq(articleTags.userId, jordanId),
        ),
      )
      .limit(1);
    expect(tagRow).toBeTruthy();

    const { agent: jordan } = await loginAs(
      (u) => u.email === "jordan@kinectem.demo",
    );
    // Round-trip: read shows the tag, DELETE returns 204, read again
    // shows null. This is the exact flow the new three-dot menu runs.
    const before = await jordan.get(`/api/v1/posts/${postId}`);
    expect(before.body.currentUserTag?.id).toBe(tagRow.id);

    const del = await jordan.delete(`/api/v1/article-tags/${tagRow.id}`);
    expect(del.status).toBe(204);

    const after = await jordan.get(`/api/v1/posts/${postId}`);
    expect(after.body.currentUserTag).toBeNull();
  });
});

describe("currentUserTag on highlight post payloads — task #344", () => {
  it("surfaces the tagged viewer's highlight tag id, kind, and status", async () => {
    const { postId, tagId } = await createHighlightWithTag(
      "marcus@kinectem.demo",
      "jordan@kinectem.demo",
    );
    const { agent: jordan } = await loginAs(
      (u) => u.email === "jordan@kinectem.demo",
    );
    const detail = await jordan.get(`/api/v1/posts/${postId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.currentUserTag).toMatchObject({
      id: tagId,
      kind: "highlight",
    });
    // Status should be 'approved' or 'pending'; never 'removed'.
    expect(["approved", "pending"]).toContain(
      detail.body.currentUserTag.status,
    );
  });

  it("returns null for the highlight uploader who tagged someone else", async () => {
    const { postId } = await createHighlightWithTag(
      "marcus@kinectem.demo",
      "jordan@kinectem.demo",
    );
    const { agent: marcus } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const detail = await marcus.get(`/api/v1/posts/${postId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.currentUserTag).toBeNull();
  });

  it("clears currentUserTag after the viewer self-untags via DELETE /highlight-tags/:id", async () => {
    const { postId, tagId } = await createHighlightWithTag(
      "marcus@kinectem.demo",
      "jordan@kinectem.demo",
    );
    const { agent: jordan } = await loginAs(
      (u) => u.email === "jordan@kinectem.demo",
    );
    const before = await jordan.get(`/api/v1/posts/${postId}`);
    expect(before.body.currentUserTag?.id).toBe(tagId);

    const del = await jordan.delete(`/api/v1/highlight-tags/${tagId}`);
    expect(del.status).toBe(204);

    const after = await jordan.get(`/api/v1/posts/${postId}`);
    expect(after.body.currentUserTag).toBeNull();
  });
});

describe("currentUserTag on org update posts — task #344", () => {
  // Org Updates have no tag concept (the untag affordance is only for
  // article + highlight tag rows). Even when a coach who is also a
  // tagged player on other articles posts an Update, the org_post
  // payload must carry currentUserTag === null on every surface.
  it("returns null on org update payloads (no tag concept exists)", async () => {
    const coachLogin = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const { orgId } = await getFootballTeam();

    const create = await coachLogin.agent
      .post(`/api/v1/organizations/${orgId}/posts`)
      .send({ title: "Schedule update", body: "Practice moved to 5pm." });
    expect(create.status).toBe(201);
    const orgPostId: string = create.body.id;
    expect(orgPostId.startsWith("orgpost-")).toBe(true);
    expect(create.body.currentUserTag).toBeNull();

    // Detail
    const detail = await coachLogin.agent.get(`/api/v1/posts/${orgPostId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.currentUserTag).toBeNull();

    // Org-page list
    const orgList = await coachLogin.agent.get(
      `/api/v1/organizations/${orgId}/posts?limit=50`,
    );
    expect(orgList.status).toBe(200);
    const item = (
      orgList.body.data as Array<{
        id: string;
        currentUserTag: unknown;
      }>
    ).find((p) => p.id === orgPostId);
    expect(item).toBeTruthy();
    expect(item?.currentUserTag).toBeNull();

    // Even a viewer who DOES have article tags elsewhere (Jordan) sees
    // null on this org_post, proving the loader doesn't bleed across
    // post kinds.
    const { agent: jordan } = await loginAs(
      (u) => u.email === "jordan@kinectem.demo",
    );
    const jordanDetail = await jordan.get(`/api/v1/posts/${orgPostId}`);
    expect(jordanDetail.status).toBe(200);
    expect(jordanDetail.body.currentUserTag).toBeNull();
  });
});

describe("currentUserTag on feed and profile lists — task #344", () => {
  it("populates currentUserTag on /users/:id/posts when viewer is tagged on a recap", async () => {
    const { articleId } = await createCoachRecap("CUT-List-Profile");
    const coachId = await findUserId("coach@kinectem.demo");
    const jordanId = await findUserId("jordan@kinectem.demo");
    const [tagRow] = await db
      .select()
      .from(articleTags)
      .where(
        and(
          eq(articleTags.articleId, articleId),
          eq(articleTags.userId, jordanId),
        ),
      )
      .limit(1);
    expect(tagRow).toBeTruthy();

    const { agent: jordan } = await loginAs(
      (u) => u.email === "jordan@kinectem.demo",
    );
    const list = await jordan.get(`/api/v1/users/${coachId}/posts?limit=50`);
    expect(list.status).toBe(200);
    const item = (list.body.data as Array<{
      id: string;
      currentUserTag: { id: string; kind: string } | null;
    }>).find((p) => p.id === `article-${articleId}`);
    expect(item).toBeTruthy();
    expect(item?.currentUserTag).toMatchObject({
      id: tagRow.id,
      kind: "article",
    });
  });
});
