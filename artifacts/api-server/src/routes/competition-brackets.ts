// Task #852 — competition brackets: organizer-defined labels for SORTING
// recaps (no standings/seeding/match trees). Hand-written Express routes +
// local Zod (NOT in the locked openapi.yaml; the client calls these via
// `customFetch` — same precedent as competition-admins.ts).
//
// Surface:
//   GET    /competitions/:id/brackets            — any signed-in user (the
//          composer needs the list for coaches); ordered by sort_order.
//          Organizers get a lazy backfill: brackets are seeded from the
//          already-imported schedule on read, so consoles for competitions
//          imported before this feature see their brackets immediately.
//   POST   /competitions/:id/brackets            — organizer create
//   PATCH  /competitions/:id/brackets/:bracketId — organizer edit
//   DELETE /competitions/:id/brackets/:bracketId — organizer delete
//          (articles.bracket_id has ON DELETE SET NULL — recaps survive)
//   POST   /competitions/:id/brackets/reorder    — organizer, one call
//          persists the full custom order
//   POST   /competitions/:id/recaps/:articleId/bracket — organizer sets or
//          clears the bracket on a recap (any time, incl. after publish)

import { Router, type IRouter } from "express";
import {
  db,
  tournaments,
  competitionBrackets,
  articles,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { canOperateCompetition } from "../lib/competition-permissions";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { requireAuth } from "../lib/auth";
import { apiError } from "../lib/spec-helpers";
import {
  bracketLabelKey,
  seedBracketsFromSchedule,
  linkParticipantsToBrackets,
} from "../lib/competition-brackets";

const router: IRouter = Router();

const bracketWriteLimiter = rateLimit({
  name: "competition-bracket-write",
  windowMs: 60_000,
  max: 120,
  keys: (req) => [ipKey(req)],
  message: "Too many bracket changes. Please wait a moment and try again.",
});

const GENDERS = ["Boys", "Girls", "Coed"] as const;

const BracketBody = z.object({
  label: z.string().trim().min(1, "Bracket name is required").max(120),
  gender: z.enum(GENDERS).nullable().optional(),
  ageGroup: z.string().trim().max(40).nullable().optional(),
});

function bracketView(b: typeof competitionBrackets.$inferSelect) {
  return {
    id: b.id,
    label: b.label,
    gender: b.gender,
    ageGroup: b.ageGroup,
    sortOrder: b.sortOrder,
  };
}

async function loadCompetition(id: string) {
  const [row] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, id))
    .limit(1);
  return row ?? null;
}

// GET — list in the organizer's saved order. Signed-in only (coaches need
// it in the composer); organizers additionally trigger the idempotent
// backfill from an already-imported schedule.
router.get(
  "/competitions/:id/brackets",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadCompetition(String(req.params.id));
    if (!competition) return apiError(res, 404, "Competition not found");
    const canManage = await canOperateCompetition(me, competition);
    if (canManage) {
      // Lazy backfill for PRE-FEATURE schedules only: seed solely when this
      // competition has no brackets at all. Task #865 — seeding per-label on
      // every load would silently recreate brackets the organizer just
      // deleted (and re-adopt their teams), so an existing bracket list —
      // even a partial one — is treated as the organizer's intent, and the
      // durable bracketsSeededAt stamp keeps a deliberately EMPTIED list
      // (delete-all) from being mistaken for a never-seeded competition.
      if (!competition.bracketsSeededAt) {
        const [{ n }] = await db
          .select({ n: sql<number>`COUNT(*)` })
          .from(competitionBrackets)
          .where(eq(competitionBrackets.tournamentId, competition.id));
        if (Number(n) === 0) {
          await seedBracketsFromSchedule(competition.id);
        }
      }
      // Task #865 — link any unlinked team slots (pre-feature imports or
      // newly seeded brackets) so the Teams grouping appears without a
      // re-upload. Linking never creates brackets, so it's always safe.
      await linkParticipantsToBrackets(competition.id);
    }
    const rows = await db
      .select()
      .from(competitionBrackets)
      .where(eq(competitionBrackets.tournamentId, competition.id))
      .orderBy(asc(competitionBrackets.sortOrder), asc(competitionBrackets.createdAt));
    res.json({ data: rows.map(bracketView), canManage });
  }),
);

