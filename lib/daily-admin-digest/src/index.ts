// Daily Admin Digest — shared builder used by both the API "send preview"
// endpoint (artifacts/api-server) and the scheduled cron (@workspace/scripts).
//
// It is a pure builder: the caller passes the already-constructed Drizzle `db`
// instance (so this lib never opens its own pool) plus a UTC time window, and
// gets back a ready-to-send email ({ subject, html, text }) summarizing that
// window's app activity. Minor names are always masked to a first name + last
// initial. The email is always producible — a quiet day yields a "no activity"
// body rather than throwing.
//
// COPPA note: this digest goes to arbitrary operator addresses, not app users,
// so there is NO minor->guardian routing here. The only COPPA concern is
// content — minor display names are masked (see `maskDisplayName`).

import type { db } from "@workspace/db";
import {
  users,
  organizations,
  teams,
  articles,
  highlights,
  orgPosts,
  postComments,
  postReactions,
  contentReports,
  organizationInvites,
  rosterInvites,
  parentalConsents,
  dailyAdminDigestRecipients,
} from "@workspace/db/schema";
import { and, gte, lt, eq, isNull, count, desc } from "drizzle-orm";

type Db = typeof db;

// Default IANA time zone for the "yesterday" boundary. Override per-deploy with
// the ADMIN_DIGEST_TIME_ZONE env var (read by the caller, passed in here).
export const DEFAULT_DIGEST_TIME_ZONE = "UTC";

// Max number of items shown per itemized section; the rest collapse to
// "+N more" so a busy day can't produce a giant email.
const DISPLAY_CAP = 10;

export interface DigestWindow {
  /** Inclusive UTC start of the window. */
  start: Date;
  /** Exclusive UTC end of the window. */
  end: Date;
  /** The window's calendar date in `timeZone`, formatted YYYY-MM-DD. */
  label: string;
  timeZone: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Calendar Y/M/D for `date` as seen in `timeZone`.
function tzParts(
  date: Date,
  timeZone: string,
): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  let y = 0;
  let m = 0;
  let d = 0;
  for (const p of dtf.formatToParts(date)) {
    if (p.type === "year") y = Number(p.value);
    else if (p.type === "month") m = Number(p.value);
    else if (p.type === "day") d = Number(p.value);
  }
  return { y, m, d };
}

// Offset (ms) between `timeZone` wall-clock and UTC at the given instant.
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  let hour = map.hour ?? 0;
  if (hour === 24) hour = 0; // some engines format midnight as "24"
  const asUtc = Date.UTC(
    map.year ?? 1970,
    (map.month ?? 1) - 1,
    map.day ?? 1,
    hour,
    map.minute ?? 0,
    map.second ?? 0,
  );
  return asUtc - date.getTime();
}

