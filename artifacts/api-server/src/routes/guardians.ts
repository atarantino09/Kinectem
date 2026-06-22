import { Router, type IRouter } from "express";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateToken, hashToken } from "../lib/passwords";
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
import { apiError, safeAvatarUrl } from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostOwnerId,
  type PostStats,
  type StatsKind,
} from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap, TAG_NOTIF_THROTTLE_MS } from "../lib/article-tagging";
import { notifyExpiredGuardianConfirmations } from "../lib/guardian-confirmations";
import {
  backfillTeamFollowsForLinkedChild,
  cleanupTeamFollowsForUnlinkedChild,
} from "../lib/team-follow";
import { isGuardian } from "../lib/guardian-capability";
import { GUARDIAN_TOKEN_TTL_MS } from "./auth";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Parent / Guardian — children management
// ---------------------------------------------------------------------------

// Creates a notification on the parent's account for each linked child whose
// guardian-confirmation token has expired without being confirmed. Existing
// notifications for the same child are not duplicated.
router.get(
  "/users/me/children",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (await isGuardian(me.id)) {
      try {
        await notifyExpiredGuardianConfirmations(me.id);
      } catch (err) {
        logger.error(
          { err },
          "Failed to create guardian-expired notifications",
        );
      }
    }
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.parentId, me.id));
    res.json({
      data: rows.map((u) => {
        const [first, ...rest] = u.name.split(" ");
        let confirmationStatus: "none" | "confirmed" | "pending" | "expired" =
          "none";
        if (u.guardianEmail) {
          if (u.guardianConfirmedAt) {
            confirmationStatus = "confirmed";
          } else if (
            !u.guardianConfirmTokenExpiresAt ||
            u.guardianConfirmTokenExpiresAt.getTime() < Date.now()
          ) {
            confirmationStatus = "expired";
          } else {
            confirmationStatus = "pending";
          }
        }
        return {
          id: u.id,
          firstName: first ?? u.name,
          lastName: rest.join(" "),
          role: u.role,
          email: u.email ?? null,
          avatarUrl: safeAvatarUrl(u.avatarUrl),
          requireTagConsent: u.requireTagConsent,
          guardianEmail: u.guardianEmail ?? null,
          guardianConfirmedAt: u.guardianConfirmedAt
            ? u.guardianConfirmedAt.toISOString()
            : null,
          confirmationStatus,
          confirmedByMe:
            !!u.guardianConfirmedAt && u.guardianConfirmedByUserId === me.id,
        };
      }),
    });
  }),
);

router.post(
  "/users/me/children",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    // Guardian capability is derived from "this user has at least one
    // linked child", not from `role === "parent"`. Anyone — including a
    // coach, athlete-of-majority, or admin — can claim a child via this
    // endpoint; permission to link a *specific* child is governed by the
    // existing search-and-link logic below (the child must not already
    // be linked to a different guardian).
    const childId = String(req.body?.childId ?? "").trim();
    if (!childId) return apiError(res, 400, "childId required");
    const [child] = await db
      .select()
      .from(users)
      .where(eq(users.id, childId))
      .limit(1);
    if (!child) return apiError(res, 404, "User not found");
    if (child.parentId && child.parentId !== me.id) {
      return apiError(res, 409, "Already linked to another guardian");
    }
    const [updated] = await db
      .update(users)
      .set({ parentId: me.id })
      .where(eq(users.id, childId))
      .returning();
    // Surface every team this child is already on under the parent's
    // profile Teams section by auto-following each one. Best-effort.
    await backfillTeamFollowsForLinkedChild(me.id, updated.id);
    const [first, ...rest] = updated.name.split(" ");
    res.status(201).json({
      id: updated.id,
      firstName: first ?? updated.name,
      lastName: rest.join(" "),
      role: updated.role,
      email: updated.email ?? null,
      avatarUrl: safeAvatarUrl(updated.avatarUrl),
      requireTagConsent: updated.requireTagConsent,
    });
  }),
);

// Task #403 — symmetric undo for `POST /users/me/children`. Lets the
// currently-linked guardian (any role — link-derived capability) sever
// the parent↔child relationship by nulling `users.parentId`. We refuse
// to unlink a child the caller does not currently own so this can't be
// used to detach a child from someone else. Best-effort cleanup of the
// auto-followed teams created when the link was made; the parent can
// re-follow manually if any get removed in error.
router.delete(
  "/users/me/children/:childId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const childId = String(req.params.childId ?? "").trim();
    if (!childId) return apiError(res, 400, "childId required");
    const [child] = await db
      .select()
      .from(users)
      .where(eq(users.id, childId))
      .limit(1);
    if (!child) return apiError(res, 404, "Child not found");
    if (child.parentId !== me.id) {
      // Don't leak whether the child exists under another guardian —
      // 404 is consistent with the resend endpoint above.
      return apiError(res, 404, "Child not found");
    }
    await db
      .update(users)
      .set({ parentId: null })
      .where(eq(users.id, childId));
    await cleanupTeamFollowsForUnlinkedChild(me.id, childId);
    res.status(204).send();
  }),
);

router.post(
  "/users/me/children/:childId/resend-guardian-confirm",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [child] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.params.childId))
      .limit(1);
    if (!child || child.parentId !== me.id) {
      return apiError(res, 404, "Child not found");
    }
    if (!child.guardianEmail) {
      return apiError(res, 400, "This account does not require guardian confirmation.");
    }
    if (child.guardianConfirmedAt) {
      return apiError(res, 400, "This account has already been confirmed.");
    }
    const newToken = generateToken();
    await db
      .update(users)
      .set({
        guardianConfirmTokenHash: hashToken(newToken),
        guardianConfirmTokenExpiresAt: new Date(
          Date.now() + GUARDIAN_TOKEN_TTL_MS,
        ),
        guardianExpiredEmailSentAt: null,
      })
      .where(eq(users.id, child.id));
    // Code review S10 — the raw confirmation token is a secret that must be
    // delivered only over email; never return it in the API response.
    try {
      await sendGuardianConfirmationEmail(
        child.guardianEmail,
        child.name,
        newToken,
      );
    } catch (err) {
      logger.error(
        { err },
        "Failed to send guardian confirmation email (resend)",
      );
    }
    res.json({ ok: true, guardianEmail: child.guardianEmail });
  }),
);

export default router;
