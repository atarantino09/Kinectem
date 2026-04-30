// Task #322 — DELETE /article-tags/:tagId and DELETE /highlight-tags/:tagId
// permission expansion. Originally only the tagged user themselves could
// remove their tag (the My Tags page). The edit-post composer now lets
// post authors and org admins/owners untag players too, so the same
// roles that can ADD a tag via POST /posts/:postId/tags must also be
// able to REMOVE one. These tests cover the new permitted roles, the
// continued rejection of unrelated viewers, and the idempotent 204
// behavior on a stale tag id.

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

// Pick *any* article tag belonging to the given user on the recap
// produced by `articleId`. The auto-tag fan-out creates one row per
// rostered player, so picking by (articleId, userId) is unambiguous.
async function findArticleTag(articleId: string, userId: string) {
  const [row] = await db
    .select()
    .from(articleTags)
    .where(
      and(eq(articleTags.articleId, articleId), eq(articleTags.userId, userId)),
    )
    .limit(1);
  return row;
}

// Spin up a published recap on Varsity Football posted by the head
// coach. Returns the bare articleId (without the `article-` prefix
// used in the post-shape envelope) so tests can look up tag rows.
async function createCoachRecap(opponent: string): Promise<string> {
  const { orgId } = await getFootballTeam();
  const { agent: coach } = await loginAs(
    (u) => u.email === "coach@kinectem.demo",
  );
  const res = await coach.post("/api/v1/posts").send({
    postType: "long",
    organizationId: orgId,
    title: `Westfield vs ${opponent}`,
    body: "Test recap for tag-delete permissions.",
    gameDate: new Date("2025-10-03T19:00:00Z").toISOString(),
    opponentName: opponent,
    gameScore: "10-0",
  });
  if (res.status !== 201) {
    throw new Error(`recap create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.id.replace(/^article-/, "");
}

// Spin up a team-scoped highlight uploaded by the given seed user
// (who must already be on the Varsity Football roster or an org
// admin). Returns the bare highlightId. We then POST a tag for the
// target player so we have a concrete tag row to delete.
async function createHighlightWithTag(
  uploaderEmail: string,
  taggedEmail: string,
): Promise<{ highlightId: string; tagId: string; postId: string }> {
  const { teamId } = await getFootballTeam();
  // POST /posts/:postId/tags drops anyone whose roster row isn't
  // `position="player"` (literal). The seed sets real football
  // positions like "QB" / "WR", so coerce the target's row to the
  // literal value the eligibility gate looks for. Scoped to (team,
  // user) so other tests' fixtures aren't disturbed.
  const taggedUserId = await findUserId(taggedEmail);
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
    title: "Tag-delete fixture clip",
    description: "Highlight used by tag-delete permission tests.",
    videoUrl: "https://example.com/tag-delete-fixture.mp4",
  });
  if (res.status !== 201) {
    throw new Error(`highlight create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const postId = res.body.id as string;
  const highlightId = postId.replace(/^highlight-/, "");
  const tagRes = await uploader.post(`/api/v1/posts/${postId}/tags`).send({
    tags: [
      { taggedEntityType: "user", taggedEntityId: taggedUserId, direction: "lateral" },
    ],
  });
  if (tagRes.status !== 201) {
    throw new Error(`tag create failed: ${tagRes.status} ${JSON.stringify(tagRes.body)}`);
  }
  // The endpoint returns the persisted rows; the underlying highlight_tags
  // row id is what DELETE /highlight-tags/:id expects.
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
  return { highlightId, tagId: t.id, postId };
}

describe("DELETE /article-tags/:tagId — task #322 permission expansion", () => {
  it("the tagged user can still untag themselves (legacy My Tags path)", async () => {
    const articleId = await createCoachRecap("Selfun-A");
    const jordanId = await findUserId("jordan@kinectem.demo");
    const tag = await findArticleTag(articleId, jordanId);
    expect(tag).toBeTruthy();

    const { agent: jordan } = await loginAs(
      (u) => u.email === "jordan@kinectem.demo",
    );
    const del = await jordan.delete(`/api/v1/article-tags/${tag.id}`);
    expect(del.status).toBe(204);

    const after = await findArticleTag(articleId, jordanId);
    expect(after).toBeUndefined();
  });

  it("the post author (head coach) can untag a rostered player", async () => {
    const articleId = await createCoachRecap("Author-A");
    const jordanId = await findUserId("jordan@kinectem.demo");
    const tag = await findArticleTag(articleId, jordanId);
    expect(tag).toBeTruthy();

    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const del = await coach.delete(`/api/v1/article-tags/${tag.id}`);
    expect(del.status).toBe(204);

    const after = await findArticleTag(articleId, jordanId);
    expect(after).toBeUndefined();
  });

  it("an org owner can untag a rostered player on a recap they did not author", async () => {
    const articleId = await createCoachRecap("Owner-A");
    const jordanId = await findUserId("jordan@kinectem.demo");
    const tag = await findArticleTag(articleId, jordanId);
    expect(tag).toBeTruthy();

    // sam@kinectem.demo is the Westfield org owner in the seed but
    // is NOT the article author (the coach is) and is NOT the tagged
    // user (Jordan is). With the task #322 expansion they can still
    // delete the tag because they manage the team's owning org.
    const { agent: owner } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const del = await owner.delete(`/api/v1/article-tags/${tag.id}`);
    expect(del.status).toBe(204);

    const after = await findArticleTag(articleId, jordanId);
    expect(after).toBeUndefined();
  });

  it("an unrelated viewer (different org, not tagged) gets 403", async () => {
    const articleId = await createCoachRecap("Outsider-A");
    const jordanId = await findUserId("jordan@kinectem.demo");
    const tag = await findArticleTag(articleId, jordanId);
    expect(tag).toBeTruthy();

    // Brand-new account that never joins the org and never appears
    // on the roster — exactly the "random logged-in user" case the
    // permission check has to keep rejecting.
    const outsiderEmail = `outsider+article-${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: outsiderEmail,
      password: "test-password-123",
      firstName: "Out",
      lastName: "SiderA",
      role: "athlete",
    });
    const outsider = request.agent(app);
    await outsider
      .post("/api/v1/auth/login")
      .send({ email: outsiderEmail, password: "test-password-123" });

    const del = await outsider.delete(`/api/v1/article-tags/${tag.id}`);
    expect(del.status).toBe(403);

    // Tag is still there — rejection didn't accidentally also delete.
    const after = await findArticleTag(articleId, jordanId);
    expect(after).toBeTruthy();
  });

  it("returns 204 idempotently for a non-existent tagId (stale UI safety)", async () => {
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const del = await coach.delete(
      "/api/v1/article-tags/00000000-0000-0000-0000-000000000000",
    );
    expect(del.status).toBe(204);
  });
});

describe("DELETE /highlight-tags/:tagId — task #322 permission expansion", () => {
  it("the tagged user can still untag themselves (legacy My Tags path)", async () => {
    // marcus uploads, jordan is tagged. jordan removes their own tag.
    const { tagId, highlightId } = await createHighlightWithTag(
      "marcus@kinectem.demo",
      "jordan@kinectem.demo",
    );
    const jordanId = await findUserId("jordan@kinectem.demo");

    const { agent: jordan } = await loginAs(
      (u) => u.email === "jordan@kinectem.demo",
    );
    const del = await jordan.delete(`/api/v1/highlight-tags/${tagId}`);
    expect(del.status).toBe(204);

    const [after] = await db
      .select()
      .from(highlightTags)
      .where(
        and(
          eq(highlightTags.highlightId, highlightId),
          eq(highlightTags.userId, jordanId),
        ),
      )
      .limit(1);
    expect(after).toBeUndefined();
  });

  it("the highlight uploader can untag a rostered player", async () => {
    // marcus uploads AND removes — uploader path on the new permission
    // check (matches `h.uploaderId === me.id`).
    const { tagId, highlightId } = await createHighlightWithTag(
      "marcus@kinectem.demo",
      "jordan@kinectem.demo",
    );
    const jordanId = await findUserId("jordan@kinectem.demo");

    const { agent: marcus } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const del = await marcus.delete(`/api/v1/highlight-tags/${tagId}`);
    expect(del.status).toBe(204);

    const [after] = await db
      .select()
      .from(highlightTags)
      .where(
        and(
          eq(highlightTags.highlightId, highlightId),
          eq(highlightTags.userId, jordanId),
        ),
      )
      .limit(1);
    expect(after).toBeUndefined();
  });

  it("an org owner can untag a player on a highlight they did not upload", async () => {
    // marcus uploads, jordan is tagged, sam (org owner) removes —
    // exercises the canManageOrganization branch.
    const { tagId, highlightId } = await createHighlightWithTag(
      "marcus@kinectem.demo",
      "jordan@kinectem.demo",
    );
    const jordanId = await findUserId("jordan@kinectem.demo");

    const { agent: owner } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const del = await owner.delete(`/api/v1/highlight-tags/${tagId}`);
    expect(del.status).toBe(204);

    const [after] = await db
      .select()
      .from(highlightTags)
      .where(
        and(
          eq(highlightTags.highlightId, highlightId),
          eq(highlightTags.userId, jordanId),
        ),
      )
      .limit(1);
    expect(after).toBeUndefined();
  });

  it("an unrelated viewer (different org, not the tagged user) gets 403", async () => {
    const { tagId, highlightId } = await createHighlightWithTag(
      "marcus@kinectem.demo",
      "jordan@kinectem.demo",
    );
    const jordanId = await findUserId("jordan@kinectem.demo");

    const outsiderEmail = `outsider+highlight-${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: outsiderEmail,
      password: "test-password-123",
      firstName: "Out",
      lastName: "SiderH",
      role: "athlete",
    });
    const outsider = request.agent(app);
    await outsider
      .post("/api/v1/auth/login")
      .send({ email: outsiderEmail, password: "test-password-123" });

    const del = await outsider.delete(`/api/v1/highlight-tags/${tagId}`);
    expect(del.status).toBe(403);

    // Tag is still there.
    const [after] = await db
      .select()
      .from(highlightTags)
      .where(
        and(
          eq(highlightTags.highlightId, highlightId),
          eq(highlightTags.userId, jordanId),
        ),
      )
      .limit(1);
    expect(after).toBeTruthy();
  });

  it("returns 204 idempotently for a non-existent tagId", async () => {
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const del = await coach.delete(
      "/api/v1/highlight-tags/00000000-0000-0000-0000-000000000000",
    );
    expect(del.status).toBe(204);
  });
});
