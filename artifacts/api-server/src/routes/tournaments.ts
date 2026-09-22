// Task #628 — Tournament schedule signup funnel for outside teams.
//
// Hand-written Express routes + local Zod (matching the org-claims / founding
// / AI precedent in this codebase). There is NO global openapi-validator, so
// these endpoints are NOT in openapi.yaml — that file is locked by user
// preference and editing it only risks breaking client codegen with no
// runtime benefit. The client calls these via `customFetch`.
//
// This file holds the OPERATOR (platform-admin) surface: create a tournament
// and upload the match-slot CSV. Public read + solo-team signup/claim live in
// other handlers.

import { Router, type IRouter } from "express";
import {
  db,
  tournaments,
  tournamentParticipants,
  tournamentMatches,
  competitionBrackets,
  teams,
  organizations,
  rosterEntries,
  articles,
  organizationAdmins,
  competitionFollowers,
  competitionOrganizers,
  competitionAdmins,
  organizerAdmins,
  teamHiddenCompetitionGames,
} from "@workspace/db";
import {
  and,
  asc,
  eq,
  isNull,
  desc,
  sql,
  inArray,
  ilike,
  or,
  TransactionRollbackError,
} from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import {
  canOperateCompetition,
  canOperateOrganizer,
} from "../lib/competition-permissions";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { requireAdmin, requireAuth } from "../lib/auth";
import {
  apiError,
  articlePostId,
  MAX_IMAGE_DATA_URL_LENGTH,
} from "../lib/spec-helpers";
import {
  canManageOrganization,
  canManageTeam,
} from "../lib/permissions";
import {
  seedBracketsFromSchedule,
  linkParticipantsToBrackets,
} from "../lib/competition-brackets";
import {
  materialChanges,
  notifyGameEdited,
  notifyGameStatusChanged,
  notifyBulkGamesChanged,
} from "../lib/game-change-notifications";
import {
  competitionWeekForDate,
  timestampToCompetitionDate,
} from "../lib/competition-weeks";

const router: IRouter = Router();

const ONE_HOUR = 60 * 60 * 1000;

// Admin-only write limiter — generous, but guards against an accidental
// runaway re-upload loop hammering the import path.
const tournamentWriteLimiter = rateLimit({
  name: "tournament-write",
  windowMs: ONE_HOUR,
  max: 120,
  keys: (req) => [ipKey(req)],
  message: "Too many tournament changes. Please wait a moment and try again.",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Generate a URL-safe slug from the tournament name plus a short random
// suffix so two same-named tournaments never collide on the unique slug.
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const suffix = randomBytes(4).toString("hex");
  return base ? `${base}-${suffix}` : suffix;
}

// Minimal CSV parser (mirrors schedule.ts) — handles quoted cells with
// embedded commas, escaped "" quotes, and CRLF.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // swallow — handled by the following \n (or EOF below)
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// Canonical CSV columns. Header matching is forgiving so organizers can
// upload scheduling-tool exports (GotSport etc.) as-is: headers are
// lowercased, punctuation-stripped, and matched against a per-column alias
// list. Only match #, date, and the two team columns are REQUIRED — every
// other column is optional and simply lands as null/"" when absent.
const CSV_COLUMNS = [
  "match #",
  "date",
  "start time",
  "age",
  "gender",
  "division",
  "bracket",
  "venue",
  "venue state",
  "field",
  "home team",
  "away team",
  "status",
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];

// Task #767 — optional status column. Blank/absent means "leave the game's
// status untouched" (imports never clobber statuses that were set inline).
// Recognized values (forgiving): scheduled/on, postponed/ppd, canceled/
// cancelled/cxl. Anything else is ignored with a row warning.
const CSV_STATUS_VALUES: Record<string, "scheduled" | "postponed" | "canceled"> = {
  scheduled: "scheduled",
  on: "scheduled",
  active: "scheduled",
  confirmed: "scheduled",
  postponed: "postponed",
  ppd: "postponed",
  delayed: "postponed",
  canceled: "canceled",
  cancelled: "canceled",
  cxl: "canceled",
};

const REQUIRED_CSV_COLUMNS: CsvColumn[] = [
  "match #",
  "date",
  "home team",
  "away team",
  // Task #865 — the group/division column is required so every schedule
  // upload produces an organized (bracket-grouped) Teams page from day 1.
  // The `bracket` column still satisfies it (resolveCsvHeader treats either
  // as the group column when only one is present — see below).
  "division",
];

// Normalize a header cell for matching: lowercase, strip everything that
// isn't a letter, digit, or '#'. "Start Time" / "start_time" / "Start-Time"
// all become "starttime".
function normalizeHeaderCell(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9#]/g, "");
}

// Alias list per canonical column, in normalized form. First header cell
// that matches wins; each header cell binds to at most one column.
const CSV_HEADER_ALIASES: Record<CsvColumn, string[]> = {
  "match #": ["match#", "match", "matchno", "matchnumber", "game#", "game", "gameno", "gamenumber", "#"],
  date: ["date", "gamedate", "matchdate", "day"],
  "start time": ["starttime", "time", "start", "kickoff", "gametime"],
  age: ["age", "agegroup", "ageband"],
  gender: ["gender", "sex", "boysgirls"],
  division: ["division", "div", "flight", "group", "pool"],
  bracket: ["bracket", "round", "pod"],
  venue: ["venue", "location", "park", "complex", "site"],
  "venue state": ["venuestate", "state", "st"],
  field: ["field", "fieldno", "field#", "pitch", "court", "surface"],
  "home team": ["hometeam", "home", "team1", "teama", "homeclub"],
  "away team": ["awayteam", "away", "visitor", "visitorteam", "team2", "teamb", "awayclub"],
  status: ["status", "gamestatus", "matchstatus"],
};

// Resolve the header row to a canonical-column → index map. Returns the
// map plus any REQUIRED columns that couldn't be found.
function resolveCsvHeader(headerRow: string[]): {
  index: Partial<Record<CsvColumn, number>>;
  missing: CsvColumn[];
} {
  const normalized = headerRow.map(normalizeHeaderCell);
  const used = new Set<number>();
  const index: Partial<Record<CsvColumn, number>> = {};
  for (const colName of CSV_COLUMNS) {
    for (const alias of CSV_HEADER_ALIASES[colName]) {
      const i = normalized.findIndex((h, idx) => h === alias && !used.has(idx));
      if (i !== -1) {
        index[colName] = i;
        used.add(i);
        break;
      }
    }
  }
  let missing = REQUIRED_CSV_COLUMNS.filter((c) => index[c] === undefined);
  // Task #865 — "division" is the required group column, but a file whose
  // only group column is named "bracket"/"round"/"pod" still satisfies it:
  // the participant grouping falls back to the bracket value when division
  // is blank, so either column organizes the page.
  if (index["bracket"] !== undefined) {
    missing = missing.filter((c) => c !== "division");
  }
  return { index, missing };
}

// Task #768 — organizer-facing summary of how the header row was resolved,
// derived from the SAME resolveCsvHeader result the import uses, so the UI
// can never drift from the parser. Display-only: no behavior change.
function buildColumnSummary(
  headerRow: string[],
  index: Partial<Record<CsvColumn, number>>,
): {
  matched: { column: CsvColumn; header: string; required: boolean }[];
  missingOptional: CsvColumn[];
  ignoredHeaders: string[];
} {
  const usedIdx = new Set<number>(
    Object.values(index).filter((i): i is number => i !== undefined),
  );
  const matched = CSV_COLUMNS.filter((c) => index[c] !== undefined).map(
    (c) => ({
      column: c,
      header: headerRow[index[c]!].trim(),
      required: REQUIRED_CSV_COLUMNS.includes(c),
    }),
  );
  const missingOptional = CSV_COLUMNS.filter(
    (c) => index[c] === undefined && !REQUIRED_CSV_COLUMNS.includes(c),
  );
  const ignoredHeaders = headerRow
    .map((h, i) => ({ h: h.trim(), i }))
    .filter(({ h, i }) => h !== "" && !usedIdx.has(i))
    .map(({ h }) => h);
  return { matched, missingOptional, ignoredHeaders };
}

// Task #938 — league exports routinely exceed the old 1,000-row ceiling.
// Keep the row and text limits aligned with the route-specific 12 MB parser
// in app.ts and the client's 10 MB file cap.
const MAX_IMPORT_ROWS = 25_000;
const MAX_IMPORT_CSV_CHARS = 10_000_000;
const IMPORT_DB_BATCH_SIZE = 1_000;
const PREVIEW_SAMPLE_LIMIT = 200;

function inBatches<T>(values: T[], size = IMPORT_DB_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    batches.push(values.slice(i, i + size));
  }
  return batches;
}

// Normalize a CSV date cell to a YYYY-MM-DD string for the `date` column, or
// null when it isn't a parseable date.
function parseDateCell(v: string): string | null {
  const t = v.trim();
  if (t === "") return null;
  // Bare spreadsheet serials (especially 0) are not dates in the CSV
  // contract. XLSX conversion resolves genuine calendar cells first.
  if (/^\d+(?:\.\d+)?$/.test(t)) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  // Excel's zero-date epoch is represented around 1899-12-31.
  if (d.getUTCFullYear() < 1901) return null;
  return d.toISOString().slice(0, 10);
}

function parseStartTimeCell(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (t === "") return null;
  if (/^0(?:\.0+)?$/.test(t)) return null;
  // The previous XLSX conversion could turn a time-only cell into an Excel
  // epoch date. Never persist or return that artifact as a kickoff time.
  if (/^(?:1899|1900)-\d{2}-\d{2}(?:[T ][^\s]+)?$/.test(t)) return null;
  return t;
}

