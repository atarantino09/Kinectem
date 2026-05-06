// Task #359 — COPPA Phase 1.
//
// Verifiable parental consent (FTC "email plus") routes:
//   GET  /auth/guardian-consent/:token         — fetch notice
//   POST /auth/guardian-consent/:token         — first step (notice + checkbox)
//   POST /auth/guardian-consent/:token/finalize — second step (email-plus)
//   POST /auth/guardian-revoke/:token          — one-click revoke
//
// Tokens are stored as sha256 hashes; the plaintext lives only in the
// emailed link. Each ceremony walks: pending_notice → pending_followup
// → finalized, with `revoked` reachable from any state.

import { Router, type IRouter } from "express";
import { db, users, parentalConsents, sessions, refreshTokens } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateToken } from "../lib/passwords";
import { apiError } from "../lib/spec-helpers";
import { logger } from "../lib/logger";
import { asyncHandler } from "../lib/async-handler";
import {
  CONSENT_NOTICE_VERSION,
  FOLLOWUP_DELAY_MS,
  FOLLOWUP_TOKEN_TTL_MS,
  clientIp,
  hashConsentToken,
  logConsentEvent,
} from "../lib/coppa";
import {
  sendParentalConsentFinalizedEmail,
  sendParentalConsentFollowupEmail,
} from "../lib/email";

const router: IRouter = Router();

async function loadByFirstToken(token: string) {
  const tokenHash = hashConsentToken(token);
  const [row] = await db
    .select({ consent: parentalConsents, child: users })
    .from(parentalConsents)
    .innerJoin(users, eq(parentalConsents.childUserId, users.id))
    .where(eq(parentalConsents.firstTokenHash, tokenHash))
    .limit(1);
  return row;
}

async function loadByFollowupToken(token: string) {
  const tokenHash = hashConsentToken(token);
  const [row] = await db
    .select({ consent: parentalConsents, child: users })
    .from(parentalConsents)
    .innerJoin(users, eq(parentalConsents.childUserId, users.id))
    .where(eq(parentalConsents.followupTokenHash, tokenHash))
    .limit(1);
  return row;
}

async function loadByRevokeToken(token: string) {
  const tokenHash = hashConsentToken(token);
  const [row] = await db
    .select({ consent: parentalConsents, child: users })
    .from(parentalConsents)
    .innerJoin(users, eq(parentalConsents.childUserId, users.id))
    .where(eq(parentalConsents.revokeTokenHash, tokenHash))
    .limit(1);
  return row;
}

// GET /auth/guardian-consent/:token — render the notice landing page.
router.get(
  "/auth/guardian-consent/:token",
  asyncHandler(async (req, res) => {
    const row = await loadByFirstToken(String(req.params.token));
    if (!row) {
      apiError(res, 404, "This consent link is invalid or has already been used.");
      return;
    }
    if (row.consent.state === "revoked") {
      apiError(res, 410, "Consent has been revoked.", { extras: { state: "revoked" } });
      return;
    }
    if (
      row.consent.firstTokenExpiresAt &&
      row.consent.firstTokenExpiresAt.getTime() < Date.now()
    ) {
      apiError(res, 410, "This consent link has expired.", { extras: { state: "expired" } });
      return;
    }
    void logConsentEvent({
      event: "guardian_notice_viewed",
      childUserId: row.child.id,
      consentId: row.consent.id,
      actorEmail: row.consent.guardianEmail,
      actorIp: clientIp(req),
    });
    res.json({
      athleteName: row.child.name,
      guardianEmail: row.consent.guardianEmail,
      noticeVersion: row.consent.noticeVersion,
      noticeText: row.consent.noticeText,
      state: row.consent.state,
    });
  }),
);

// POST /auth/guardian-consent/:token — guardian ticks the box.
router.post(
  "/auth/guardian-consent/:token",
  asyncHandler(async (req, res) => {
    const agreed = req.body?.agreed === true;
    const noticeVersion = String(req.body?.noticeVersion ?? "");
    if (!agreed) {
      apiError(res, 400, "You must agree to the notice to continue.");
      return;
    }
    const row = await loadByFirstToken(String(req.params.token));
    if (!row) {
      apiError(res, 404, "This consent link is invalid or has already been used.");
      return;
    }
    if (row.consent.state === "revoked") {
      apiError(res, 410, "Consent has been revoked.");
      return;
    }
    if (noticeVersion !== row.consent.noticeVersion) {
      apiError(
        res,
        400,
        "The consent notice has been updated. Please reload this page to see the current version.",
      );
      return;
    }
    if (
      row.consent.firstTokenExpiresAt &&
      row.consent.firstTokenExpiresAt.getTime() < Date.now()
    ) {
      apiError(res, 410, "This consent link has expired.");
      return;
    }

    const followup = generateToken();
    const followupHash = hashConsentToken(followup);
    const followupExpires = new Date(Date.now() + FOLLOWUP_TOKEN_TTL_MS);

    await db
      .update(parentalConsents)
      .set({
        state: "pending_followup",
        firstTokenHash: null,
        firstConsentAt: new Date(),
        firstConsentIp: clientIp(req),
        followupTokenHash: followupHash,
        followupTokenExpiresAt: followupExpires,
      })
      .where(eq(parentalConsents.id, row.consent.id));

    void logConsentEvent({
      event: "guardian_first_consent",
      childUserId: row.child.id,
      consentId: row.consent.id,
      actorEmail: row.consent.guardianEmail,
      actorIp: clientIp(req),
    });

    // Schedule the follow-up email after the FTC "email plus" delay.
    // The in-process timer below is just the happy-path optimization
    // for "process stays up between step one and step two"; the
    // durable backstop is `startConsentScheduler` (lib/consent-scheduler.ts),
    // which runs an interval sweep against the DB and delivers any
    // pending_followup row whose timer was lost across a restart.
    // We update `followup_sent_at` only after delivery so a crashed
    // process doesn't leave the row claiming we sent something we didn't.
    setTimeout(() => {
      void (async () => {
        try {
          await sendParentalConsentFollowupEmail(
            row.consent.guardianEmail,
            row.child.name,
            followup,
          );
          await db
            .update(parentalConsents)
            .set({ followupSentAt: new Date() })
            .where(eq(parentalConsents.id, row.consent.id));
          void logConsentEvent({
            event: "guardian_followup_sent",
            childUserId: row.child.id,
            consentId: row.consent.id,
            actorEmail: row.consent.guardianEmail,
          });
        } catch (err) {
          logger.error({ err }, "Failed to send guardian followup email");
        }
      })();
    }, FOLLOWUP_DELAY_MS).unref?.();

    res.json({
      ok: true,
      guardianEmail: row.consent.guardianEmail,
      athleteName: row.child.name,
    });
  }),
);

