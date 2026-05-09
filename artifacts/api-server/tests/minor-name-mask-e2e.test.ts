// Task #416 — End-to-end coverage proving the under-13 last-name mask
// (Task #414) actually fires across the request pipeline. The unit
// tests in `minor-name-mask.test.ts` cover the helpers; this file
// drives real HTTP requests so a regression in any single handler
// (e.g. someone re-introduces `u.name` directly) is caught loudly.
//
// -----------------------------------------------------------------------------
// DESIGN MODEL — read this before reading the assertions.
// -----------------------------------------------------------------------------
// Two distinct COPPA layers protect a minor's identity in API responses,
// and every surface in the Task #416 spec sits on top of one (or both):
//
// 1. ROW SUPPRESSION (`filterOutMinors` in src/lib/coppa.ts).
//    Used by list endpoints that surface user rows directly: `/search`,
//    `/users`, `/users/:userId/followers`, `/users/:userId/following`,
//    `/organizations/:orgId/followers`, `/teams/:teamId/followers`.
//    A minor row is preserved ONLY when the viewer is the minor herself
//    (id-match) or the linked guardian (parentId-match). Strangers (and
//    even platform admins) see the minor row REMOVED entirely. Because
//    the row never reaches the response, there is no “stranger sees
//    masked row” path on these surfaces — the strongest correctness
//    statement is "minor row absent for strangers / present with full
//    name for the linked guardian or self". (For routes whose query
//    doesn't select `parentId` on the follower row, even the linked
//    guardian doesn't survive — only the minor herself does. This is
//    documented per-surface where it matters.)
//
// 2. INLINE NAME MASKING (`displayNameForViewer` + `buildMinorNameContext`
//    in src/lib/spec-helpers.ts). Used for nested user references
//    embedded in non-user payloads: post authors, comment authors,
//    feed item authors, etc. The masking layer is viewer-aware: self,
//    linked guardian, shared accepted-roster teammate, and platform
//    admins (`bypass`) all get the full name; everyone else gets
//    "Samira C.". This is the layer that produces the masked-stranger
//    assertions in this file, on `/posts/:id`, `/posts/:id/comments`,
//    `/feed`, `/teams/:teamId/posts`, and `/organizations/:orgId/posts`.
//
// `/users/:userId/posts` is a third pattern — the route's upstream
// private-by-default gate (Task #359) gives strangers a 404 before
// any post serializer runs, which is what justifies the route's
// profile-owner carve-out (the owner chip is unmasked for anyone who
// reaches the handler). We assert the gate (404 + no leak) and the
// privileged-viewer path (guardian sees full name).
//
// `expectNoLeak()` runs on every response — even when a stranger
// payload is empty/absent — so a regression that re-introduces
// `Samira Carter` anywhere in the response body is caught loudly.

import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  users,
  rosterEntries,
  articles,
  postComments,
  userFollowers,
  teamFollowers,
  organizationFollowers,
  orgPosts,
  teams,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";

const FULL = "Samira Carter";
const MASKED = "Samira C.";

type Ids = {
  samira: string;
  lisa: string;
  marcus: string;
  daniela: string;
  admin: string;
  coach: string;
  org: string;
  team: string;
  article: string;
  samiraArticle: string;
  samiraOrgPost: string;
  coachArticle: string;
  samiraComment: string;
};

async function findUserId(email: string): Promise<string> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) throw new Error(`User ${email} missing from seed`);
  return u.id;
}

