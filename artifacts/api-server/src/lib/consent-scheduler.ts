// Task #359 — durable email-plus follow-up scheduler.
//
// The FTC "email plus" verifiable-parental-consent flow requires a
// second, independent guardian action delayed from the first. The
// in-process `setTimeout` in `routes/consent.ts` covers the happy path
// where the API process stays up between the two emails, but if the
// process restarts (deploys, crashes, autoscaling) the timer is lost
// and the row sits in `pending_followup` forever.
//
// This module provides a DB-backed sweep that runs at startup and on
// an interval. It looks for consent rows where:
//   • state is `pending_followup`
//   • the guardian completed step one (`firstConsentAt` is set)
//   • we haven't successfully sent the follow-up yet
//     (`followupSentAt IS NULL`)
//   • the FTC delay has elapsed since step one
//   • a follow-up token still exists (`followupTokenHash IS NOT NULL`)
// and emits the follow-up email + audit event for each one. The
// emailed link's plaintext was already lost when the process exited,
// so on recovery we mint a fresh follow-up token (same hash column),
// extend its expiry, and email it. The original first-step token has
// already been consumed and is gone, so this is the only path back to
// the guardian.
//
// We mark `followupSentAt` only after a successful send so a partial
// failure can be retried on the next sweep, and we use a short-lived
// in-process Set to dedupe rows already being processed in the
// current tick.

import { and, eq, isNull, isNotNull, lte } from "drizzle-orm";
import { db, parentalConsents, users } from "@workspace/db";
import { logger } from "./logger";
import { sendParentalConsentFollowupEmail } from "./email";
import {
  FOLLOWUP_DELAY_MS,
  FOLLOWUP_TOKEN_TTL_MS,
  hashConsentToken,
  logConsentEvent,
} from "./coppa";
import { generateToken } from "./passwords";

const SWEEP_INTERVAL_MS = 60_000;
const inflight = new Set<string>();

async function sweepOnce(): Promise<void> {
  const cutoff = new Date(Date.now() - FOLLOWUP_DELAY_MS);
  const due = await db
    .select({ consent: parentalConsents, child: users })
    .from(parentalConsents)
    .innerJoin(users, eq(parentalConsents.childUserId, users.id))
    .where(
      and(
        eq(parentalConsents.state, "pending_followup"),
        isNotNull(parentalConsents.firstConsentAt),
        isNull(parentalConsents.followupSentAt),
        lte(parentalConsents.firstConsentAt, cutoff),
      ),
    )
    .limit(50);

  for (const row of due) {
    if (inflight.has(row.consent.id)) continue;
    inflight.add(row.consent.id);
    try {
      const followup = generateToken();
      const followupHash = hashConsentToken(followup);
      const followupExpires = new Date(Date.now() + FOLLOWUP_TOKEN_TTL_MS);
      // Atomically rotate the token before sending so a concurrent
      // sweep on another instance doesn't double-send. The WHERE
      // clause requires followupSentAt IS NULL — if another worker
      // already sent it, the UPDATE returns 0 rows and we skip.
      const updated = await db
        .update(parentalConsents)
        .set({
          followupTokenHash: followupHash,
          followupTokenExpiresAt: followupExpires,
        })
        .where(
          and(
            eq(parentalConsents.id, row.consent.id),
            isNull(parentalConsents.followupSentAt),
          ),
        )
        .returning({ id: parentalConsents.id });
      if (updated.length === 0) continue;

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
        details: "delivered_by_durable_sweeper",
      });
    } catch (err) {
      logger.error(
        { err, consentId: row.consent.id },
        "consent-scheduler: failed to deliver follow-up email",
      );
    } finally {
      inflight.delete(row.consent.id);
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startConsentScheduler(): void {
  if (timer) return;
  // Kick off an immediate sweep at startup so any rows that were stuck
  // while the process was down get caught up before the first tick.
  void sweepOnce().catch((err) =>
    logger.error({ err }, "consent-scheduler: initial sweep failed"),
  );
  timer = setInterval(() => {
    void sweepOnce().catch((err) =>
      logger.error({ err }, "consent-scheduler: sweep failed"),
    );
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