// UTC instant for local midnight of the given calendar date in `timeZone`.
function zonedMidnightUtc(
  y: number,
  m: number,
  d: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

// The window covering "yesterday" in `timeZone`, relative to `now`.
export function getDigestWindow(now: Date, timeZone: string): DigestWindow {
  const today = tzParts(now, timeZone);
  const todayStart = zonedMidnightUtc(today.y, today.m, today.d, timeZone);
  // One ms before local midnight lands in yesterday, in any zone.
  const yesterday = tzParts(new Date(todayStart.getTime() - 1), timeZone);
  const start = zonedMidnightUtc(
    yesterday.y,
    yesterday.m,
    yesterday.d,
    timeZone,
  );
  return {
    start,
    end: todayStart,
    label: `${yesterday.y}-${pad(yesterday.m)}-${pad(yesterday.d)}`,
    timeZone,
  };
}

// The window covering a specific calendar date (YYYY-MM-DD) in `timeZone`.
// Used by the cron's `--day=` override to re-send a past day.
export function getDigestWindowForDate(
  dateStr: string,
  timeZone: string,
): DigestWindow {
  const [y, m, d] = dateStr.split("-").map((v) => Number(v));
  if (!y || !m || !d) {
    throw new Error(`Invalid --day value "${dateStr}" (expected YYYY-MM-DD).`);
  }
  const start = zonedMidnightUtc(y, m, d, timeZone);
  // +26h then re-derive the local date to cross a day boundary DST-safely.
  const next = tzParts(new Date(start.getTime() + 26 * 60 * 60 * 1000), timeZone);
  const end = zonedMidnightUtc(next.y, next.m, next.d, timeZone);
  return { start, end, label: `${pad(y)}-${pad(m)}-${pad(d)}`, timeZone };
}

// Mask a display name to "First L." — applied to minors before their names
// appear in the digest.
export function maskDisplayName(name: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name ?? "";
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${parts[0]} ${last}.`;
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface DailyAdminDigestTotals {
  newUsers: number;
  newOrganizations: number;
  newTeams: number;
  newRecaps: number;
  newHighlights: number;
  newOrgPosts: number;
  newComments: number;
  newReactions: number;
  newReports: number;
  newOrgInvites: number;
  newRosterInvites: number;
  consentsFinalized: number;
}

export interface DailyAdminDigest {
  subject: string;
  html: string;
  text: string;
  totals: DailyAdminDigestTotals;
  totalEvents: number;
}

interface Section {
  label: string;
  count: number;
  /** Already capped to DISPLAY_CAP; may be omitted for count-only rows. */
  items?: string[];
}

// Enabled recipients, oldest-first. Used by the cron to fan out the send.
export function listActiveDigestRecipients(
  database: Db,
): Promise<Array<{ id: string; email: string; label: string | null }>> {
  return database
    .select({
      id: dailyAdminDigestRecipients.id,
      email: dailyAdminDigestRecipients.email,
      label: dailyAdminDigestRecipients.label,
    })
    .from(dailyAdminDigestRecipients)
    .where(eq(dailyAdminDigestRecipients.enabled, true))
    .orderBy(dailyAdminDigestRecipients.createdAt);
}

async function countIn(
  database: Db,
  runner: () => Promise<Array<{ c: number }>>,
): Promise<number> {
  const [row] = await runner();
  return Number(row?.c ?? 0);
}

export async function buildDailyAdminDigest(
  database: Db,
  opts: { start: Date; end: Date; appBaseUrl: string; label?: string },
): Promise<DailyAdminDigest> {
  const { start, end, appBaseUrl } = opts;
  const base = appBaseUrl.replace(/\/+$/, "");

  // --- Itemized sections (small list + true count) ---
  const [newUserRows, newUsers] = await Promise.all([
    database
      .select({ name: users.name, isMinor: users.isMinor })
      .from(users)
      .where(and(gte(users.createdAt, start), lt(users.createdAt, end)))
      .orderBy(desc(users.createdAt))
      .limit(DISPLAY_CAP),
    countIn(database, () =>
      database
        .select({ c: count() })
        .from(users)
        .where(and(gte(users.createdAt, start), lt(users.createdAt, end))),
    ),
  ]);

  const [newOrgRows, newOrganizations] = await Promise.all([
    database
      .select({ name: organizations.name })
      .from(organizations)
      .where(
        and(
          gte(organizations.createdAt, start),
          lt(organizations.createdAt, end),
        ),
      )
      .orderBy(desc(organizations.createdAt))
      .limit(DISPLAY_CAP),
    countIn(database, () =>
      database
        .select({ c: count() })
        .from(organizations)
        .where(
          and(
            gte(organizations.createdAt, start),
            lt(organizations.createdAt, end),
          ),
        ),
    ),
  ]);

  const [newTeamRows, newTeams] = await Promise.all([
    database
      .select({ name: teams.name })
      .from(teams)
      .where(and(gte(teams.createdAt, start), lt(teams.createdAt, end)))
      .orderBy(desc(teams.createdAt))
      .limit(DISPLAY_CAP),
    countIn(database, () =>
      database
        .select({ c: count() })
        .from(teams)
        .where(and(gte(teams.createdAt, start), lt(teams.createdAt, end))),
    ),
  ]);

  const [newRecapRows, newRecaps] = await Promise.all([
    // Itemize by the team's (public) name, NOT the recap title — titles are
    // free-text authored by coaches and can contain a minor's full name.
    database
      .select({ teamName: teams.name })
      .from(articles)
      .innerJoin(teams, eq(teams.id, articles.teamId))
      .where(
        and(
          eq(articles.status, "published"),
          gte(articles.createdAt, start),
          lt(articles.createdAt, end),
        ),
      )
      .orderBy(desc(articles.createdAt))
      .limit(DISPLAY_CAP),
    countIn(database, () =>
      database
        .select({ c: count() })
        .from(articles)
        .where(
          and(
            eq(articles.status, "published"),
            gte(articles.createdAt, start),
            lt(articles.createdAt, end),
          ),
        ),
    ),
  ]);

  const [newHighlightRows, newHighlights] = await Promise.all([
    // Itemize by the team's (public) name, NOT the highlight title (free-text).
    database
      .select({ teamName: teams.name })
      .from(highlights)
      .leftJoin(teams, eq(teams.id, highlights.teamId))
      .where(
        and(gte(highlights.createdAt, start), lt(highlights.createdAt, end)),
      )
      .orderBy(desc(highlights.createdAt))
      .limit(DISPLAY_CAP),
    countIn(database, () =>
      database
        .select({ c: count() })
        .from(highlights)
        .where(
          and(gte(highlights.createdAt, start), lt(highlights.createdAt, end)),
        ),
    ),
  ]);

  // --- Count-only sections ---
  const [
    newOrgPosts,
    newComments,
    newReactions,
    newOrgInvites,
    newRosterInvites,
    consentsFinalized,
    newReports,
  ] = await Promise.all([
    countIn(database, () =>
      database
        .select({ c: count() })
        .from(orgPosts)
        .where(and(gte(orgPosts.createdAt, start), lt(orgPosts.createdAt, end))),
    ),
    countIn(database, () =>
      database
        .select({ c: count() })
        .from(postComments)
        .where(
          and(
            gte(postComments.createdAt, start),
            lt(postComments.createdAt, end),
            isNull(postComments.deletedAt),
          ),
        ),
    ),
    countIn(database, () =>
      database
        .select({ c: count() })
        .from(postReactions)
        .where(
          and(
            gte(postReactions.createdAt, start),
            lt(postReactions.createdAt, end),
          ),
        ),
    ),
    countIn(database, () =>
      database
        .select({ c: count() })
        .from(organizationInvites)
        .where(
          and(
            gte(organizationInvites.createdAt, start),
            lt(organizationInvites.createdAt, end),
          ),
        ),
    ),
    countIn(database, () =>
      database
        .select({ c: count() })
        .from(rosterInvites)
        .where(
          and(
            gte(rosterInvites.createdAt, start),
            lt(rosterInvites.createdAt, end),
          ),
        ),
    ),
    countIn(database, () =>
      database
        .select({ c: count() })
        .from(parentalConsents)
        .where(
          and(
            gte(parentalConsents.finalizedAt, start),
            lt(parentalConsents.finalizedAt, end),
          ),
        ),
    ),
    // Count only — report reasons/notes are free-text and can contain PII.
    countIn(database, () =>
      database
        .select({ c: count() })
        .from(contentReports)
        .where(
          and(
            gte(contentReports.createdAt, start),
            lt(contentReports.createdAt, end),
          ),
        ),
    ),
  ]);

  const totals: DailyAdminDigestTotals = {
    newUsers,
    newOrganizations,
    newTeams,
    newRecaps,
    newHighlights,
    newOrgPosts,
    newComments,
    newReactions,
    newReports,
    newOrgInvites,
    newRosterInvites,
    consentsFinalized,
  };
  const totalEvents = Object.values(totals).reduce((a, b) => a + b, 0);

  const sections: Section[] = [
    {
      label: "New members",
      count: newUsers,
      items: newUserRows.map((u) =>
        u.isMinor ? maskDisplayName(u.name) : u.name,
      ),
    },
    {
      label: "New organizations",
      count: newOrganizations,
      items: newOrgRows.map((o) => o.name),
    },
    {
      label: "New teams",
      count: newTeams,
      items: newTeamRows.map((t) => t.name),
    },
    {
      label: "New game recaps",
      count: newRecaps,
      items: newRecapRows.map((r) => r.teamName),
    },
    {
      label: "New highlights",
      count: newHighlights,
      items: newHighlightRows
        .map((h) => h.teamName)
        .filter((n): n is string => Boolean(n)),
    },
    { label: "New org posts", count: newOrgPosts },
    { label: "New comments", count: newComments },
    { label: "New reactions", count: newReactions },
    { label: "Content reports", count: newReports },
    { label: "Org invites sent", count: newOrgInvites },
    { label: "Roster invites sent", count: newRosterInvites },
    { label: "Parental consents finalized", count: consentsFinalized },
  ];

  // Prefer the zoned label the caller computed; fall back to the UTC date of
  // the window start (cosmetic only — used in the subject/heading).
  const label =
    opts.label ??
    `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(
      start.getUTCDate(),
    )}`;

  return renderDigest({ sections, totals, totalEvents, label, base });
}

function renderDigest(args: {
  sections: Section[];
  totals: DailyAdminDigestTotals;
  totalEvents: number;
  label: string;
  base: string;
}): DailyAdminDigest {
  const { sections, totalEvents, label, base } = args;
  const quiet = totalEvents === 0;
  const adminUrl = `${base}/app/admin`;

  const subject = quiet
    ? `Kinectem daily digest — ${label}: quiet day`
    : `Kinectem daily digest — ${label}: ${totalEvents} event${
        totalEvents === 1 ? "" : "s"
      }`;

  // --- Plain text ---
  const textLines: string[] = [
    `Kinectem daily digest for ${label}`,
    "",
    quiet
      ? "No activity yesterday — all quiet on Kinectem."
      : `${totalEvents} total event${totalEvents === 1 ? "" : "s"} yesterday.`,
    "",
  ];
  if (!quiet) {
    for (const s of sections) {
      if (s.count === 0) continue;
      textLines.push(`${s.label}: ${s.count}`);
      if (s.items && s.items.length) {
        for (const it of s.items) textLines.push(`    - ${it}`);
        if (s.count > s.items.length) {
          textLines.push(`    - +${s.count - s.items.length} more`);
        }
      }
    }
    textLines.push("");
  }
  textLines.push(`Open the admin console: ${adminUrl}`);
  const text = textLines.join("\n");

  // --- HTML ---
  const rows = sections
    .filter((s) => s.count > 0)
    .map((s) => {
      const itemsHtml =
        s.items && s.items.length
          ? `<ul style="margin:4px 0 0;padding-left:18px;color:#374151">${s.items
              .map((it) => `<li>${escapeHtml(it)}</li>`)
              .join("")}${
              s.count > s.items.length
                ? `<li style="color:#6b7280">+${
                    s.count - s.items.length
                  } more</li>`
                : ""
            }</ul>`
          : "";
      return `<li style="margin-bottom:12px"><strong>${escapeHtml(
        s.label,
      )}: ${s.count}</strong>${itemsHtml}</li>`;
    })
    .join("");

  const bodyInner = quiet
    ? `<p style="color:#374151">No activity yesterday — all quiet on Kinectem.</p>`
    : `<p style="color:#374151">${totalEvents} total event${
        totalEvents === 1 ? "" : "s"
      } yesterday.</p><ul style="list-style:none;padding:0;margin:16px 0">${rows}</ul>`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto">
<h1 style="font-size:20px;margin:0 0 4px">Kinectem daily digest</h1>
<p style="color:#6b7280;margin:0 0 16px">Activity for ${escapeHtml(label)}</p>
${bodyInner}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
<p style="font-size:13px"><a href="${escapeHtml(
    adminUrl,
  )}">Open the Kinectem admin console →</a></p>
<p style="font-size:12px;color:#6b7280">You're receiving this operational digest because your address is on the Kinectem admin recipient list. Ask a platform admin to remove you.</p>
</div>`;

  return { subject, html, text, totals: args.totals, totalEvents };
}
