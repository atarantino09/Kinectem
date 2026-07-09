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
  teams,
  rosterEntries,
  articles,
  gameScoreReports,
  organizationAdmins,
} from "@workspace/db";
import { and, eq, isNull, desc, sql, inArray, or } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { requireAdmin, requireAuth } from "../lib/auth";
import { apiError, MAX_IMAGE_DATA_URL_LENGTH } from "../lib/spec-helpers";
import { resolveScore } from "../lib/score-resolve";
import {
  canManageOrganization,
  canManageTeam,
  recapFreeUntil,
} from "../lib/permissions";

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
  "home score",
  "away team",
  "away score",
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];

const REQUIRED_CSV_COLUMNS: CsvColumn[] = [
  "match #",
  "date",
  "home team",
  "away team",
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
  "home score": ["homescore", "homegoals", "score1", "hscore"],
  "away team": ["awayteam", "away", "visitor", "visitorteam", "team2", "teamb", "awayclub"],
  "away score": ["awayscore", "awaygoals", "score2", "ascore", "visitorscore"],
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
  const missing = REQUIRED_CSV_COLUMNS.filter((c) => index[c] === undefined);
  return { index, missing };
}

const MAX_IMPORT_ROWS = 1000;

// Parse a score cell into an integer or null (empty / non-numeric → null).
function parseScore(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

// Normalize a CSV date cell to a YYYY-MM-DD string for the `date` column, or
// null when it isn't a parseable date.
function parseDateCell(v: string): string | null {
  const t = v.trim();
  if (t === "") return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Slot key for a participant: division|bracket|nameKey, all lowercased and
// trimmed; division/bracket normalize to "" (never null) to mirror the
// schema's unique-slot index.
function slotKey(division: string, bracket: string, nameKey: string): string {
  return `${division}\u0000${bracket}\u0000${nameKey}`;
}

// ---------------------------------------------------------------------------
// Competition operator scope (Competitions §3). A competition's OWNER (the
// creator, `ownerUserId`) can manage only their own competitions — branding,
// schedule uploads, claim settings, curation. Platform admins retain global
// oversight. This is per-competition scope, NOT a platform role.
// ---------------------------------------------------------------------------

type SessionUserLike = { id: string; role: string };

function canOperateCompetition(
  me: SessionUserLike,
  competition: { ownerUserId: string | null; createdById: string | null },
): boolean {
  if (me.role === "admin") return true;
  // ownerUserId is backfilled from createdById; fall back for safety.
  const owner = competition.ownerUserId ?? competition.createdById;
  return owner != null && owner === me.id;
}

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

  const [row] = await db
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
    })
    .returning();

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

