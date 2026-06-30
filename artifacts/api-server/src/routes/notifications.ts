import { Router, type IRouter } from "express";
import { db, users, notifications } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import { sendGuardianConfirmationEmail, sendGuardianExpiredEmail, sendPasswordResetEmail, appBaseUrl } from "../lib/email";
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
import {
  getOrCreatePreferences,
  serializePreferences,
  updatePreferences,
  applyUnsubscribe,
  isEmailCategory,
} from "../lib/notification-prefs";

const router: IRouter = Router();

const ONE_HOUR_MS = 60 * 60 * 1000;

// Public, no-login unsubscribe links embedded in every gated email are an
// unauthenticated endpoint, so throttle per-IP to blunt token-guessing /
// abuse. Tokens are 256-bit random so guessing is already impractical.
const unsubscribeLimiter = rateLimit({
  name: "notifications-unsubscribe",
  windowMs: ONE_HOUR_MS,
  max: 60,
  keys: (req) => [ipKey(req)],
  message: "Too many requests. Please try again later.",
});

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

// ---------------------------------------------------------------------------
// Per-category email notification preferences (task #633)
// ---------------------------------------------------------------------------
//
// The Settings page reads/writes the full set of toggles + the master pause.
// Rows are lazily created (and the unsubscribe token minted) on first read.

router.get(
  "/notifications/preferences",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const prefs = await getOrCreatePreferences(me.id);
    res.json(serializePreferences(prefs));
  }),
);

const updateNotificationPreferences = asyncHandler(async (req, res) => {
  const me = req.sessionUser;
  if (!me) return apiError(res, 401, "Not authenticated");
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(res, 400, "Request body must be an object");
  }
  const result = await updatePreferences(me.id, body as Record<string, unknown>);
  if ("error" in result) return apiError(res, 400, result.error);
  res.json(serializePreferences(result));
});

router.patch("/notifications/preferences", updateNotificationPreferences);
router.put("/notifications/preferences", updateNotificationPreferences);

// ---------------------------------------------------------------------------
// Public no-login unsubscribe (task #633)
// ---------------------------------------------------------------------------
//
// Every gated email carries `/notifications/unsubscribe?token=<t>&cat=<c>`.
// `cat=all` (or missing) trips the master pause; a specific category turns
// just that one off. Always returns a small self-contained HTML page (200)
// so the link works without auth and never leaks whether a token was valid.

function unsubscribePage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${title} — Kinectem</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f7f7f8;color:#1a1a1a;margin:0;padding:0}
  .card{max-width:480px;margin:10vh auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
  h1{font-size:20px;margin:0 0 12px}
  p{font-size:15px;line-height:1.5;color:#444;margin:0 0 8px}
  a{color:#2563eb;text-decoration:none}
</style></head><body><div class="card"><h1>${title}</h1>${body}</div></body></html>`;
}

router.get(
  "/notifications/unsubscribe",
  unsubscribeLimiter,
  asyncHandler(async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const rawCat = typeof req.query.cat === "string" ? req.query.cat : "all";
    const category =
      rawCat === "all" || !rawCat
        ? "all"
        : isEmailCategory(rawCat)
          ? rawCat
          : null;

    res.set("Content-Type", "text/html; charset=utf-8");

    if (!token || category === null) {
      return res
        .status(400)
        .send(
          unsubscribePage(
            "Invalid link",
            `<p>This unsubscribe link is invalid or incomplete.</p>
<p>You can manage all your email preferences in <a href="${appBaseUrl()}/settings">Settings</a>.</p>`,
          ),
        );
    }

    // Best-effort: a non-matching token still returns a friendly 200 so we
    // never confirm whether a token exists.
    await applyUnsubscribe(token, category);

    const what =
      category === "all"
        ? "all non-essential emails"
        : "these emails";
    return res.status(200).send(
      unsubscribePage(
        "You're unsubscribed",
        `<p>You've been unsubscribed from ${what}. It may take a moment to take effect.</p>
<p>You can re-enable or fine-tune anything in <a href="${appBaseUrl()}/settings">Settings</a>.</p>
<p>Note: essential account emails (security, consent) are always sent.</p>`,
      ),
    );
  }),
);

export default router;
