// Task #767 — Notify claimed teams & competition followers when games change.
//
// One shared "material change" model used by BOTH the inline single-game
// edit/status paths and the CSV re-import path, so the two can never drift
// on what counts as a notify-worthy change.
//
// Material fields: date, start time, venue, field, and status
// (postponed/canceled/restored). Cosmetic edits — team-name spelling,
// division/bracket labels, age/gender — do NOT notify.
//
// Recipients:
// - Claimed-team staff (coaches with an accepted roster entry, the team's
//   creator, and owner/admin of the team's parent org) for the teams in the
//   changed game. Unclaimed placeholder slots have no linked account — out
//   of scope by design.
// - Competition followers, for STATUS changes only (postponed/canceled/
//   restored).
// The acting operator is always excluded; recipients are deduped.
//
// In-app only (bell notifications). No email dispatch here on purpose: the
// existing email pipeline's preference/guardian-routing gate covers other
// categories, and this task's scope is the in-app pipeline. Deep links go
// to the in-app competition page (`/competitions/c/<slug>`); notification
// links are app-relative like every other kind in this table.

import {
  db,
  notifications,
  organizationAdmins,
  rosterEntries,
  teams,
  competitionFollowers,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

export const GAME_CHANGED_NOTIF_KIND = "competition_game_changed";
export const GAME_STATUS_NOTIF_KIND = "competition_game_status";
export const GAMES_DIGEST_NOTIF_KIND = "competition_games_digest";

// ---------------------------------------------------------------------------
// Material change detection
// ---------------------------------------------------------------------------

export interface MaterialGameFields {
  matchDate: string | null;
  startTime: string | null;
  venue: string | null;
  field: string | null;
}

const MATERIAL_LABELS: { key: keyof MaterialGameFields; label: string }[] = [
  { key: "matchDate", label: "date" },
  { key: "startTime", label: "start time" },
  { key: "venue", label: "venue" },
  { key: "field", label: "field" },
];

export interface MaterialChange {
  field: string;
  before: string | null;
  after: string | null;
}

// Returns [] when nothing material changed (cosmetic-only edits notify
// nobody). Empty string and null are treated as the same "blank" value.
export function materialChanges(
  before: MaterialGameFields,
  after: MaterialGameFields,
): MaterialChange[] {
  const out: MaterialChange[] = [];
  for (const { key, label } of MATERIAL_LABELS) {
    const b = before[key] || null;
    const a = after[key] || null;
    if (b !== a) out.push({ field: label, before: b, after: a });
  }
  return out;
}

const show = (v: string | null) => (v == null || v === "" ? "TBD" : v);

export function describeChanges(changes: MaterialChange[]): string {
  return changes
    .map((c) => `${c.field} ${show(c.before)} → ${show(c.after)}`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

// Staff of a set of claimed teams: accepted coaches, the team creator, and
// owner/admin of the team's parent org (mirrors canManageTeam's reach).
export async function resolveTeamStaff(
  teamIds: string[],
): Promise<Set<string>> {
  const ids = Array.from(new Set(teamIds.filter(Boolean)));
  const staff = new Set<string>();
  if (ids.length === 0) return staff;

  const teamRows = await db
    .select({
      id: teams.id,
      createdById: teams.createdById,
      organizationId: teams.organizationId,
    })
    .from(teams)
    .where(inArray(teams.id, ids));
  for (const t of teamRows) {
    if (t.createdById) staff.add(t.createdById);
  }
  const orgIds = Array.from(
    new Set(
      teamRows
        .map((t) => t.organizationId)
        .filter((o): o is string => o != null),
    ),
  );

  const [coachRows, managerRows, orgAdminRows] = await Promise.all([
    db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          inArray(rosterEntries.teamId, ids),
          eq(rosterEntries.role, "coach"),
          eq(rosterEntries.status, "accepted"),
        ),
      ),
    // Task #559 — `manager` is a staff position regardless of role.
    db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          inArray(rosterEntries.teamId, ids),
          eq(rosterEntries.position, "manager"),
          eq(rosterEntries.status, "accepted"),
        ),
      ),
    orgIds.length > 0
      ? db
          .select({ userId: organizationAdmins.userId })
          .from(organizationAdmins)
          .where(
            and(
              inArray(organizationAdmins.organizationId, orgIds),
              inArray(organizationAdmins.role, ["owner", "admin"]),
            ),
          )
      : Promise.resolve([] as { userId: string }[]),
  ]);
  for (const r of coachRows) if (r.userId) staff.add(r.userId);
  for (const r of managerRows) if (r.userId) staff.add(r.userId);
  for (const r of orgAdminRows) staff.add(r.userId);
  return staff;
}

export async function resolveCompetitionFollowers(
  competitionId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ userId: competitionFollowers.userId })
    .from(competitionFollowers)
    .where(eq(competitionFollowers.competitionId, competitionId));
  return new Set(rows.map((r) => r.userId));
}

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

interface CompetitionRef {
  id: string;
  slug: string;
  name: string;
}

function competitionLink(c: CompetitionRef): string {
  return `/competitions/c/${c.slug}`;
}

