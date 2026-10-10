// Task #633 — Per-user email notification preferences.
//
// One row per user, lazily created on first read (which mints the
// unsubscribe token). Every category defaults to ON; `pauseAll` is the
// master "pause all non-essential email" switch. Essential/transactional
// emails (password reset, guardian/parental consent, guardian-confirm) are
// NOT represented here — they bypass preferences entirely.

import { db, notificationPreferences } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { generateToken } from "./passwords";
import { competitionRecapEmailEnabled } from "@workspace/competition-recap-alerts";

// The toggleable email categories. Each maps 1:1 to a boolean column on
// notification_preferences (and to a camelCase row field via FIELD_BY_CATEGORY).
export const EMAIL_CATEGORIES = [
  "social_follow",
  "social_comment",
  "social_reaction",
  "social_tag",
  "team_recap",
  "team_roster",
  "team_broadcast",
  "reminder_schedule",
  "reminder_game_recap",
  "digest_weekly",
  "motivational",
] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number] | "competition_recap";

export function isEmailCategory(value: string): value is EmailCategory {
  return value === "competition_recap" || (EMAIL_CATEGORIES as readonly string[]).includes(value);
}

export type NotificationPreferencesRow =
  typeof notificationPreferences.$inferSelect;

// Boolean row fields that the Settings UI / preferences API may read/write.
// Excludes the master `pauseAll` (handled separately) and the token/timestamps.
type CategoryField =
  | "socialFollow"
  | "socialComment"
  | "socialReaction"
  | "socialTag"
  | "teamRecap"
  | "teamRoster"
  | "teamBroadcast"
  | "reminderSchedule"
  | "reminderGameRecap"
  | "digestWeekly"
  | "motivational";

export const FIELD_BY_CATEGORY: Record<Exclude<EmailCategory, "competition_recap">, CategoryField> = {
  social_follow: "socialFollow",
  social_comment: "socialComment",
  social_reaction: "socialReaction",
  social_tag: "socialTag",
  team_recap: "teamRecap",
  team_roster: "teamRoster",
  team_broadcast: "teamBroadcast",
  reminder_schedule: "reminderSchedule",
  reminder_game_recap: "reminderGameRecap",
  digest_weekly: "digestWeekly",
  motivational: "motivational",
};

// Lazily create (and return) the preference row for a user. Defaults are
// all-on; the unsubscribe token is minted once on creation. Concurrent
// first-reads are safe — `onConflictDoNothing` keeps the first writer's row.
export async function getOrCreatePreferences(
  userId: string,
): Promise<NotificationPreferencesRow> {
  const [existing] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  if (existing) return existing;

  await db
    .insert(notificationPreferences)
    .values({ userId, unsubscribeToken: generateToken() })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  return row;
}

// True if the user wants email for this category — master pause off AND the
// per-category flag on.
export function wantsCategory(
  prefs: NotificationPreferencesRow,
  category: EmailCategory,
): boolean {
  if (prefs.pauseAll) return false;
  if (category === "competition_recap") return competitionRecapEmailEnabled(prefs);
  return prefs[FIELD_BY_CATEGORY[category]] === true;
}

// Wire shape for the preferences API: the camelCase category fields plus the
// master pause switch. Stable contract consumed by the Settings page.
export function serializePreferences(prefs: NotificationPreferencesRow) {
  return {
    socialFollow: prefs.socialFollow,
    socialComment: prefs.socialComment,
    socialReaction: prefs.socialReaction,
    socialTag: prefs.socialTag,
    teamRecap: prefs.teamRecap,
    teamRoster: prefs.teamRoster,
    teamBroadcast: prefs.teamBroadcast,
    reminderSchedule: prefs.reminderSchedule,
    reminderGameRecap: prefs.reminderGameRecap,
    digestWeekly: prefs.digestWeekly,
    motivational: prefs.motivational,
    pauseAll: prefs.pauseAll,
    competitionRecapMode: prefs.competitionRecapMode,
  };
}

const WRITABLE_FIELDS: ReadonlyArray<CategoryField | "pauseAll"> = [
  "socialFollow",
  "socialComment",
  "socialReaction",
  "socialTag",
  "teamRecap",
  "teamRoster",
  "teamBroadcast",
  "reminderSchedule",
  "reminderGameRecap",
  "digestWeekly",
  "motivational",
  "pauseAll",
];

// Validate + apply a partial update from the preferences API. Unknown keys
// and non-boolean values are rejected. Returns the updated row.
export async function updatePreferences(
  userId: string,
  patch: Record<string, unknown>,
): Promise<NotificationPreferencesRow | { error: string }> {
  const set: Record<string, boolean | Date | string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "competitionRecapMode") {
      if (value !== "digest" && value !== "immediate" && value !== "off") {
        return { error: "competitionRecapMode must be digest, immediate, or off" };
      }
      set[key] = value;
      continue;
    }
    if (!(WRITABLE_FIELDS as readonly string[]).includes(key)) {
      return { error: `Unknown preference: ${key}` };
    }
    if (typeof value !== "boolean") {
      return { error: `${key} must be a boolean` };
    }
    set[key] = value;
  }
  // Ensure the row exists (and has a token) before updating.
  await getOrCreatePreferences(userId);
  if (Object.keys(set).length > 0) {
    set.updatedAt = new Date();
    await db.transaction(async tx => {
      // Serialize with the mail worker. Changing mode or pausing discards
      // queued mail; it never converts/replays an old opt-out backlog.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`competition-recap:${userId}`},0))`);
      const [prior] = await tx.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).for("update");
      const discard = (typeof set.competitionRecapMode === "string" && set.competitionRecapMode !== prior?.competitionRecapMode) || set.pauseAll === true;
      await tx.update(notificationPreferences).set({
        ...set, ...(discard ? { competitionRecapDiscardBefore: new Date() } : {}),
      }).where(eq(notificationPreferences.userId, userId));
      if (discard) {
        await tx.execute(sql`UPDATE competition_recap_mail SET finished_at=now() WHERE recipient_id=${userId} AND finished_at IS NULL`);
      }
    });
  }
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  return row;
}

// Token-based opt-out used by the unsubscribe links in marketing emails.
// `category === "all"` flips the master pause; otherwise the single category
// is turned off. Returns true when the token matched a row.
export async function applyUnsubscribe(
  token: string,
  category: EmailCategory | "all",
): Promise<boolean> {
  const set: Record<string, boolean | Date | string> =
    category === "all"
      ? { pauseAll: true, updatedAt: new Date() }
      : category === "competition_recap"
        ? { competitionRecapMode: "off", updatedAt: new Date() }
        : { [FIELD_BY_CATEGORY[category]]: false, updatedAt: new Date() };
  const [prefs] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.unsubscribeToken, token));
  if (!prefs) return false;
  const result = await updatePreferences(prefs.userId, setWithoutTimestamp(set));
  return !("error" in result);
}

function setWithoutTimestamp(set: Record<string, boolean | Date | string>) {
  const { updatedAt: _, ...patch } = set;
  return patch;
}
