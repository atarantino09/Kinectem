import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, users, userFollowers } from "@workspace/db";
import { app, loginAs, request } from "./helpers";

// Task #520 — Adult-only "private account" follow gating.
// Verifies that toggling `requiresFollowApproval` demotes new follow
// edges to `pending`, surfaces them in the requester's `Requested`
// state, lists them on the followed user's inbox, and that
// approve / decline behave correctly.
describe("follow requests (Task #520)", () => {
  it("private account demotes new follows to pending and approve flips to approved", async () => {
    const { agent: sam, user: samUser } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const { agent: marcus, user: marcusUser } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );

    // Sam turns on private account. Adults only — minors are rejected.
    const patch = await sam
      .patch(`/api/v1/users/${samUser.id}`)
      .send({ requiresFollowApproval: true });
    expect(patch.status).toBe(200);
    expect(patch.body.requiresFollowApproval).toBe(true);

    // Marcus tries to follow Sam — should land as pending, not approved.
    const followRes = await marcus.post(`/api/v1/users/${samUser.id}/follow`);
    expect([200, 201, 202]).toContain(followRes.status);

    // Public view of Sam from Marcus's session shows the pending state.
    const samView = await marcus.get(`/api/v1/users/${samUser.id}`);
    expect(samView.status).toBe(200);
    expect(samView.body.isFollowing).toBe(false);
    expect(samView.body.followRequestPending).toBe(true);

    // Sam's inbox lists the pending request.
    const inbox = await sam.get(`/api/v1/users/me/follow-requests`);
    expect(inbox.status).toBe(200);
    const ids = inbox.body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(marcusUser.id);

    // Sam's own followers list shows the pending edge (owner carve-out
    // from Task #520 — non-owners would only see approved).
    const ownFollowersBefore = await sam.get(
      `/api/v1/users/${samUser.id}/followers`,
    );
    expect(ownFollowersBefore.status).toBe(200);
    const ownFollowerIdsBefore = ownFollowersBefore.body.data.map(
      (r: { id: string }) => r.id,
    );
    expect(ownFollowerIdsBefore).toContain(marcusUser.id);

    // Marcus's own /following list shows his pending outgoing request.
    const marcusFollowingPending = await marcus.get(
      `/api/v1/users/${marcusUser.id}/following`,
    );
    const marcusFollowingIdsPending = marcusFollowingPending.body.data.map(
      (r: { id: string }) => r.id,
    );
    expect(marcusFollowingIdsPending).toContain(samUser.id);

    // A third-party viewer should NOT see the pending edge in either
    // list (the existing approved-only filter for non-owners).
    const thirdPartyFollowers = await request(app).get(
      `/api/v1/users/${samUser.id}/followers`,
    );
    const thirdPartyIds = thirdPartyFollowers.body.data.map(
      (r: { id: string }) => r.id,
    );
    expect(thirdPartyIds).not.toContain(marcusUser.id);

    // Sam approves. Idempotent: a second call returns ok (status is
    // already approved) — never 5xx.
    const approve = await sam.post(
      `/api/v1/users/me/follow-requests/${marcusUser.id}/approve`,
    );
    expect(approve.status).toBe(200);

    // Approval stamps the decision audit fields (mirrors guardian flow).
    const [decided] = await db
      .select({
        moderationStatus: userFollowers.moderationStatus,
        decidedAt: userFollowers.decidedAt,
        decidedByGuardianId: userFollowers.decidedByGuardianId,
      })
      .from(userFollowers)
      .where(
        and(
          eq(userFollowers.followingUserId, samUser.id),
          eq(userFollowers.followerUserId, marcusUser.id),
        ),
      )
      .limit(1);
    expect(decided?.moderationStatus).toBe("approved");
    expect(decided?.decidedAt).toBeInstanceOf(Date);
    expect(decided?.decidedByGuardianId).toBe(samUser.id);
    const approveAgain = await sam.post(
      `/api/v1/users/me/follow-requests/${marcusUser.id}/approve`,
    );
    expect(approveAgain.status).toBe(200);

    // After approval, Marcus is a real follower (isFollowing = true)
    // and no longer "Requested".
    const samViewAfter = await marcus.get(`/api/v1/users/${samUser.id}`);
    expect(samViewAfter.body.isFollowing).toBe(true);
    expect(samViewAfter.body.followRequestPending).toBe(false);

    // Inbox is now empty for this requester.
    const inbox2 = await sam.get(`/api/v1/users/me/follow-requests`);
    const ids2 = inbox2.body.data.map((r: { id: string }) => r.id);
    expect(ids2).not.toContain(marcusUser.id);

    // Reset for test isolation: turn private off and unfollow.
    await sam
      .patch(`/api/v1/users/${samUser.id}`)
      .send({ requiresFollowApproval: false });
    await marcus.delete(`/api/v1/users/${samUser.id}/follow`);
  });

  it("decline deletes the pending row; toggling off does not auto-approve outstanding requests", async () => {
    const { agent: sam, user: samUser } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const { agent: marcus, user: marcusUser } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );

    await sam
      .patch(`/api/v1/users/${samUser.id}`)
      .send({ requiresFollowApproval: true });
    await marcus.post(`/api/v1/users/${samUser.id}/follow`);

    // Decline removes the row.
    const decline = await sam.post(
      `/api/v1/users/me/follow-requests/${marcusUser.id}/decline`,
    );
    expect(decline.status).toBe(200);

    const samView = await marcus.get(`/api/v1/users/${samUser.id}`);
    expect(samView.body.isFollowing).toBe(false);
    expect(samView.body.followRequestPending).toBe(false);

    // Re-request, then flip private OFF — outstanding pending should NOT
    // auto-promote to approved.
    await marcus.post(`/api/v1/users/${samUser.id}/follow`);
    await sam
      .patch(`/api/v1/users/${samUser.id}`)
      .send({ requiresFollowApproval: false });

    const stillPending = await marcus.get(`/api/v1/users/${samUser.id}`);
    expect(stillPending.body.isFollowing).toBe(false);
    expect(stillPending.body.followRequestPending).toBe(true);

    // Cleanup.
    await sam.post(
      `/api/v1/users/me/follow-requests/${marcusUser.id}/decline`,
    );
  });

  it("requires auth on the inbox endpoint", async () => {
    const res = await request(app).get("/api/v1/users/me/follow-requests");
    expect(res.status).toBe(401);
  });

  it("minors cannot list/approve/decline via the adult inbox routes", async () => {
    // Samira is the seeded under-13 athlete. The seed inserts the row
    // but doesn't set `is_minor`; we flip it here so the runtime guard
    // sees an actual minor session. Her pending follows still flow
    // through the guardian queue in routes/guardians-coppa.ts — these
    // adult endpoints must reject her outright (403) so she can't
    // self-approve a stranger follower.
    const { agent: samira, user: samiraUser } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    await db
      .update(users)
      .set({ isMinor: true })
      .where(eq(users.id, samiraUser.id));

    const list = await samira.get("/api/v1/users/me/follow-requests");
    expect(list.status).toBe(403);

    const approve = await samira.post(
      "/api/v1/users/me/follow-requests/00000000-0000-0000-0000-000000000000/approve",
    );
    expect(approve.status).toBe(403);

    const decline = await samira.post(
      "/api/v1/users/me/follow-requests/00000000-0000-0000-0000-000000000000/decline",
    );
    expect(decline.status).toBe(403);

    // PATCH /users/:id with `requiresFollowApproval: true` must also be
    // rejected for minors (server-side enforcement of the hidden UI).
    const patch = await samira
      .patch(`/api/v1/users/${samiraUser.id}`)
      .send({ requiresFollowApproval: true });
    expect(patch.status).toBeGreaterThanOrEqual(400);
  });
});
