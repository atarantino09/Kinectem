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

import { db, rosterEntries, users } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { isUnder13 } from "./coppa";
import { logger } from "./logger";
import {
  sendScheduleReminderEmail,
  sendScheduleChangeNoticeEmail,
} from "./email";

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

// Resolve the deduped recipient email list for a team, applying COPPA routing.
// Deduped case-insensitively, preserving the first-seen original casing.
export async function resolveTeamScheduleRecipientEmails(
  teamId: string,
): Promise<string[]> {
  const roster = await db
    .select({ userId: rosterEntries.userId, role: rosterEntries.role })
    .from(rosterEntries)
    .where(
      and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.status, "accepted")),
    );
  if (roster.length === 0) return [];

  const userIds = Array.from(new Set(roster.map((r) => r.userId)));
  const rosterUsers = await db
    .select({
      id: users.id,
      email: users.email,
      dateOfBirth: users.dateOfBirth,
      parentId: users.parentId,
    })
    .from(users)
    .where(inArray(users.id, userIds));

  const parentIds = Array.from(
    new Set(
      rosterUsers
        .map((u) => u.parentId)
        .filter((p): p is string => Boolean(p)),
    ),
  );
  const parents = parentIds.length
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.id, parentIds))
    : [];
  const parentEmailById = new Map(parents.map((p) => [p.id, p.email]));
  // A user can have multiple roster rows; prefer the coach role if present.
  const isCoach = new Set(
    roster.filter((r) => r.role === "coach").map((r) => r.userId),
  );

  // Case-insensitive dedupe, keep first-seen casing.
  const out = new Map<string, string>();
  const add = (email: string | null | undefined) => {
    const trimmed = email?.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!out.has(key)) out.set(key, trimmed);
  };

  for (const u of rosterUsers) {
    const parentEmail = u.parentId
      ? (parentEmailById.get(u.parentId) ?? null)
      : null;
    if (isCoach.has(u.id)) {
      add(u.email);
      continue;
    }
    const dobIso = u.dateOfBirth
      ? new Date(u.dateOfBirth).toISOString().slice(0, 10)
      : null;
    if (isUnder13(dobIso)) {
      // COPPA — parent only, never the child.
      add(parentEmail);
    } else {
      add(u.email);
      add(parentEmail);
    }
  }
  return Array.from(out.values());
}

// Fan out the ~24h reminder. Returns the number of recipients emailed.
export async function notifyTeamOfScheduleReminder(
  info: ScheduleEmailEventInfo,
): Promise<number> {
  const recipients = await resolveTeamScheduleRecipientEmails(info.teamId);
  if (recipients.length === 0) return 0;
  const ev = {
    teamId: info.teamId,
    teamName: info.teamName,
    whatLabel: whatLabel(info),
    whenText: whenText(info),
    locationName: info.locationName,
  };
  const results = await Promise.allSettled(
    recipients.map((to) => sendScheduleReminderEmail(to, ev)),
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    logger.warn(
      { teamId: info.teamId, failed, total: recipients.length },
      "schedule-reminder: some reminder emails failed",
    );
  }
  return recipients.length;
}

// Fan out an immediate cancel/postpone change notice.
export async function notifyTeamOfScheduleChange(
  info: ScheduleEmailEventInfo & {
    status: "canceled" | "postponed";
    reason: string | null;
  },
): Promise<number> {
  const recipients = await resolveTeamScheduleRecipientEmails(info.teamId);
  if (recipients.length === 0) return 0;
  const ev = {
    teamId: info.teamId,
    teamName: info.teamName,
    whatLabel: whatLabel(info),
    whenText: whenText(info),
    locationName: info.locationName,
    status: info.status,
    reason: info.reason,
  };
  const results = await Promise.allSettled(
    recipients.map((to) => sendScheduleChangeNoticeEmail(to, ev)),
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    logger.warn(
      { teamId: info.teamId, failed, total: recipients.length },
      "schedule-change-notice: some change-notice emails failed",
    );
  }
  return recipients.length;
}
