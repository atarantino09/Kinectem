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
} from "@workspace/db";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { requireAdmin, requireAuth } from "../lib/auth";
import { apiError } from "../lib/spec-helpers";
import { canManageOrganization } from "../lib/permissions";

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

// The expected CSV columns (lowercased header match). Order in the file does
// not matter — each row is resolved by header position.
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
// POST /tournaments — operator creates a tournament (platform admin only)
// ---------------------------------------------------------------------------

const CreateTournamentBody = z.object({
  name: z.string().trim().min(1, "Tournament name is required").max(200),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
  location: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
});

router.post(
  "/tournaments",
  requireAdmin,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = CreateTournamentBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return apiError(res, 400, first?.message ?? "Invalid tournament details.", {
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
        startDate: body.startDate,
        endDate: body.endDate,
        location: body.location ?? null,
        description: body.description ?? null,
        createdById: me.id,
      })
      .returning();

    res.status(201).json({
      id: row.id,
      slug: row.slug,
      name: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      location: row.location,
      description: row.description,
      createdAt: row.createdAt.toISOString(),
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
        return {
          id: t.id,
          slug: t.slug,
          name: t.name,
          startDate: t.startDate,
          endDate: t.endDate,
          location: t.location,
          matchCount,
          participantCount,
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

router.get(
  "/tournaments/:slug",
  asyncHandler(async (req, res) => {
    const [tournament] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.slug, req.params.slug))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Tournament not found");

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

    // Active window: today's date (UTC calendar) within [startDate, endDate]
    // inclusive — same comparison the recap gate uses.
    const today = new Date().toISOString().slice(0, 10);
    const isActive = today >= tournament.startDate && today <= tournament.endDate;

    res.json({
      tournament: {
        id: tournament.id,
        slug: tournament.slug,
        name: tournament.name,
        startDate: tournament.startDate,
        endDate: tournament.endDate,
        location: tournament.location,
        description: tournament.description,
        isActive,
      },
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
            homeScore: m.homeScore,
            awayScore: m.awayScore,
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
  csv: z.string().min(1).max(2_000_000),
});

router.post(
  "/tournaments/:id/import",
  requireAdmin,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [tournament] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, req.params.id))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Tournament not found");

    const parsed = ImportBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }

    const grid = parseCsv(parsed.data.csv).filter((r) =>
      r.some((c) => c.trim() !== ""),
    );
    if (grid.length === 0) return apiError(res, 400, "CSV is empty");

    const header = grid[0].map((h) => h.trim().toLowerCase());
    const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
    if (missing.length > 0) {
      return apiError(res, 400, `CSV is missing columns: ${missing.join(", ")}`);
    }
    const dataRows = grid.slice(1);
    if (dataRows.length > MAX_IMPORT_ROWS) {
      return apiError(
        res,
        400,
        `Too many rows (${dataRows.length}); max ${MAX_IMPORT_ROWS}.`,
      );
    }

    const col = (rec: string[], name: (typeof CSV_COLUMNS)[number]): string =>
      (rec[header.indexOf(name)] ?? "").trim();

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
  }),
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

const ClaimBody = z.object({
  participantId: z.string().uuid("Invalid participant"),
  teamName: z.string().trim().min(1, "Team name is required").max(120),
  sport: z.string().trim().max(100).optional().nullable(),
  gender: z.enum(ALLOWED_GENDERS).optional().nullable(),
});

class AlreadyClaimedError extends Error {}

router.post(
  "/tournaments/:slug/claim",
  requireAuth,
  tournamentWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [tournament] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.slug, req.params.slug))
      .limit(1);
    if (!tournament) return apiError(res, 404, "Tournament not found");

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

    try {
      const result = await db.transaction(async (tx) => {
        const [team] = await tx
          .insert(teams)
          .values({
            organizationId: null,
            name: body.teamName,
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
          .set({
            teamId: team.id,
            claimedByUserId: me.id,
            claimedAt: new Date(),
          })
          .where(
            and(
              eq(tournamentParticipants.id, body.participantId),
              eq(tournamentParticipants.tournamentId, tournament.id),
              isNull(tournamentParticipants.teamId),
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
      });
    } catch (err) {
      if (err instanceof AlreadyClaimedError) {
        return apiError(res, 409, "That team slot was just claimed by someone else.", {
          code: "ALREADY_CLAIMED",
        });
      }
      throw err;
    }
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

export default router;
