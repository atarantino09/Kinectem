// Durable "event starts in ~24h" reminder sweep.
//
// Mirrors game-recap-reminder-scheduler.ts: rather than per-event in-process
// timers (lost on restart), we run a DB-backed sweep at startup and hourly.
//
// An event is "due" for a 24h reminder when:
//   • status is still `scheduled` (not canceled/postponed/completed)
//   • it starts within the next ~24h and is still in the future
//   • the reminder hasn't been sent yet (`reminder_24h_sent_at IS NULL`)
//
// We atomically stamp `reminder_24h_sent_at` (WHERE ... IS NULL RETURNING)
// before fanning out, so a concurrent sweep on another Autoscale instance
// can't double-send. If the fan-out throws after the claim, we release the
// stamp so a later sweep retries.

import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { db, scheduleEvents, teams } from "@workspace/db";
import { logger } from "./logger";
import { notifyTeamOfScheduleReminder } from "./schedule-notifications";

const WINDOW_MS = 24 * 60 * 60 * 1000; // remind for events starting within 24h
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

const inflight = new Set<string>();

async function sweepOnce(): Promise<void> {
  const now = new Date();
  const horizon = new Date(now.getTime() + WINDOW_MS);

  const due = await db
    .select({
      id: scheduleEvents.id,
      teamId: scheduleEvents.teamId,
      teamName: teams.name,
      eventType: scheduleEvents.eventType,
      opponent: scheduleEvents.opponent,
      locationName: scheduleEvents.locationName,
      startAt: scheduleEvents.startAt,
      allDay: scheduleEvents.allDay,
    })
    .from(scheduleEvents)
    .innerJoin(teams, eq(scheduleEvents.teamId, teams.id))
    .where(
      and(
        eq(scheduleEvents.status, "scheduled"),
        isNull(scheduleEvents.reminder24hSentAt),
        gt(scheduleEvents.startAt, now),
        lte(scheduleEvents.startAt, horizon),
      ),
    )
    .limit(100);

  for (const row of due) {
    if (inflight.has(row.id)) continue;
    inflight.add(row.id);
    try {
      // Claim the row first; the predicate re-checks the mutable conditions so
      // an event canceled between SELECT and now matches zero rows and is
      // skipped (no stale reminder).
      const claimed = await db
        .update(scheduleEvents)
        .set({ reminder24hSentAt: new Date() })
        .where(
          and(
            eq(scheduleEvents.id, row.id),
            isNull(scheduleEvents.reminder24hSentAt),
            eq(scheduleEvents.status, "scheduled"),
          ),
        )
        .returning({ id: scheduleEvents.id });
      if (claimed.length === 0) continue;

      try {
        const sent = await notifyTeamOfScheduleReminder({
          teamId: row.teamId,
          teamName: row.teamName,
          eventType: row.eventType,
          opponent: row.opponent,
          locationName: row.locationName,
          startAt: new Date(row.startAt),
          allDay: row.allDay,
        });
        logger.info(
          { eventId: row.id, recipients: sent },
          "schedule-reminder: reminder dispatched",
        );
      } catch (sendErr) {
        // Release the claim so a later sweep retries rather than dropping it.
        await db
          .update(scheduleEvents)
          .set({ reminder24hSentAt: null })
          .where(eq(scheduleEvents.id, row.id));
        throw sendErr;
      }
    } catch (err) {
      logger.error(
        { err, eventId: row.id },
        "schedule-reminder: failed to dispatch reminder",
      );
    } finally {
      inflight.delete(row.id);
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startScheduleReminderScheduler(): void {
  if (timer) return;
  void sweepOnce().catch((err) =>
    logger.error({ err }, "schedule-reminder: initial sweep failed"),
  );
  timer = setInterval(() => {
    void sweepOnce().catch((err) =>
      logger.error({ err }, "schedule-reminder: sweep failed"),
    );
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}