// POST — create; appended at the end of the current order.
router.post(
  "/competitions/:id/brackets",
  requireAuth,
  bracketWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadCompetition(String(req.params.id));
    if (!competition) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, competition))) {
      return apiError(res, 403, "Only the competition operator can manage brackets.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }
    const parsed = BracketBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return apiError(res, 400, first?.message ?? "Invalid bracket.", {
        code: "VALIDATION_FAILED",
      });
    }
    const { label, gender, ageGroup } = parsed.data;
    const key = bracketLabelKey(label);
    const [{ max }] = await db
      .select({ max: sql<number>`COALESCE(MAX(${competitionBrackets.sortOrder}), -1)` })
      .from(competitionBrackets)
      .where(eq(competitionBrackets.tournamentId, competition.id));
    const [created] = await db
      .insert(competitionBrackets)
      .values({
        tournamentId: competition.id,
        label,
        labelKey: key,
        gender: gender ?? null,
        ageGroup: ageGroup || null,
        sortOrder: Number(max) + 1,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      return apiError(res, 409, "A bracket with that name already exists.", {
        code: "BRACKET_EXISTS",
      });
    }
    // Task #865 — a manually added bracket may match team slots that were
    // previously unmatched ("Other"); adopt them right away.
    await linkParticipantsToBrackets(competition.id);
    res.status(201).json(bracketView(created));
  }),
);

// PATCH — edit label/gender/age. Renaming onto an existing label 409s.
router.patch(
  "/competitions/:id/brackets/:bracketId",
  requireAuth,
  bracketWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadCompetition(String(req.params.id));
    if (!competition) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, competition))) {
      return apiError(res, 403, "Only the competition operator can manage brackets.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }
    const parsed = BracketBody.partial().safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return apiError(res, 400, first?.message ?? "Invalid bracket.", {
        code: "VALIDATION_FAILED",
      });
    }
    const body = parsed.data;
    const bracketId = String(req.params.bracketId);
    if (body.label !== undefined) {
      const key = bracketLabelKey(body.label);
      const [dupe] = await db
        .select({ id: competitionBrackets.id })
        .from(competitionBrackets)
        .where(
          and(
            eq(competitionBrackets.tournamentId, competition.id),
            eq(competitionBrackets.labelKey, key),
            ne(competitionBrackets.id, bracketId),
          ),
        )
        .limit(1);
      if (dupe) {
        return apiError(res, 409, "A bracket with that name already exists.", {
          code: "BRACKET_EXISTS",
        });
      }
    }
    const [updated] = await db
      .update(competitionBrackets)
      .set({
        ...(body.label !== undefined
          ? { label: body.label, labelKey: bracketLabelKey(body.label) }
          : {}),
        ...(body.gender !== undefined ? { gender: body.gender } : {}),
        ...(body.ageGroup !== undefined ? { ageGroup: body.ageGroup || null } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(competitionBrackets.id, bracketId),
          eq(competitionBrackets.tournamentId, competition.id),
        ),
      )
      .returning();
    if (!updated) return apiError(res, 404, "Bracket not found");
    res.json(bracketView(updated));
  }),
);