// Slot key for a participant: identity is (name, gender) per competition.
// Division/bracket are informational (first-seen values) and intentionally
// NOT part of the key — the same exact team name across brackets/divisions
// is one participant per gender, never duplicates. Gender IS part of the key
// because real clubs field same-named boys and girls teams. The unused
// params are kept so call sites stay explicit about the context.
function slotKey(
  _division: string,
  _bracket: string,
  nameKey: string,
  gender: string | null | undefined,
): string {
  return `${nameKey}\u0000${(gender ?? "").trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Competition operator scope (Competitions §3). A competition's OWNER (the
// creator, `ownerUserId`) can manage only their own competitions — branding,
// schedule uploads, claim settings, curation. Platform admins retain global
// oversight. This is per-competition scope, NOT a platform role.
// ---------------------------------------------------------------------------

// Task #745 — widened to owner OR competition/hub admin OR platform admin;
// now async (DB-backed membership lookups) and shared with organizers.ts.
// See ../lib/competition-permissions.ts.

const COMPETITION_TYPES = ["tournament", "league"] as const;

// Optional #rrggbb hex color for the public-page theme.
const BrandColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "brandColor must be a #rrggbb hex color");

// http(s) URL fields (logo/banner/website) — plain URLs, max 2000 chars.
const HttpUrl = z
  .string()
  .trim()
  .max(2000)
  .regex(/^https?:\/\//, "Must be an http(s) URL");

// Logo/banner also accept inline base64 `data:image/...` URLs uploaded from
// the branding UI (same pattern as org logos / team banners). Over-cap data
// URLs are rejected with a friendly 413 before Zod parsing in the PATCH
// handler, so the max() here only guards plain URLs.
const ImageUrl = z.union([
  HttpUrl,
  z
    .string()
    .max(MAX_IMAGE_DATA_URL_LENGTH)
    .regex(/^data:image\//, "Must be an image data: URL"),
]);

// ---------------------------------------------------------------------------
// POST /competitions — ANY signed-in user creates a competition and becomes
// its operator/owner (self-serve, Competitions §3). The legacy platform-admin
// POST /tournaments below reuses the same handler with an admin gate.
// ---------------------------------------------------------------------------

const CreateCompetitionBody = z.object({
  name: z.string().trim().min(1, "Competition name is required").max(200),
  type: z.enum(COMPETITION_TYPES).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
  location: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  // Task #723 — create-from-hub: link to an organizer the caller owns and
  // inherit its branding (colors/logo/banner/website) at creation time.
  organizerId: z.string().uuid().optional().nullable(),
});

const createCompetitionHandler = asyncHandler(async (req, res) => {
  const me = req.sessionUser;
  if (!me) return apiError(res, 401, "Not authenticated");
  const parsed = CreateCompetitionBody.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return apiError(res, 400, first?.message ?? "Invalid competition details.", {
      code: "VALIDATION_FAILED",
      extras: { fields: parsed.error.flatten().fieldErrors },
    });
  }
  const body = parsed.data;
  if (body.endDate < body.startDate) {
    return apiError(res, 400, "endDate must be on or after startDate");
  }

  // Create-from-hub (Task #723): the organizer must exist and belong to the
  // caller (platform admins can create under any organizer). Branding is
  // inherited as a starting point — the wizard's branding step can override.
  let organizer: typeof competitionOrganizers.$inferSelect | null = null;
  if (body.organizerId) {
    const [o] = await db
      .select()
      .from(competitionOrganizers)
      .where(eq(competitionOrganizers.id, body.organizerId))
      .limit(1);
    if (!o) return apiError(res, 404, "Organizer not found");
    // Task #745 — hub admins (not just the owner) can create under the hub.
    if (!(await canOperateOrganizer(me, o))) {
      return apiError(res, 403, "You can only create competitions under a hub you manage");
    }
    organizer = o;
  }

  // Atomic create + auto-follow: the creator operates this competition, so
  // follow it for them immediately. One tx so a failed follow insert can't
  // strand a half-set-up competition.
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tournaments)
      .values({
        slug: slugify(body.name),
        name: body.name,
        type: body.type ?? "tournament",
        startDate: body.startDate,
        endDate: body.endDate,
        location: body.location ?? null,
        description: body.description ?? null,
        createdById: me.id,
        ownerUserId: me.id,
        organizerId: organizer?.id ?? null,
        // Brand inheritance — copied (not referenced) so later organizer
        // rebrands never silently restyle past competitions.
        logoUrl: organizer?.logoUrl ?? null,
        brandColor: organizer?.brandColor ?? null,
        secondaryColor: organizer?.secondaryColor ?? null,
        tertiaryColor: organizer?.tertiaryColor ?? null,
        bannerUrl: organizer?.bannerUrl ?? null,
        websiteUrl: organizer?.websiteUrl ?? null,
      })
      .returning();
    await tx
      .insert(competitionFollowers)
      .values({ competitionId: created.id, userId: me.id })
      .onConflictDoNothing();
    return created;
  });

  res.status(201).json({
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    startDate: row.startDate,
    endDate: row.endDate,
    location: row.location,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  });
});

router.post(
  "/competitions",
  requireAuth,
  tournamentWriteLimiter,
  createCompetitionHandler,
);

// ---------------------------------------------------------------------------
// Competition claim links — public consume flow (mirrors org-claim-links).
// Possessing the secret token IS the authorization: the platform admin mints
// links on the admin claim-links screen and sends each one to the right
// organizer; whoever opens it and signs in becomes the competition's
// operator (ownerUserId). Once claimed, the link shows "already claimed".
// Hand-written validation + customFetch on the client — these endpoints
// have no openapi.yaml entry (spec is locked; org-claim-links precedent).
// ---------------------------------------------------------------------------
const competitionClaimLinkLimiter = rateLimit({
  name: "competition-claim-link",
  windowMs: 60_000,
  max: 30,
  keys: (req) => [ipKey(req)],
});

// Public — resolve a secret token to its competition so the landing page can
// render the target + the "already claimed" state. Never leaks the token
// itself or any other secret field.
router.get(
  "/competition-claim-links/:token",
  competitionClaimLinkLimiter,
  asyncHandler(async (req, res) => {
    const token = String(req.params.token ?? "");
    if (!token) return apiError(res, 404, "Not found");
    const [row] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.claimToken, token))
      .limit(1);
    if (!row) return apiError(res, 404, "Not found");
    res.json({
      competition: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        type: row.type,
        startDate: row.startDate,
        endDate: row.endDate,
        location: row.location,
        logoUrl: row.logoUrl,
        brandColor: row.brandColor,
        secondaryColor: row.secondaryColor,
        // Promo code the platform admin pre-loaded for this competition —
        // shown to the claimer so they know it's already wired into their
        // invite message (tournaments.promo_code is what the console's
        // outreach message auto-fills from).
        promoCode: row.promoCode,
      },
      alreadyClaimed: row.ownerUserId != null || row.createdById != null,
    });
  }),
);

// Auth — finalize the claim for the signed-in user. Race-safe: a conditional
// UPDATE ... WHERE owner_user_id IS NULL AND created_by_id IS NULL is the
// backstop against two concurrent finalizes both passing the pre-check.
router.post(
  "/competition-claim-links/:token/claim",
  competitionClaimLinkLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const token = String(req.params.token ?? "");
    if (!token) return apiError(res, 404, "Not found");
    const [row] = await db
      .select({
        id: tournaments.id,
        slug: tournaments.slug,
        promoCode: tournaments.promoCode,
      })
      .from(tournaments)
      .where(eq(tournaments.claimToken, token))
      .limit(1);
    if (!row) return apiError(res, 404, "Not found");
    const claimed = await db
      .update(tournaments)
      .set({ ownerUserId: me.id, createdById: me.id, updatedAt: new Date() })
      .where(
        and(
          eq(tournaments.id, row.id),
          isNull(tournaments.ownerUserId),
          isNull(tournaments.createdById),
        ),
      )
      .returning({ id: tournaments.id });
    if (claimed.length === 0) {
      return apiError(res, 409, "This competition has already been claimed", {
        code: "ALREADY_CLAIMED",
      });
    }
    // Auto-follow so the competition shows up in the new operator's sidebar.
    await db
      .insert(competitionFollowers)
      .values({ competitionId: row.id, userId: me.id })
      .onConflictDoNothing();
    res.status(201).json({
      ok: true,
      competitionId: row.id,
      slug: row.slug,
      promoCode: row.promoCode,
    });
  }),
);

// Legacy admin path — kept for back-compat with the existing admin console.
router.post(
  "/tournaments",
  requireAdmin,
  tournamentWriteLimiter,
  createCompetitionHandler,
);

// ---------------------------------------------------------------------------
// GET /my/competitions — competitions the signed-in user owns (operator
// console listing). Same shape as the admin listing.
// ---------------------------------------------------------------------------

async function competitionListRows(rows: (typeof tournaments.$inferSelect)[]) {
  const ids = rows.map((row) => row.id);
  const [matchCounts, participantCounts] = ids.length
    ? await Promise.all([
        db
          .select({
            id: tournamentMatches.tournamentId,
            matchCount: sql<number>`count(*)::int`,
          })
          .from(tournamentMatches)
          .where(inArray(tournamentMatches.tournamentId, ids))
          .groupBy(tournamentMatches.tournamentId),
        db
          .select({
            id: tournamentParticipants.tournamentId,
            participantCount: sql<number>`count(*)::int`,
            claimedCount: sql<number>`(count(*) FILTER (WHERE ${tournamentParticipants.teamId} IS NOT NULL))::int`,
            pendingClaimCount: sql<number>`(count(*) FILTER (WHERE ${tournamentParticipants.pendingTeamId} IS NOT NULL AND ${tournamentParticipants.teamId} IS NULL))::int`,
          })
          .from(tournamentParticipants)
          .where(inArray(tournamentParticipants.tournamentId, ids))
          .groupBy(tournamentParticipants.tournamentId),
      ])
    : [[], []];
  const matchCountById = new Map(
    matchCounts.map((row) => [row.id, Number(row.matchCount)]),
  );
  const participantCountById = new Map(
    participantCounts.map((row) => [row.id, row]),
  );

  return rows.map((t) => {
    const participants = participantCountById.get(t.id);
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      type: t.type,
      startDate: t.startDate,
      endDate: t.endDate,
      location: t.location,
      organizerId: t.organizerId ?? null,
      autoApproveClaims: t.autoApproveClaims,
      logoUrl: t.logoUrl,
      brandColor: t.brandColor,
      secondaryColor: t.secondaryColor,
      tertiaryColor: t.tertiaryColor,
      matchCount: matchCountById.get(t.id) ?? 0,
      participantCount: Number(participants?.participantCount ?? 0),
      claimedCount: Number(participants?.claimedCount ?? 0),
      pendingClaimCount: Number(participants?.pendingClaimCount ?? 0),
      createdAt: t.createdAt.toISOString(),
    };
  });
}

// GET /my/manageable-teams — every team the caller can claim a competition
// slot for (mirrors canManageTeam: accepted coach, solo-team creator, or
// owner/admin of the parent org). Used by the signup funnel's
// "claim to my existing team" branch.
router.get(
  "/my/manageable-teams",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");

    const [coachRows, createdRows, orgAdminRows] = await Promise.all([
      db
        .select({ t: teams })
        .from(rosterEntries)
        .innerJoin(teams, eq(teams.id, rosterEntries.teamId))
        .where(
          and(
            eq(rosterEntries.userId, me.id),
            eq(rosterEntries.role, "coach"),
            eq(rosterEntries.status, "accepted"),
          ),
        ),
      db.select({ t: teams }).from(teams).where(eq(teams.createdById, me.id)),
      db
        .select({ t: teams })
        .from(organizationAdmins)
        .innerJoin(
          teams,
          eq(teams.organizationId, organizationAdmins.organizationId),
        )
        .where(
          and(
            eq(organizationAdmins.userId, me.id),
            inArray(organizationAdmins.role, ["owner", "admin"]),
          ),
        ),
    ]);

    const byId = new Map<string, typeof teams.$inferSelect>();
    for (const { t } of [...coachRows, ...createdRows, ...orgAdminRows]) {
      byId.set(t.id, t);
    }
    const organizationIds = Array.from(
      new Set(
        Array.from(byId.values())
          .map((team) => team.organizationId)
          .filter((id): id is string => id != null),
      ),
    );
    const organizationRows =
      organizationIds.length > 0
        ? await db
            .select({ id: organizations.id, name: organizations.name })
            .from(organizations)
            .where(inArray(organizations.id, organizationIds))
        : [];
    const organizationNames = new Map(
      organizationRows.map((organization) => [
        organization.id,
        organization.name,
      ]),
    );
    const manageableOrganizationIds = new Set(
      (
        await Promise.all(
          organizationIds.map(async (organizationId) => ({
            organizationId,
            canManage: await canManageOrganization(me.id, organizationId),
          })),
        )
      )
        .filter((organization) => organization.canManage)
        .map((organization) => organization.organizationId),
    );

    const data = Array.from(byId.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({
        id: t.id,
        name: t.name,
        sport: t.sport ?? null,
        organizationId: t.organizationId ?? null,
        organizationName: t.organizationId
          ? (organizationNames.get(t.organizationId) ?? null)
          : null,
        canManageOrganization: t.organizationId
          ? manageableOrganizationIds.has(t.organizationId)
          : false,
      }));
    res.json({ data });
  }),
);

router.get(
  "/my/competitions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    // Task #745 — membership-aware: competitions the user owns, is a
    // per-competition admin of, or reaches through a hub-admin membership
    // (organizer_admins → all competitions attached to that hub, including
    // ones attached later). Each row carries accessRole so the UI can show
    // an "Admin" badge and hide owner-only controls.
    //
    // Task #877 — list is membership-scoped for everyone including platform
    // admins. Admins reach non-listed competitions via search → public page →
    // "Edit competition", which resolves the console by ID via the detail
    // endpoint's UUID fallback (see GET /competitions/:slug below).
    const myHubAdminIds = db
      .select({ id: organizerAdmins.organizerId })
      .from(organizerAdmins)
      .where(eq(organizerAdmins.userId, me.id));
    const myCompAdminIds = db
      .select({ id: competitionAdmins.competitionId })
      .from(competitionAdmins)
      .where(eq(competitionAdmins.userId, me.id));
    const rows = await db
      .select()
      .from(tournaments)
      .where(
        or(
          eq(tournaments.ownerUserId, me.id),
          and(isNull(tournaments.ownerUserId), eq(tournaments.createdById, me.id)),
          inArray(tournaments.id, myCompAdminIds),
          inArray(tournaments.organizerId, myHubAdminIds),
        ),
      )
      .orderBy(desc(tournaments.createdAt));
    const listRows = await competitionListRows(rows);
    const data = listRows.map((listRow, index) => ({
        ...listRow,
        accessRole:
          (rows[index].ownerUserId ?? rows[index].createdById) === me.id
            ? "owner"
            : "admin",
      }));
    res.json({ data });
  }),
);

// Platform-admin support desk: search every competition without changing the
// membership-scoped "My competitions" sidebar. The result IDs link directly
// to the existing console UUID fallback, whose detail + mutations all use the
// shared canOperateCompetition admin bypass.
router.get(
  "/admin/competitions",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const query = String(req.query.q ?? "").trim();
    if (query.length < 2) {
      return apiError(res, 400, "Enter at least 2 characters to search.");
    }
    if (query.length > 200) {
      return apiError(res, 400, "Search is too long.");
    }
    // LIKE's %, _, and backslash are metacharacters. Escape them so an admin
    // searching for literal punctuation cannot accidentally request a broad
    // scan (the value remains parameterized through Drizzle).
    const search = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = await db
      .select()
      .from(tournaments)
      .where(
        or(
          ilike(tournaments.name, search),
          ilike(tournaments.slug, search),
          ...(UUID_RE.test(query) ? [eq(tournaments.id, query)] : []),
        ),
      )
      .orderBy(desc(tournaments.createdAt))
      .limit(50);
    const data = (await competitionListRows(rows)).map((row) => ({
        ...row,
        accessRole: "admin" as const,
      }));
    res.json({ data });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /competitions/:id — owner/admin edits details, type, claim setting,
// and branding (Competitions §2, §8, §9b).
// ---------------------------------------------------------------------------

const UpdateCompetitionBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  type: z.enum(COMPETITION_TYPES).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  location: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  autoApproveClaims: z.boolean().optional(),
  logoUrl: ImageUrl.nullable().optional(),
  brandColor: BrandColor.nullable().optional(),
  secondaryColor: BrandColor.nullable().optional(),
  tertiaryColor: BrandColor.nullable().optional(),
  bannerUrl: ImageUrl.nullable().optional(),
  websiteUrl: HttpUrl.nullable().optional(),
  // Task #818 — per-competition promo code override (free text; empty string
  // clears it so the hub's code applies again).
  promoCode: z.string().trim().max(64).nullable().optional(),
});

router.patch(
  "/competitions/:id",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [competition] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, req.params.id))
      .limit(1);
    if (!competition) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, competition))) {
      return apiError(res, 403, "Only the competition operator can edit it.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }

    // Friendly 413 for over-cap inline images (matches org-logo behavior)
    // instead of an opaque Zod max-length error.
    for (const field of ["logoUrl", "bannerUrl"] as const) {
      const v = (req.body as Record<string, unknown>)?.[field];
      if (
        typeof v === "string" &&
        v.startsWith("data:") &&
        v.length > MAX_IMAGE_DATA_URL_LENGTH
      ) {
        return apiError(
          res,
          413,
          "That image is too large. Please choose a smaller photo.",
        );
      }
    }
    const parsed = UpdateCompetitionBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return apiError(res, 400, first?.message ?? "Invalid competition details.", {
        code: "VALIDATION_FAILED",
        extras: { fields: parsed.error.flatten().fieldErrors },
      });
    }
    const body = parsed.data;
    const startDate = body.startDate ?? competition.startDate;
    const endDate = body.endDate ?? competition.endDate;
    if (endDate < startDate) {
      return apiError(res, 400, "endDate must be on or after startDate");
    }

    const [row] = await db
      .update(tournaments)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
        ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.autoApproveClaims !== undefined
          ? { autoApproveClaims: body.autoApproveClaims }
          : {}),
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
        ...(body.brandColor !== undefined ? { brandColor: body.brandColor } : {}),
        ...(body.secondaryColor !== undefined
          ? { secondaryColor: body.secondaryColor }
          : {}),
        ...(body.tertiaryColor !== undefined
          ? { tertiaryColor: body.tertiaryColor }
          : {}),
        ...(body.bannerUrl !== undefined ? { bannerUrl: body.bannerUrl } : {}),
        ...(body.websiteUrl !== undefined ? { websiteUrl: body.websiteUrl } : {}),
        ...(body.promoCode !== undefined
          ? { promoCode: body.promoCode || null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(tournaments.id, competition.id))
      .returning();

    res.json({
      id: row.id,
      slug: row.slug,
      name: row.name,
      type: row.type,
      startDate: row.startDate,
      endDate: row.endDate,
      location: row.location,
      description: row.description,
      autoApproveClaims: row.autoApproveClaims,
      logoUrl: row.logoUrl,
      brandColor: row.brandColor,
      secondaryColor: row.secondaryColor,
      tertiaryColor: row.tertiaryColor,
      bannerUrl: row.bannerUrl,
      websiteUrl: row.websiteUrl,
      promoCode: row.promoCode,
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /admin/tournaments — operator listing of all tournaments
// ---------------------------------------------------------------------------

router.get(
  "/admin/tournaments",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(tournaments)
      .orderBy(desc(tournaments.createdAt));
    const data = await Promise.all(
      rows.map(async (t) => {
        const [{ matchCount }] = await db
          .select({ matchCount: sql<number>`count(*)::int` })
          .from(tournamentMatches)
          .where(eq(tournamentMatches.tournamentId, t.id));
        const [{ participantCount }] = await db
          .select({ participantCount: sql<number>`count(*)::int` })
          .from(tournamentParticipants)
          .where(eq(tournamentParticipants.tournamentId, t.id));
        const [{ featuredCount }] = await db
          .select({ featuredCount: sql<number>`count(*)::int` })
          .from(articles)
          .where(
            and(
              eq(articles.competitionId, t.id),
              eq(articles.featured, true),
              eq(articles.status, "published"),
              isNull(articles.hiddenAt),
            ),
          );
        return {
          id: t.id,
          slug: t.slug,
          name: t.name,
          type: t.type,
          startDate: t.startDate,
          endDate: t.endDate,
          location: t.location,
          ownerUserId: t.ownerUserId ?? t.createdById ?? null,
          brandColor: t.brandColor,
          secondaryColor: t.secondaryColor,
          tertiaryColor: t.tertiaryColor,
          logoUrl: t.logoUrl,
          bannerUrl: t.bannerUrl,
          websiteUrl: t.websiteUrl,
          matchCount,
          participantCount,
          featuredCount,
          createdAt: t.createdAt.toISOString(),
        };
      }),
    );
    res.json({ data });
  }),
);

// ---------------------------------------------------------------------------
// GET /tournaments/:slug — PUBLIC funnel read. Returns tournament meta, the
// participant list with claimed/unclaimed state, and the full match schedule
// with resolved home/away names. The client groups by division / bracket /
// field / time for display. Scores are intentionally not part of
// competitions — the content model is game recaps only.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const publicCompetitionRead = asyncHandler(async (req, res) => {
    // Task #877 — platform admins reach the console via "Edit competition" on
    // the public page, which passes the competition's UUID as the route param.
    // Accept either a slug or a UUID so the detail endpoint works for both.
    const param = req.params.slug;
    const [tournament] = await db
      .select()
      .from(tournaments)
      .where(UUID_RE.test(param) ? eq(tournaments.id, param) : eq(tournaments.slug, param))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Competition not found");

    // Task #723 — "Presented by <Organizer>" chip linking back to the hub.
    const [organizerRow] = tournament.organizerId
      ? await db
          .select({
            id: competitionOrganizers.id,
            slug: competitionOrganizers.slug,
            name: competitionOrganizers.name,
            logoUrl: competitionOrganizers.logoUrl,
            promoCode: competitionOrganizers.promoCode,
          })
          .from(competitionOrganizers)
          .where(eq(competitionOrganizers.id, tournament.organizerId))
          .limit(1)
      : [];

    // Viewer follow state for the Follow button. Logged-out → false.
    const viewerId = req.sessionUser?.id ?? null;
    const isFollowing = viewerId
      ? (
          await db
            .select({ userId: competitionFollowers.userId })
            .from(competitionFollowers)
            .where(
              and(
                eq(competitionFollowers.competitionId, tournament.id),
                eq(competitionFollowers.userId, viewerId),
              ),
            )
            .limit(1)
        ).length > 0
      : false;

    // Operator check up front — it decides whether hidden participant slots
    // are included (greyed for operators) or omitted entirely (public).
    const canManage = req.sessionUser
      ? await canOperateCompetition(req.sessionUser, tournament)
      : false;

    const allPartRows = await db
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.tournamentId, tournament.id))
      .orderBy(tournamentParticipants.name);
    // Hidden slots stay in the schedule (matches resolve names through the
    // full map) — hiding only removes them from the public Teams list.
    const partById = new Map(allPartRows.map((p) => [p.id, p]));
    const partRows = canManage
      ? allPartRows
      : allPartRows.filter((p) => p.hiddenAt == null);

    const matchRows = await db
      .select()
      .from(tournamentMatches)
      .where(eq(tournamentMatches.tournamentId, tournament.id));

    // Active window: today's date (UTC calendar) within [startDate, endDate]
    // inclusive — same comparison the recap gate uses.
    const today = new Date().toISOString().slice(0, 10);
    const isActive = today >= tournament.startDate && today <= tournament.endDate;

    const claimedCount = partRows.filter((p) => p.teamId != null).length;

    // Featured game recaps rail (§7) — published recaps the operator featured.
    // The card carries the AUTHORING TEAM's identity (name), sitting inside
    // the competition-branded page.
    const featuredRows = await db
      .select({
        article: articles,
        teamName: teams.name,
        matchId: tournamentMatches.id,
        matchDate: tournamentMatches.matchDate,
        matchDivision: tournamentMatches.division,
        matchBracket: tournamentMatches.bracket,
      })
      .from(articles)
      .innerJoin(teams, eq(teams.id, articles.teamId))
      .leftJoin(
        tournamentMatches,
        and(
          eq(tournamentMatches.id, articles.competitionGameId),
          eq(tournamentMatches.tournamentId, tournament.id),
        ),
      )
      .where(
        and(
          eq(articles.competitionId, tournament.id),
          eq(articles.featured, true),
          eq(articles.status, "published"),
          isNull(articles.hiddenAt),
        ),
      )
      .orderBy(desc(articles.createdAt))
      .limit(12);

    // Task #852 — brackets in the organizer's saved order, for the public
    // page's recap filter chips. Labels only; safe to expose publicly.
    const bracketRows = await db
      .select()
      .from(competitionBrackets)
      .where(eq(competitionBrackets.tournamentId, tournament.id))
      .orderBy(asc(competitionBrackets.sortOrder), asc(competitionBrackets.createdAt));
    const bracketLabelById = new Map(bracketRows.map((b) => [b.id, b.label]));

    const competitionMeta = {
      id: tournament.id,
      slug: tournament.slug,
      name: tournament.name,
      type: tournament.type,
      startDate: tournament.startDate,
      endDate: tournament.endDate,
      location: tournament.location,
      description: tournament.description,
      isActive,
      isEnded: today > tournament.endDate,
      autoApproveClaims: tournament.autoApproveClaims,
      logoUrl: tournament.logoUrl,
      brandColor: tournament.brandColor,
      secondaryColor: tournament.secondaryColor,
      tertiaryColor: tournament.tertiaryColor,
      bannerUrl: tournament.bannerUrl,
      websiteUrl: tournament.websiteUrl,
      claimedCount,
      participantCount: partRows.length,
      // Viewer follow state (quick-access follows; NOT a feed source).
      // False for logged-out viewers.
      isFollowing,
      // True only for the competition operator (owner/creator or platform
      // admin) — drives the "Edit competition" button on the public page.
      canManage,
      // Task #818 — promo code is admin-only (never in the public payload).
      // The hub's code rides along so the console can show the fallback.
      ...(canManage ? { promoCode: tournament.promoCode } : {}),
      // Parent-company hub (null when the competition is standalone).
      organizer: organizerRow
        ? {
            id: organizerRow.id,
            slug: organizerRow.slug,
            name: organizerRow.name,
            logoUrl: organizerRow.logoUrl,
            ...(canManage ? { promoCode: organizerRow.promoCode } : {}),
          }
        : null,
    };

    res.json({
      // Emitted under both keys so the legacy /t page and the new /c page
      // read the same payload during the rename transition.
      tournament: competitionMeta,
      competition: competitionMeta,
      // Task #852 — organizer-ordered brackets driving the recap filter.
      brackets: bracketRows.map((b) => ({
        id: b.id,
        label: b.label,
        gender: b.gender,
        ageGroup: b.ageGroup,
      })),
      featuredRecaps: featuredRows.map(
        ({ article: a, teamName, matchId, matchDate, matchDivision, matchBracket }) => {
          const linkedMatch = matchId != null;
          const effectiveGameDate =
            linkedMatch && matchDate
              ? matchDate
              : timestampToCompetitionDate(a.gameDate);
          const groupDivision =
            linkedMatch && matchDivision?.trim()
              ? matchDivision.trim()
              : null;
          const groupBracket =
            linkedMatch && matchBracket?.trim()
              ? matchBracket.trim()
              : a.bracketId
                ? bracketLabelById.get(a.bracketId) ?? null
                : null;
          return {
        // Post ids are prefixed ("article-<uuid>") — the client links to
        // /posts/:id which 404s on a raw uuid.
        id: `article-${a.id}`,
        title: a.title,
        body: a.body,
        summary: a.summary,
        coverImageUrl: a.coverImageUrl,
        gameDate: a.gameDate,
        opponentName: a.opponentName,
        teamScore: a.teamScore,
        opponentScore: a.opponentScore,
        teamId: a.teamId,
        teamName,
        publishedAt: a.publishedAt,
        // Task #852 — used only for the public page's bracket filter;
        // never rendered on the post itself.
        bracketId: a.bracketId,
            // Grouping metadata is derived on read; it is never persisted.
            effectiveGameDate,
            groupDivision,
            groupBracket,
            groupingSource: linkedMatch ? "competition-game" : "recap",
            week: competitionWeekForDate(effectiveGameDate),
          };
        },
      ),
      participants: partRows.map((p) => ({
        id: p.id,
        name: p.name,
        division: p.division,
        bracket: p.bracket,
        // Task #865 — sorting bracket this slot belongs to (null = "Other").
        // Id-based like recaps, so bracket renames/reorders mirror here.
        bracketId: p.bracketId,
        age: p.age,
        gender: p.gender,
        claimed: p.teamId != null,
        pending: p.teamId == null && p.pendingTeamId != null,
        teamId: p.teamId,
        // Operators only — public viewers never receive hidden slots at all.
        ...(canManage && p.hiddenAt != null ? { hidden: true } : {}),
      })),
      matches: matchRows
        .map((m) => {
          const home = m.homeParticipantId ? partById.get(m.homeParticipantId) : null;
          const away = m.awayParticipantId ? partById.get(m.awayParticipantId) : null;
          return {
            id: m.id,
            matchNumber: m.matchNumber,
            matchDate: m.matchDate,
            startTime: parseStartTimeCell(m.startTime),
            age: m.age,
            gender: m.gender,
            division: m.division,
            bracket: m.bracket,
            venue: m.venue,
            venueState: m.venueState,
            field: m.field,
            homeName: home?.name ?? null,
            awayName: away?.name ?? null,
            homeParticipantId: m.homeParticipantId,
            awayParticipantId: m.awayParticipantId,
            homeTeamId: home?.teamId ?? null,
            awayTeamId: away?.teamId ?? null,
            // Task #765 — postponed/canceled games render with a status
            // treatment instead of silently disappearing.
            status: m.status,
            statusReason: m.statusReason,
             week: competitionWeekForDate(m.matchDate),
          };
        })
        .sort((a, b) => {
          // Stable display order: date, then time, then match number.
          const da = a.matchDate ?? "";
          const dbb = b.matchDate ?? "";
          if (da !== dbb) return da < dbb ? -1 : 1;
          const ta = a.startTime ?? "";
          const tb = b.startTime ?? "";
          if (ta !== tb) return ta < tb ? -1 : 1;
          return a.matchNumber.localeCompare(b.matchNumber, undefined, {
            numeric: true,
          });
        }),
    });
});

router.get("/tournaments/:slug", publicCompetitionRead);
router.get("/competitions/:slug", publicCompetitionRead);

// ---------------------------------------------------------------------------
// Competition follows — quick access only, intentionally NOT a feed source.
// Mirrors team_followers but never enters the home-feed fan-in.
// ---------------------------------------------------------------------------

// POST /competitions/:slug/follow — idempotent (conflict → no-op).
router.post(
  "/competitions/:slug/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [tournament] = await db
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(eq(tournaments.slug, req.params.slug))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Competition not found");
    await db
      .insert(competitionFollowers)
      .values({ competitionId: tournament.id, userId: me.id })
      .onConflictDoNothing();
    res.json({ ok: true, isFollowing: true });
  }),
);

// DELETE /competitions/:slug/follow — idempotent.
router.delete(
  "/competitions/:slug/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [tournament] = await db
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(eq(tournaments.slug, req.params.slug))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Competition not found");
    await db
      .delete(competitionFollowers)
      .where(
        and(
          eq(competitionFollowers.competitionId, tournament.id),
          eq(competitionFollowers.userId, me.id),
        ),
      );
    res.json({ ok: true, isFollowing: false });
  }),
);

// GET /teams/:teamId/claimed-competitions — competitions this team holds a
// CLAIMED slot in (pending claims excluded — `teamId` only gets stamped once
// a claim is approved). Powers the recap composer's competition picker, which
// is why only claimed competitions appear: the recap → competition link
// requires a claimed slot, so listing anything else would just produce a 403
// at publish time. Extra-spec route (same precedent as the rest of this file).
router.get(
  "/teams/:teamId/claimed-competitions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamIdParse = z.string().uuid().safeParse(req.params.teamId);
    if (!teamIdParse.success) return apiError(res, 400, "Invalid team id");
    const rows = await db
      .select({
        id: tournaments.id,
        slug: tournaments.slug,
        name: tournaments.name,
        type: tournaments.type,
        logoUrl: tournaments.logoUrl,
        brandColor: tournaments.brandColor,
        secondaryColor: tournaments.secondaryColor,
        startDate: tournaments.startDate,
        endDate: tournaments.endDate,
      })
      .from(tournamentParticipants)
      .innerJoin(
        tournaments,
        eq(tournaments.id, tournamentParticipants.tournamentId),
      )
      .where(eq(tournamentParticipants.teamId, teamIdParse.data))
      .orderBy(desc(tournaments.startDate));
    // A team can hold multiple slots (divisions/brackets) in the same
    // competition — dedupe so the picker lists each competition once.
    const seen = new Set<string>();
    const competitions = rows.filter((r) =>
      seen.has(r.id) ? false : (seen.add(r.id), true),
    );
    res.json({ competitions });
  }),
);

// GET /my/followed-competitions — quick-access list for the feed sidebar.
router.get(
  "/my/followed-competitions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const rows = await db
      .select({
        id: tournaments.id,
        slug: tournaments.slug,
        name: tournaments.name,
        type: tournaments.type,
        logoUrl: tournaments.logoUrl,
        brandColor: tournaments.brandColor,
        startDate: tournaments.startDate,
        endDate: tournaments.endDate,
        followedAt: competitionFollowers.createdAt,
      })
      .from(competitionFollowers)
      .innerJoin(tournaments, eq(tournaments.id, competitionFollowers.competitionId))
      .where(eq(competitionFollowers.userId, me.id))
      .orderBy(desc(competitionFollowers.createdAt));
    res.json({ data: rows });
  }),
);

// ---------------------------------------------------------------------------
// POST /tournaments/:id/import — operator uploads the match-slot CSV.
//
// Idempotent on re-upload:
//   - participants upsert on the unique-slot index (tournament,div,bracket,
//     nameKey) via onConflictDoNothing, then re-read to map slot → id.
//   - matches upsert on the unique (tournament, matchNumber) index via
//     onConflictDoUpdate so re-running corrects scores / participant links.
// ---------------------------------------------------------------------------

const ImportBody = z.object({
  csv: z
    .string()
    .min(1)
    .max(
      MAX_IMPORT_CSV_CHARS,
      "Schedule file is too large; maximum CSV size is 10 MB.",
    ),
  // Task #766 — dry-run preview: parse + diff against existing games without
  // writing anything. The apply path (dryRun absent/false) is unchanged.
  dryRun: z.boolean().optional(),
});

// Fields the CSV upsert overwrites, compared field-by-field for the preview.
// Team sides compare by lowercase key (matching slot semantics) but display
// the human name. status is only touched when the file provides a
// recognized value in an optional status column (Task #767); statusReason
// is never touched by imports.
const DIFF_FIELDS = [
  { key: "matchDate", label: "date" },
  { key: "startTime", label: "start time" },
  { key: "age", label: "age" },
  { key: "gender", label: "gender" },
  { key: "division", label: "division" },
  { key: "bracket", label: "bracket" },
  { key: "venue", label: "venue" },
  { key: "venueState", label: "venue state" },
  { key: "field", label: "field" },
] as const;

const importScheduleHandler = asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [tournament] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, req.params.id))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Competition not found");
    // Owner-or-admin (Competitions §3): the operator uploads their own
    // schedule; platform admins retain global access.
    if (!(await canOperateCompetition(me, tournament))) {
      return apiError(
        res,
        403,
        "Only the competition operator can upload its schedule.",
        { code: "COMPETITION_FORBIDDEN" },
      );
    }

    const parsed = ImportBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }

    const grid = parseCsv(parsed.data.csv).filter((r) =>
      r.some((c) => c.trim() !== ""),
    );
    if (grid.length === 0) return apiError(res, 400, "CSV is empty");

    const { index: headerIndex, missing } = resolveCsvHeader(grid[0]);
    if (missing.length > 0) {
      // Task #768 — include what WAS recognized so a mis-named column is
      // easy to spot ("home team" arrived as "Home Side", etc.).
      const found = buildColumnSummary(grid[0], headerIndex);
      const foundNote =
        found.matched.length > 0
          ? ` Columns we did recognize: ${found.matched.map((m) => `${m.column} (from "${m.header}")`).join(", ")}.`
          : "";
      const ignoredNote =
        found.ignoredHeaders.length > 0
          ? ` Headers we couldn't match: ${found.ignoredHeaders.map((h) => `"${h}"`).join(", ")}.`
          : "";
      return apiError(
        res,
        400,
        `Couldn't find these required columns in your file: ${missing.join(", ")}. ` +
          "Make sure the first row has headers like: match #, date, home team, away team, division (or group/bracket)." +
          foundNote +
          ignoredNote,
      );
    }
    const dataRows = grid.slice(1);
    if (dataRows.length > MAX_IMPORT_ROWS) {
      return apiError(
        res,
        400,
        `Too many rows (${dataRows.length}); max ${MAX_IMPORT_ROWS}.`,
      );
    }

    const col = (rec: string[], name: CsvColumn): string => {
      const i = headerIndex[name];
      return i === undefined ? "" : (rec[i] ?? "").trim();
    };

    interface MatchRec {
      matchNumber: string;
      matchDate: string | null;
      startTime: string | null;
      age: string | null;
      gender: string | null;
      division: string;
      bracket: string;
      venue: string | null;
      venueState: string | null;
      field: string | null;
      homeName: string;
      homeKey: string;
      awayName: string;
      awayKey: string;
      // Task #767 — null means "leave the existing status untouched".
      status: "scheduled" | "postponed" | "canceled" | null;
    }

    // First pass: parse rows + collect unique participant slots.
    const matchRecs: MatchRec[] = [];
    const slots = new Map<
      string,
      { name: string; nameKey: string; division: string; bracket: string; age: string | null; gender: string | null }
    >();

    // Task #768 — plain-language row warnings for the organizer. Display
    // only: skipped/partial rows behave exactly as before. Row numbers are
    // 1-based file line numbers (header = row 1).
    const rowWarnings: { row: number; reason: string }[] = [];
    // Task #865 — rows (with a match #) whose group/division cell is blank.
    const missingGroupRows: { row: number; matchNumber: string }[] = [];

    for (const [rowIdx, r] of dataRows.entries()) {
      const fileRow = rowIdx + 2;
      const matchNumber = col(r, "match #");
      if (!matchNumber) {
        rowWarnings.push({
          row: fileRow,
          reason: "Skipped — no value in the match # column.",
        });
        continue; // skip rows with no match id
      }
      const division = col(r, "division");
      const bracket = col(r, "bracket");
      // Task #865 — group is mandatory per game row: every game must carry a
      // division (or bracket) value so the Teams page is organized from the
      // first upload. Collected here, rejected as a batch below.
      if (!division && !bracket) {
        missingGroupRows.push({ row: fileRow, matchNumber });
      }
      const age = col(r, "age") || null;
      const gender = col(r, "gender") || null;
      const homeName = col(r, "home team");
      const awayName = col(r, "away team");
      const homeKey = homeName.toLowerCase();
      const awayKey = awayName.toLowerCase();

      if (!homeName || !awayName) {
        rowWarnings.push({
          row: fileRow,
          reason: `Game ${matchNumber} imported without a ${!homeName && !awayName ? "home or away team" : !homeName ? "home team" : "away team"} name — that side stays blank until a re-upload fills it in.`,
        });
      }
      const rawStatus = col(r, "status");
      const status = rawStatus
        ? CSV_STATUS_VALUES[rawStatus.trim().toLowerCase()] ?? null
        : null;
      if (rawStatus && status === null) {
        rowWarnings.push({
          row: fileRow,
          reason: `Game ${matchNumber}: couldn't read "${rawStatus}" as a status, so the game's status was left unchanged. Use scheduled, postponed, or canceled.`,
        });
      }
      const rawDate = col(r, "date");
      if (rawDate && parseDateCell(rawDate) === null) {
        rowWarnings.push({
          row: fileRow,
          reason: `Game ${matchNumber}: couldn't read "${rawDate}" as a date, so the game imported without one. Dates like 2026-07-11 or 7/11/2026 work best.`,
        });
      }

      for (const [name, key] of [
        [homeName, homeKey],
        [awayName, awayKey],
      ] as const) {
        if (!name) continue;
        const sk = slotKey(division, bracket, key, gender);
        if (!slots.has(sk)) {
          slots.set(sk, { name, nameKey: key, division, bracket, age, gender });
        }
      }

      matchRecs.push({
        matchNumber,
        matchDate: parseDateCell(col(r, "date")),
        startTime: parseStartTimeCell(col(r, "start time")),
        age,
        gender,
        division,
        bracket,
        venue: col(r, "venue") || null,
        venueState: col(r, "venue state") || null,
        field: col(r, "field") || null,
        homeName,
        homeKey,
        awayName,
        awayKey,
        status,
      });
    }

    // Task #865 — reject the whole upload when any game row is missing its
    // group/division value (applies to preview AND apply, so the organizer
    // hears about it at preview time). Naming the exact rows makes the fix
    // a quick spreadsheet edit rather than a guessing game.
    if (missingGroupRows.length > 0) {
      const shown = missingGroupRows.slice(0, 15);
      const rowList = shown
        .map((r) => `row ${r.row} (game ${r.matchNumber})`)
        .join(", ");
      const more =
        missingGroupRows.length > shown.length
          ? ` and ${missingGroupRows.length - shown.length} more`
          : "";
      return apiError(
        res,
        400,
        `Every game needs a value in the division (group) column so your Teams page stays organized. ` +
          `Missing on: ${rowList}${more}. Fill those cells in and upload again.`,
      );
    }

    // Task #766 — dry-run preview: diff the parsed rows against existing
    // games and return without writing. Reuses the exact same parse above,
    // so preview and apply can never disagree.
    if (parsed.data.dryRun) {
      // Later rows win in the apply loop (upsert per row), so preview the
      // same way: keep the LAST rec per match number and warn on dupes.
      const byNumber = new Map<string, MatchRec>();
      for (const m of matchRecs) {
        if (byNumber.has(m.matchNumber)) {
          rowWarnings.push({
            row: 0,
            reason: `Game ${m.matchNumber} appears more than once in the file — the last row wins.`,
          });
        }
        byNumber.set(m.matchNumber, m);
      }

      const existing = await db
        .select()
        .from(tournamentMatches)
        .where(eq(tournamentMatches.tournamentId, tournament.id));
      const partRows = await db
        .select()
        .from(tournamentParticipants)
        .where(eq(tournamentParticipants.tournamentId, tournament.id));
      const partById = new Map(partRows.map((p) => [p.id, p]));
      const sideOf = (participantId: string | null) => {
        const p = participantId ? partById.get(participantId) : undefined;
        return { name: p?.name ?? "", key: p?.nameKey ?? "" };
      };

      const existingByNumber = new Map(existing.map((m) => [m.matchNumber, m]));

      const added: {
        matchNumber: string;
        matchDate: string | null;
        startTime: string | null;
        homeName: string;
        awayName: string;
      }[] = [];
      const changed: {
        matchNumber: string;
        changes: { field: string; before: string; after: string }[];
      }[] = [];
      let unchangedCount = 0;

      const show = (v: string | null) => (v == null || v === "" ? "—" : v);

      for (const m of byNumber.values()) {
        const ex = existingByNumber.get(m.matchNumber);
        if (!ex) {
          added.push({
            matchNumber: m.matchNumber,
            matchDate: m.matchDate,
            startTime: m.startTime,
            homeName: m.homeName,
            awayName: m.awayName,
          });
          continue;
        }
        const changes: { field: string; before: string; after: string }[] = [];
        for (const f of DIFF_FIELDS) {
          const before = (ex[f.key] ?? "") as string;
          const after = (m[f.key] ?? "") as string;
          if (before !== after) {
            changes.push({ field: f.label, before: show(before || null), after: show(after || null) });
          }
        }
        // Task #767 — status only diffs when the file provides one (blank
        // cells leave the existing status untouched).
        if (m.status !== null && m.status !== ex.status) {
          changes.push({ field: "status", before: ex.status, after: m.status });
        }
        const exHome = sideOf(ex.homeParticipantId);
        const exAway = sideOf(ex.awayParticipantId);
        // Compare team sides by lowercase key + slot (division/bracket moves
        // relink the slot even when the name text is identical).
        const slotMoved =
          ex.division !== m.division || ex.bracket !== m.bracket;
        if (exHome.key !== m.homeKey || (slotMoved && m.homeName)) {
          changes.push({ field: "home team", before: show(exHome.name || null), after: show(m.homeName || null) });
        }
        if (exAway.key !== m.awayKey || (slotMoved && m.awayName)) {
          changes.push({ field: "away team", before: show(exAway.name || null), after: show(m.awayName || null) });
        }
        // Dedupe: a home/away change caused purely by a division/bracket move
        // with the same name shows identical before/after — drop those.
        const realChanges = changes.filter((c) => c.before !== c.after);
        if (realChanges.length > 0) {
          changed.push({ matchNumber: m.matchNumber, changes: realChanges });
        } else {
          unchangedCount += 1;
        }
      }

      // Renumbering heuristic: a "new" game whose date + team pair matches an
      // existing game filed under a DIFFERENT number usually means the
      // scheduling tool regenerated match numbers — importing would create
      // duplicates instead of updates.
      const pairKey = (date: string | null, a: string, b: string) =>
        `${date ?? ""}\u0000${[a, b].sort().join("\u0000")}`;
      const existingByPair = new Map<string, string[]>();
      for (const ex of existing) {
        const h = sideOf(ex.homeParticipantId).key;
        const a = sideOf(ex.awayParticipantId).key;
        if (!h || !a) continue;
        const k = pairKey(ex.matchDate, h, a);
        existingByPair.set(k, [...(existingByPair.get(k) ?? []), ex.matchNumber]);
      }
      const renumberWarnings: {
        fileMatchNumber: string;
        existingMatchNumber: string;
        matchDate: string | null;
        homeName: string;
        awayName: string;
      }[] = [];
      for (const m of added) {
        const rec = byNumber.get(m.matchNumber)!;
        if (!rec.homeKey || !rec.awayKey) continue;
        const hits = existingByPair.get(
          pairKey(rec.matchDate, rec.homeKey, rec.awayKey),
        );
        const other = hits?.find((n) => n !== m.matchNumber);
        if (other !== undefined) {
          renumberWarnings.push({
            fileMatchNumber: m.matchNumber,
            existingMatchNumber: other,
            matchDate: rec.matchDate,
            homeName: rec.homeName,
            awayName: rec.awayName,
          });
        }
      }

      // Informational: games in the DB that this file doesn't mention.
      // Imports never delete, so these stay untouched.
      const missingFromFile = existing
        .filter((ex) => !byNumber.has(ex.matchNumber))
        .map((ex) => ({
          matchNumber: ex.matchNumber,
          matchDate: ex.matchDate,
          homeName: sideOf(ex.homeParticipantId).name,
          awayName: sideOf(ex.awayParticipantId).name,
        }));

      return res.json({
        ok: true,
        preview: true,
        tournamentId: tournament.id,
        addedCount: added.length,
        changedCount: changed.length,
        renumberWarningCount: renumberWarnings.length,
        missingFromFileCount: missingFromFile.length,
        rowWarningCount: rowWarnings.length,
        added: added.slice(0, PREVIEW_SAMPLE_LIMIT),
        changed: changed.slice(0, PREVIEW_SAMPLE_LIMIT),
        unchangedCount,
        renumberWarnings: renumberWarnings.slice(0, PREVIEW_SAMPLE_LIMIT),
        missingFromFile: missingFromFile.slice(0, PREVIEW_SAMPLE_LIMIT),
        columns: buildColumnSummary(grid[0], headerIndex),
        rowWarnings: rowWarnings.slice(0, PREVIEW_SAMPLE_LIMIT),
      });
    }

    // Task #767 — snapshot before-state so we can diff material fields
    // (date / start time / venue / field) after the upserts and send ONE
    // digest notification per affected claimed-team staffer.
    const beforeMatches = await db
      .select()
      .from(tournamentMatches)
      .where(eq(tournamentMatches.tournamentId, tournament.id));
    const beforeByNumber = new Map(beforeMatches.map((m) => [m.matchNumber, m]));
    // PostgreSQL cannot upsert duplicate conflict keys in one INSERT. Preserve
    // the established "last row wins" behavior while allowing batched writes.
    const finalMatchByNumber = new Map<string, MatchRec>();
    for (const m of matchRecs) finalMatchByNumber.set(m.matchNumber, m);
    const finalMatchRecs = Array.from(finalMatchByNumber.values());

    const summary = await db.transaction(async (tx) => {
      // Task #780 — serialize imports against the bulk clear-games /
      // clear-teams actions (same per-competition lock key) so a clear can't
      // interleave with an import and leave a mixed schedule.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`competition-clear:${tournament.id}`}))`,
      );

      // Upsert participant slots (idempotent on the unique-slot index).
      const slotValues = Array.from(slots.values());
      for (const batch of inBatches(slotValues)) {
        await tx
          .insert(tournamentParticipants)
          .values(
            batch.map((s) => ({
              tournamentId: tournament.id,
              name: s.name,
              nameKey: s.nameKey,
              division: s.division,
              bracket: s.bracket,
              age: s.age,
              gender: s.gender,
            })),
          )
          .onConflictDoNothing();
      }

      // Re-imports must refresh the display category on existing team slots.
      // Identity stays name + gender, so claims and hidden-state survive, but
      // age/group/bracket reflect the current schedule rather than the first
      // file ever uploaded.
      let partRows = await tx
        .select()
        .from(tournamentParticipants)
        .where(eq(tournamentParticipants.tournamentId, tournament.id));
      const participantIdBySlot = new Map(
        partRows.map((p) => [
          slotKey(p.division, p.bracket, p.nameKey, p.gender),
          p.id,
        ]),
      );
      const participantRefreshes: Array<
        typeof tournamentParticipants.$inferInsert
      > = [];
      for (const slot of slotValues) {
        const participantId = participantIdBySlot.get(
          slotKey(slot.division, slot.bracket, slot.nameKey, slot.gender),
        );
        if (!participantId) continue;
        participantRefreshes.push({
          id: participantId,
          tournamentId: tournament.id,
          name: slot.name,
          nameKey: slot.nameKey,
          division: slot.division,
          bracket: slot.bracket,
          age: slot.age,
          gender: slot.gender,
        });
      }
      for (const batch of inBatches(participantRefreshes)) {
        await tx
          .insert(tournamentParticipants)
          .values(batch)
          .onConflictDoUpdate({
            target: tournamentParticipants.id,
            set: {
              division: sql`excluded.division`,
              bracket: sql`excluded.bracket`,
              age: sql`excluded.age`,
            },
          })
      }

      // Re-read participants after refreshing imported display categories.
      partRows = await tx
        .select()
        .from(tournamentParticipants)
        .where(eq(tournamentParticipants.tournamentId, tournament.id));
      const partBySlot = new Map<string, string>();
      for (const p of partRows) {
        partBySlot.set(slotKey(p.division, p.bracket, p.nameKey, p.gender), p.id);
      }

      const matchValue = (m: MatchRec) => ({
        tournamentId: tournament.id,
        matchNumber: m.matchNumber,
        matchDate: m.matchDate,
        startTime: m.startTime,
        age: m.age,
        gender: m.gender,
        division: m.division,
        bracket: m.bracket,
        venue: m.venue,
        venueState: m.venueState,
        field: m.field,
        homeParticipantId: m.homeName
          ? partBySlot.get(
              slotKey(m.division, m.bracket, m.homeKey, m.gender),
            ) ?? null
          : null,
        awayParticipantId: m.awayName
          ? partBySlot.get(
              slotKey(m.division, m.bracket, m.awayKey, m.gender),
            ) ?? null
          : null,
      });
      const commonConflictSet = {
        matchDate: sql`excluded.match_date`,
        startTime: sql`excluded.start_time`,
        age: sql`excluded.age`,
        gender: sql`excluded.gender`,
        division: sql`excluded.division`,
        bracket: sql`excluded.bracket`,
        venue: sql`excluded.venue`,
        venueState: sql`excluded.venue_state`,
        field: sql`excluded.field`,
        homeParticipantId: sql`excluded.home_participant_id`,
        awayParticipantId: sql`excluded.away_participant_id`,
        updatedAt: new Date(),
      };

      // Upsert matches in bounded batches. Status-bearing and status-blank
      // rows are separate so a blank status still leaves an existing inline
      // status untouched.
      const withoutStatus = finalMatchRecs.filter((m) => m.status === null);
      for (const batch of inBatches(withoutStatus)) {
        await tx
          .insert(tournamentMatches)
          .values(batch.map(matchValue))
          .onConflictDoUpdate({
            target: [tournamentMatches.tournamentId, tournamentMatches.matchNumber],
            set: commonConflictSet,
          });
      }
      const withStatus = finalMatchRecs.filter((m) => m.status !== null);
      for (const batch of inBatches(withStatus)) {
        await tx
          .insert(tournamentMatches)
          .values(
            batch.map((m) => ({
              ...matchValue(m),
              status: m.status!,
            })),
          )
          .onConflictDoUpdate({
            target: [tournamentMatches.tournamentId, tournamentMatches.matchNumber],
            set: {
              ...commonConflictSet,
              status: sql`excluded.status`,
              statusReason: sql`CASE WHEN excluded.status = 'scheduled' THEN NULL ELSE ${tournamentMatches.statusReason} END`,
            },
          });
      }

      return {
        participantCount: partRows.length,
        matchesUpserted: finalMatchRecs.length,
        partRows,
      };
    });

    // Task #852 — auto-seed brackets from the freshly imported schedule's
    // division/bracket column. Idempotent: never duplicates or clobbers
    // organizer-edited brackets/order; new values are appended.
    try {
      await seedBracketsFromSchedule(tournament.id);
      // Task #865 — attach newly created team slots to their bracket so the
      // Teams list is grouped immediately after the upload.
      await linkParticipantsToBrackets(tournament.id);
    } catch (err) {
      // Bracket seeding is a convenience — never fail the import over it.
      req.log?.error?.({ err }, "bracket auto-seed failed");
    }

    // Task #767 — digest fan-out. Compare each imported game's material
    // fields against the pre-import snapshot; new games and cosmetic-only
    // updates stay silent. Each affected claimed-team staffer gets ONE
    // notification for the whole import, never a per-game flood.
    {
      const partById = new Map(summary.partRows.map((p) => [p.id, p]));
      const partBySlot = new Map(
        summary.partRows.map((p) => [slotKey(p.division, p.bracket, p.nameKey, p.gender), p]),
      );
      // Later rows win on upsert, so diff only each match number's LAST row.
      const changedGames: { teamIds: string[]; statusChanged: boolean }[] = [];
      for (const m of finalMatchByNumber.values()) {
        const ex = beforeByNumber.get(m.matchNumber);
        if (!ex) continue; // brand-new game: no one to re-plan around it yet
        const changes = materialChanges(ex, m);
        const statusChanged = m.status !== null && m.status !== ex.status;
        if (changes.length === 0 && !statusChanged) continue;
        const teamIds = new Set<string>();
        for (const pid of [ex.homeParticipantId, ex.awayParticipantId]) {
          const t = pid ? partById.get(pid)?.teamId : null;
          if (t) teamIds.add(t);
        }
        for (const [name, key] of [
          [m.homeName, m.homeKey],
          [m.awayName, m.awayKey],
        ] as const) {
          if (!name) continue;
          const t = partBySlot.get(slotKey(m.division, m.bracket, key, m.gender))?.teamId;
          if (t) teamIds.add(t);
        }
        changedGames.push({ teamIds: Array.from(teamIds), statusChanged });
      }
      await notifyBulkGamesChanged({
        competition: tournament,
        changedGames,
        actorUserId: me.id,
      });
    }

    res.json({
      ok: true,
      tournamentId: tournament.id,
      matchesUpserted: summary.matchesUpserted,
      participantCount: summary.participantCount,
      // Task #768 — display-only column-match + row-warning summary so the
      // organizer can spot a mis-named column or skipped rows.
      columns: buildColumnSummary(grid[0], headerIndex),
      rowWarnings,
    });
});