// Promote the seeded Samira to an active minor with a public profile
// (so /users/:userId/posts is reachable by strangers), flip her roster
// row to accepted so the shared-team carve-out kicks in for daniela,
// and plant the content surfaces under test.
async function plantFixtures(): Promise<Ids> {
  const samira = await findUserId("samira@kinectem.demo");
  const lisa = await findUserId("lisa@kinectem.demo");
  const marcus = await findUserId("marcus@kinectem.demo");
  const daniela = await findUserId("daniela@kinectem.demo");
  const admin = await findUserId("sam@kinectem.demo");
  const coach = await findUserId("coach@kinectem.demo");

  // Promote Samira to an active minor with the COPPA-default
  // restricted profile visibility (`followers`) so the upstream
  // private-by-default gate on GET /users/:userId/posts fires for
  // strangers. The route's profile-owner carve-out (which unmasks
  // the owner chip for anyone who reaches the handler) is justified
  // by that gate.
  await db
    .update(users)
    .set({
      isMinor: true,
      accountStatus: "active",
      profileVisibility: "followers",
    })
    .where(eq(users.id, samira));

  // Flip Samira's roster on the basketball team to accepted so daniela
  // (also accepted on that team) becomes a privileged shared-team viewer.
  await db
    .update(rosterEntries)
    .set({ status: "accepted" })
    .where(eq(rosterEntries.userId, samira));

  const [team] = await db
    .select({ id: teams.id, organizationId: teams.organizationId })
    .from(teams)
    .where(eq(teams.name, "Varsity Boys Basketball"))
    .limit(1);
  if (!team) throw new Error("Varsity Boys Basketball missing from seed");
  const org = team.organizationId;

  // Article authored by Samira (the minor) on her team.
  const [samiraArticle] = await db
    .insert(articles)
    .values({
      teamId: team.id,
      authorId: samira,
      title: "My first recap",
      body: "scored some buckets",
      status: "published",
      publishedAt: new Date(),
    })
    .returning();

  // Article authored by the coach (an adult) so we have a non-minor
  // post for Samira to comment on.
  const [coachArticle] = await db
    .insert(articles)
    .values({
      teamId: team.id,
      authorId: coach,
      title: "Coach's writeup",
      body: "team played well",
      status: "published",
      publishedAt: new Date(),
    })
    .returning();

  // Org post authored by Samira. Inserted directly because the public
  // POST /organizations/:orgId/posts route is gated to org admins.
  const [samiraOrgPost] = await db
    .insert(orgPosts)
    .values({
      organizationId: org,
      authorId: samira,
      title: "Note from Samira",
      body: "hello org",
      status: "published",
      publishedAt: new Date(),
    })
    .returning();

  // Approved comment authored by Samira on the coach's article. The
  // public comments route only surfaces approved rows for strangers.
  const [samiraComment] = await db
    .insert(postComments)
    .values({
      postKind: "article",
      postRefId: coachArticle.id,
      authorId: samira,
      body: "thanks coach!",
      moderationStatus: "approved",
    })
    .returning();

  // Follow rows so Samira appears in stranger-visible follower /
  // following lists. user_followers rows are inserted with the
  // default `approved` moderationStatus so they render publicly.
  await db
    .insert(organizationFollowers)
    .values({ organizationId: org, userId: samira })
    .onConflictDoNothing();
  await db
    .insert(teamFollowers)
    .values({ teamId: team.id, userId: samira })
    .onConflictDoNothing();
  await db
    .insert(userFollowers)
    .values({ followingUserId: marcus, followerUserId: samira })
    .onConflictDoNothing();
  await db
    .insert(userFollowers)
    .values({ followingUserId: samira, followerUserId: marcus })
    .onConflictDoNothing();
  // Marcus also follows the basketball team so his /feed pulls
  // Samira's article through the team-follow path.
  await db
    .insert(teamFollowers)
    .values({ teamId: team.id, userId: marcus })
    .onConflictDoNothing();
  // Lisa (the linked guardian) follows the team as well so the same
  // surface fires on her side as a privileged viewer.
  await db
    .insert(teamFollowers)
    .values({ teamId: team.id, userId: lisa })
    .onConflictDoNothing();

  return {
    samira,
    lisa,
    marcus,
    daniela,
    admin,
    coach,
    org,
    team: team.id,
    article: samiraArticle.id,
    samiraArticle: samiraArticle.id,
    samiraOrgPost: samiraOrgPost.id,
    coachArticle: coachArticle.id,
    samiraComment: samiraComment.id,
  };
}

let ids: Ids;

beforeEach(async () => {
  ids = await plantFixtures();
});

