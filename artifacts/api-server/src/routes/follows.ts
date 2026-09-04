import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  users,
  organizations,
  organizationFollowers,
  userFollowers,
  teamFollowers,
  teams,
  adminActivityLog,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import {
  isActiveGuardian,
  patchParentIdForViewer,
} from "../lib/guardian-links";
import { sendGuardianConfirmationEmail, sendGuardianExpiredEmail, sendPasswordResetEmail } from "../lib/email";
import { canCreateRecap, canManageOrganization, isTeamMember, canManageTeam } from "../lib/permissions";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../lib/auth";
import {
  displayName,
  displayNameForViewer,
  buildMinorNameContext,
  apiError,
  safeAvatarUrl,
} from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostOwnerId,
  type PostStats,
  type StatsKind,
} from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap, TAG_NOTIF_THROTTLE_MS } from "../lib/article-tagging";
import { filterOutMinors } from "../lib/coppa";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Follower / following list endpoints
// ---------------------------------------------------------------------------

function parseFollowLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function decodeFollowCursor(raw: unknown): { createdAt: Date; id: string } | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const idx = decoded.indexOf("|");
    if (idx < 0) return null;
    const ts = decoded.slice(0, idx);
    const id = decoded.slice(idx + 1);
    const d = new Date(ts);
    if (Number.isNaN(d.getTime()) || !id) return null;
    return { createdAt: d, id };
  } catch {
    return null;
  }
}

function encodeFollowCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64");
}

async function listOrgFollowers(req: Request, res: Response) {
  const limit = parseFollowLimit(req.query["limit"]);
  const cursor = decodeFollowCursor(req.query["cursor"]);
  const conds = [eq(organizationFollowers.organizationId, req.params.orgId)];
  if (cursor) {
    conds.push(
      sql`(${organizationFollowers.createdAt}, ${organizationFollowers.userId}) < (${cursor.createdAt.toISOString()}, ${cursor.id})`,
    );
  }
  const rawRows = await db
    .select({
      id: users.id,
      name: users.name,
      avatarUrl: users.avatarUrl,
      isMinor: users.isMinor,
      parentId: users.parentId,
      followedAt: organizationFollowers.createdAt,
    })
    .from(organizationFollowers)
    .innerJoin(users, eq(users.id, organizationFollowers.userId))
    .where(and(...conds))
    .orderBy(desc(organizationFollowers.createdAt), desc(organizationFollowers.userId))
    .limit(limit + 1);
  // Hide minors from public follower lists (the viewer-aware filter
  // still surfaces a minor to themself or their linked guardian).
  const rows = filterOutMinors(
    await patchParentIdForViewer(rawRows, req.sessionUser?.id ?? null),
    req.sessionUser?.id ?? null,
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && page.length > 0
      ? encodeFollowCursor(page[page.length - 1].followedAt, page[page.length - 1].id)
      : null;
  // Task #414 — surface masked names for any minor the viewer is not
  // privileged for. `filterOutMinors` already drops most minor rows for
  // strangers; surviving rows (self, linked guardian, shared-team) are
  // also the ones that should keep the full name.
  const ctx = await buildMinorNameContext(
    { id: req.sessionUser?.id ?? null, role: req.sessionUser?.role ?? null },
    page.filter((r) => r.isMinor).map((r) => r.id),
  );
  res.json({
    data: page.map((r) => ({
      id: r.id,
      displayName: displayNameForViewer(
        { id: r.id, name: r.name, isMinor: r.isMinor },
        ctx,
      ),
      avatarUrl: safeAvatarUrl(r.avatarUrl),
      followedAt: r.followedAt.toISOString(),
    })),
    pagination: { nextCursor, hasMore, totalCount: 0 },
  });
}

router.get("/organizations/:orgId/followers", asyncHandler(listOrgFollowers));

router.get(
  "/teams/:teamId/followers",
  asyncHandler(async (req, res) => {
    const limit = parseFollowLimit(req.query["limit"]);
    const cursor = decodeFollowCursor(req.query["cursor"]);
    const conds = [eq(teamFollowers.teamId, req.params.teamId)];
    if (cursor) {
      conds.push(
        sql`(${teamFollowers.createdAt}, ${teamFollowers.userId}) < (${cursor.createdAt.toISOString()}, ${cursor.id})`,
      );
    }
    const rawRows = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        isMinor: users.isMinor,
        parentId: users.parentId,
        followedAt: teamFollowers.createdAt,
      })
      .from(teamFollowers)
      .innerJoin(users, eq(users.id, teamFollowers.userId))
      .where(and(...conds))
      .orderBy(desc(teamFollowers.createdAt), desc(teamFollowers.userId))
      .limit(limit + 1);
    const rows = filterOutMinors(
      await patchParentIdForViewer(rawRows, req.sessionUser?.id ?? null),
      req.sessionUser?.id ?? null,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && page.length > 0
        ? encodeFollowCursor(page[page.length - 1].followedAt, page[page.length - 1].id)
        : null;
    // Task #414 — see listOrgFollowers; same masking rationale.
    const ctx = await buildMinorNameContext(
      { id: req.sessionUser?.id ?? null, role: req.sessionUser?.role ?? null },
      page.filter((r) => r.isMinor).map((r) => r.id),
    );
    res.json({
      data: page.map((r) => ({
        id: r.id,
        displayName: displayNameForViewer(
          { id: r.id, name: r.name, isMinor: r.isMinor },
          ctx,
        ),
        avatarUrl: safeAvatarUrl(r.avatarUrl),
        followedAt: r.followedAt.toISOString(),
      })),
      pagination: { nextCursor, hasMore, totalCount: 0 },
    });
  }),
);