router.post(
  "/tournaments/:id/import",
  requireAuth,
  tournamentWriteLimiter,
  importScheduleHandler,
);
router.post(
  "/competitions/:id/import",
  requireAuth,
  tournamentWriteLimiter,
  importScheduleHandler,
);

// ---------------------------------------------------------------------------
// Task #765 — inline single-game management for the organizer console.
// Create / edit / status-change / delete ONE match without a CSV re-import.
// All guarded by canOperateCompetition; the CSV import stays the bulk source
// of truth (a later re-import of the same match # overwrites these fields —
// documented in the console UI).
// ---------------------------------------------------------------------------

// Postponed/canceled lifecycle values the console can set. "completed" is
// reserved (schema comment) but intentionally not exposed here.
const MATCH_STATUSES = ["scheduled", "postponed", "canceled"] as const;

const MatchFieldsBody = z.object({
  matchNumber: z.string().trim().min(1, "Match # is required").max(50),
  matchDate: z.string().trim().max(50).nullable().optional(),
  startTime: z.string().trim().max(50).nullable().optional(),
  age: z.string().trim().max(100).nullable().optional(),
  gender: z.string().trim().max(100).nullable().optional(),
  division: z.string().trim().max(200).optional(),
  bracket: z.string().trim().max(200).optional(),
  venue: z.string().trim().max(200).nullable().optional(),
  venueState: z.string().trim().max(100).nullable().optional(),
  field: z.string().trim().max(200).nullable().optional(),
  homeName: z.string().trim().max(200).nullable().optional(),
  awayName: z.string().trim().max(200).nullable().optional(),
});