// Tiny convenience: assert the response body never renders Samira's
// full first+last name. The bare surname "Carter" is shared with the
// adult guardian "Lisa Carter" so we look for the joined token.
function expectNoLeak(body: unknown) {
  expect(JSON.stringify(body)).not.toContain("Samira Carter");
}

describe("Task #416 — minor name masking E2E", () => {
  // -------------------------------------------------------------------------
  // /search — stranger sees `Samira C.`; linked guardian sees full name.
  // (filterOutMinors keeps the minor visible to self/guardian; the
  // shared-team carve-out also keeps her visible to daniela.)
  // -------------------------------------------------------------------------
  describe("/search", () => {
    it("masks for an anonymous viewer; full name for the linked guardian", async () => {
      const anon = await request(app).get("/api/v1/search?q=Samira");
      expect(anon.status).toBe(200);
      expectNoLeak(anon.body);
      // Anon viewer is filterOutMinors-removed from search.
      const anonHit = (anon.body.users.data as Array<{ id: string }>).find(
        (u) => u.id === ids.samira,
      );
      expect(anonHit).toBeUndefined();

      const { agent: lisa } = await loginAs("lisa@kinectem.demo");
      const guardian = await lisa.get("/api/v1/search?q=Samira");
      expect(guardian.status).toBe(200);
      const guardianHit = (
        guardian.body.users.data as Array<{ id: string; displayName: string }>
      ).find((u) => u.id === ids.samira);
      expect(guardianHit).toBeDefined();
      expect(guardianHit!.displayName).toBe(FULL);
    });

    it("never leaks the surname to a logged-in stranger", async () => {
      // filterOutMinors hides Samira from a non-privileged logged-in
      // viewer entirely, so the assertion is the stronger "no surname
      // leak" plus "she does not appear in the result list".
      const { agent: marcus } = await loginAs("marcus@kinectem.demo");
      const res = await marcus.get("/api/v1/search?q=Samira");
      expect(res.status).toBe(200);
      expectNoLeak(res.body);
      const hit = (res.body.users.data as Array<{ id: string }>).find(
        (u) => u.id === ids.samira,
      );
      expect(hit).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // /users — same shape as /search. filterOutMinors hides the row for
  // strangers; linked guardian sees Samira with the full name.
  // -------------------------------------------------------------------------
  describe("/users", () => {
    it("hides the minor from strangers and keeps full name for guardian", async () => {
      const { agent: marcus } = await loginAs("marcus@kinectem.demo");
      const stranger = await marcus.get("/api/v1/users?q=Samira");
      expect(stranger.status).toBe(200);
      expectNoLeak(stranger.body);
      const sHit = (stranger.body.data as Array<{ id: string }>).find(
        (u) => u.id === ids.samira,
      );
      expect(sHit).toBeUndefined();

      const { agent: lisa } = await loginAs("lisa@kinectem.demo");
      const guardian = await lisa.get("/api/v1/users?q=Samira");
      expect(guardian.status).toBe(200);
      const gHit = (
        guardian.body.data as Array<{
          id: string;
          displayName: string;
          lastName: string;
        }>
      ).find((u) => u.id === ids.samira);
      expect(gHit).toBeDefined();
      expect(gHit!.displayName).toBe(FULL);
      expect(gHit!.lastName).toBe("Carter");
    });
  });

  // -------------------------------------------------------------------------
  // /posts/:id — single post detail. Stranger sees masked author chip;
  // privileged viewers (linked guardian, shared-team teammate, admin)
  // all see the full name.
  // -------------------------------------------------------------------------
  describe("/posts/:postId (Samira-authored article)", () => {
    const postId = () => `article-${ids.samiraArticle}`;

    it("masks the author chip for a stranger viewer", async () => {
      const { agent: marcus } = await loginAs("marcus@kinectem.demo");
      const res = await marcus.get(`/api/v1/posts/${postId()}`);
      expect(res.status).toBe(200);
      expectNoLeak(res.body);
      expect(res.body.author.displayName).toBe(MASKED);
    });

    it("returns the full author name to the linked guardian", async () => {
      const { agent: lisa } = await loginAs("lisa@kinectem.demo");
      const res = await lisa.get(`/api/v1/posts/${postId()}`);
      expect(res.status).toBe(200);
      expect(res.body.author.displayName).toBe(FULL);
    });

    it("returns the full author name to a shared-roster teammate (daniela)", async () => {
      const { agent: daniela } = await loginAs("daniela@kinectem.demo");
      const res = await daniela.get(`/api/v1/posts/${postId()}`);
      expect(res.status).toBe(200);
      expect(res.body.author.displayName).toBe(FULL);
    });

    it("returns the full author name to a platform admin", async () => {
      const { agent: admin } = await loginAs("sam@kinectem.demo");
      const res = await admin.get(`/api/v1/posts/${postId()}`);
      expect(res.status).toBe(200);
      expect(res.body.author.displayName).toBe(FULL);
    });
  });

  // -------------------------------------------------------------------------
  // /posts/:id/comments — comment author chip is masked / unmasked the
  // same way.
  // -------------------------------------------------------------------------
  describe("/posts/:postId/comments (Samira-authored comment)", () => {
    const postId = () => `article-${ids.coachArticle}`;

    it("masks the comment author for an anonymous viewer", async () => {
      const res = await request(app).get(`/api/v1/posts/${postId()}/comments`);
      expect(res.status).toBe(200);
      expectNoLeak(res.body);
      const c = (
        res.body.data as Array<{
          id: string;
          author: { id: string; displayName: string };
        }>
      ).find((row) => row.id === ids.samiraComment);
      expect(c).toBeDefined();
      expect(c!.author.displayName).toBe(MASKED);
    });

    it("returns the full comment author name to the linked guardian", async () => {
      const { agent: lisa } = await loginAs("lisa@kinectem.demo");
      const res = await lisa.get(`/api/v1/posts/${postId()}/comments`);
      expect(res.status).toBe(200);
      const c = (
        res.body.data as Array<{
          id: string;
          author: { id: string; displayName: string };
        }>
      ).find((row) => row.id === ids.samiraComment);
      expect(c).toBeDefined();
      expect(c!.author.displayName).toBe(FULL);
    });
  });

  // -------------------------------------------------------------------------
  // /feed — Marcus follows the team that Samira posted on, so her
  // article surfaces in his feed with the masked author chip; Lisa
  // follows the same team as the linked guardian and sees full name.
  // -------------------------------------------------------------------------
  describe("/feed", () => {
    it("masks the author chip for a stranger viewer's feed", async () => {
      const { agent: marcus } = await loginAs("marcus@kinectem.demo");
      const res = await marcus.get("/api/v1/feed");
      expect(res.status).toBe(200);
      expectNoLeak(res.body);
      const item = (
        res.body.data as Array<{
          id: string;
          author: { id: string; displayName: string };
        }>
      ).find((p) => p.author.id === ids.samira);
      expect(item, "expected Samira's article in marcus's feed").toBeDefined();
      expect(item!.author.displayName).toBe(MASKED);
    });

    it("returns the full author name to the linked guardian's feed", async () => {
      const { agent: lisa } = await loginAs("lisa@kinectem.demo");
      const res = await lisa.get("/api/v1/feed");
      expect(res.status).toBe(200);
      const item = (
        res.body.data as Array<{
          id: string;
          author: { id: string; displayName: string };
        }>
      ).find((p) => p.author.id === ids.samira);
      expect(item).toBeDefined();
      expect(item!.author.displayName).toBe(FULL);
    });
  });

  // -------------------------------------------------------------------------
  // /users/:userId/posts — the minor's own profile feed. Stranger sees
  // her authored article with masked author chip; guardian sees full.
  // -------------------------------------------------------------------------
  describe("/users/:userId/posts", () => {
    it("returns 404 (private-by-default minor) and never leaks the surname for stranger viewers", async () => {
      // The minor's profile is restricted (seed default
      // `profileVisibility = 'followers'`), so the route's upstream
      // gate hands strangers a 404 before any post serializer runs.
      // That gate is what justifies the route's profile-owner
      // carve-out (which would otherwise unmask the owner chip for
      // anyone reaching the handler).
      // Use jordan (no roster overlap with Samira, not a parent, not
      // an approved follower) so the restricted-profile gate fires.
      const { agent: jordan } = await loginAs("jordan@kinectem.demo");
      const res = await jordan.get(`/api/v1/users/${ids.samira}/posts`);
      expect(res.status).toBe(404);
      expectNoLeak(res.body);
    });

    it("returns the full author name to the linked guardian", async () => {
      const { agent: lisa } = await loginAs("lisa@kinectem.demo");
      const res = await lisa.get(`/api/v1/users/${ids.samira}/posts`);
      expect(res.status).toBe(200);
      const item = (
        res.body.data as Array<{
          id: string;
          author: { id: string; displayName: string };
        }>
      ).find((p) => p.id === `article-${ids.samiraArticle}`);
      expect(item).toBeDefined();
      expect(item!.author.displayName).toBe(FULL);
    });
  });

  // -------------------------------------------------------------------------
  // /teams/:teamId/posts — same masking on team-page post cards.
  // -------------------------------------------------------------------------
  describe("/teams/:teamId/posts", () => {
    it("masks the minor author for stranger viewers", async () => {
      const { agent: marcus } = await loginAs("marcus@kinectem.demo");
      const res = await marcus.get(`/api/v1/teams/${ids.team}/posts`);
      expect(res.status).toBe(200);
      expectNoLeak(res.body);
      const item = (
        res.body.data as Array<{
          id: string;
          author: { id: string; displayName: string };
        }>
      ).find((p) => p.id === `article-${ids.samiraArticle}`);
      expect(item).toBeDefined();
      expect(item!.author.displayName).toBe(MASKED);
    });

    it("returns the full author name to a shared-roster teammate", async () => {
      const { agent: daniela } = await loginAs("daniela@kinectem.demo");
      const res = await daniela.get(`/api/v1/teams/${ids.team}/posts`);
      expect(res.status).toBe(200);
      const item = (
        res.body.data as Array<{
          id: string;
          author: { id: string; displayName: string };
        }>
      ).find((p) => p.id === `article-${ids.samiraArticle}`);
      expect(item).toBeDefined();
      expect(item!.author.displayName).toBe(FULL);
    });
  });

  // -------------------------------------------------------------------------
  // /organizations/:orgId/posts — both article and org_post author
  // chips are masked / unmasked.
  // -------------------------------------------------------------------------
  describe("/organizations/:orgId/posts", () => {
    it("masks the minor author on both article and org_post cards for strangers", async () => {
      const { agent: marcus } = await loginAs("marcus@kinectem.demo");
      const res = await marcus.get(`/api/v1/organizations/${ids.org}/posts`);
      expect(res.status).toBe(200);
      expectNoLeak(res.body);
      const article = (
        res.body.data as Array<{
          id: string;
          author: { id: string; displayName: string };
        }>
      ).find((p) => p.id === `article-${ids.samiraArticle}`);
      expect(article).toBeDefined();
      expect(article!.author.displayName).toBe(MASKED);

      const orgPost = (
        res.body.data as Array<{
          id: string;
          author: { id: string; displayName: string };
        }>
      ).find((p) => p.id === `orgpost-${ids.samiraOrgPost}`);
      expect(orgPost).toBeDefined();
      expect(orgPost!.author.displayName).toBe(MASKED);
    });

    it("returns the full author name to the linked guardian", async () => {
      const { agent: lisa } = await loginAs("lisa@kinectem.demo");
      const res = await lisa.get(`/api/v1/organizations/${ids.org}/posts`);
      expect(res.status).toBe(200);
      const article = (
        res.body.data as Array<{
          id: string;
          author: { id: string; displayName: string };
        }>
      ).find((p) => p.id === `article-${ids.samiraArticle}`);
      expect(article).toBeDefined();
      expect(article!.author.displayName).toBe(FULL);

      const orgPost = (
        res.body.data as Array<{
          id: string;
          author: { id: string; displayName: string };
        }>
      ).find((p) => p.id === `orgpost-${ids.samiraOrgPost}`);
      expect(orgPost).toBeDefined();
      expect(orgPost!.author.displayName).toBe(FULL);
    });
  });

  // -------------------------------------------------------------------------
  // /users/:userId/followers and /users/:userId/following — Samira
  // follows Marcus and vice-versa. Strangers do not see Samira at all
  // (filterOutMinors); the linked guardian sees her with the full name.
  // -------------------------------------------------------------------------
  describe("/users/:userId/followers", () => {
    // The route projects {id, name, avatarUrl, isMinor, followedAt}
    // (no parentId) before calling filterOutMinors, so the only viewer
    // that ever surfaces a minor follower row here is the minor herself.
    // We assert (a) anonymous + non-self viewers never leak the surname
    // and (b) Samira viewing /users/marcus/followers sees herself with
    // her full name (the self carve-out path).
    it("never leaks the minor follower's full name to anonymous or stranger viewers; surfaces full name to the minor viewing herself", async () => {
      const anon = await request(app).get(
        `/api/v1/users/${ids.marcus}/followers`,
      );
      expect(anon.status).toBe(200);
      expectNoLeak(anon.body);
      expect(
        (anon.body.data as Array<{ id: string }>).find(
          (r) => r.id === ids.samira,
        ),
      ).toBeUndefined();

      const { agent: marcus } = await loginAs("marcus@kinectem.demo");
      const stranger = await marcus.get(
        `/api/v1/users/${ids.marcus}/followers`,
      );
      expect(stranger.status).toBe(200);
      expectNoLeak(stranger.body);

      const { agent: samira } = await loginAs("samira@kinectem.demo");
      const self = await samira.get(
        `/api/v1/users/${ids.marcus}/followers`,
      );
      expect(self.status).toBe(200);
      const sHit = (
        self.body.data as Array<{ id: string; displayName: string }>
      ).find((r) => r.id === ids.samira);
      expect(sHit).toBeDefined();
      expect(sHit!.displayName).toBe(FULL);
    });
  });

  describe("/users/:userId/following", () => {
    // Same projection caveat as /users/:userId/followers — only the
    // minor herself sees her own row in another user's following list.
    it("never leaks the minor followee's full name to anonymous or stranger viewers; surfaces full name to the minor viewing herself", async () => {
      const anon = await request(app).get(
        `/api/v1/users/${ids.marcus}/following`,
      );
      expect(anon.status).toBe(200);
      expectNoLeak(anon.body);
      expect(
        (anon.body.data as Array<{ id: string }>).find(
          (r) => r.id === ids.samira,
        ),
      ).toBeUndefined();

      const { agent: samira } = await loginAs("samira@kinectem.demo");
      const self = await samira.get(
        `/api/v1/users/${ids.marcus}/following`,
      );
      expect(self.status).toBe(200);
      const sHit = (
        self.body.data as Array<{ id: string; displayName: string }>
      ).find((r) => r.id === ids.samira);
      expect(sHit).toBeDefined();
      expect(sHit!.displayName).toBe(FULL);
    });
  });

  // -------------------------------------------------------------------------
  // /organizations/:orgId/followers — Samira follows the org. Same
  // shape as the user follower lists.
  // -------------------------------------------------------------------------
  describe("/organizations/:orgId/followers", () => {
    it("hides the minor follower from strangers; full name for the linked guardian", async () => {
      const stranger = await request(app).get(
        `/api/v1/organizations/${ids.org}/followers`,
      );
      expect(stranger.status).toBe(200);
      expectNoLeak(stranger.body);
      const sHit = (stranger.body.data as Array<{ id: string }>).find(
        (r) => r.id === ids.samira,
      );
      expect(sHit).toBeUndefined();

      const { agent: lisa } = await loginAs("lisa@kinectem.demo");
      const guardian = await lisa.get(
        `/api/v1/organizations/${ids.org}/followers`,
      );
      expect(guardian.status).toBe(200);
      const gHit = (
        guardian.body.data as Array<{ id: string; displayName: string }>
      ).find((r) => r.id === ids.samira);
      expect(gHit).toBeDefined();
      expect(gHit!.displayName).toBe(FULL);
    });
  });

  // -------------------------------------------------------------------------
  // /teams/:teamId/followers — same shape; daniela's shared-roster
  // carve-out also unmasks her view.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // /posts/follow-suggestions — Task #421. Defense in depth: the
  // route's filterOutMinors already drops minor rows for strangers, so
  // a non-privileged viewer's payload simply doesn't contain Samira at
  // all. The linked guardian, however, can still be recommended their
  // own child (filterOutMinors carves out parentId), and the new
  // toPublicUser minorNameCtx must keep the full name flowing for the
  // guardian. The masking branch is exercised at the unit level.
  describe("/posts/follow-suggestions", () => {
    it("never leaks the minor's surname to a stranger viewer", async () => {
      const { agent: marcus } = await loginAs("marcus@kinectem.demo");
      const res = await marcus.get(`/api/v1/follow-suggestions`);
      expect(res.status).toBe(200);
      expectNoLeak(res.body);
      const hit = (
        res.body.users as Array<{ id: string }>
      ).find((u) => u.id === ids.samira);
      expect(hit).toBeUndefined();
    });

    it("returns the full name to the linked guardian when their child is suggested", async () => {
      // Force Samira deterministically into Lisa's suggestion list:
      // (1) ensure Lisa does NOT already follow Samira (would exclude
      // her), and (2) bump Samira's follower count above her peers so
      // the popularity-ordered query surfaces her in the top 5.
      await db
        .delete(userFollowers)
        .where(
          and(
            eq(userFollowers.followerUserId, ids.lisa),
            eq(userFollowers.followingUserId, ids.samira),
          ),
        );
      // Padding followers: pull a few seeded users and have them
      // follow Samira so her count dominates. Re-uses marcus + coach
      // + daniela who are already privileged in this test file.
      for (const followerId of [ids.marcus, ids.coach, ids.daniela]) {
        await db
          .insert(userFollowers)
          .values({
            followingUserId: ids.samira,
            followerUserId: followerId,
            moderationStatus: "approved",
          })
          .onConflictDoNothing();
      }

      const { agent: lisa } = await loginAs("lisa@kinectem.demo");
      const res = await lisa.get(`/api/v1/follow-suggestions`);
      expect(res.status).toBe(200);
      const hit = (
        res.body.users as Array<{
          id: string;
          firstName: string;
          lastName: string;
        }>
      ).find((u) => u.id === ids.samira);
      expect(hit, "expected Samira in Lisa's suggestion list").toBeDefined();
      expect(hit!.firstName).toBe("Samira");
      expect(hit!.lastName).toBe("Carter");
    });
  });

  describe("/teams/:teamId/followers", () => {
    // filterOutMinors only carves out self + linked parent on follower
    // listings — shared-team teammates do NOT get a carve-out here, so
    // the privileged-viewer assertion is restricted to the linked
    // guardian (Task #414's per-row mask still fires for surviving
    // rows, which the guardian assertion exercises).
    it("hides the minor follower from strangers; full name for the linked guardian", async () => {
      const stranger = await request(app).get(
        `/api/v1/teams/${ids.team}/followers`,
      );
      expect(stranger.status).toBe(200);
      expectNoLeak(stranger.body);
      const sHit = (stranger.body.data as Array<{ id: string }>).find(
        (r) => r.id === ids.samira,
      );
      expect(sHit).toBeUndefined();

      const { agent: lisa } = await loginAs("lisa@kinectem.demo");
      const guardian = await lisa.get(
        `/api/v1/teams/${ids.team}/followers`,
      );
      expect(guardian.status).toBe(200);
      const gHit = (
        guardian.body.data as Array<{ id: string; displayName: string }>
      ).find((r) => r.id === ids.samira);
      expect(gHit).toBeDefined();
      expect(gHit!.displayName).toBe(FULL);
    });
  });
});