async function competitionListRow(t: typeof tournaments.$inferSelect) {
  const [{ matchCount }] = await db
    .select({ matchCount: sql<number>`count(*)::int` })
    .from(tournamentMatches)
    .where(eq(tournamentMatches.tournamentId, t.id));
  const [{ participantCount }] = await db
    .select({ participantCount: sql<number>`count(*)::int` })
    .from(tournamentParticipants)
    .where(eq(tournamentParticipants.tournamentId, t.id));
  const [{ claimedCount }] = await db
    .select({ claimedCount: sql<number>`count(*)::int` })
    .from(tournamentParticipants)
    .where(
      and(
        eq(tournamentParticipants.tournamentId, t.id),
        sql`${tournamentParticipants.teamId} IS NOT NULL`,
      ),
    );
  const [{ pendingClaimCount }] = await db
    .select({ pendingClaimCount: sql<number>`count(*)::int` })
    .from(tournamentParticipants)
    .where(
      and(
        eq(tournamentParticipants.tournamentId, t.id),
        sql`${tournamentParticipants.pendingTeamId} IS NOT NULL`,
        isNull(tournamentParticipants.teamId),
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
    autoApproveClaims: t.autoApproveClaims,
    logoUrl: t.logoUrl,
    brandColor: t.brandColor,
    secondaryColor: t.secondaryColor,
    tertiaryColor: t.tertiaryColor,
    matchCount,
    participantCount,
    claimedCount,
    pendingClaimCount,
    createdAt: t.createdAt.toISOString(),
  };
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
    const data = Array.from(byId.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({
        id: t.id,
        name: t.name,
        sport: t.sport ?? null,
        organizationId: t.organizationId ?? null,
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
    const rows = await db
      .select()
      .from(tournaments)
      .where(
        or(
          eq(tournaments.ownerUserId, me.id),
          and(isNull(tournaments.ownerUserId), eq(tournaments.createdById, me.id)),
        ),
      )
      .orderBy(desc(tournaments.createdAt));
    const data = await Promise.all(rows.map(competitionListRow));
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
    if (!canOperateCompetition(me, competition)) {
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
// with resolved home/away names + imported scores. The client groups by
// division / bracket / field / time for display.
// ---------------------------------------------------------------------------

const publicCompetitionRead = asyncHandler(async (req, res) => {
    const [tournament] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.slug, req.params.slug))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Competition not found");

    const partRows = await db
      .select()
      .from(tournamentParticipants)
      .where(eq(tournamentParticipants.tournamentId, tournament.id))
      .orderBy(tournamentParticipants.name);
    const partById = new Map(partRows.map((p) => [p.id, p]));

    const matchRows = await db
      .select()
      .from(tournamentMatches)
      .where(eq(tournamentMatches.tournamentId, tournament.id));

    // Score ladder (§6) — load self-reports for every game in one query and
    // resolve each game to its highest tier. Only official/confirmed scores
    // are public on this page; reported/disputed stay hidden here.
    const reportRows = matchRows.length
      ? await db
          .select()
          .from(gameScoreReports)
          .where(
            inArray(
              gameScoreReports.competitionGameId,
              matchRows.map((m) => m.id),
            ),
          )
      : [];
    const reportsByGame = new Map<string, typeof reportRows>();
    for (const r of reportRows) {
      const arr = reportsByGame.get(r.competitionGameId) ?? [];
      arr.push(r);
      reportsByGame.set(r.competitionGameId, arr);
    }

    // Active window: today's date (UTC calendar) within [startDate, endDate]
    // inclusive — same comparison the recap gate uses.
    const today = new Date().toISOString().slice(0, 10);
    const isActive = today >= tournament.startDate && today <= tournament.endDate;

    const claimedCount = partRows.filter((p) => p.teamId != null).length;

    // Featured game recaps rail (§7) — published recaps the operator featured.
    // The card carries the AUTHORING TEAM's identity (name), sitting inside
    // the competition-branded page.
    const featuredRows = await db
      .select({ article: articles, teamName: teams.name })
      .from(articles)
      .innerJoin(teams, eq(teams.id, articles.teamId))
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
    };

    res.json({
      // Emitted under both keys so the legacy /t page and the new /c page
      // read the same payload during the rename transition.
      tournament: competitionMeta,
      competition: competitionMeta,
      featuredRecaps: featuredRows.map(({ article: a, teamName }) => ({
        // Post ids are prefixed ("article-<uuid>") — the client links to
        // /posts/:id which 404s on a raw uuid.
        id: `article-${a.id}`,
        title: a.title,
        summary: a.summary,
        coverImageUrl: a.coverImageUrl,
        gameDate: a.gameDate,
        opponentName: a.opponentName,
        teamScore: a.teamScore,
        opponentScore: a.opponentScore,
        teamId: a.teamId,
        teamName,
        publishedAt: a.publishedAt,
      })),
      participants: partRows.map((p) => ({
        id: p.id,
        name: p.name,
        division: p.division,
        bracket: p.bracket,
        age: p.age,
        gender: p.gender,
        claimed: p.teamId != null,
        teamId: p.teamId,
      })),
      matches: matchRows
        .map((m) => {
          const home = m.homeParticipantId ? partById.get(m.homeParticipantId) : null;
          const away = m.awayParticipantId ? partById.get(m.awayParticipantId) : null;
          const resolved = resolveScore(m, reportsByGame.get(m.id) ?? [], [
            home?.teamId,
            away?.teamId,
          ]);
          return {
            id: m.id,
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
            homeName: home?.name ?? null,
            awayName: away?.name ?? null,
            homeParticipantId: m.homeParticipantId,
            awayParticipantId: m.awayParticipantId,
            // Public score = official or confirmed only (§6). Reported /
            // disputed scores never leak onto the shareable page.
            homeScore: resolved.public ? resolved.homeScore : null,
            awayScore: resolved.public ? resolved.awayScore : null,
            scoreState: resolved.state,
            homeTeamId: home?.teamId ?? null,
            awayTeamId: away?.teamId ?? null,
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
// POST /tournaments/:id/import — operator uploads the match-slot CSV.
//
// Idempotent on re-upload:
//   - participants upsert on the unique-slot index (tournament,div,bracket,
//     nameKey) via onConflictDoNothing, then re-read to map slot → id.
//   - matches upsert on the unique (tournament, matchNumber) index via
//     onConflictDoUpdate so re-running corrects scores / participant links.
// ---------------------------------------------------------------------------

const ImportBody = z.object({
  csv: z.string().min(1).max(2_000_000),
});

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
    if (!canOperateCompetition(me, tournament)) {
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
      return apiError(
        res,
        400,
        `Couldn't find these columns in your file: ${missing.join(", ")}. ` +
          "Make sure the first row has headers like: match #, date, home team, away team.",
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
      homeScore: number | null;
      awayScore: number | null;
    }

    // First pass: parse rows + collect unique participant slots.
    const matchRecs: MatchRec[] = [];
    const slots = new Map<
      string,
      { name: string; nameKey: string; division: string; bracket: string; age: string | null; gender: string | null }
    >();

    for (const r of dataRows) {
      const matchNumber = col(r, "match #");
      if (!matchNumber) continue; // skip rows with no match id
      const division = col(r, "division");
      const bracket = col(r, "bracket");
      const age = col(r, "age") || null;
      const gender = col(r, "gender") || null;
      const homeName = col(r, "home team");
      const awayName = col(r, "away team");
      const homeKey = homeName.toLowerCase();
      const awayKey = awayName.toLowerCase();

      for (const [name, key] of [
        [homeName, homeKey],
        [awayName, awayKey],
      ] as const) {
        if (!name) continue;
        const sk = slotKey(division, bracket, key);
        if (!slots.has(sk)) {
          slots.set(sk, { name, nameKey: key, division, bracket, age, gender });
        }
      }

      matchRecs.push({
        matchNumber,
        matchDate: parseDateCell(col(r, "date")),
        startTime: col(r, "start time") || null,
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
        homeScore: parseScore(col(r, "home score")),
        awayScore: parseScore(col(r, "away score")),
      });
    }

    const summary = await db.transaction(async (tx) => {
      // Upsert participant slots (idempotent on the unique-slot index).
      const slotValues = Array.from(slots.values());
      if (slotValues.length > 0) {
        await tx
          .insert(tournamentParticipants)
          .values(
            slotValues.map((s) => ({
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

      // Re-read participants to map slot → id (covers pre-existing rows too).
      const partRows = await tx
        .select()
        .from(tournamentParticipants)
        .where(eq(tournamentParticipants.tournamentId, tournament.id));
      const partBySlot = new Map<string, string>();
      for (const p of partRows) {
        partBySlot.set(slotKey(p.division, p.bracket, p.nameKey), p.id);
      }

      // Upsert matches (idempotent on the unique (tournament, matchNumber)).
      let matchesUpserted = 0;
      for (const m of matchRecs) {
        const homeParticipantId = m.homeName
          ? partBySlot.get(slotKey(m.division, m.bracket, m.homeKey)) ?? null
          : null;
        const awayParticipantId = m.awayName
          ? partBySlot.get(slotKey(m.division, m.bracket, m.awayKey)) ?? null
          : null;
        await tx
          .insert(tournamentMatches)
          .values({
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
            homeParticipantId,
            awayParticipantId,
            homeScore: m.homeScore,
            awayScore: m.awayScore,
            // Competitions §6/§8 — CSV scores are OPERATOR data, so they land
            // straight in the official tier.
            homeScoreOfficial: m.homeScore,
            awayScoreOfficial: m.awayScore,
          })
          .onConflictDoUpdate({
            target: [tournamentMatches.tournamentId, tournamentMatches.matchNumber],
            set: {
              matchDate: m.matchDate,
              startTime: m.startTime,
              age: m.age,
              gender: m.gender,
              division: m.division,
              bracket: m.bracket,
              venue: m.venue,
              venueState: m.venueState,
              field: m.field,
              homeParticipantId,
              awayParticipantId,
              homeScore: m.homeScore,
              awayScore: m.awayScore,
              // Append-friendly re-import: a CSV row WITH scores corrects the
              // official score; a blank-score row keeps whatever official
              // score already exists (e.g. one the operator entered in-app).
              homeScoreOfficial: sql`COALESCE(${m.homeScore ?? null}::int, ${tournamentMatches.homeScoreOfficial})`,
              awayScoreOfficial: sql`COALESCE(${m.awayScore ?? null}::int, ${tournamentMatches.awayScoreOfficial})`,
              updatedAt: new Date(),
            },
          });
        matchesUpserted += 1;
      }

      return {
        participantCount: partRows.length,
        matchesUpserted,
      };
    });

    res.json({
      ok: true,
      tournamentId: tournament.id,
      matchesUpserted: summary.matchesUpserted,
      participantCount: summary.participantCount,
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
// POST /tournaments/:slug/claim — a signed-in visiting coach creates a SOLO
// team (no organization) and claims an unclaimed participant slot in one
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
          "Only a coach or admin of that team can claim a slot for it.",
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
          return tx
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
              ),
            )
            .returning();
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
    if (!canOperateCompetition(me, competition)) {
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
    if (!canOperateCompetition(me, competition)) {
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
          ),
        )
        .returning();
      if (updated.length === 0) {
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
    if (!canOperateCompetition(me, competition)) {
      return apiError(res, 403, "Only the competition operator can curate recaps.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }

    const rows = await db
      .select({ article: articles, teamName: teams.name })
      .from(articles)
      .innerJoin(teams, eq(teams.id, articles.teamId))
      .where(
        and(
          eq(articles.competitionId, competition.id),
          eq(articles.status, "published"),
          isNull(articles.hiddenAt),
        ),
      )
      .orderBy(desc(articles.createdAt))
      .limit(100);

    res.json({
      data: rows.map(({ article: a, teamName }) => ({
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
        createdAt: a.createdAt.toISOString(),
      })),
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
    if (!canOperateCompetition(me, competition)) {
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
// Score ladder (§6) — team self-report, dispute queue, operator official score.
// ---------------------------------------------------------------------------

const ScoreReportBody = z.object({
  homeScore: z.number().int().min(0).max(999),
  awayScore: z.number().int().min(0).max(999),
});

// POST /competitions/games/:gameId/report-score — a manager of a CLAIMED team
// on either side of the game reports the final score (home/away oriented).
// One report per (game, team); re-reporting updates in place.
router.post(
  "/competitions/games/:gameId/report-score",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = ScoreReportBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "Invalid request.", { code: "VALIDATION_FAILED" });
    }

    // Pre-transaction permission work (reads only) — the official-score
    // guard is re-checked inside the transaction under a row lock so a
    // concurrent operator write can't race a report in after the fact.
    const [game] = await db
      .select()
      .from(tournamentMatches)
      .where(eq(tournamentMatches.id, String(req.params.gameId)))
      .limit(1);
    if (!game) return apiError(res, 404, "Game not found");

    // Which claimed side (if any) does the caller manage?
    const sideIds = [game.homeParticipantId, game.awayParticipantId].filter(
      (x): x is string => x != null,
    );
    if (sideIds.length === 0) return apiError(res, 404, "Game not found");
    const sides = await db
      .select()
      .from(tournamentParticipants)
      .where(inArray(tournamentParticipants.id, sideIds));
    const sideTeamIds = sides.map((s) => s.teamId);
    let myTeamId: string | null = null;
    for (const side of sides) {
      if (!side.teamId) continue;
      const [team] = await db.select().from(teams).where(eq(teams.id, side.teamId)).limit(1);
      if (team && (await canManageTeam(me.id, team))) {
        myTeamId = team.id;
        break;
      }
    }
    if (!myTeamId) {
      return apiError(
        res,
        403,
        "Only a coach or manager of a claimed team in this game can report its score.",
        { code: "COMPETITION_FORBIDDEN" },
      );
    }
    const reportingTeamId = myTeamId;

    const outcome = await db.transaction(async (tx) => {
      // Lock the match row, then re-check the official-score guard.
      const [locked] = await tx
        .select()
        .from(tournamentMatches)
        .where(eq(tournamentMatches.id, game.id))
        .for("update")
        .limit(1);
      if (!locked) return { kind: "gone" as const };
      if (locked.homeScoreOfficial != null && locked.awayScoreOfficial != null) {
        return { kind: "official" as const };
      }

      await tx
        .insert(gameScoreReports)
        .values({
          competitionGameId: game.id,
          teamId: reportingTeamId,
          reportedByUserId: me.id,
          homeScore: parsed.data.homeScore,
          awayScore: parsed.data.awayScore,
        })
        .onConflictDoUpdate({
          target: [gameScoreReports.competitionGameId, gameScoreReports.teamId],
          set: {
            homeScore: parsed.data.homeScore,
            awayScore: parsed.data.awayScore,
            reportedByUserId: me.id,
            updatedAt: new Date(),
          },
        });

      const reports = await tx
        .select()
        .from(gameScoreReports)
        .where(eq(gameScoreReports.competitionGameId, game.id));
      return {
        kind: "ok" as const,
        resolved: resolveScore(locked, reports, sideTeamIds),
      };
    });

    if (outcome.kind === "gone") return apiError(res, 404, "Game not found");
    if (outcome.kind === "official") {
      return apiError(res, 409, "This game already has an official score.", {
        code: "SCORE_OFFICIAL",
      });
    }
    res.json({
      ok: true,
      gameId: game.id,
      teamId: reportingTeamId,
      scoreState: outcome.resolved.state,
    });
  }),
);

// GET /competitions/:id/disputes — operator queue of games where the two
// teams' reports disagree and no official score exists yet.
router.get(
  "/competitions/:id/disputes",
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
    if (!canOperateCompetition(me, competition)) {
      return apiError(res, 403, "Only the competition operator can review disputes.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }

    const games = await db
      .select()
      .from(tournamentMatches)
      .where(eq(tournamentMatches.tournamentId, competition.id));
    const gameIds = games.map((g) => g.id);
    const reports = gameIds.length
      ? await db
          .select({ report: gameScoreReports, teamName: teams.name })
          .from(gameScoreReports)
          .innerJoin(teams, eq(teams.id, gameScoreReports.teamId))
          .where(inArray(gameScoreReports.competitionGameId, gameIds))
      : [];
    const byGame = new Map<string, typeof reports>();
    for (const r of reports) {
      const arr = byGame.get(r.report.competitionGameId) ?? [];
      arr.push(r);
      byGame.set(r.report.competitionGameId, arr);
    }

    const partIds = games
      .flatMap((g) => [g.homeParticipantId, g.awayParticipantId])
      .filter((x): x is string => x != null);
    const parts = partIds.length
      ? await db
          .select()
          .from(tournamentParticipants)
          .where(inArray(tournamentParticipants.id, partIds))
      : [];
    const partById = new Map(parts.map((p) => [p.id, p]));

    const disputes = games
      .filter((g) => {
        const rs = byGame.get(g.id) ?? [];
        const sideTeamIds = [
          g.homeParticipantId ? partById.get(g.homeParticipantId)?.teamId : null,
          g.awayParticipantId ? partById.get(g.awayParticipantId)?.teamId : null,
        ];
        return (
          resolveScore(g, rs.map((r) => r.report), sideTeamIds).state ===
          "disputed"
        );
      })
      .map((g) => ({
        gameId: g.id,
        matchNumber: g.matchNumber,
        matchDate: g.matchDate,
        division: g.division,
        bracket: g.bracket,
        homeName: g.homeParticipantId
          ? (partById.get(g.homeParticipantId)?.name ?? null)
          : null,
        awayName: g.awayParticipantId
          ? (partById.get(g.awayParticipantId)?.name ?? null)
          : null,
        reports: (byGame.get(g.id) ?? []).map((r) => ({
          teamId: r.report.teamId,
          teamName: r.teamName,
          homeScore: r.report.homeScore,
          awayScore: r.report.awayScore,
          updatedAt: r.report.updatedAt.toISOString(),
        })),
      }));

    res.json({ data: disputes });
  }),
);

// POST /competitions/:id/games/:gameId/official-score — operator enters the
// official score in one action; promotes the game to the Official tier
// (resolves any dispute).
router.post(
  "/competitions/:id/games/:gameId/official-score",
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
    if (!canOperateCompetition(me, competition)) {
      return apiError(res, 403, "Only the competition operator can set official scores.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }
    const parsed = ScoreReportBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "Invalid request.", { code: "VALIDATION_FAILED" });
    }

    const updated = await db
      .update(tournamentMatches)
      .set({
        homeScoreOfficial: parsed.data.homeScore,
        awayScoreOfficial: parsed.data.awayScore,
        status: "completed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tournamentMatches.id, String(req.params.gameId)),
          eq(tournamentMatches.tournamentId, competition.id),
        ),
      )
      .returning({ id: tournamentMatches.id });
    if (updated.length === 0) {
      return apiError(res, 404, "Game not found in this competition.");
    }
    res.json({ ok: true, gameId: updated[0].id, scoreState: "official" });
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
// GET /teams/:teamId/tournament-schedule — PUBLIC. The tournament match
// schedule for a team that claimed a participant slot, oriented to THAT team
// (opponent name + this-team/opponent scores), grouped by tournament. The
// imported tournament schedule stays the source of truth, so score / slot
// corrections on re-import flow through here automatically. Returns an empty
// `data` array when the team isn't linked to any tournament.
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
    const [teamRow] = await db
      .select({ organizationId: teams.organizationId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    const isOrgBacked = !!teamRow?.organizationId;

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
      teamScore: number | null;
      opponentScore: number | null;
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
          recapFreeUntil: isOrgBacked ? null : recapFreeUntil(t.startDate),
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
        startTime: m.startTime,
        division: m.division,
        bracket: m.bracket,
        venue: m.venue,
        venueState: m.venueState,
        field: m.field,
        isHome,
        opponentName: oppId ? nameById.get(oppId) ?? null : null,
        teamScore: isHome ? m.homeScore : m.awayScore,
        opponentScore: isHome ? m.awayScore : m.homeScore,
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
