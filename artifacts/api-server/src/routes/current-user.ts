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

export default router;