router.get(
  "/users/:userId/followers",
  asyncHandler(async (req, res) => {
    const limit = parseFollowLimit(req.query["limit"]);
    const cursor = decodeFollowCursor(req.query["cursor"]);
    const userId =
      req.params.userId === "me" ? req.sessionUser?.id : req.params.userId;
    if (!userId) return apiError(res, 401, "Not authenticated");
    // Task #363 — non-guardian viewers only see APPROVED follows. The
    // child's linked guardian sees them all (pending + approved) so the
    // family page reflects what they're managing.
    const me = req.sessionUser;
    const conds = [eq(userFollowers.followingUserId, userId)];
    // Task #755 — any ACTIVE guardian qualifies, not just the primary.
    const isGuardianViewer = me ? await isActiveGuardian(me.id, userId) : false;
    // Task #363 — pending follow edges are only visible to the linked
    // guardian. The child themselves should not see incoming pending
    // follows in their public follower list (those live on the
    // family-managed surface).
    // Task #520 — Adult account owners (non-minor) CAN see their own
    // pending follows in their `/followers` view; the private-account
    // inbox at /follow-requests is the canonical surface, but list
    // consumers (e.g. profile renderer) should reflect pending edges
    // for the owner so the row count matches what they manage.
    const isOwnerAdultViewer = !!me && me.id === userId && !me.isMinor;
    if (!isGuardianViewer && !isOwnerAdultViewer) {
      conds.push(eq(userFollowers.moderationStatus, "approved"));
    }
    if (cursor) {
      conds.push(
        sql`(${userFollowers.createdAt}, ${userFollowers.followerUserId}) < (${cursor.createdAt.toISOString()}, ${cursor.id})`,
      );
    }
    const rowsRaw = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        isMinor: users.isMinor,
        followedAt: userFollowers.createdAt,
      })
      .from(userFollowers)
      .innerJoin(users, eq(users.id, userFollowers.followerUserId))
      .where(and(...conds))
      .orderBy(desc(userFollowers.createdAt), desc(userFollowers.followerUserId))
      .limit(limit + 1);
    // Task #359 — minor accounts must not surface in stranger-visible
    // follower lists. Filter post-query so the cursor pagination plan
    // is unchanged; the page may now be slightly shorter than `limit`.
    const rows = filterOutMinors(
      await patchParentIdForViewer(rowsRaw, req.sessionUser?.id ?? null),
      req.sessionUser?.id ?? null,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && page.length > 0
        ? encodeFollowCursor(page[page.length - 1].followedAt, page[page.length - 1].id)
        : null;
    // Task #414 — mask under-13 last names on the public follower list
    // for any viewer not privileged for that minor.
    const ctx = await buildMinorNameContext(
      { id: req.sessionUser?.id ?? null, role: req.sessionUser?.role ?? null },
      page.filter((r) => r.isMinor).map((r) => r.id),
    );
    res.json({
      data: page.map((r) => ({
        id: r.id,
        displayName: displayNameForViewer(
          { id: r.id, name: r.name, isMinor: r.isMinor },
          ctx,
        ),
        avatarUrl: safeAvatarUrl(r.avatarUrl),
        followedAt: r.followedAt.toISOString(),
      })),
      pagination: { nextCursor, hasMore, totalCount: 0 },
    });
  }),
);