const MatchStatusBody = z.object({
  status: z.enum(MATCH_STATUSES),
  // Optional short reason ("Rainout"). Ignored/cleared for "scheduled".
  reason: z.string().trim().max(300).nullable().optional(),
});

// Normalize a client-sent date to YYYY-MM-DD (reuses the forgiving CSV date
// parser) or null. Returns undefined when the raw value can't be read.
function parseMatchDateInput(
  raw: string | null | undefined,
): string | null | undefined {
  if (raw == null || raw === "") return null;
  const parsed = parseDateCell(raw);
  return parsed === null ? undefined : parsed;
}

// Resolve (or create) the participant slot for a team name, mirroring the
// CSV import's slot-upsert semantics. Participant identity is (name, gender)
// per competition — same-named boys/girls teams stay separate slots.
// Division/bracket are just first-seen informational values on a newly
// created slot. Returns null for a blank name (TBD side).
async function resolveParticipantId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tournamentId: string,
  division: string,
  bracket: string,
  gender: string | null,
  name: string | null,
): Promise<string | null> {
  if (!name) return null;
  const nameKey = name.toLowerCase();
  const genderKey = (gender ?? "").trim().toLowerCase();
  await tx
    .insert(tournamentParticipants)
    .values({ tournamentId, name, nameKey, division, bracket, gender: gender || null })
    .onConflictDoNothing();
  const [row] = await tx
    .select({ id: tournamentParticipants.id })
    .from(tournamentParticipants)
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        eq(tournamentParticipants.nameKey, nameKey),
        sql`LOWER(BTRIM(COALESCE(${tournamentParticipants.gender}, ''))) = ${genderKey}`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

// Postgres unique-violation detector (code 23505, possibly wrapped) so the
// rare pre-check race on the (tournament, matchNumber) unique index still
// maps to a friendly 409 instead of a 500.
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// Shared guard: load the tournament, 404 if missing, 403 unless the caller
// can operate it. Returns null after writing the error response.
async function loadOperableCompetition(
  req: Parameters<Parameters<typeof asyncHandler>[0]>[0],
  res: Parameters<Parameters<typeof asyncHandler>[0]>[1],
) {
  const me = req.sessionUser;
  if (!me) {
    apiError(res, 401, "Not authenticated");
    return null;
  }
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, String(req.params.id)))
    .limit(1);
  if (!tournament) {
    apiError(res, 404, "Competition not found");
    return null;
  }
  if (!(await canOperateCompetition(me, tournament))) {
    apiError(res, 403, "Only the competition operator can manage its games.", {
      code: "COMPETITION_FORBIDDEN",
    });
    return null;
  }
  return tournament;
}

