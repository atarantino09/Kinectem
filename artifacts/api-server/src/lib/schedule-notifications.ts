// Phase 2 — Team Schedule email fan-out (reminders + change notices).
//
// Recipient model (per the spec): a team's rostered members + their parents +
// that team's coaches. COPPA routing is enforced here: for an athlete under 13
// the email goes to the PARENT on file ONLY, never the child. For 13+ we email
// the athlete AND their parent (if linked). Coaches are emailed directly.
//
// Emails carry the location NAME only (never the full address) and a link into
// the team's Schedule tab. Date/time is formatted in UTC with an explicit zone
// label because events are stored as instants and we have no per-team timezone.

import { db, rosterEntries } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  buildScheduleReminderMessage,
  buildScheduleChangeMessage,
} from "./email";
import { dispatchNotificationEmailToMany } from "./notification-email";

export interface ScheduleEmailEventInfo {
  teamId: string;
  teamName: string | null;
  eventType: string;
  opponent: string | null;
  locationName: string | null;
  startAt: Date;
  allDay: boolean;
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  practice: "Practice",
  game: "Game",
  scrimmage: "Scrimmage",
  tournament: "Tournament",
  other: "Event",
};

// "Game vs Tigers" / "Practice" / "Tournament".
function whatLabel(info: ScheduleEmailEventInfo): string {
  const base = EVENT_TYPE_LABEL[info.eventType] ?? "Event";
  if (
    (info.eventType === "game" || info.eventType === "scrimmage") &&
    info.opponent?.trim()
  ) {
    return `${base} vs ${info.opponent.trim()}`;
  }
  return base;
}

function whenText(info: ScheduleEmailEventInfo): string {
  if (info.allDay) {
    return (
      new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(info.startAt) + " (all day)"
    );
  }
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(info.startAt);
}

// Resolve the deduped accepted-roster user IDs for a team. The central email
// dispatch gate (notification-email.ts) handles COPPA routing per recipient —
// any minor (under-13 OR 13-17) is routed to their linked guardian, never the
// child — and applies each recipient's `reminder_schedule` preference. This
// is intentionally more conservative than the old age-split: a minor athlete
// no longer receives the schedule email directly; the guardian does.
export async function resolveTeamScheduleRecipientUserIds(
  teamId: string,
): Promise<string[]> {
  const roster = await db
    .select({ userId: rosterEntries.userId })
    .from(rosterEntries)
    .where(
      and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.status, "accepted")),
    );
  return Array.from(new Set(roster.map((r) => r.userId)));
}

// Fan out the ~24h reminder. Returns the number of target users dispatched
// (before per-recipient preference/COPPA filtering inside the gate).
export async function notifyTeamOfScheduleReminder(
  info: ScheduleEmailEventInfo,
): Promise<number> {
  const userIds = await resolveTeamScheduleRecipientUserIds(info.teamId);
  if (userIds.length === 0) return 0;
  const ev = {
    teamId: info.teamId,
    teamName: info.teamName,
    whatLabel: whatLabel(info),
    whenText: whenText(info),
    locationName: info.locationName,
  };
  await dispatchNotificationEmailToMany({
    userIds,
    category: "reminder_schedule",
    build: (ctx) => buildScheduleReminderMessage(ctx, ev),
  });
  return userIds.length;
}

// Fan out an immediate cancel/postpone change notice.
export async function notifyTeamOfScheduleChange(
  info: ScheduleEmailEventInfo & {
    status: "canceled" | "postponed";
    reason: string | null;
  },
): Promise<number> {
  const userIds = await resolveTeamScheduleRecipientUserIds(info.teamId);
  if (userIds.length === 0) return 0;
  const ev = {
    teamId: info.teamId,
    teamName: info.teamName,
    whatLabel: whatLabel(info),
    whenText: whenText(info),
    locationName: info.locationName,
    status: info.status,
    reason: info.reason,
  };
  await dispatchNotificationEmailToMany({
    userIds,
    category: "reminder_schedule",
    build: (ctx) => buildScheduleChangeMessage(ctx, ev),
  });
  return userIds.length;
}
