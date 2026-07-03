import { Router, type IRouter } from "express";
import {
  db,
  users,
  organizations,
  organizationAdmins,
  organizationFollowers,
  organizationFollowOptouts,
  userFollowers,
  teamFollowers,
  teams,
  rosterEntries,
  rosterInvites,
  articles,
  articleAuthors,
  articleTags,
  highlights,
  highlightTags,
  orgPosts,
  notifications,
  postReactions,
  postComments,
  conversations,
  conversationParticipants,
  messages,
  messageAssets,
  assets,
  organizationJoinRequests,
  passwordResets,
  contentReports,
  parentChildNotificationReads,
  messageChildHides,
  userPinnedTeams,
  userPinnedOrgs,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import { logger } from "../lib/logger";
import { sendGuardianConfirmationEmail, sendGuardianExpiredEmail, sendPasswordResetEmail } from "../lib/email";
import { canCreateRecap, canManageOrganization, isTeamMember, canManageTeam } from "../lib/permissions";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../lib/auth";
import { toPrivateUser, apiError } from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostOwnerId,
  type PostStats,
  type StatsKind,
} from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap, TAG_NOTIF_THROTTLE_MS } from "../lib/article-tagging";
import { notifyExpiredGuardianConfirmations } from "../lib/guardian-confirmations";
import { isGuardian } from "../lib/guardian-capability";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

router.get(
  "/users/me",
  asyncHandler(async (req, res) => {
    const u = req.sessionUser;
    if (!u) return apiError(res, 401, "Not authenticated");
    if (await isGuardian(u.id)) {
      try {
        await notifyExpiredGuardianConfirmations(u.id);
      } catch (err) {
        logger.error(
          { err },
          "Failed to create guardian-expired notifications",
        );
      }
    }
    res.json(toPrivateUser(u));
  }),
);

router.get(
  "/users/me/settings",
  asyncHandler(async (_req, res) => {
    res.json({ share_to_facebook_default: false });
  }),
);

router.patch(
  "/users/me/settings",
  asyncHandler(async (req, res) => {
    res.json({ share_to_facebook_default: !!req.body?.share_to_facebook_default });
  }),
);

// ---------------------------------------------------------------------------
// Pinned teams — the viewer's own personalization (max 5). Pinned teams
// float to the top of the viewer's team lists on their profile and on any
// org page. Full-replace PUT mirrors the /users/:userId/sports pattern; the
// submitted array order becomes the stored pin order.
// ---------------------------------------------------------------------------

router.get(
  "/users/me/pinned-teams",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const rows = await db
      .select({ teamId: userPinnedTeams.teamId })
      .from(userPinnedTeams)
      .where(eq(userPinnedTeams.userId, me.id))
      .orderBy(asc(userPinnedTeams.position), asc(userPinnedTeams.createdAt));
    res.json({ teamIds: rows.map((r) => r.teamId) });
  }),
);

router.put(
  "/users/me/pinned-teams",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    // The OpenAPI validator enforces the global `maxItems` + uuid shape before
    // the handler runs; de-dupe here so a repeated id can't waste a slot.
    const requested: string[] = Array.isArray(req.body?.teamIds)
      ? (req.body.teamIds as string[])
      : [];
    const deduped = requested.filter(
      (id, i) => requested.indexOf(id) === i,
    );
    // Defense-in-depth global safety cap (matches openapi `maxItems: 50`).
    if (deduped.length > 50) {
      return apiError(res, 400, "Too many pinned teams");
    }
    // Ignore non-existent team ids (they'd violate the FK and never render).
    // Fetch each team's org so we can enforce the per-org cap below.
    const existing =
      deduped.length > 0
        ? await db
            .select({ id: teams.id, organizationId: teams.organizationId })
            .from(teams)
            .where(inArray(teams.id, deduped))
        : [];
    const orgByTeamId = new Map(existing.map((r) => [r.id, r.organizationId]));
    const validIds = new Set(existing.map((r) => r.id));
    const finalIds = deduped.filter((id) => validIds.has(id));
    // Enforce max 5 pinned teams PER organization. Independent/solo teams
    // (no org) share a single "no-org" bucket, also capped at 5. Mirrors the
    // client-side per-org cap in usePinnedTeams.
    const perOrgCounts = new Map<string, number>();
    for (const id of finalIds) {
      const bucket = orgByTeamId.get(id) ?? "__independent__";
      const n = (perOrgCounts.get(bucket) ?? 0) + 1;
      if (n > 5) {
        return apiError(
          res,
          400,
          "You can pin up to 5 teams per organization",
        );
      }
      perOrgCounts.set(bucket, n);
    }
    await db.transaction(async (tx) => {
      await tx
        .delete(userPinnedTeams)
        .where(eq(userPinnedTeams.userId, me.id));
      if (finalIds.length > 0) {
        await tx.insert(userPinnedTeams).values(
          finalIds.map((teamId, position) => ({
            userId: me.id,
            teamId,
            position,
          })),
        );
      }
    });
    res.json({ teamIds: finalIds });
  }),
);

// ---------------------------------------------------------------------------
// Pinned orgs — the viewer's own personalization (max 5). Pinned orgs float
// to the top of the "Your Orgs and Teams" sidebar on the feed. Full-replace
// PUT mirrors the pinned-teams routes above; the submitted array order
// becomes the stored pin order.
// ---------------------------------------------------------------------------

router.get(
  "/users/me/pinned-orgs",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const rows = await db
      .select({ orgId: userPinnedOrgs.orgId })
      .from(userPinnedOrgs)
      .where(eq(userPinnedOrgs.userId, me.id))
      .orderBy(asc(userPinnedOrgs.position), asc(userPinnedOrgs.createdAt));
    res.json({ orgIds: rows.map((r) => r.orgId) });
  }),
);

router.put(
  "/users/me/pinned-orgs",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    // The OpenAPI validator enforces `maxItems: 5` + uuid shape before the
    // handler runs; de-dupe here so a repeated id can't waste a slot.
    const requested: string[] = Array.isArray(req.body?.orgIds)
      ? (req.body.orgIds as string[])
      : [];
    const deduped = requested.filter(
      (id, i) => requested.indexOf(id) === i,
    );
    // Defense-in-depth: the OpenAPI validator already caps this at 5, but
    // enforce here too in case the spec wiring ever changes.
    if (deduped.length > 5) {
      return apiError(res, 400, "You can pin up to 5 organizations");
    }
    // Ignore non-existent org ids (they'd violate the FK and never render).
    const existing =
      deduped.length > 0
        ? await db
            .select({ id: organizations.id })
            .from(organizations)
            .where(inArray(organizations.id, deduped))
        : [];
    const validIds = new Set(existing.map((r) => r.id));
    const finalIds = deduped.filter((id) => validIds.has(id));
    await db.transaction(async (tx) => {
      await tx
        .delete(userPinnedOrgs)
        .where(eq(userPinnedOrgs.userId, me.id));
      if (finalIds.length > 0) {
        await tx.insert(userPinnedOrgs).values(
          finalIds.map((orgId, position) => ({
            userId: me.id,
            orgId,
            position,
          })),
        );
      }
    });
    res.json({ orgIds: finalIds });
  }),
);

export default router;
