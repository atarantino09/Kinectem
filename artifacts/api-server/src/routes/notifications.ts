import { Router, type IRouter } from "express";
import { db, users, notifications } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
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
import { toNotification, paginate, apiError } from "../lib/spec-helpers";
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
// Notifications
// ---------------------------------------------------------------------------

router.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json(paginate([]));
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, me.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    res.json(paginate(rows.map(toNotification)));
  }),
);

router.get(
  "/notifications/unread-count",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json({ unreadCount: 0 });
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, me.id), eq(notifications.read, false)));
    res.json({ unreadCount: count });
  }),
);

router.post(
  "/notifications/:notificationId/read",
  asyncHandler(async (req, res) => {
    await db
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, req.params.notificationId));
    res.status(204).end();
  }),
);

router.post(
  "/notifications/read-all",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json({ markedCount: 0 });
    const result = await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.userId, me.id), eq(notifications.read, false)))
      .returning({ id: notifications.id });
    res.json({ markedCount: result.length });
  }),
);

router.get(
  "/notifications/email-preference",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [row] = await db
      .select({ optOut: users.guardianExpiredEmailOptOut })
      .from(users)
      .where(eq(users.id, me.id))
      .limit(1);
    res.json({ emailOptOut: !!row?.optOut });
  }),
);

const updateEmailPreference = asyncHandler(async (req, res) => {
  const me = req.sessionUser;
  if (!me) return apiError(res, 401, "Not authenticated");
  if (typeof req.body?.emailOptOut !== "boolean") {
    return apiError(res, 400, "emailOptOut must be a boolean");
  }
  const optOut = req.body.emailOptOut;
  await db
    .update(users)
    .set({ guardianExpiredEmailOptOut: optOut })
    .where(eq(users.id, me.id));
  res.json({ emailOptOut: optOut });
});

router.patch("/notifications/email-preference", updateEmailPreference);
router.put("/notifications/email-preference", updateEmailPreference);

// ---------------------------------------------------------------------------
// Share-notification preference (task #190)
// ---------------------------------------------------------------------------
//
// Mirrors /notifications/email-preference: a single boolean stored
// on `users.shareNotificationsOptOut`. When true the share route
// suppresses the bell notification that would otherwise fire on a
// fresh re-share of one of the recipient's recaps or highlights.

router.get(
  "/notifications/share-preference",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [row] = await db
      .select({ optOut: users.shareNotificationsOptOut })
      .from(users)
      .where(eq(users.id, me.id))
      .limit(1);
    res.json({ shareOptOut: !!row?.optOut });
  }),
);

const updateSharePreference = asyncHandler(async (req, res) => {
  const me = req.sessionUser;
  if (!me) return apiError(res, 401, "Not authenticated");
  if (typeof req.body?.shareOptOut !== "boolean") {
    return apiError(res, 400, "shareOptOut must be a boolean");
  }
  const optOut = req.body.shareOptOut;
  await db
    .update(users)
    .set({ shareNotificationsOptOut: optOut })
    .where(eq(users.id, me.id));
  res.json({ shareOptOut: optOut });
});

router.patch("/notifications/share-preference", updateSharePreference);
router.put("/notifications/share-preference", updateSharePreference);

export default router;
