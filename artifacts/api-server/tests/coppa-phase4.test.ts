// Task #368 — COPPA Phase 4 launch-readiness test suite. Covers the
// load-bearing privacy invariants from Phases 1-3 plus the new admin
// takedown queue:
//
//   • restricted-minor profile 404 carve-outs (self / linked guardian
//     / platform admin)
//   • pending_deletion account lockout at the auth middleware
//   • pending-takedown suppression on /feed and /posts/:id with the
//     guardian + admin viewer carve-outs
//   • admin takedown approve / decline endpoints and audit trail

import { describe, expect, it, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  users,
  articles,
  articleTags,
  highlights,
  highlightTags,
  takedownRequests,
  consentAuditLog,
  notifications,
  teams,
  rosterEntries,
  userFollowers,
  postComments,
  conversations,
  conversationParticipants,
  messages,
} from "@workspace/db";
import {
  resolveTakedownCli,
  hardDeleteUserCli,
} from "@workspace/scripts/coppa-hard-delete";
import { app, loginAs, request } from "./helpers";

async function findUserId(email: string): Promise<string> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) throw new Error(`User ${email} missing from seed`);
  return u.id;
}

async function getAnyTeamId(): Promise<string> {
  const [t] = await db.select({ id: teams.id }).from(teams).limit(1);
  if (!t) throw new Error("No teams in seed");
  return t.id;
}

async function makeSamiraAMinor(): Promise<string> {
  const samiraId = await findUserId("samira@kinectem.demo");
  await db
    .update(users)
    .set({ isMinor: true, profileVisibility: "followers" })
    .where(eq(users.id, samiraId));
  return samiraId;
}