router.get(
  "/users/:userId/following",
  asyncHandler(async (req, res) => {
    const limit = parseFollowLimit(req.query["limit"]);
    const cursor = decodeFollowCursor(req.query["cursor"]);
    const userId =
      req.params.userId === "me" ? req.sessionUser?.id : req.params.userId;
    if (!userId) return apiError(res, 401, "Not authenticated");
    // Combine followed users + followed organizations, sort by createdAt desc.
    // Task #363 — only show approved outgoing follows in the public
    // /following list; pending edges remain invisible until guardian
    // approval.
    // Task #520 — Adult account owners viewing their own /following
    // list see their pending outgoing requests too (the "Requested"
    // state on the requester side), so the list matches what the
    // profile UI surfaces.
    const me = req.sessionUser;
    const isOwnerAdultViewer = !!me && me.id === userId && !me.isMinor;
    const userConds = [eq(userFollowers.followerUserId, userId)];
    if (!isOwnerAdultViewer) {
      userConds.push(eq(userFollowers.moderationStatus, "approved"));
    }
    const userRowsRaw = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        isMinor: users.isMinor,
        parentId: users.parentId,
        followedAt: userFollowers.createdAt,
      })
      .from(userFollowers)
      .innerJoin(users, eq(users.id, userFollowers.followingUserId))
      .where(and(...userConds))
      .orderBy(desc(userFollowers.createdAt));
    // Task #359 — drop minor rows from the followed-user list; viewer
    // is allowed to see themselves and their own children through it.
    const userRows = filterOutMinors(
      await patchParentIdForViewer(userRowsRaw, req.sessionUser?.id ?? null),
      req.sessionUser?.id ?? null,
    );
    // Task #414 — among the surviving minor rows, mask the last name
    // unless the viewer is privileged for that specific minor.
    const ctxFollowing = await buildMinorNameContext(
      { id: req.sessionUser?.id ?? null, role: req.sessionUser?.role ?? null },
      userRows.filter((r) => r.isMinor).map((r) => r.id),
    );
    const orgConds = [eq(organizationFollowers.userId, req.params.userId)];
    const orgRows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        avatarUrl: organizations.logoUrl,
        followedAt: organizationFollowers.createdAt,
      })
      .from(organizationFollowers)
      .innerJoin(organizations, eq(organizations.id, organizationFollowers.organizationId))
      .where(and(...orgConds))
      .orderBy(desc(organizationFollowers.createdAt));
    const combined = [
      ...userRows.map((r) => ({
        id: r.id,
        displayName: displayNameForViewer(
          { id: r.id, name: r.name, isMinor: r.isMinor },
          ctxFollowing,
        ),
        avatarUrl: safeAvatarUrl(r.avatarUrl),
        entityType: "user" as const,
        followedAt: r.followedAt,
      })),
      ...orgRows.map((r) => ({
        id: r.id,
        displayName: r.name,
        avatarUrl: safeAvatarUrl(r.avatarUrl),
        entityType: "organization" as const,
        followedAt: r.followedAt,
      })),
    ].sort((a, b) => {
      const diff = b.followedAt.getTime() - a.followedAt.getTime();
      if (diff !== 0) return diff;
      return b.id.localeCompare(a.id);
    });
    let startIdx = 0;
    if (cursor) {
      startIdx = combined.findIndex(
        (it) =>
          it.followedAt.getTime() < cursor.createdAt.getTime() ||
          (it.followedAt.getTime() === cursor.createdAt.getTime() && it.id < cursor.id),
      );
      if (startIdx < 0) startIdx = combined.length;
    }
    const slice = combined.slice(startIdx, startIdx + limit + 1);
    const hasMore = slice.length > limit;
    const page = hasMore ? slice.slice(0, limit) : slice;
    const nextCursor =
      hasMore && page.length > 0
        ? encodeFollowCursor(page[page.length - 1].followedAt, page[page.length - 1].id)
        : null;
    res.json({
      data: page.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        avatarUrl: safeAvatarUrl(r.avatarUrl),
        entityType: r.entityType,
        followedAt: r.followedAt.toISOString(),
      })),
      pagination: { nextCursor, hasMore, totalCount: 0 },
    });
  }),
);

// Manager-only follower removal. These routes intentionally differ from the
// self-service `/follow` DELETE paths: managers supply the follower id and
// their authority is derived from the persisted org/team context.
router.delete(
  "/organizations/:orgId/followers/:userId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, req.params.orgId))
      .limit(1);
    if (!org) return apiError(res, 404, "Not found");
    if (!(await canManageOrganization(me.id, org.id))) {
      return apiError(res, 403, "Organization managers only");
    }
    const deleted = await db.transaction(async (tx) => {
      const rows = await tx
        .delete(organizationFollowers)
        .where(and(
          eq(organizationFollowers.organizationId, org.id),
          eq(organizationFollowers.userId, req.params.userId),
        ))
        .returning({ userId: organizationFollowers.userId });
      if (!rows.length) return false;
      await tx.insert(adminActivityLog).values({
        adminUserId: me.id,
        actionType: "moderation_remove",
        targetType: "follower",
        targetId: req.params.userId,
        metadata: JSON.stringify({ organizationId: org.id, followType: "organization" }),
      });
      return true;
    });
    if (!deleted) return apiError(res, 404, "Follower relationship not found");
    return res.status(204).end();
  }),
);

router.delete(
  "/teams/:teamId/followers/:userId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, req.params.teamId))
      .limit(1);
    if (!team) return apiError(res, 404, "Not found");
    if (!(await canManageTeam(me.id, team))) {
      return apiError(res, 403, "Team coaches or organization managers only");
    }
    const deleted = await db.transaction(async (tx) => {
      const rows = await tx
        .delete(teamFollowers)
        .where(and(
          eq(teamFollowers.teamId, team.id),
          eq(teamFollowers.userId, req.params.userId),
        ))
        .returning({ userId: teamFollowers.userId });
      if (!rows.length) return false;
      await tx.insert(adminActivityLog).values({
        adminUserId: me.id,
        actionType: "moderation_remove",
        targetType: "follower",
        targetId: req.params.userId,
        metadata: JSON.stringify({
          organizationId: team.organizationId,
          teamId: team.id,
          followType: "team",
        }),
      });
      return true;
    });
    if (!deleted) return apiError(res, 404, "Follower relationship not found");
    return res.status(204).end();
  }),
);

export default router;