async function insertForRecipients(
  recipients: Set<string>,
  actorUserId: string,
  kind: string,
  message: string,
  link: string,
): Promise<void> {
  recipients.delete(actorUserId);
  const userIds = Array.from(recipients);
  if (userIds.length === 0) return;
  await db.insert(notifications).values(
    userIds.map((userId) => ({
      userId,
      kind,
      message,
      link,
      actorUserId,
    })),
  );
}

export interface GameLabelParts {
  matchNumber: string;
  homeName: string | null;
  awayName: string | null;
}

export function gameLabel(g: GameLabelParts): string {
  return `${g.homeName ?? "TBD"} vs ${g.awayName ?? "TBD"} (game #${g.matchNumber})`;
}

// Single inline edit: material field changes → claimed-team staff only.
export async function notifyGameEdited(args: {
  competition: CompetitionRef;
  game: GameLabelParts;
  teamIds: string[];
  changes: MaterialChange[];
  actorUserId: string;
}): Promise<void> {
  if (args.changes.length === 0) return;
  const staff = await resolveTeamStaff(args.teamIds);
  const message = `${args.competition.name}: ${gameLabel(args.game)} changed — ${describeChanges(args.changes)}.`;
  await insertForRecipients(
    staff,
    args.actorUserId,
    GAME_CHANGED_NOTIF_KIND,
    message,
    competitionLink(args.competition),
  );
}

const STATUS_PHRASE: Record<string, string> = {
  postponed: "was postponed",
  canceled: "was canceled",
  scheduled: "is back on the schedule",
};

// Status change (postpone/cancel/restore): claimed-team staff AND
// competition followers.
export async function notifyGameStatusChanged(args: {
  competition: CompetitionRef;
  game: GameLabelParts;
  teamIds: string[];
  status: "scheduled" | "postponed" | "canceled";
  reason: string | null;
  actorUserId: string;
}): Promise<void> {
  const phrase = STATUS_PHRASE[args.status] ?? `is now ${args.status}`;
  const reasonSuffix = args.reason?.trim() ? ` (${args.reason.trim()})` : "";
  const message = `${args.competition.name}: ${gameLabel(args.game)} ${phrase}${reasonSuffix}.`;
  const [staff, followers] = await Promise.all([
    resolveTeamStaff(args.teamIds),
    resolveCompetitionFollowers(args.competition.id),
  ]);
  const recipients = new Set([...staff, ...followers]);
  await insertForRecipients(
    recipients,
    args.actorUserId,
    GAME_STATUS_NOTIF_KIND,
    message,
    competitionLink(args.competition),
  );
}

// Bulk CSV re-import: ONE digest notification per recipient covering all
// materially-changed games (never a per-game flood). Claimed-team staff get
// a digest counting the games whose teams they staff; competition followers
// get a digest ONLY when at least one game's STATUS changed (mirrors the
// single-edit rule: followers care about postponed/canceled/restored, not
// venue/time moves). A recipient in both sets gets one notification.
export async function notifyBulkGamesChanged(args: {
  competition: CompetitionRef;
  // Per changed game: which claimed teams are in it + whether its status
  // (postponed/canceled/restored) changed in this import.
  changedGames: { teamIds: string[]; statusChanged?: boolean }[];
  actorUserId: string;
}): Promise<void> {
  if (args.changedGames.length === 0) return;
  const statusChangedCount = args.changedGames.filter(
    (g) => g.statusChanged,
  ).length;

  // Resolve staff per game, then invert to recipient → affected-game count.
  const staffByGame = await Promise.all(
    args.changedGames.map((g) => resolveTeamStaff(g.teamIds)),
  );
  const countByUser = new Map<string, number>();
  for (const staff of staffByGame) {
    for (const userId of staff) {
      countByUser.set(userId, (countByUser.get(userId) ?? 0) + 1);
    }
  }

  const followers =
    statusChangedCount > 0
      ? await resolveCompetitionFollowers(args.competition.id)
      : new Set<string>();

  const link = competitionLink(args.competition);
  const rows: {
    userId: string;
    kind: string;
    message: string;
    link: string;
    actorUserId: string;
  }[] = [];
  for (const [userId, count] of countByUser) {
    if (userId === args.actorUserId) continue;
    rows.push({
      userId,
      kind: GAMES_DIGEST_NOTIF_KIND,
      message: `${count === 1 ? "1 of your games" : `${count} of your games`} in ${args.competition.name} changed — check the updated schedule.`,
      link,
      actorUserId: args.actorUserId,
    });
  }
  for (const userId of followers) {
    if (userId === args.actorUserId || countByUser.has(userId)) continue;
    rows.push({
      userId,
      kind: GAMES_DIGEST_NOTIF_KIND,
      message: `${statusChangedCount === 1 ? "1 game" : `${statusChangedCount} games`} in ${args.competition.name} ${statusChangedCount === 1 ? "was" : "were"} postponed, canceled, or restored — check the updated schedule.`,
      link,
      actorUserId: args.actorUserId,
    });
  }
  if (rows.length === 0) return;
  await db.insert(notifications).values(rows);
}
