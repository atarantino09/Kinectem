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
  toPublicUser,
  toPrivateUser,
  displayName,
  toOrganization,
  toMember,
  toTeam,
  toTeamMember,
  toInvite,
  toNotification,
  articleToPost,
  highlightToPost,
  orgPostToPost,
  paginate,
  emptyPagination,
  splitName,
  parsePostId,
  articlePostId,
  highlightPostId,
  toComment,
  toConversation,
  toMessage,
  toAssetResponse,
  toJoinRequest,
  apiError,
  ErrorCodes,
  safeAvatarUrl,
  MAX_AVATAR_DATA_URL_LENGTH,
  notFound,
} from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostOwnerId,
  type PostStats,
  type StatsKind,
} from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap, TAG_NOTIF_THROTTLE_MS } from "../lib/article-tagging";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Masquerade visibility for the current viewer (web client uses this to
// render the masquerade banner).
// ---------------------------------------------------------------------------

router.get(
  "/auth/whoami",
  asyncHandler((req, res) => {
    const session = req.sessionUser;
    const real = req.realUser;
    if (!real) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      isMasquerading: !!req.isMasquerading,
      realUser: {
        id: real.id,
        name: real.name,
        email: real.email,
        role: real.role,
      },
      viewingAs:
        req.isMasquerading && session
          ? {
              id: session.id,
              name: session.name,
              email: session.email,
              role: session.role,
            }
          : null,
    });
  }),
);

export default router;