// Task #767 — participant lookup for change notifications: display names +
// claimed team ids for the sides of a game (unclaimed slots have no team).
async function loadMatchSides(participantIds: (string | null)[]): Promise<{
  nameOf: (id: string | null) => string | null;
  teamIds: string[];
}> {
  const ids = Array.from(
    new Set(participantIds.filter((i): i is string => i != null)),
  );
  if (ids.length === 0) return { nameOf: () => null, teamIds: [] };
  const rows = await db
    .select({
      id: tournamentParticipants.id,
      name: tournamentParticipants.name,
      teamId: tournamentParticipants.teamId,
    })
    .from(tournamentParticipants)
    .where(inArray(tournamentParticipants.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    nameOf: (id) => (id ? (byId.get(id)?.name ?? null) : null),
    teamIds: rows
      .map((r) => r.teamId)
      .filter((t): t is string => t != null),
  };
}

// POST /competitions/:id/matches — add ONE game without a CSV.
router.post(
  "/competitions/:id/matches",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const tournament = await loadOperableCompetition(req, res);
    if (!tournament) return;

    const parsed = MatchFieldsBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }
    const b = parsed.data;
    const matchDate = parseMatchDateInput(b.matchDate);
    if (matchDate === undefined) {
      return apiError(
        res,
        400,
        `Couldn't read "${b.matchDate}" as a date. Dates like 2026-07-11 or 7/11/2026 work best.`,
      );
    }
    const division = b.division ?? "";
    const bracket = b.bracket ?? "";

    // Uniqueness pre-check for a friendly 409; the unique index still
    // backstops races (insert throws → 500 is acceptable for the rare race).
    const [dupe] = await db
      .select({ id: tournamentMatches.id })
      .from(tournamentMatches)
      .where(
        and(
          eq(tournamentMatches.tournamentId, tournament.id),
          eq(tournamentMatches.matchNumber, b.matchNumber),
        ),
      )
      .limit(1);
    if (dupe) {
      return apiError(
        res,
        409,
        `Game #${b.matchNumber} already exists in this competition. Pick a different match number.`,
        { code: "MATCH_NUMBER_TAKEN" },
      );
    }

    const created = await db.transaction(async (tx) => {
      const homeParticipantId = await resolveParticipantId(
        tx, tournament.id, division, bracket, b.gender || null, b.homeName ?? null,
      );
      const awayParticipantId = await resolveParticipantId(
        tx, tournament.id, division, bracket, b.gender || null, b.awayName ?? null,
      );
      const [row] = await tx
        .insert(tournamentMatches)
        .values({
          tournamentId: tournament.id,
          matchNumber: b.matchNumber,
          matchDate,
          startTime: parseStartTimeCell(b.startTime),
          age: b.age || null,
          gender: b.gender || null,
          division,
          bracket,
          venue: b.venue || null,
          venueState: b.venueState || null,
          field: b.field || null,
          homeParticipantId,
          awayParticipantId,
        })
        .returning();
      return row;
    }).catch((err: unknown) => {
      if (isUniqueViolation(err)) return null;
      throw err;
    });
    if (!created) {
      return apiError(
        res,
        409,
        `Game #${b.matchNumber} already exists in this competition. Pick a different match number.`,
        { code: "MATCH_NUMBER_TAKEN" },
      );
    }

    res.status(201).json({ ok: true, matchId: created.id });
  }),
);

// PATCH /competitions/:id/matches/:matchId — edit ONE game's fields.
router.patch(
  "/competitions/:id/matches/:matchId",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const tournament = await loadOperableCompetition(req, res);
    if (!tournament) return;
    const me = req.sessionUser!;

    const [match] = await db
      .select()
      .from(tournamentMatches)
      .where(
        and(
          eq(tournamentMatches.id, String(req.params.matchId)),
          eq(tournamentMatches.tournamentId, tournament.id),
        ),
      )
      .limit(1);
    if (!match) return apiError(res, 404, "Game not found");

    const parsed = MatchFieldsBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }
    const b = parsed.data;
    const matchDate = parseMatchDateInput(b.matchDate);
    if (matchDate === undefined) {
      return apiError(
        res,
        400,
        `Couldn't read "${b.matchDate}" as a date. Dates like 2026-07-11 or 7/11/2026 work best.`,
      );
    }
    const division = b.division ?? "";
    const bracket = b.bracket ?? "";

    if (b.matchNumber !== match.matchNumber) {
      const [dupe] = await db
        .select({ id: tournamentMatches.id })
        .from(tournamentMatches)
        .where(
          and(
            eq(tournamentMatches.tournamentId, tournament.id),
            eq(tournamentMatches.matchNumber, b.matchNumber),
          ),
        )
        .limit(1);
      if (dupe) {
        return apiError(
          res,
          409,
          `Game #${b.matchNumber} already exists in this competition. Pick a different match number.`,
          { code: "MATCH_NUMBER_TAKEN" },
        );
      }
    }

    const updated = await db.transaction(async (tx) => {
      const homeParticipantId = await resolveParticipantId(
        tx, tournament.id, division, bracket, b.gender || null, b.homeName ?? null,
      );
      const awayParticipantId = await resolveParticipantId(
        tx, tournament.id, division, bracket, b.gender || null, b.awayName ?? null,
      );
      await tx
        .update(tournamentMatches)
        .set({
          matchNumber: b.matchNumber,
          matchDate,
          startTime: parseStartTimeCell(b.startTime),
          age: b.age || null,
          gender: b.gender || null,
          division,
          bracket,
          venue: b.venue || null,
          venueState: b.venueState || null,
          field: b.field || null,
          homeParticipantId,
          awayParticipantId,
          updatedAt: new Date(),
        })
        .where(eq(tournamentMatches.id, match.id));
      return { homeParticipantId, awayParticipantId };
    }).catch((err: unknown) => {
      if (isUniqueViolation(err)) return null;
      throw err;
    });
    if (!updated) {
      return apiError(
        res,
        409,
        `Game #${b.matchNumber} already exists in this competition. Pick a different match number.`,
        { code: "MATCH_NUMBER_TAKEN" },
      );
    }

    // Task #767 — material changes (date / start time / venue / field)
    // notify the staff of any claimed team in this game. Cosmetic edits
    // (labels, spelling, division/bracket) stay silent.
    const changes = materialChanges(match, {
      matchDate,
      startTime: parseStartTimeCell(b.startTime),
      venue: b.venue || null,
      field: b.field || null,
    });
    if (changes.length > 0) {
      const sides = await loadMatchSides([
        match.homeParticipantId,
        match.awayParticipantId,
        updated.homeParticipantId,
        updated.awayParticipantId,
      ]);
      await notifyGameEdited({
        competition: tournament,
        game: {
          matchNumber: b.matchNumber,
          homeName: sides.nameOf(updated.homeParticipantId ?? match.homeParticipantId),
          awayName: sides.nameOf(updated.awayParticipantId ?? match.awayParticipantId),
        },
        teamIds: sides.teamIds,
        changes,
        actorUserId: me.id,
      });
    }

    res.json({ ok: true });
  }),
);

// POST /competitions/:id/matches/:matchId/status — postpone/cancel/restore.
router.post(
  "/competitions/:id/matches/:matchId/status",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const tournament = await loadOperableCompetition(req, res);
    if (!tournament) return;

    const parsed = MatchStatusBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }
    const { status, reason } = parsed.data;
    const me = req.sessionUser!;

    // Snapshot the current row so a no-op status write (same status) stays
    // silent — only real transitions notify (Task #767).
    const [before] = await db
      .select()
      .from(tournamentMatches)
      .where(
        and(
          eq(tournamentMatches.id, String(req.params.matchId)),
          eq(tournamentMatches.tournamentId, tournament.id),
        ),
      )
      .limit(1);
    if (!before) return apiError(res, 404, "Game not found");

    const updated = await db
      .update(tournamentMatches)
      .set({
        status,
        // A reason only makes sense with a non-scheduled status; restoring
        // to "scheduled" always clears it.
        statusReason: status === "scheduled" ? null : reason || null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tournamentMatches.id, String(req.params.matchId)),
          eq(tournamentMatches.tournamentId, tournament.id),
        ),
      )
      .returning({ id: tournamentMatches.id });
    if (updated.length === 0) return apiError(res, 404, "Game not found");

    // Task #767 — status transitions notify claimed-team staff AND
    // competition followers (postponed / canceled / restored).
    if (before.status !== status) {
      const sides = await loadMatchSides([
        before.homeParticipantId,
        before.awayParticipantId,
      ]);
      await notifyGameStatusChanged({
        competition: tournament,
        game: {
          matchNumber: before.matchNumber,
          homeName: sides.nameOf(before.homeParticipantId),
          awayName: sides.nameOf(before.awayParticipantId),
        },
        teamIds: sides.teamIds,
        status,
        reason: status === "scheduled" ? null : reason || null,
        actorUserId: me.id,
      });
    }

    res.json({ ok: true });
  }),
);