// DELETE — recaps pointing at the bracket survive (FK ON DELETE SET NULL).
router.delete(
  "/competitions/:id/brackets/:bracketId",
  requireAuth,
  bracketWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadCompetition(String(req.params.id));
    if (!competition) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, competition))) {
      return apiError(res, 403, "Only the competition operator can manage brackets.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }
    const deleted = await db
      .delete(competitionBrackets)
      .where(
        and(
          eq(competitionBrackets.id, String(req.params.bracketId)),
          eq(competitionBrackets.tournamentId, competition.id),
        ),
      )
      .returning({ id: competitionBrackets.id });
    if (deleted.length === 0) return apiError(res, 404, "Bracket not found");
    // A deliberate delete is bracket management — stamp it so the lazy
    // backfill never treats a later-emptied list as "never seeded" and
    // resurrects brackets from the schedule.
    await db
      .update(tournaments)
      .set({ bracketsSeededAt: new Date() })
      .where(and(eq(tournaments.id, competition.id), isNull(tournaments.bracketsSeededAt)));
    res.json({ ok: true, id: deleted[0].id });
  }),
);

const ReorderBody = z.object({
  // The FULL bracket id list in the desired order.
  ids: z.array(z.string().uuid()).min(1).max(500),
});

// POST reorder — persists a custom order in one call. Rejects unless the
// list covers exactly this competition's brackets (no missing/foreign ids)
// so a stale client can't silently scramble sort orders.
router.post(
  "/competitions/:id/brackets/reorder",
  requireAuth,
  bracketWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadCompetition(String(req.params.id));
    if (!competition) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, competition))) {
      return apiError(res, 403, "Only the competition operator can manage brackets.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }
    const parsed = ReorderBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "Invalid request.", { code: "VALIDATION_FAILED" });
    }
    const ids = parsed.data.ids;
    if (new Set(ids).size !== ids.length) {
      return apiError(res, 400, "Duplicate bracket ids in order list.");
    }
    const existing = await db
      .select({ id: competitionBrackets.id })
      .from(competitionBrackets)
      .where(eq(competitionBrackets.tournamentId, competition.id));
    const existingIds = new Set(existing.map((b) => b.id));
    if (
      ids.length !== existingIds.size ||
      ids.some((id) => !existingIds.has(id))
    ) {
      return apiError(
        res,
        409,
        "The bracket list changed — refresh and try reordering again.",
        { code: "BRACKETS_STALE" },
      );
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(competitionBrackets)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(
            and(
              eq(competitionBrackets.id, ids[i]),
              eq(competitionBrackets.tournamentId, competition.id),
            ),
          );
      }
    });
    res.json({ ok: true });
  }),
);

const SetRecapBracketBody = z.object({
  // null clears the bracket.
  bracketId: z.string().uuid().nullable(),
});

// POST — organizer sets/changes/clears the bracket on a recap at any time,
// including after publish. Never affects how the published post renders.
router.post(
  "/competitions/:id/recaps/:articleId/bracket",
  requireAuth,
  bracketWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadCompetition(String(req.params.id));
    if (!competition) return apiError(res, 404, "Competition not found");
    if (!(await canOperateCompetition(me, competition))) {
      return apiError(res, 403, "Only the competition operator can curate recaps.", {
        code: "COMPETITION_FORBIDDEN",
      });
    }
    const parsed = SetRecapBracketBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "Invalid request.", { code: "VALIDATION_FAILED" });
    }
    const { bracketId } = parsed.data;
    if (bracketId !== null) {
      const [bracket] = await db
        .select({ id: competitionBrackets.id })
        .from(competitionBrackets)
        .where(
          and(
            eq(competitionBrackets.id, bracketId),
            eq(competitionBrackets.tournamentId, competition.id),
          ),
        )
        .limit(1);
      if (!bracket) {
        return apiError(res, 404, "Bracket not found in this competition.");
      }
    }
    const updated = await db
      .update(articles)
      .set({ bracketId, updatedAt: new Date() })
      .where(
        and(
          eq(articles.id, String(req.params.articleId)),
          eq(articles.competitionId, competition.id),
        ),
      )
      .returning({ id: articles.id, bracketId: articles.bracketId });
    if (updated.length === 0) {
      return apiError(res, 404, "Game recap not found in this competition.");
    }
    res.json({ ok: true, id: updated[0].id, bracketId: updated[0].bracketId });
  }),
);

export default router;