describe("COPPA Phase 4 launch-readiness", () => {
  describe("restricted minor profile 404 matrix", () => {
    beforeEach(async () => {
      await makeSamiraAMinor();
    });

    it("strangers get 404 on a restricted minor's profile", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const { agent: stranger } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      const res = await stranger.get(`/api/v1/users/${samiraId}`);
      expect(res.status).toBe(404);
    });

    it("self, linked guardian, and platform admin all see the minor", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const { agent: self } = await loginAs(
        (u) => u.email === "samira@kinectem.demo",
      );
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const { agent: admin } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      for (const agent of [self, lisa, admin]) {
        const res = await agent.get(`/api/v1/users/${samiraId}`);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(samiraId);
      }
    });

    it("anonymous (no session) cannot see a restricted minor's profile", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const res = await request(app).get(`/api/v1/users/${samiraId}`);
      // Public route — anon falls through to the same restricted-minor 404
      // carve-out as a logged-in stranger; either 401 or 404 is acceptable
      // so long as the minor's profile is not exposed.
      expect([401, 404]).toContain(res.status);
    });

    it("approved follower of the restricted minor sees the profile", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const marcusId = await findUserId("marcus@kinectem.demo");
      await db
        .insert(userFollowers)
        .values({
          followingUserId: samiraId,
          followerUserId: marcusId,
          moderationStatus: "approved",
        })
        .onConflictDoUpdate({
          target: [userFollowers.followingUserId, userFollowers.followerUserId],
          set: { moderationStatus: "approved" },
        });
      const { agent: marcus } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      const res = await marcus.get(`/api/v1/users/${samiraId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(samiraId);
    });

    it("shared-team admin (coach role) does NOT get a carve-out — 404", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const res = await coach.get(`/api/v1/users/${samiraId}`);
      expect(res.status).toBe(404);
    });

    it("/users/:id/posts mirrors the same restricted-minor matrix", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const marcusId = await findUserId("marcus@kinectem.demo");
      await db
        .insert(userFollowers)
        .values({
          followingUserId: samiraId,
          followerUserId: marcusId,
          moderationStatus: "approved",
        })
        .onConflictDoUpdate({
          target: [userFollowers.followingUserId, userFollowers.followerUserId],
          set: { moderationStatus: "approved" },
        });
      const { agent: stranger } = await loginAs(
        (u) => u.email === "jordan@kinectem.demo",
      );
      const { agent: self } = await loginAs(
        (u) => u.email === "samira@kinectem.demo",
      );
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const { agent: admin } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const { agent: marcus } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const anon = request(app);

      expect((await stranger.get(`/api/v1/users/${samiraId}/posts`)).status).toBe(404);
      expect((await coach.get(`/api/v1/users/${samiraId}/posts`)).status).toBe(404);
      const anonRes = await anon.get(`/api/v1/users/${samiraId}/posts`);
      expect([401, 404]).toContain(anonRes.status);
      expect((await self.get(`/api/v1/users/${samiraId}/posts`)).status).toBe(200);
      expect((await lisa.get(`/api/v1/users/${samiraId}/posts`)).status).toBe(200);
      expect((await admin.get(`/api/v1/users/${samiraId}/posts`)).status).toBe(200);
      expect((await marcus.get(`/api/v1/users/${samiraId}/posts`)).status).toBe(200);
    });

    it("public-visibility minor stays publicly visible", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      await db
        .update(users)
        .set({ profileVisibility: "public" })
        .where(eq(users.id, samiraId));
      const { agent: stranger } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      const res = await stranger.get(`/api/v1/users/${samiraId}`);
      expect(res.status).toBe(200);
    });
  });

  describe("pending_deletion account lockout", () => {
    it("a pending_deletion account cannot use its existing cookie session", async () => {
      // Log in first, then flip account to pending_deletion. Subsequent
      // requests must fail auth even though the session row is valid.
      const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
      const meRes = await agent.get("/api/v1/users/me");
      expect(meRes.status).toBe(200);
      const myId = meRes.body.id as string;
      await db
        .update(users)
        .set({ accountStatus: "pending_deletion", deletionRequestedAt: new Date() })
        .where(eq(users.id, myId));
      const after = await agent.get("/api/v1/users/me");
      expect(after.status).toBe(401);
    });
  });

  describe("pending-takedown suppression", () => {
    async function plantTakedownArticle(): Promise<{
      articleId: string;
      samiraId: string;
      lisaId: string;
    }> {
      const samiraId = await makeSamiraAMinor();
      const lisaId = await findUserId("lisa@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Game with samira tagged",
          body: "body",
          status: "published",
        })
        .returning();
      await db.insert(takedownRequests).values({
        childUserId: samiraId,
        requestedByGuardianId: lisaId,
        postKind: "article",
        postRefId: article.id,
        reason: "Test",
        status: "pending",
      });
      return { articleId: article.id, samiraId, lisaId };
    }

    it("strangers get 404 on a post with a pending takedown", async () => {
      const { articleId } = await plantTakedownArticle();
      const { agent: stranger } = await loginAs(
        (u) => u.email === "jordan@kinectem.demo",
      );
      const res = await stranger.get(`/api/v1/posts/article-${articleId}`);
      expect(res.status).toBe(404);
    });

    it("requesting guardian and platform admin still see the post", async () => {
      const { articleId } = await plantTakedownArticle();
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const { agent: admin } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      for (const agent of [lisa, admin]) {
        const res = await agent.get(`/api/v1/posts/article-${articleId}`);
        expect(res.status).toBe(200);
      }
    });
  });

  describe("admin takedown queue", () => {
    async function plantPendingTakedown(): Promise<{
      takedownId: string;
      articleId: string;
      samiraId: string;
    }> {
      const samiraId = await makeSamiraAMinor();
      const lisaId = await findUserId("lisa@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Pending takedown post",
          body: "body",
          status: "published",
        })
        .returning();
      const [t] = await db
        .insert(takedownRequests)
        .values({
          childUserId: samiraId,
          requestedByGuardianId: lisaId,
          postKind: "article",
          postRefId: article.id,
          reason: "Photo of minor",
          status: "pending",
        })
        .returning();
      return { takedownId: t.id, articleId: article.id, samiraId };
    }

    it("non-admins cannot list takedowns", async () => {
      const { agent: stranger } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      const res = await stranger.get("/api/v1/admin/takedowns");
      expect(res.status).toBe(403);
    });

    it("admin sees pending takedowns with child + guardian + post info", async () => {
      const { takedownId, articleId } = await plantPendingTakedown();
      const { agent: admin } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const res = await admin.get("/api/v1/admin/takedowns?status=pending");
      expect(res.status).toBe(200);
      const item = (res.body.data as Array<{ id: string; post: { id: string; exists: boolean } }>).find(
        (t) => t.id === takedownId,
      );
      expect(item).toBeDefined();
      expect(item!.post.id).toBe(articleId);
      expect(item!.post.exists).toBe(true);
    });

    it("approve deletes the post and stamps the takedown approved + audit row", async () => {
      const { takedownId, articleId, samiraId } = await plantPendingTakedown();
      const { agent: admin } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const res = await admin.post(`/api/v1/admin/takedowns/${takedownId}/approve`);
      expect(res.status).toBe(200);
      expect(res.body.decision).toBe("approved");

      const [art] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId));
      expect(art).toBeUndefined();

      const [t] = await db
        .select()
        .from(takedownRequests)
        .where(eq(takedownRequests.id, takedownId));
      expect(t?.status).toBe("approved");
      expect(t?.decidedAt).toBeTruthy();
      expect(t?.decidedByUserId).toBeTruthy();

      const audits = await db
        .select()
        .from(consentAuditLog)
        .where(
          and(
            eq(consentAuditLog.event, "guardian_takedown_approved"),
            eq(consentAuditLog.childUserId, samiraId),
          ),
        );
      expect(audits.length).toBeGreaterThanOrEqual(1);
    });

    it("concurrent approve+decline collapse to a single decision and one audit row", async () => {
      const { takedownId, articleId, samiraId } = await plantPendingTakedown();
      const { agent: admin1 } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const { agent: admin2 } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const [a, b] = await Promise.all([
        admin1.post(`/api/v1/admin/takedowns/${takedownId}/approve`),
        admin2.post(`/api/v1/admin/takedowns/${takedownId}/decline`),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      // Exactly one decision actually transitioned the row.
      const affectedTotal = (a.body.affected as number) + (b.body.affected as number);
      expect(affectedTotal).toBe(1);

      const [t] = await db
        .select()
        .from(takedownRequests)
        .where(eq(takedownRequests.id, takedownId));
      expect(t?.status === "approved" || t?.status === "declined").toBe(true);

      const audits = await db
        .select()
        .from(consentAuditLog)
        .where(eq(consentAuditLog.childUserId, samiraId));
      const decisionAudits = audits.filter(
        (r) =>
          r.event === "guardian_takedown_approved" ||
          r.event === "guardian_takedown_declined",
      );
      // Exactly one decision audit row for this child / takedown.
      expect(decisionAudits.length).toBe(1);
      // Article state matches the actual winning decision.
      const [art] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId));
      if (t?.status === "approved") {
        expect(art).toBeUndefined();
      } else {
        expect(art).toBeDefined();
      }
    });

    it("decline marks the takedown declined and leaves the post intact", async () => {
      const { takedownId, articleId, samiraId } = await plantPendingTakedown();
      const { agent: admin } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const res = await admin.post(`/api/v1/admin/takedowns/${takedownId}/decline`);
      expect(res.status).toBe(200);
      expect(res.body.decision).toBe("declined");

      const [art] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId));
      expect(art).toBeDefined();

      const [t] = await db
        .select()
        .from(takedownRequests)
        .where(eq(takedownRequests.id, takedownId));
      expect(t?.status).toBe("declined");

      const audits = await db
        .select()
        .from(consentAuditLog)
        .where(
          and(
            eq(consentAuditLog.event, "guardian_takedown_declined"),
            eq(consentAuditLog.childUserId, samiraId),
          ),
        );
      expect(audits.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("pending-takedown profile + feed suppression", () => {
    async function plantTaggedTakedown(): Promise<{
      articleId: string;
      samiraId: string;
      lisaId: string;
      coachId: string;
    }> {
      const samiraId = await makeSamiraAMinor();
      const lisaId = await findUserId("lisa@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Tagged samira recap",
          body: "x",
          status: "published",
        })
        .returning();
      await db.insert(articleTags).values({
        articleId: article.id,
        userId: samiraId,
        taggerUserId: coachId,
        status: "approved",
      });
      await db.insert(takedownRequests).values({
        childUserId: samiraId,
        requestedByGuardianId: lisaId,
        postKind: "article",
        postRefId: article.id,
        reason: "test",
        status: "pending",
      });
      return { articleId: article.id, samiraId, lisaId, coachId };
    }

    it("excludes pending-takedown article from coach's /users/:id/posts for strangers", async () => {
      const { articleId, coachId } = await plantTaggedTakedown();
      const { agent: stranger } = await loginAs(
        (u) => u.email === "jordan@kinectem.demo",
      );
      const res = await stranger.get(`/api/v1/users/${coachId}/posts`);
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).not.toContain(`article-${articleId}`);
    });

    it("requesting guardian still sees the pending-takedown article on /users/:id/posts", async () => {
      const { articleId, coachId } = await plantTaggedTakedown();
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa.get(`/api/v1/users/${coachId}/posts`);
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(`article-${articleId}`);
    });

    it("platform admin still sees the pending-takedown article on /users/:id/posts", async () => {
      const { articleId, coachId } = await plantTaggedTakedown();
      const { agent: admin } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const res = await admin.get(`/api/v1/users/${coachId}/posts`);
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(`article-${articleId}`);
    });

    it("excludes pending-takedown article from /feed for non-guardian non-admin viewers", async () => {
      const { articleId } = await plantTaggedTakedown();
      const { agent: stranger } = await loginAs(
        (u) => u.email === "jordan@kinectem.demo",
      );
      const res = await stranger.get(`/api/v1/feed?limit=100`);
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).not.toContain(`article-${articleId}`);
    });
  });

  describe("guardian takedown child-link authorization matrix", () => {
    it("403s when the child is not author/uploader, not tagged, and not rostered on the team", async () => {
      const samiraId = await makeSamiraAMinor();
      const coachId = await findUserId("coach@kinectem.demo");
      // Use a brand new team the child is NOT on by skipping team selection:
      // we just use any existing team but ensure samira is not rostered/tagged.
      const teamId = await getAnyTeamId();
      const { db: _ } = await import("@workspace/db");
      const { rosterEntries } = await import("@workspace/db");
      // Defensively remove any roster entry for samira on that team.
      await db
        .delete(rosterEntries)
        .where(
          and(
            eq(rosterEntries.teamId, teamId),
            eq(rosterEntries.userId, samiraId),
          ),
        );
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Unrelated post",
          body: "x",
          status: "published",
        })
        .returning();
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/guardians/children/${samiraId}/takedown-request`)
        .send({ postId: `article:${article.id}`, reason: "no link" });
      expect(res.status).toBe(403);
    });

    it("201s when the child is the article author", async () => {
      const samiraId = await makeSamiraAMinor();
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: samiraId,
          title: "Self-authored",
          body: "x",
          status: "published",
        })
        .returning();
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/guardians/children/${samiraId}/takedown-request`)
        .send({ postId: `article:${article.id}`, reason: "author" });
      expect(res.status).toBe(201);
    });

    it("201s when the child is the highlight uploader", async () => {
      const samiraId = await makeSamiraAMinor();
      const teamId = await getAnyTeamId();
      const [hl] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: samiraId,
          title: "Self-uploaded",
        })
        .returning();
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/guardians/children/${samiraId}/takedown-request`)
        .send({ postId: `highlight:${hl.id}`, reason: "uploader" });
      expect(res.status).toBe(201);
    });

    it("201s when the child is rostered on the posting team (no tag, not author)", async () => {
      const samiraId = await makeSamiraAMinor();
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      // Ensure samira is rostered on this team.
      await db
        .insert(rosterEntries)
        .values({
          teamId,
          userId: samiraId,
          role: "player",
          status: "accepted",
        })
        .onConflictDoNothing();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Team game recap",
          body: "x",
          status: "published",
        })
        .returning();
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/guardians/children/${samiraId}/takedown-request`)
        .send({ postId: `article:${article.id}`, reason: "rostered" });
      expect(res.status).toBe(201);
    });

    it("201s when the child is tagged on the article (any tag status)", async () => {
      const samiraId = await makeSamiraAMinor();
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Tagged",
          body: "x",
          status: "published",
        })
        .returning();
      await db.insert(articleTags).values({
        articleId: article.id,
        userId: samiraId,
        taggerUserId: coachId,
        status: "pending",
      });
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/guardians/children/${samiraId}/takedown-request`)
        .send({ postId: `article:${article.id}`, reason: "tagged" });
      expect(res.status).toBe(201);
    });
  });

  describe("operator hard-delete script (resolveTakedownCli)", () => {
    async function plantPendingArticleTakedown(): Promise<{
      articleId: string;
      samiraId: string;
    }> {
      const samiraId = await makeSamiraAMinor();
      const lisaId = await findUserId("lisa@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Script target",
          body: "x",
          status: "published",
        })
        .returning();
      await db.insert(takedownRequests).values({
        childUserId: samiraId,
        requestedByGuardianId: lisaId,
        postKind: "article",
        postRefId: article.id,
        status: "pending",
      });
      return { articleId: article.id, samiraId };
    }

    it("approve mode deletes the post, stamps takedowns approved, writes audit row", async () => {
      const { articleId, samiraId } = await plantPendingArticleTakedown();
      const result = await resolveTakedownCli({
        postRef: `article:${articleId}`,
        apply: true,
        decline: false,
      });
      expect(result.ok).toBe(true);
      expect(result.affected).toBeGreaterThanOrEqual(1);

      const [art] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId));
      expect(art).toBeUndefined();
      const tdRows = await db
        .select()
        .from(takedownRequests)
        .where(eq(takedownRequests.postRefId, articleId));
      expect(tdRows.every((r) => r.status === "approved")).toBe(true);
      const audits = await db
        .select()
        .from(consentAuditLog)
        .where(
          and(
            eq(consentAuditLog.event, "guardian_takedown_approved"),
            eq(consentAuditLog.childUserId, samiraId),
          ),
        );
      expect(audits.length).toBeGreaterThanOrEqual(1);
    });

    it("decline mode leaves the post intact, marks takedowns declined, writes a decline audit row", async () => {
      const { articleId, samiraId } = await plantPendingArticleTakedown();
      const result = await resolveTakedownCli({
        postRef: `article:${articleId}`,
        apply: true,
        decline: true,
      });
      expect(result.ok).toBe(true);
      const [art] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId));
      expect(art).toBeDefined();
      const tdRows = await db
        .select()
        .from(takedownRequests)
        .where(eq(takedownRequests.postRefId, articleId));
      expect(tdRows.every((r) => r.status === "declined")).toBe(true);
      const audits = await db
        .select()
        .from(consentAuditLog)
        .where(
          and(
            eq(consentAuditLog.event, "guardian_takedown_declined"),
            eq(consentAuditLog.childUserId, samiraId),
          ),
        );
      expect(audits.length).toBeGreaterThanOrEqual(1);
    });

    it("dry-run (apply=false) is a no-op", async () => {
      const { articleId } = await plantPendingArticleTakedown();
      const result = await resolveTakedownCli({
        postRef: `article:${articleId}`,
        apply: false,
        decline: false,
      });
      expect(result.ok).toBe(true);
      expect(result.affected).toBe(0);
      const [art] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId));
      expect(art).toBeDefined();
      const tdRows = await db
        .select()
        .from(takedownRequests)
        .where(eq(takedownRequests.postRefId, articleId));
      expect(tdRows.every((r) => r.status === "pending")).toBe(true);
    });
  });

  describe("operator hard-delete script (hardDeleteUserCli)", () => {
    it("purges the user row, child-authored articles/highlights/comments, and conversation participants", async () => {
      const samiraId = await makeSamiraAMinor();
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      // Child-authored content across the SET-NULL FK surface.
      const [art] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: samiraId,
          title: "Samira's recap",
          body: "x",
          status: "published",
        })
        .returning();
      const [hl] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: samiraId,
          title: "Samira clip",
        })
        .returning();
      const [com] = await db
        .insert(postComments)
        .values({
          postKind: "article",
          postRefId: art.id,
          authorId: samiraId,
          body: "nice game",
        })
        .returning();
      // Conversation with a polymorphic participant row pointing at samira.
      const [conv] = await db
        .insert(conversations)
        .values({ type: "direct" })
        .returning();
      await db.insert(conversationParticipants).values([
        { conversationId: conv.id, participantType: "user", participantId: samiraId },
        { conversationId: conv.id, participantType: "user", participantId: coachId },
      ]);
      await db.insert(messages).values({
        conversationId: conv.id,
        senderUserId: samiraId,
        body: "hi coach",
      });
      await db.insert(messages).values({
        conversationId: conv.id,
        senderUserId: coachId,
        body: "hi samira",
      });

      await hardDeleteUserCli(samiraId);

      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.id, samiraId));
      expect(userRows.length).toBe(0);
      const artRows = await db
        .select()
        .from(articles)
        .where(eq(articles.id, art.id));
      expect(artRows.length).toBe(0);
      const hlRows = await db
        .select()
        .from(highlights)
        .where(eq(highlights.id, hl.id));
      expect(hlRows.length).toBe(0);
      const commentRows = await db
        .select()
        .from(postComments)
        .where(eq(postComments.id, com.id));
      expect(commentRows.length).toBe(0);
      const partRows = await db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.participantType, "user"),
            eq(conversationParticipants.participantId, samiraId),
          ),
        );
      expect(partRows.length).toBe(0);
    });
  });

  describe("guardian takedown filing notifies admins", () => {
    it("filing a takedown drops a notification into every admin's bell + a child_pending_takedown into the guardian's", async () => {
      const samiraId = await makeSamiraAMinor();
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Tag samira",
          body: "x",
          status: "published",
        })
        .returning();
      // Tag samira so the guardian passes the child-link check.
      await db.insert(articleTags).values({
        articleId: article.id,
        userId: samiraId,
        taggerUserId: coachId,
        status: "pending",
      });

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const filed = await lisa
        .post(`/api/v1/guardians/children/${samiraId}/takedown-request`)
        .send({ postId: `article:${article.id}`, reason: "test" });
      expect(filed.status).toBe(201);

      const adminId = await findUserId("sam@kinectem.demo");
      const notifs = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, adminId),
            eq(notifications.kind, "admin_takedown_filed"),
          ),
        );
      expect(notifs.length).toBeGreaterThanOrEqual(1);
      expect(notifs[0].link).toBe("/admin/moderation");

      const lisaId = await findUserId("lisa@kinectem.demo");
      const guardianBell = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, lisaId),
            eq(notifications.kind, "child_pending_takedown"),
          ),
        );
      expect(guardianBell.length).toBeGreaterThanOrEqual(1);
      expect(guardianBell[0].link).toMatch(/^\/family\?childId=/);
    });
  });
});