// DELETE /competitions/:id/matches/:matchId — remove a game entered in error.
router.delete(
  "/competitions/:id/matches/:matchId",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const tournament = await loadOperableCompetition(req, res);
    if (!tournament) return;

    const deleted = await db
      .delete(tournamentMatches)
      .where(
        and(
          eq(tournamentMatches.id, String(req.params.matchId)),
          eq(tournamentMatches.tournamentId, tournament.id),
        ),
      )
      .returning({ id: tournamentMatches.id });
    if (deleted.length === 0) return apiError(res, 404, "Game not found");

    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Task #780 — bulk "clear all" actions for the competition console. Both are
// organizer-gated, type-to-confirm (the exact competition name), and run in a
// single transaction behind a per-competition advisory lock so two overlapping
// clears (or a clear racing an import) can't interleave. Recap posts survive:
// their game link (articles.competition_game_id) is cleared, never broken —
// the competition badge (articles.competition_id) stays. Score reports and
// per-team hide rows cascade with the matches (FKs are ON DELETE CASCADE).
// ---------------------------------------------------------------------------

const normalizeConfirmName = (s: string) =>
  s.trim().replace(/\s+/g, " ").toLowerCase();

const ClearAllBody = z.object({ confirm: z.string() });

// POST /competitions/:id/clear-games — delete EVERY game in the competition.
// Team slots (participants) are untouched, so a fresh CSV re-import re-links
// claimed teams by slot as usual.
router.post(
  "/competitions/:id/clear-games",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const tournament = await loadOperableCompetition(req, res);
    if (!tournament) return;

    const parsed = ClearAllBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "Confirmation text is required.", {
        code: "VALIDATION_FAILED",
      });
    }
    if (
      normalizeConfirmName(parsed.data.confirm) !==
      normalizeConfirmName(tournament.name)
    ) {
      return apiError(
        res,
        400,
        `Type the competition's exact name ("${tournament.name}") to confirm.`,
        { code: "CONFIRMATION_REQUIRED" },
      );
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`competition-clear:${tournament.id}`}))`,
      );

      // Clear (don't break) recap→game links first so the count is exact and
      // the intent is explicit, even though the FK is SET NULL anyway.
      const unlinked = await tx
        .update(articles)
        .set({ competitionGameId: null })
        .where(
          inArray(
            articles.competitionGameId,
            tx
              .select({ id: tournamentMatches.id })
              .from(tournamentMatches)
              .where(eq(tournamentMatches.tournamentId, tournament.id)),
          ),
        )
        .returning({ id: articles.id });

      // Score reports + per-team hide rows cascade with the matches.
      const deleted = await tx
        .delete(tournamentMatches)
        .where(eq(tournamentMatches.tournamentId, tournament.id))
        .returning({ id: tournamentMatches.id });

      return { gamesDeleted: deleted.length, recapsUnlinked: unlinked.length };
    });

    req.log.info(
      { competitionId: tournament.id, ...result },
      "competition clear all games",
    );
    res.json({ ok: true, ...result });
  }),
);

// POST /competitions/:id/clear-teams — remove EVERY team slot. Claimed teams
// themselves are never deleted — only the slot (and its claim/pending-claim
// link) goes. Matches reference slots, so any game with a home or away slot
// is deleted too (TBD-vs-TBD games with no slot on either side survive);
// recap links on those games are cleared the same way as clear-games.
router.post(
  "/competitions/:id/clear-teams",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const tournament = await loadOperableCompetition(req, res);
    if (!tournament) return;

    const parsed = ClearAllBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "Confirmation text is required.", {
        code: "VALIDATION_FAILED",
      });
    }
    if (
      normalizeConfirmName(parsed.data.confirm) !==
      normalizeConfirmName(tournament.name)
    ) {
      return apiError(
        res,
        400,
        `Type the competition's exact name ("${tournament.name}") to confirm.`,
        { code: "CONFIRMATION_REQUIRED" },
      );
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`competition-clear:${tournament.id}`}))`,
      );

      const participants = await tx
        .select({
          id: tournamentParticipants.id,
          teamId: tournamentParticipants.teamId,
        })
        .from(tournamentParticipants)
        .where(eq(tournamentParticipants.tournamentId, tournament.id));
      const participantIds = participants.map((p) => p.id);
      const claimedUnlinked = participants.filter(
        (p) => p.teamId != null,
      ).length;

      let gamesDeleted = 0;
      let recapsUnlinked = 0;
      if (participantIds.length > 0) {
        // Matches that reference any slot go with the slots. Clear their
        // recap links first (explicit, counted), then delete them.
        const referencingMatch = or(
          inArray(tournamentMatches.homeParticipantId, participantIds),
          inArray(tournamentMatches.awayParticipantId, participantIds),
        );
        const unlinked = await tx
          .update(articles)
          .set({ competitionGameId: null })
          .where(
            inArray(
              articles.competitionGameId,
              tx
                .select({ id: tournamentMatches.id })
                .from(tournamentMatches)
                .where(
                  and(
                    eq(tournamentMatches.tournamentId, tournament.id),
                    referencingMatch,
                  ),
                ),
            ),
          )
          .returning({ id: articles.id });
        recapsUnlinked = unlinked.length;

        const deletedMatches = await tx
          .delete(tournamentMatches)
          .where(
            and(
              eq(tournamentMatches.tournamentId, tournament.id),
              referencingMatch,
            ),
          )
          .returning({ id: tournamentMatches.id });
        gamesDeleted = deletedMatches.length;

        await tx
          .delete(tournamentParticipants)
          .where(eq(tournamentParticipants.tournamentId, tournament.id));
      }

      return {
        teamsRemoved: participantIds.length,
        claimedUnlinked,
        gamesDeleted,
        recapsUnlinked,
      };
    });

    req.log.info(
      { competitionId: tournament.id, ...result },
      "competition clear all teams",
    );
    res.json({ ok: true, ...result });
  }),
);

// ---------------------------------------------------------------------------
// Task #846 — DELETE /competitions/:id — delete the whole competition.
// Operator-gated (owner, competition/hub admin, or platform admin) with the
// same type-to-confirm contract as the bulk clear actions. DB cascades remove
// matches, participants, followers, admin rows, and admin invites; recap
// posts SURVIVE — their competition/game links are cleared explicitly (and
// `featured` reset) so the count is exact, even though the FKs are SET NULL.
// Same per-competition advisory lock as imports/clears so a delete can't
// interleave with an in-flight import.
// ---------------------------------------------------------------------------
router.delete(
  "/competitions/:id",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const tournament = await loadOperableCompetition(req, res);
    if (!tournament) return;

    const parsed = ClearAllBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "Confirmation text is required.", {
        code: "VALIDATION_FAILED",
      });
    }
    if (
      normalizeConfirmName(parsed.data.confirm) !==
      normalizeConfirmName(tournament.name)
    ) {
      return apiError(
        res,
        400,
        `Type the competition's exact name ("${tournament.name}") to confirm.`,
        { code: "CONFIRMATION_REQUIRED" },
      );
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`competition-clear:${tournament.id}`}))`,
      );

      // Unlink recaps first (explicit + counted): clear both link columns
      // and the operator-curated featured flag. The posts themselves stay.
      const unlinked = await tx
        .update(articles)
        .set({ competitionId: null, competitionGameId: null, featured: false })
        .where(eq(articles.competitionId, tournament.id))
        .returning({ id: articles.id });

      // Pre-delete counts for the response (cascades don't report rows).
      const [counts] = await tx
        .select({
          games: sql<number>`(select count(*)::int from tournament_matches where tournament_id = ${tournament.id})`,
          teams: sql<number>`(select count(*)::int from tournament_participants where tournament_id = ${tournament.id})`,
          followers: sql<number>`(select count(*)::int from competition_followers where competition_id = ${tournament.id})`,
        })
        .from(sql`(select 1) as _`);

      await tx.delete(tournaments).where(eq(tournaments.id, tournament.id));

      return {
        gamesDeleted: counts?.games ?? 0,
        teamsRemoved: counts?.teams ?? 0,
        followersRemoved: counts?.followers ?? 0,
        recapsUnlinked: unlinked.length,
      };
    });

    req.log.info(
      { competitionId: tournament.id, name: tournament.name, ...result },
      "competition deleted",
    );
    res.json({ ok: true, ...result });
  }),
);

// ---------------------------------------------------------------------------
// POST /tournaments/:slug/claim — a signed-in team manager creates a SOLO
// team (no organization) or links a team they manage. Organization owners and
// admins may coordinate claims for every team in their club without being
// rostered as a coach on each team.
// step. Race-safe: the claim is a conditional UPDATE ... WHERE team_id IS
// NULL inside the same transaction that created the team, so a lost race
// rolls the team back and returns 409 (mirrors the org one-owner pattern).
//
// Because matches reference the participant row (home/away participant id),
// linking the team to the participant implicitly links it to every match
// where that name appears — no extra fan-out write needed.
// ---------------------------------------------------------------------------

const ALLOWED_GENDERS = ["boys", "girls", "coed"] as const;

const ClaimBody = z
  .object({
    participantId: z.string().uuid("Invalid participant"),
    // Branch A — create a new SOLO team named `teamName`.
    teamName: z.string().trim().min(1, "Team name is required").max(120).optional(),
    sport: z.string().trim().max(100).optional().nullable(),
    gender: z.enum(ALLOWED_GENDERS).optional().nullable(),
    // Branch B — claim the slot TO an existing Kinectem team the caller
    // manages (no new team created). Mutually exclusive with teamName.
    existingTeamId: z.string().uuid("Invalid team").optional(),
  })
  .refine((b) => !!b.teamName !== !!b.existingTeamId, {
    message: "Provide either a new team name or an existing team.",
  });

class AlreadyClaimedError extends Error {}

const BulkClaimBody = z.object({
  organizationId: z.string().uuid("Invalid organization"),
  assignments: z
    .array(
      z.object({
        participantId: z.string().uuid("Invalid participant"),
        teamId: z.string().uuid("Invalid team"),
        nameMismatchAcknowledged: z.boolean().optional().default(false),
      }),
    )
    .min(1, "Choose at least one team-slot match.")
    .max(100, "You can match at most 100 teams at once.")
    .superRefine((assignments, ctx) => {
      const participantIds = new Set<string>();
      const teamIds = new Set<string>();
      assignments.forEach((assignment, index) => {
        if (participantIds.has(assignment.participantId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "participantId"],
            message: "Each competition slot can only be matched once.",
          });
        }
        if (teamIds.has(assignment.teamId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "teamId"],
            message: "Each club team can only be matched once.",
          });
        }
        participantIds.add(assignment.participantId);
        teamIds.add(assignment.teamId);
      });
    }),
});

function competitionNamesRoughlyMatch(a: string, b: string): boolean {
  const norm = (value: string) =>
    value.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedA = norm(a);
  const normalizedB = norm(b);
  return (
    normalizedA === normalizedB ||
    normalizedA.includes(normalizedB) ||
    normalizedB.includes(normalizedA)
  );
}

class BulkClaimError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function claimExistingTeamSlot(input: {
  tournament: typeof tournaments.$inferSelect;
  participantId: string;
  participantName: string;
  team: typeof teams.$inferSelect;
  userId: string;
  nameMismatchAcknowledged?: boolean;
}) {
  const {
    tournament,
    participantId,
    participantName,
    team,
    userId,
    nameMismatchAcknowledged = true,
  } = input;
  if (
    !competitionNamesRoughlyMatch(participantName, team.name) &&
    !nameMismatchAcknowledged
  ) {
    throw new BulkClaimError(
      400,
      "NAME_MISMATCH_ACKNOWLEDGEMENT_REQUIRED",
      `Confirm that ${participantName} is the competition slot for ${team.name}.`,
    );
  }

  const claimed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${tournament.id}), hashtext(${team.id}))`,
      );
      const [alreadyIn] = await tx
        .select({ id: tournamentParticipants.id })
        .from(tournamentParticipants)
        .where(
          and(
            eq(tournamentParticipants.tournamentId, tournament.id),
            or(
              eq(tournamentParticipants.teamId, team.id),
              eq(tournamentParticipants.pendingTeamId, team.id),
            ),
          ),
        )
        .limit(1);
      if (alreadyIn) {
        throw new BulkClaimError(
          409,
          "TEAM_ALREADY_IN_COMPETITION",
          "That team already holds (or has a pending claim on) a slot in this competition.",
        );
      }
      const updated = await tx
        .update(tournamentParticipants)
        .set(
          tournament.autoApproveClaims
            ? {
                teamId: team.id,
                claimedByUserId: userId,
                claimedAt: new Date(),
              }
            : {
                pendingTeamId: team.id,
                pendingClaimedByUserId: userId,
                pendingClaimedAt: new Date(),
              },
        )
        .where(
          and(
            eq(tournamentParticipants.id, participantId),
            eq(tournamentParticipants.tournamentId, tournament.id),
            isNull(tournamentParticipants.teamId),
            isNull(tournamentParticipants.pendingTeamId),
            isNull(tournamentParticipants.hiddenAt),
          ),
        )
        .returning();
      if (updated.length === 0) {
        throw new BulkClaimError(
          409,
          "ALREADY_CLAIMED",
          "That team slot was just claimed by someone else.",
        );
      }
      await tx
        .insert(competitionFollowers)
        .values({ competitionId: tournament.id, userId })
        .onConflictDoNothing();
      return updated[0];
  });
  return claimed;
}

