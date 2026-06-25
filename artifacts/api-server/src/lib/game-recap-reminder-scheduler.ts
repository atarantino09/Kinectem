// Durable "write your game recap" reminder sweep.
//
// A couple hours after a game (or scrimmage) starts, the team's recap-writing
// staff should be nudged to write the recap while it's still fresh. Rather
// than scheduling a per-event in-process timer (which is lost on restart), we
// run a DB-backed sweep at startup and on an interval, mirroring
// `consent-scheduler.ts`.
//
// A game is "due" for a reminder when:
//   • event_type is game-family (game | scrimmage) — the same set that shows
//     the "Write game recap" prompt on the event detail
//   • it is not all-day (an all-day game has no meaningful start time)
//   • status is still `scheduled` (not canceled/postponed/completed)
//   • no recap is linked yet (`game_recap_id IS NULL`)
//   • the reminder hasn't been sent yet (`recap_reminder_sent_at IS NULL`)
//   • the reminder delay has elapsed since `start_at`
//   • the game started within the lookback window — so first-deploy doesn't
//     blast reminders for long-finished historical games
//
// We atomically stamp `recap_reminder_sent_at` (WHERE ... IS NULL RETURNING)
// before fanning out, so a concurrent sweep on another Autoscale instance
// can't double-notify. An in-process Set dedupes rows already in flight in
// the current tick.

import { and, eq, gte, isNull, lte, inArray } from "drizzle-orm";
import { db, scheduleEvents, teams } from "@workspace/db";
import { logger } from "./logger";
import { notifyStaffOfGameRecapReminder } from "./notifications";

const REMINDER_DELAY_MS = 2 * 60 * 60 * 1000; // ~2 hours after start
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // ignore games older than a week
const SWEEP_INTERVAL_MS = 5 * 60_000; // every 5 minutes
const GAME_TYPES = ["game", "scrimmage"] as const;

const inflight = new Set<string>();

async function sweepOnce(): Promise<void> {
  const now = Date.now();
  const dueBefore = new Date(now - REMINDER_DELAY_MS);
  const floor = new Date(now - LOOKBACK_MS);

  const due = await db
    .select({
      id: scheduleEvents.id,
      teamId: scheduleEvents.teamId,
      organizationId: scheduleEvents.organizationId,
      opponent: scheduleEvents.opponent,
      teamName: teams.name,
    })
    .from(scheduleEvents)
    .innerJoin(teams, eq(scheduleEvents.teamId, teams.id))
    .where(
      and(
        inArray(scheduleEvents.eventType, [...GAME_TYPES]),
        eq(scheduleEvents.allDay, false),
        eq(scheduleEvents.status, "scheduled"),
        isNull(scheduleEvents.gameRecapId),
        isNull(scheduleEvents.recapReminderSentAt),
        lte(scheduleEvents.startAt, dueBefore),
        gte(scheduleEvents.startAt, floor),
      ),
    )
    .limit(50);

  for (const row of due) {
    if (inflight.has(row.id)) continue;
    inflight.add(row.id);
    try {
      // Claim the row first so a concurrent sweep (another Autoscale
      // instance) can't also send. The predicate re-checks the mutable
      // conditions — if a recap was linked or the game was canceled
      // between the SELECT above and now, the UPDATE matches zero rows and
      // we skip, so we never send a stale reminder.
      const claimed = await db
        .update(scheduleEvents)
        .set({ recapReminderSentAt: new Date() })
        .where(
          and(
            eq(scheduleEvents.id, row.id),
            isNull(scheduleEvents.recapReminderSentAt),
            isNull(scheduleEvents.gameRecapId),
            eq(scheduleEvents.status, "scheduled"),
          ),
        )
        .returning({ id: scheduleEvents.id });
      if (claimed.length === 0) continue;

      try {
        const sent = await notifyStaffOfGameRecapReminder({
          teamId: row.teamId,
          organizationId: row.organizationId,
          teamName: row.teamName,
          opponent: row.opponent,
          eventId: row.id,
        });
        logger.info(
          { eventId: row.id, recipients: sent },
          "game-recap-reminder: reminder dispatched",
        );
      } catch (sendErr) {
        // The fan-out failed after we claimed the row. Release the claim so
        // a later sweep retries rather than silently dropping the reminder.
        await db
          .update(scheduleEvents)
          .set({ recapReminderSentAt: null })
          .where(eq(scheduleEvents.id, row.id));
        throw sendErr;
      }
    } catch (err) {
      logger.error(
        { err, eventId: row.id },
        "game-recap-reminder: failed to dispatch reminder",
      );
    } finally {
      inflight.delete(row.id);
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startGameRecapReminderScheduler(): void {
  if (timer) return;
  void sweepOnce().catch((err) =>
    logger.error({ err }, "game-recap-reminder: initial sweep failed"),
  );
  timer = setInterval(() => {
    void sweepOnce().catch((err) =>
      logger.error({ err }, "game-recap-reminder: sweep failed"),
    );
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}
