import { Router, type IRouter } from "express";
import { db, users, userFollowers } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { apiError, splitName, safeAvatarUrl } from "../lib/spec-helpers";

// Task #520 — Adult-only "private account" follow-request inbox.
// Pending edges that landed here come from POST /users/:userId/follow
// when the followed adult has `requires_follow_approval = true`.
// Minor-targeted pending follows continue to flow through the
// guardian dashboard at /family — they don't surface here.
//
// Hard guard: under-13 (`isMinor`) users may NEVER use these routes,
// even to list. Their pending follows live in the same `user_followers`
// table but are guardian-moderated only (see guardians-coppa.ts). A
// minor calling these endpoints would let them self-approve a stranger
// follower, bypassing parental consent. We reject with 403 before any
// row is read or written.

const router: IRouter = Router();

function rejectIfMinor(
  me: { isMinor?: boolean | null } | undefined,
  res: import("express").Response,
): boolean {
  if (me?.isMinor) {
    apiError(
      res,
      403,
      "Follow requests for minors are managed by a guardian",
      { code: "minor_follow_requests_guardian_only" },
    );
    return true;
  }
  return false;
}

router.get(
  "/users/me/follow-requests",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (rejectIfMinor(me, res)) return;
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        createdAt: userFollowers.createdAt,
      })
      .from(userFollowers)
      .innerJoin(users, eq(users.id, userFollowers.followerUserId))
      .where(
        and(
          eq(userFollowers.followingUserId, me.id),
          eq(userFollowers.moderationStatus, "pending"),
        ),
      )
      .orderBy(desc(userFollowers.createdAt));
    const data = rows.map((r) => {
      const { firstName, lastName } = splitName(r.name);
      return {
        id: r.id,
        displayName: `${firstName} ${lastName}`.trim(),
        avatarUrl: safeAvatarUrl(r.avatarUrl),
        bio: r.bio ?? null,
        requestedAt: r.createdAt.toISOString(),
      };
    });
    return res.json({
      data,
      pagination: { nextCursor: null, hasMore: false, totalCount: data.length },
    });
  }),
);

router.post(
  "/users/me/follow-requests/:requesterId/approve",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (rejectIfMinor(me, res)) return;
    const requesterId = String(req.params.requesterId);
    // Single conditional UPDATE — never resurrects a row that doesn't
    // exist, and a concurrent decline (DELETE) just yields zero rows
    // here so we 404 cleanly.
    // Mirror the guardian-approval audit trail: stamp `decidedAt` and
    // `decidedByGuardianId` with the deciding user's id. For the adult
    // private-account flow that's the followed user themselves (self-
    // approval), reusing the existing column instead of adding a new
    // one — the schema comment already covers the "transition out of
    // pending" semantics.
    const updated = await db
      .update(userFollowers)
      .set({
        moderationStatus: "approved",
        decidedAt: new Date(),
        decidedByGuardianId: me.id,
      })
      .where(
        and(
          eq(userFollowers.followingUserId, me.id),
          eq(userFollowers.followerUserId, requesterId),
          eq(userFollowers.moderationStatus, "pending"),
        ),
      )
      .returning({ followerUserId: userFollowers.followerUserId });
    if (updated.length === 0) {
      // Idempotency: if an `approved` row already exists, treat as
      // success; otherwise no such request → 404.
      const [existing] = await db
        .select({ status: userFollowers.moderationStatus })
        .from(userFollowers)
        .where(
          and(
            eq(userFollowers.followingUserId, me.id),
            eq(userFollowers.followerUserId, requesterId),
          ),
        )
        .limit(1);
      if (!existing) return apiError(res, 404, "Follow request not found");
    }
    return res.json({ ok: true });
  }),
);

router.post(
  "/users/me/follow-requests/:requesterId/decline",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (rejectIfMinor(me, res)) return;
    const requesterId = String(req.params.requesterId);
    // Decline = delete the pending row. Idempotent: no row → 200 ok.
    // We deliberately scope to `pending` so a decline can't kick an
    // already-approved follower (those go through unfollow / block).
    await db
      .delete(userFollowers)
      .where(
        and(
          eq(userFollowers.followingUserId, me.id),
          eq(userFollowers.followerUserId, requesterId),
          eq(userFollowers.moderationStatus, "pending"),
        ),
      );
    return res.json({ ok: true });
  }),
);

export default router;