const claimSlotHandler = asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [tournament] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.slug, req.params.slug))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Competition not found");

    const parsed = ClaimBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return apiError(res, 400, first?.message ?? "Invalid claim details.", {
        code: "VALIDATION_FAILED",
        extras: { fields: parsed.error.flatten().fieldErrors },
      });
    }
    const body = parsed.data;

    // Clean 404 for a truly missing / wrong-tournament participant, and an
    // early 409 for an already-claimed slot (the conditional UPDATE below is
    // the authoritative race guard).
    const [participant] = await db
      .select()
      .from(tournamentParticipants)
      .where(
        and(
          eq(tournamentParticipants.id, body.participantId),
          eq(tournamentParticipants.tournamentId, tournament.id),
        ),
      )
      .limit(1);
    if (!participant) return apiError(res, 404, "Team slot not found");
    // Operator-hidden slots are invisible to the public list, so a claim
    // against one (stale link / direct API call) reads as not found.
    if (participant.hiddenAt != null)
      return apiError(res, 404, "Team slot not found");
    if (participant.teamId) {
      return apiError(res, 409, "That team slot has already been claimed.", {
        code: "ALREADY_CLAIMED",
      });
    }
    if (participant.pendingTeamId) {
      return apiError(
        res,
        409,
        "A claim for that team slot is already awaiting operator approval.",
        { code: "CLAIM_PENDING" },
      );
    }

    // auto_approve_claims (Competitions §5): when the operator turns it off,
    // the claim parks in the pending_* columns until approved in the console.
    const autoApprove = tournament.autoApproveClaims;

    // Branch B — claim to an EXISTING team the caller manages. No team row is
    // created; the slot links straight to the real team (same race-safe
    // conditional UPDATE + pending-approval flow as the solo branch).
    if (body.existingTeamId) {
      const [existingTeam] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, body.existingTeamId))
        .limit(1);
      if (!existingTeam) return apiError(res, 404, "Team not found");
      if (!(await canManageTeam(me.id, existingTeam))) {
        return apiError(
          res,
          403,
          "Only a team coach or an admin of its organization can claim a slot for it.",
          { code: "FORBIDDEN" },
        );
      }
      // One slot per team per competition. The check + update run inside a
      // transaction behind an advisory lock keyed on (tournament, team) so
      // two concurrent claims for DIFFERENT slots can't both pass the
      // precheck (TOCTOU — same pattern as the per-tier team-cap guard).
      class TeamAlreadyInError extends Error {}
      let claimed: (typeof tournamentParticipants.$inferSelect)[];
      try {
        claimed = await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${tournament.id}), hashtext(${existingTeam.id}))`,
          );
          const [alreadyIn] = await tx
            .select({ id: tournamentParticipants.id })
            .from(tournamentParticipants)
            .where(
              and(
                eq(tournamentParticipants.tournamentId, tournament.id),
                or(
                  eq(tournamentParticipants.teamId, existingTeam.id),
                  eq(tournamentParticipants.pendingTeamId, existingTeam.id),
                ),
              ),
            )
            .limit(1);
          if (alreadyIn) throw new TeamAlreadyInError();
          const updated = await tx
            .update(tournamentParticipants)
            .set(
              autoApprove
                ? {
                    teamId: existingTeam.id,
                    claimedByUserId: me.id,
                    claimedAt: new Date(),
                  }
                : {
                    pendingTeamId: existingTeam.id,
                    pendingClaimedByUserId: me.id,
                    pendingClaimedAt: new Date(),
                  },
            )
            .where(
              and(
                eq(tournamentParticipants.id, body.participantId),
                eq(tournamentParticipants.tournamentId, tournament.id),
                isNull(tournamentParticipants.teamId),
                isNull(tournamentParticipants.pendingTeamId),
                // A slot hidden after the precheck read is not claimable.
                isNull(tournamentParticipants.hiddenAt),
              ),
            )
            .returning();
          // Auto-follow only once the claim actually landed — a lost race
          // (0 rows updated) must not leave a stray follow behind.
          if (updated.length > 0) {
            await tx
              .insert(competitionFollowers)
              .values({ competitionId: tournament.id, userId: me.id })
              .onConflictDoNothing();
          }
          return updated;
        });
      } catch (err) {
        if (err instanceof TeamAlreadyInError) {
          return apiError(
            res,
            409,
            "That team already holds (or has a pending claim on) a slot in this competition.",
            { code: "TEAM_ALREADY_IN_COMPETITION" },
          );
        }
        throw err;
      }
      if (claimed.length === 0) {
        return apiError(res, 409, "That team slot was just claimed by someone else.", {
          code: "ALREADY_CLAIMED",
        });
      }
      return res.status(201).json({
        ok: true,
        teamId: existingTeam.id,
        tournamentSlug: tournament.slug,
        pendingApproval: !autoApprove,
        existingTeam: true,
      });
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [team] = await tx
          .insert(teams)
          .values({
            organizationId: null,
            name: body.teamName!,
            createdById: me.id,
            sport: body.sport ?? undefined,
            gender: body.gender ?? undefined,
          })
          .returning();
        // Creator joins their own solo team as coach/admin.
        await tx.insert(rosterEntries).values({
          teamId: team.id,
          userId: me.id,
          role: "coach",
          status: "accepted",
          position: "admin",
          invitedById: me.id,
        });
        // Claiming a slot means you run this team here — auto-follow the
        // competition so it lands in the claimer's feed/sidebar.
        await tx
          .insert(competitionFollowers)
          .values({ competitionId: tournament.id, userId: me.id })
          .onConflictDoNothing();
        const claimed = await tx
          .update(tournamentParticipants)
          .set(
            autoApprove
              ? {
                  teamId: team.id,
                  claimedByUserId: me.id,
                  claimedAt: new Date(),
                }
              : {
                  pendingTeamId: team.id,
                  pendingClaimedByUserId: me.id,
                  pendingClaimedAt: new Date(),
                },
          )
          .where(
            and(
              eq(tournamentParticipants.id, body.participantId),
              eq(tournamentParticipants.tournamentId, tournament.id),
              isNull(tournamentParticipants.teamId),
              isNull(tournamentParticipants.pendingTeamId),
              // A slot hidden after the precheck read is not claimable.
              isNull(tournamentParticipants.hiddenAt),
            ),
          )
          .returning();
        if (claimed.length === 0) throw new AlreadyClaimedError();
        return { team };
      });

      res.status(201).json({
        ok: true,
        teamId: result.team.id,
        tournamentSlug: tournament.slug,
        pendingApproval: !autoApprove,
      });
    } catch (err) {
      if (err instanceof AlreadyClaimedError) {
        return apiError(res, 409, "That team slot was just claimed by someone else.", {
          code: "ALREADY_CLAIMED",
        });
      }
      throw err;
    }
});

router.post(
  "/tournaments/:slug/claim",
  requireAuth,
  tournamentWriteLimiter,
  claimSlotHandler,
);
router.post(
  "/competitions/:slug/claim",
  requireAuth,
  tournamentWriteLimiter,
  claimSlotHandler,
);

router.post(
  "/competitions/:slug/claims/bulk",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = BulkClaimBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return apiError(res, 400, first?.message ?? "Invalid club matches.", {
        code: "VALIDATION_FAILED",
        extras: { fields: parsed.error.flatten().fieldErrors },
      });
    }

    const [tournament] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.slug, req.params.slug))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Competition not found");
    if (!(await canManageOrganization(me.id, parsed.data.organizationId))) {
      return apiError(
        res,
        403,
        "Only an owner or admin of this organization can match its teams.",
        { code: "FORBIDDEN" },
      );
    }

    const teamIds = parsed.data.assignments.map((item) => item.teamId);
    const participantIds = parsed.data.assignments.map(
      (item) => item.participantId,
    );
    const [teamRows, participantRows] = await Promise.all([
      db.select().from(teams).where(inArray(teams.id, teamIds)),
      db
        .select()
        .from(tournamentParticipants)
        .where(
          and(
            eq(tournamentParticipants.tournamentId, tournament.id),
            inArray(tournamentParticipants.id, participantIds),
          ),
        ),
    ]);
    const teamsById = new Map(teamRows.map((team) => [team.id, team]));
    const participantsById = new Map(
      participantRows.map((participant) => [participant.id, participant]),
    );

    const results = [];
    for (const assignment of parsed.data.assignments) {
      const team = teamsById.get(assignment.teamId);
      const participant = participantsById.get(assignment.participantId);
      try {
        if (!team || team.organizationId !== parsed.data.organizationId) {
          throw new BulkClaimError(
            403,
            "TEAM_NOT_IN_ORGANIZATION",
            "That team does not belong to the selected organization.",
          );
        }
        if (!participant || participant.hiddenAt != null) {
          throw new BulkClaimError(
            404,
            "SLOT_NOT_FOUND",
            "That competition slot is no longer available.",
          );
        }
        if (participant.teamId) {
          throw new BulkClaimError(
            409,
            "ALREADY_CLAIMED",
            "That team slot has already been claimed.",
          );
        }
        if (participant.pendingTeamId) {
          throw new BulkClaimError(
            409,
            "CLAIM_PENDING",
            "A claim for that team slot is already awaiting organizer approval.",
          );
        }
        await claimExistingTeamSlot({
          tournament,
          participantId: participant.id,
          participantName: participant.name,
          team,
          userId: me.id,
          nameMismatchAcknowledged: assignment.nameMismatchAcknowledged,
        });
        results.push({
          participantId: assignment.participantId,
          teamId: assignment.teamId,
          ok: true as const,
          pendingApproval: !tournament.autoApproveClaims,
        });
      } catch (error) {
        if (!(error instanceof BulkClaimError)) throw error;
        results.push({
          participantId: assignment.participantId,
          teamId: assignment.teamId,
          ok: false as const,
          status: error.status,
          code: error.code,
          error: error.message,
        });
      }
    }

    const succeeded = results.filter((result) => result.ok).length;
    res.json({
      ok: succeeded === results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    });
  }),
);

// ---------------------------------------------------------------------------
// Pending-claim review (Competitions §5) — owner/admin lists, approves, or
// rejects claims while auto_approve_claims is off. Approve promotes the
// pending_* columns into the real claim (race-safe conditional UPDATE);
// reject clears them. The claimant's solo team survives a rejection.
// ---------------------------------------------------------------------------

router.get(
  "/competitions/:id/claims/pending",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [competition] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, req.params.id))
      .limit(1);
    if (!competition) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, competition))) {
      return apiError(res, 403, "Only the competition operator can review claims.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }

    const rows = await db
      .select({
        participant: tournamentParticipants,
        teamName: teams.name,
      })
      .from(tournamentParticipants)
      .leftJoin(teams, eq(teams.id, tournamentParticipants.pendingTeamId))
      .where(
        and(
          eq(tournamentParticipants.tournamentId, competition.id),
          sql`${tournamentParticipants.pendingTeamId} IS NOT NULL`,
          isNull(tournamentParticipants.teamId),
        ),
      );

    res.json({
      data: rows.map(({ participant: p, teamName }) => ({
        participantId: p.id,
        slotName: p.name,
        division: p.division,
        bracket: p.bracket,
        age: p.age,
        gender: p.gender,
        pendingTeamId: p.pendingTeamId,
        pendingTeamName: teamName,
        pendingClaimedAt: p.pendingClaimedAt?.toISOString() ?? null,
      })),
    });
  }),
);

const ClaimDecisionBody = z.object({
  approve: z.boolean(),
});

router.post(
  "/competitions/:id/claims/:participantId/decide",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [competition] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, req.params.id))
      .limit(1);
    if (!competition) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, competition))) {
      return apiError(res, 403, "Only the competition operator can review claims.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }

    const parsed = ClaimDecisionBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "Invalid request.", { code: "VALIDATION_FAILED" });
    }

    const [participant] = await db
      .select()
      .from(tournamentParticipants)
      .where(
        and(
          eq(tournamentParticipants.id, String(req.params.participantId)),
          eq(tournamentParticipants.tournamentId, competition.id),
        ),
      )
      .limit(1);
    if (!participant) return apiError(res, 404, "Team slot not found");
    if (!participant.pendingTeamId) {
      return apiError(res, 409, "No pending claim on that team slot.", {
        code: "NO_PENDING_CLAIM",
      });
    }
    // Task #866 — a hidden slot can't be claimed, so its pending claim can't
    // be approved either. Unhide the team first (rejecting is still allowed).
    if (parsed.data.approve && participant.hiddenAt != null) {
      return apiError(
        res,
        409,
        "That team is hidden from the Teams list. Unhide it before approving the claim.",
        { code: "PARTICIPANT_HIDDEN" },
      );
    }

    if (parsed.data.approve) {
      // Race-safe promote: only while the slot is still unclaimed and the
      // pending claim is unchanged.
      const updated = await db
        .update(tournamentParticipants)
        .set({
          teamId: participant.pendingTeamId,
          claimedByUserId: participant.pendingClaimedByUserId,
          claimedAt: new Date(),
          pendingTeamId: null,
          pendingClaimedByUserId: null,
          pendingClaimedAt: null,
        })
        .where(
          and(
            eq(tournamentParticipants.id, participant.id),
            eq(tournamentParticipants.pendingTeamId, participant.pendingTeamId),
            isNull(tournamentParticipants.teamId),
            // Race guard vs hide committed after the read above.
            isNull(tournamentParticipants.hiddenAt),
          ),
        )
        .returning();
      if (updated.length === 0) {
        // Distinguish "slot was hidden meanwhile" from "claim resolved
        // elsewhere" for a clear operator message.
        const [now] = await db
          .select({ hiddenAt: tournamentParticipants.hiddenAt })
          .from(tournamentParticipants)
          .where(eq(tournamentParticipants.id, participant.id))
          .limit(1);
        if (now?.hiddenAt != null) {
          return apiError(
            res,
            409,
            "That team is hidden from the Teams list. Unhide it before approving the claim.",
            { code: "PARTICIPANT_HIDDEN" },
          );
        }
        return apiError(res, 409, "That claim was just resolved elsewhere.", {
          code: "ALREADY_CLAIMED",
        });
      }
      return res.json({ ok: true, approved: true, participantId: participant.id });
    }

    await db
      .update(tournamentParticipants)
      .set({
        pendingTeamId: null,
        pendingClaimedByUserId: null,
        pendingClaimedAt: null,
      })
      .where(
        and(
          eq(tournamentParticipants.id, participant.id),
          eq(tournamentParticipants.pendingTeamId, participant.pendingTeamId),
        ),
      );
    res.json({ ok: true, approved: false, participantId: participant.id });
  }),
);

// ---------------------------------------------------------------------------
// Recap curation (§7) — operator console queue + feature/hide toggles.
// Queue = published game recaps whose competition_id matches, newest first.
// "Feature" sets articles.featured = true (renders on the public rail);
// "Hide" sets it back to false. Neither affects the recap on its own team
// page — score/feature state never blocks recap publishing.
// ---------------------------------------------------------------------------

router.get(
  "/competitions/:id/recaps",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [competition] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, req.params.id))
      .limit(1);
    if (!competition) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, competition))) {
      return apiError(res, 403, "Only the competition operator can curate recaps.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }

    const rows = await db
      .select({
        article: articles,
        teamName: teams.name,
        matchId: tournamentMatches.id,
        matchDate: tournamentMatches.matchDate,
        matchDivision: tournamentMatches.division,
        matchBracket: tournamentMatches.bracket,
      })
      .from(articles)
      .innerJoin(teams, eq(teams.id, articles.teamId))
      .leftJoin(
        tournamentMatches,
        and(
          eq(tournamentMatches.id, articles.competitionGameId),
          eq(tournamentMatches.tournamentId, competition.id),
        ),
      )
      .where(
        and(
          eq(articles.competitionId, competition.id),
          eq(articles.status, "published"),
          isNull(articles.hiddenAt),
        ),
      )
      .orderBy(desc(articles.createdAt))
      .limit(100);

    const [bracketRows] = await Promise.all([
      db
        .select({ id: competitionBrackets.id, label: competitionBrackets.label })
        .from(competitionBrackets)
        .where(eq(competitionBrackets.tournamentId, competition.id)),
    ]);
    const bracketLabelById = new Map(bracketRows.map((b) => [b.id, b.label]));

    res.json({
      data: rows.map(
        ({ article: a, teamName, matchId, matchDate, matchDivision, matchBracket }) => {
          const linkedMatch = matchId != null;
          const effectiveGameDate =
            linkedMatch && matchDate
              ? matchDate
              : timestampToCompetitionDate(a.gameDate);
          const groupDivision =
            linkedMatch && matchDivision?.trim()
              ? matchDivision.trim()
              : null;
          const groupBracket =
            linkedMatch && matchBracket?.trim()
              ? matchBracket.trim()
              : a.bracketId
                ? bracketLabelById.get(a.bracketId) ?? null
                : null;
          return {
        id: a.id,
        title: a.title,
        summary: a.summary,
        coverImageUrl: a.coverImageUrl,
        gameDate: a.gameDate,
        opponentName: a.opponentName,
        teamScore: a.teamScore,
        opponentScore: a.opponentScore,
        teamId: a.teamId,
        teamName,
        featured: a.featured,
        competitionGameId: a.competitionGameId,
        // Task #852 — current bracket assignment for the curation dropdown.
        bracketId: a.bracketId,
        createdAt: a.createdAt.toISOString(),
            effectiveGameDate,
            groupDivision,
            groupBracket,
            groupingSource: linkedMatch ? "competition-game" : "recap",
            week: competitionWeekForDate(effectiveGameDate),
          };
        },
      ),
    });
  }),
);

const FeatureBody = z.object({
  featured: z.boolean(),
});

router.post(
  "/competitions/:id/recaps/:articleId/feature",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [competition] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, req.params.id))
      .limit(1);
    if (!competition) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, competition))) {
      return apiError(res, 403, "Only the competition operator can curate recaps.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }
    const parsed = FeatureBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "Invalid request.", { code: "VALIDATION_FAILED" });
    }

    const updated = await db
      .update(articles)
      .set({ featured: parsed.data.featured, updatedAt: new Date() })
      .where(
        and(
          eq(articles.id, String(req.params.articleId)),
          eq(articles.competitionId, competition.id),
        ),
      )
      .returning({ id: articles.id, featured: articles.featured });
    if (updated.length === 0) {
      return apiError(res, 404, "Game recap not found in this competition.");
    }
    res.json({ ok: true, id: updated[0].id, featured: updated[0].featured });
  }),
);

// ---------------------------------------------------------------------------
// Org-claims-team (continuation path)
// ---------------------------------------------------------------------------
//
// A real organization adopts a solo team (created via the signup funnel),
// reparenting it into the org so it keeps its roster + recap history and
// unlocks full features (recap authoring is no longer window-gated once the
// team has an org). Mirrors the org one-owner pattern: a race-safe conditional
// UPDATE ... WHERE organization_id IS NULL is the authoritative guard, so two
// orgs adopting the same solo team collapse to one winner.

const AdoptBody = z.object({
  organizationId: z.string().uuid(),
});

router.post(
  "/teams/:teamId/adopt",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = String(req.params.teamId);

    const parsed = AdoptBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return apiError(res, 400, first?.message ?? "Invalid request.", {
        code: "VALIDATION_FAILED",
        extras: { fields: parsed.error.flatten().fieldErrors },
      });
    }
    const { organizationId } = parsed.data;

    // Only an owner/admin of the target org may pull a team into it.
    if (!(await canManageOrganization(me.id, organizationId))) {
      return apiError(
        res,
        403,
        "You must be an owner or admin of the organization to adopt a team.",
        { code: "ORG_FORBIDDEN" },
      );
    }

    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) return apiError(res, 404, "Team not found");
    if (team.organizationId) {
      return apiError(res, 409, "This team already belongs to an organization.", {
        code: "ALREADY_ADOPTED",
      });
    }

    // Race-safe reparent: only succeeds while the team is still org-less.
    const adopted = await db
      .update(teams)
      .set({ organizationId })
      .where(and(eq(teams.id, teamId), isNull(teams.organizationId)))
      .returning();
    if (adopted.length === 0) {
      return apiError(
        res,
        409,
        "This team was just adopted by another organization.",
        { code: "ALREADY_ADOPTED" },
      );
    }

    res.json({ ok: true, teamId, organizationId });
  }),
);

// ---------------------------------------------------------------------------
// Adopt-link (coach-generated shareable invite)
// ---------------------------------------------------------------------------
//
// A solo team's coach can't be expected to also be an admin of the adopting
// organization. So the coach mints a one-time secret link and hands it to
// their org admin, who opens `/adopt-team/<token>` and confirms which org (or
// creates one) to reparent the team into. Mirrors the org-claim-link pattern:
// the token alone authorizes resolving the team on the public landing page,
// the finalize step still gates on the claimer being an owner/admin of the
// chosen org, and the same race-safe `WHERE organization_id IS NULL` guard is
// the source of truth. The token is single-use — cleared on success — and the
// coach can rotate it to revoke an outstanding link.

// Public, token-keyed; rate-limited by IP to blunt token guessing.
const teamAdoptLinkLimiter = rateLimit({
  name: "team-adopt-link",
  windowMs: ONE_HOUR,
  max: 120,
  keys: (req) => [ipKey(req)],
  message: "Too many requests. Please wait a moment and try again.",
});

// POST /teams/:teamId/adopt-link — coach/manager mints (or rotates) the link.
// Returns the current token, creating one lazily; pass `{ rotate: true }` to
// issue a fresh token and invalidate any previously shared link.
const AdoptLinkBody = z.object({ rotate: z.boolean().optional() });

router.post(
  "/teams/:teamId/adopt-link",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = String(req.params.teamId);

    const parsed = AdoptLinkBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return apiError(res, 400, "Invalid request.", {
        code: "VALIDATION_FAILED",
      });
    }
    const rotate = parsed.data.rotate === true;

    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) return apiError(res, 404, "Team not found");
    if (!(await canManageTeam(me.id, team))) {
      return apiError(
        res,
        403,
        "Only a coach or manager of this team can create an adopt link.",
        { code: "TEAM_FORBIDDEN" },
      );
    }
    if (team.organizationId) {
      return apiError(res, 409, "This team already belongs to an organization.", {
        code: "ALREADY_ADOPTED",
      });
    }

    let token = team.adoptToken;
    if (!token || rotate) {
      token = randomBytes(24).toString("base64url");
      await db
        .update(teams)
        .set({ adoptToken: token })
        .where(eq(teams.id, teamId));
    }
    res.json({ ok: true, token });
  }),
);

// Public — resolve a token to its (still org-less) team for the landing page.
// Never leaks the token or other secret fields.
router.get(
  "/team-adopt-links/:token",
  teamAdoptLinkLimiter,
  asyncHandler(async (req, res) => {
    const token = String(req.params.token ?? "");
    if (!token) return apiError(res, 404, "Adopt link not found");
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.adoptToken, token))
      .limit(1);
    if (!team) return apiError(res, 404, "Adopt link not found");
    res.json({
      team: {
        id: team.id,
        name: team.name,
        sport: team.sport,
        logoUrl: team.logoUrl,
      },
      alreadyAdopted: !!team.organizationId,
    });
  }),
);

// Auth — finalize: reparent the team into an org the signed-in user manages.
// Race-safe conditional UPDATE (only while org-less) is the authoritative
// guard; the token is cleared in the same statement so it can't be reused.
const AdoptLinkClaimBody = z.object({
  organizationId: z.string().uuid(),
});

router.post(
  "/team-adopt-links/:token/claim",
  requireAuth,
  teamAdoptLinkLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const token = String(req.params.token ?? "");
    if (!token) return apiError(res, 404, "Adopt link not found");

    const parsed = AdoptLinkClaimBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return apiError(res, 400, first?.message ?? "Invalid request.", {
        code: "VALIDATION_FAILED",
        extras: { fields: parsed.error.flatten().fieldErrors },
      });
    }
    const { organizationId } = parsed.data;

    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.adoptToken, token))
      .limit(1);
    if (!team) return apiError(res, 404, "Adopt link not found");
    if (team.organizationId) {
      return apiError(res, 409, "This team already belongs to an organization.", {
        code: "ALREADY_ADOPTED",
      });
    }

    // Only an owner/admin of the target org may pull a team into it.
    if (!(await canManageOrganization(me.id, organizationId))) {
      return apiError(
        res,
        403,
        "You must be an owner or admin of the organization to adopt a team.",
        { code: "ORG_FORBIDDEN" },
      );
    }

    // Race-safe reparent + single-use token consume in one statement: only
    // succeeds while the team is still org-less and the token is unchanged.
    const adopted = await db
      .update(teams)
      .set({ organizationId, adoptToken: null })
      .where(
        and(
          eq(teams.id, team.id),
          eq(teams.adoptToken, token),
          isNull(teams.organizationId),
        ),
      )
      .returning();
    if (adopted.length === 0) {
      return apiError(
        res,
        409,
        "This team was just adopted by another organization.",
        { code: "ALREADY_ADOPTED" },
      );
    }

    res.json({ ok: true, teamId: team.id, organizationId });
  }),
);

// ---------------------------------------------------------------------------
// Task #746 — hide / unhide a competition game on the team page. Team admins
// (coaches/managers + parent-org admins) can hide an individual imported
// tournament match from the PUBLIC team page. Hiding is scoped to the team
// page only — the competition's own public page is unaffected. Both
// operations are idempotent.
// ---------------------------------------------------------------------------

router.post(
  "/teams/:teamId/competition-games/:matchId/hide",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser!;
    const teamId = String(req.params.teamId);
    const matchId = String(req.params.matchId);
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) return apiError(res, 404, "Team not found");
    if (!(await canManageTeam(me.id, team)))
      return apiError(res, 403, "Only team admins can hide games");
    // The match must actually involve one of this team's claimed slots —
    // otherwise a team admin could stash hide rows against arbitrary games.
    const myParts = await db
      .select({ id: tournamentParticipants.id })
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.teamId, teamId));
    const partIds = myParts.map((p) => p.id);
    const [match] =
      partIds.length > 0
        ? await db
            .select({ id: tournamentMatches.id })
            .from(tournamentMatches)
            .where(
              and(
                eq(tournamentMatches.id, matchId),
                or(
                  inArray(tournamentMatches.homeParticipantId, partIds),
                  inArray(tournamentMatches.awayParticipantId, partIds),
                ),
              ),
            )
            .limit(1)
        : [];
    if (!match) return apiError(res, 404, "Game not found for this team");
    await db
      .insert(teamHiddenCompetitionGames)
      .values({
        teamId,
        competitionGameId: matchId,
        hiddenByUserId: me.id,
      })
      .onConflictDoNothing();
    res.json({ ok: true, hidden: true });
  }),
);

router.delete(
  "/teams/:teamId/competition-games/:matchId/hide",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser!;
    const teamId = String(req.params.teamId);
    const matchId = String(req.params.matchId);
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) return apiError(res, 404, "Team not found");
    if (!(await canManageTeam(me.id, team)))
      return apiError(res, 403, "Only team admins can unhide games");
    await db
      .delete(teamHiddenCompetitionGames)
      .where(
        and(
          eq(teamHiddenCompetitionGames.teamId, teamId),
          eq(teamHiddenCompetitionGames.competitionGameId, matchId),
        ),
      );
    res.json({ ok: true, hidden: false });
  }),
);

// ---------------------------------------------------------------------------
// Hide / unhide a participant slot from the competition's public Teams list.
// Competition operators (owner, competition/hub admins, platform admin) only.
// Hidden slots are omitted for public viewers but stay in the schedule and
// remain visible (greyed) to operators. Both operations are idempotent.
// ---------------------------------------------------------------------------

router.post(
  "/competitions/:competitionId/participants/:participantId/hide",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser!;
    const competitionId = String(req.params.competitionId);
    const participantId = String(req.params.participantId);
    const [tournament] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, competitionId))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, tournament)))
      return apiError(res, 403, "Only competition admins can hide teams");
    const [updated] = await db
      .update(tournamentParticipants)
      .set({ hiddenAt: new Date(), hiddenByUserId: me.id })
      .where(
        and(
          eq(tournamentParticipants.id, participantId),
          eq(tournamentParticipants.tournamentId, tournament.id),
        ),
      )
      .returning({ id: tournamentParticipants.id });
    if (!updated)
      return apiError(res, 404, "Team not found in this competition");
    res.json({ ok: true, hidden: true });
  }),
);

router.delete(
  "/competitions/:competitionId/participants/:participantId/hide",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser!;
    const competitionId = String(req.params.competitionId);
    const participantId = String(req.params.participantId);
    const [tournament] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, competitionId))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, tournament)))
      return apiError(res, 403, "Only competition admins can unhide teams");
    const [updated] = await db
      .update(tournamentParticipants)
      .set({ hiddenAt: null, hiddenByUserId: null })
      .where(
        and(
          eq(tournamentParticipants.id, participantId),
          eq(tournamentParticipants.tournamentId, tournament.id),
        ),
      )
      .returning({ id: tournamentParticipants.id });
    if (!updated)
      return apiError(res, 404, "Team not found in this competition");
    res.json({ ok: true, hidden: false });
  }),
);

// Task #866 — bulk hide: same semantics/permission as the single hide, but
// for a list of participant ids in one request. Every id must belong to
// this competition (whole request 400s otherwise, so a stale client can't
// silently half-apply). Idempotent — already-hidden slots just get their
// stamp refreshed like the single route does.
const BulkHideBody = z.object({
  participantIds: z.array(z.string().uuid()).min(1).max(500),
});

router.post(
  "/competitions/:competitionId/participants/bulk-hide",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser!;
    const competitionId = String(req.params.competitionId);
    const [tournament] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, competitionId))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, tournament)))
      return apiError(res, 403, "Only competition admins can hide teams");
    const parsed = BulkHideBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return apiError(res, 400, first?.message ?? "Invalid team selection.", {
        code: "VALIDATION_FAILED",
      });
    }
    const ids = Array.from(new Set(parsed.data.participantIds));
    // Atomic all-or-nothing: update inside a transaction and roll back when
    // fewer rows matched than requested, so a concurrently removed slot can
    // never produce a silent partial hide.
    let hiddenCount: number | null = null;
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(tournamentParticipants)
        .set({ hiddenAt: new Date(), hiddenByUserId: me.id })
        .where(
          and(
            eq(tournamentParticipants.tournamentId, tournament.id),
            inArray(tournamentParticipants.id, ids),
          ),
        )
        .returning({ id: tournamentParticipants.id });
      if (updated.length !== ids.length) {
        tx.rollback();
        return;
      }
      hiddenCount = updated.length;
    }).catch((err) => {
      // drizzle's tx.rollback() throws to abort — swallow only that path
      // (hiddenCount stays null → 400 below); real DB errors still bubble.
      if (!(err instanceof TransactionRollbackError)) throw err;
    });
    if (hiddenCount === null) {
      return apiError(
        res,
        400,
        "Some of the selected teams aren't part of this competition anymore. Refresh the page and try again.",
      );
    }
    res.json({ ok: true, hiddenCount });
  }),
);

// ---------------------------------------------------------------------------
// GET /teams/:teamId/tournament-schedule — PUBLIC. The tournament match
// schedule for a team that claimed a participant slot, oriented to THAT team
// (opponent name), grouped by tournament. The imported tournament schedule
// stays the source of truth, so slot corrections on re-import flow through
// here automatically. Returns an empty `data` array when the team isn't
// linked to any tournament.
// ---------------------------------------------------------------------------

router.get(
  "/teams/:teamId/tournament-schedule",
  asyncHandler(async (req, res) => {
    const teamId = String(req.params.teamId);

    const myParts = await db
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.teamId, teamId));
    if (myParts.length === 0) return res.json({ data: [] });

    // Org-backed teams have normal recap rights — the free-window notice is
    // only meaningful for org-less solo teams, so we null it out for them.
    // Task #746 needs the FULL team row: canManageTeam decides whether the
    // viewer sees hidden games (greyed out) or not at all.
    const [teamRow] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    const isOrgBacked = !!teamRow?.organizationId;

    // Task #746 — team admins can hide individual games from the public
    // team page. loadSession runs globally, so req.sessionUser is
    // available even on this public route. Admin viewers get hidden
    // matches back with `hidden: true`; everyone else doesn't see them.
    const viewerCanManage =
      req.sessionUser && teamRow
        ? await canManageTeam(req.sessionUser.id, teamRow)
        : false;
    const myPartIds = myParts.map((p) => p.id);
    const myPartIdSet = new Set(myPartIds);
    const tournamentIds = Array.from(new Set(myParts.map((p) => p.tournamentId)));

    const tourneyRows = await db
      .select()
      .from(tournaments)
      .where(inArray(tournaments.id, tournamentIds));
    const tourneyById = new Map(tourneyRows.map((t) => [t.id, t]));

    const matchRows = await db
      .select()
      .from(tournamentMatches)
      .where(
        and(
          inArray(tournamentMatches.tournamentId, tournamentIds),
          or(
            inArray(tournamentMatches.homeParticipantId, myPartIds),
            inArray(tournamentMatches.awayParticipantId, myPartIds),
          ),
        ),
      );

    // Task #746 — per-team hidden games + published-recap links.
    const matchIds = matchRows.map((m) => m.id);
    const hiddenRows =
      matchIds.length > 0
        ? await db
            .select({ id: teamHiddenCompetitionGames.competitionGameId })
            .from(teamHiddenCompetitionGames)
            .where(
              and(
                eq(teamHiddenCompetitionGames.teamId, teamId),
                inArray(
                  teamHiddenCompetitionGames.competitionGameId,
                  matchIds,
                ),
              ),
            )
        : [];
    const hiddenSet = new Set(hiddenRows.map((r) => r.id));
    // This team's PUBLISHED recaps linked to a specific game. Ordered so
    // the earliest published recap wins when several link the same game.
    const recapRows =
      matchIds.length > 0
        ? await db
            .select({
              id: articles.id,
              competitionGameId: articles.competitionGameId,
            })
            .from(articles)
            .where(
              and(
                eq(articles.teamId, teamId),
                eq(articles.status, "published"),
                inArray(articles.competitionGameId, matchIds),
              ),
            )
            .orderBy(asc(articles.publishedAt), asc(articles.createdAt))
        : [];
    const recapPostIdByMatch = new Map<string, string>();
    for (const r of recapRows) {
      if (r.competitionGameId && !recapPostIdByMatch.has(r.competitionGameId)) {
        recapPostIdByMatch.set(r.competitionGameId, articlePostId(r.id));
      }
    }

    // Resolve opponent display names for every participant referenced.
    const refIds = new Set<string>();
    for (const m of matchRows) {
      if (m.homeParticipantId) refIds.add(m.homeParticipantId);
      if (m.awayParticipantId) refIds.add(m.awayParticipantId);
    }
    const refRows =
      refIds.size > 0
        ? await db
            .select()
            .from(tournamentParticipants)
            .where(inArray(tournamentParticipants.id, Array.from(refIds)))
        : [];
    const nameById = new Map(refRows.map((p) => [p.id, p.name]));

    interface OutMatch {
      id: string;
      matchNumber: string;
      matchDate: string | null;
      startTime: string | null;
      division: string;
      bracket: string;
      venue: string | null;
      venueState: string | null;
      field: string | null;
      isHome: boolean;
      opponentName: string | null;
      // Task #746 — link to this team's published recap for the game
      // (null when none) and, for admin viewers only, whether the game
      // is hidden from the public team page.
      recapPostId: string | null;
      hidden?: boolean;
      // Task #765 — postponed/canceled treatment on the team page.
      status: string;
      statusReason: string | null;
    }
    const groups = new Map<
      string,
      {
        tournamentId: string;
        tournamentSlug: string;
        tournamentName: string;
        startDate: string;
        endDate: string;
        recapFreeUntil: string | null;
        logoUrl: string | null;
        brandColor: string | null;
        secondaryColor: string | null;
        matches: OutMatch[];
      }
    >();

    for (const m of matchRows) {
      const t = tourneyById.get(m.tournamentId);
      if (!t) continue;
      // Task #746 — hidden games: omitted entirely for the public,
      // greyed-out (hidden: true) for team admins.
      const isHidden = hiddenSet.has(m.id);
      if (isHidden && !viewerCanManage) continue;
      const isHome =
        m.homeParticipantId != null && myPartIdSet.has(m.homeParticipantId);
      const oppId = isHome ? m.awayParticipantId : m.homeParticipantId;
      let g = groups.get(m.tournamentId);
      if (!g) {
        g = {
          tournamentId: t.id,
          tournamentSlug: t.slug,
          tournamentName: t.name,
          startDate: t.startDate,
          endDate: t.endDate,
          recapFreeUntil: isOrgBacked ? null : t.endDate,
          logoUrl: t.logoUrl ?? null,
          brandColor: t.brandColor ?? null,
          secondaryColor: t.secondaryColor ?? null,
          matches: [],
        };
        groups.set(m.tournamentId, g);
      }
      g.matches.push({
        id: m.id,
        matchNumber: m.matchNumber,
        matchDate: m.matchDate,
        startTime: parseStartTimeCell(m.startTime),
        division: m.division,
        bracket: m.bracket,
        venue: m.venue,
        venueState: m.venueState,
        field: m.field,
        isHome,
        opponentName: oppId ? nameById.get(oppId) ?? null : null,
        recapPostId: recapPostIdByMatch.get(m.id) ?? null,
        status: m.status,
        statusReason: m.statusReason,
        ...(isHidden ? { hidden: true } : {}),
      });
    }

    const sortMatches = (a: OutMatch, b: OutMatch) => {
      const da = a.matchDate ?? "";
      const dbb = b.matchDate ?? "";
      if (da !== dbb) return da < dbb ? -1 : 1;
      const ta = a.startTime ?? "";
      const tb = b.startTime ?? "";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.matchNumber.localeCompare(b.matchNumber, undefined, {
        numeric: true,
      });
    };

    const data = Array.from(groups.values())
      .map((g) => ({ ...g, matches: g.matches.sort(sortMatches) }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    res.json({ data });
  }),
);

export default router;