// POST /auth/guardian-consent/:token/finalize — second-click.
router.post(
  "/auth/guardian-consent/:token/finalize",
  asyncHandler(async (req, res) => {
    const row = await loadByFollowupToken(String(req.params.token));
    if (!row) {
      apiError(res, 404, "This confirmation link is invalid or has already been used.");
      return;
    }
    if (row.consent.state === "revoked") {
      apiError(res, 410, "Consent has been revoked.");
      return;
    }
    if (
      row.consent.followupTokenExpiresAt &&
      row.consent.followupTokenExpiresAt.getTime() < Date.now()
    ) {
      apiError(res, 410, "This confirmation link has expired.");
      return;
    }
    const revokeToken = generateToken();
    const revokeHash = hashConsentToken(revokeToken);

    // Try to link to a real guardian user account if one exists for that
    // email — useful for the Family page revoke control.
    const [guardianUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, row.consent.guardianEmail))
      .limit(1);

    const now = new Date();
    await db
      .update(parentalConsents)
      .set({
        state: "finalized",
        followupTokenHash: null,
        finalizedAt: now,
        finalizedIp: clientIp(req),
        revokeTokenHash: revokeHash,
        guardianUserId: guardianUser?.id ?? null,
      })
      .where(eq(parentalConsents.id, row.consent.id));
    await db
      .update(users)
      .set({
        accountStatus: "active",
        consentFinalizedAt: now,
        guardianConfirmedAt: now,
        guardianConfirmTokenHash: null,
        guardianConfirmTokenExpiresAt: null,
        // If the guardian's email matches a real user, link parentId so
        // existing Family-page UI sees the relationship immediately.
        ...(guardianUser ? { parentId: guardianUser.id } : {}),
      })
      .where(eq(users.id, row.child.id));

    try {
      await sendParentalConsentFinalizedEmail(
        row.consent.guardianEmail,
        row.child.name,
        revokeToken,
      );
    } catch (err) {
      logger.error({ err }, "Failed to send finalized confirmation email");
    }
    void logConsentEvent({
      event: "guardian_finalized",
      childUserId: row.child.id,
      consentId: row.consent.id,
      actorEmail: row.consent.guardianEmail,
      actorIp: clientIp(req),
    });

    res.json({ ok: true, athleteName: row.child.name });
  }),
);

// POST /auth/guardian-revoke/:token — one-click revoke. Idempotent.
router.post(
  "/auth/guardian-revoke/:token",
  asyncHandler(async (req, res) => {
    const row = await loadByRevokeToken(String(req.params.token));
    if (!row) {
      apiError(res, 404, "This revoke link is invalid.");
      return;
    }
    if (row.consent.state === "revoked") {
      // Idempotent — already revoked is success.
      res.json({ ok: true, athleteName: row.child.name });
      return;
    }
    const now = new Date();
    // 30-day grace period before any data purge. The schedule lives on
    // the user row; an out-of-band worker (tracked as a follow-up) is
    // what actually deletes posts/highlights/messages, so a human can
    // intercept incorrect revocations during the window.
    const GRACE_DAYS = 30;
    const deletionScheduledAt = new Date(
      now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000,
    );
    await db
      .update(parentalConsents)
      .set({ state: "revoked", revokedAt: now })
      .where(eq(parentalConsents.id, row.consent.id));
    await db
      .update(users)
      .set({
        accountStatus: "disabled",
        consentRevokedAt: now,
        deletionScheduledAt,
      })
      .where(eq(users.id, row.child.id));
    // Task #359 — revocation must lock the child out immediately. Drop
    // every active cookie session and refresh token so existing devices
    // can't keep authenticating until natural expiry.
    await db.delete(sessions).where(eq(sessions.userId, row.child.id));
    await db
      .delete(refreshTokens)
      .where(eq(refreshTokens.userId, row.child.id));
    void logConsentEvent({
      event: "guardian_revoked",
      childUserId: row.child.id,
      consentId: row.consent.id,
      actorEmail: row.consent.guardianEmail,
      actorIp: clientIp(req),
    });
    void logConsentEvent({
      event: "deletion_scheduled",
      childUserId: row.child.id,
      consentId: row.consent.id,
      actorEmail: row.consent.guardianEmail,
      actorIp: clientIp(req),
      details: `scheduled_for=${deletionScheduledAt.toISOString()}`,
    });
    res.json({
      ok: true,
      athleteName: row.child.name,
      deletionScheduledAt: deletionScheduledAt.toISOString(),
    });
  }),
);

export default router;
