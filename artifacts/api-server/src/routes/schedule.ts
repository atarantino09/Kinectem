import { Router, type IRouter } from "express";
import {
  db,
  teams,
  users,
  articles,
  rosterEntries,
  scheduleEvents,
  scheduleRecurrences,
  scheduleEventRsvps,
} from "@workspace/db";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { apiError, notFound, paginate } from "../lib/spec-helpers";
import { canManageTeam, canViewTeamSchedule } from "../lib/permissions";
import { rateLimit, ipKey } from "../middlewares/rate-limit";

const router: IRouter = Router();

// Writes (create/edit/delete/cancel/link-recap) are coach/admin-only and
// already DB-gated; the limiter is a per-user abuse backstop. A whole
// recurring season is a single create request, so the cap is generous.
const scheduleWriteLimiter = rateLimit({
  name: "schedule_write",
  windowMs: 15 * 60 * 1000,
  max: 80,
  keys: (req) => [ipKey(req), req.sessionUser?.id],
});

// Hard cap on rows a single recurrence may expand into, so a bad date range
// can't generate an unbounded number of events.
const MAX_RECURRENCE_EVENTS = 366;

type ScheduleEventRow = typeof scheduleEvents.$inferSelect;

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toScheduleEvent(
  e: ScheduleEventRow,
  opts: { canManage: boolean },
): Record<string, unknown> {
  return {
    id: e.id,
    teamId: e.teamId,
    organizationId: e.organizationId,
    eventType: e.eventType,
    title: e.title,
    opponent: e.opponent,
    homeAway: e.homeAway,
    locationName: e.locationName,
    locationAddress: e.locationAddress,
    locationField: e.locationField,
    startAt: iso(e.startAt),
    endAt: iso(e.endAt),
    allDay: e.allDay,
    notes: e.notes,
    status: e.status,
    statusReason: e.statusReason,
    recurrenceId: e.recurrenceId,
    gameRecapId: e.gameRecapId,
    createdById: e.createdById,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
    canManage: opts.canManage,
  };
}

// Combine a local wall-clock date ("YYYY-MM-DD") + time ("HH:MM") into the
// exact UTC instant, given the client's `getTimezoneOffset()` in minutes
// (UTC = local + offset). Used only for recurrence expansion; single events
// arrive as fully-resolved ISO instants from the browser.
function combineLocal(
  dateStr: string,
  timeStr: string,
  offsetMinutes: number,
): Date {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const [hh, mm] = timeStr.split(":").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d, hh, mm) + offsetMinutes * 60_000);
}

const eventTypeZ = z.enum([
  "practice",
  "game",
  "scrimmage",
  "tournament",
  "other",
]);
const homeAwayZ = z.enum(["home", "away", "neutral"]);
const timeZ = z.string().regex(/^\d{2}:\d{2}$/, "expected HH:MM");
const dateZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const recurrenceZ = z.object({
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: timeZ,
  endTime: timeZ.nullish(),
  seriesStartDate: dateZ,
  seriesEndDate: dateZ,
});

const createZ = z.object({
  eventType: eventTypeZ,
  title: z.string().trim().max(200).nullish(),
  opponent: z.string().trim().max(200).nullish(),
  homeAway: homeAwayZ.nullish(),
  locationName: z.string().trim().max(300).nullish(),
  locationAddress: z.string().trim().max(500).nullish(),
  locationField: z.string().trim().max(100).nullish(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).nullish(),
  allDay: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullish(),
  recurrence: recurrenceZ.optional(),
  tzOffsetMinutes: z.number().int().min(-840).max(840).optional(),
});

const updateZ = z.object({
  scope: z.enum(["single", "series"]).optional(),
  title: z.string().trim().max(200).nullish(),
  opponent: z.string().trim().max(200).nullish(),
  homeAway: homeAwayZ.nullish(),
  locationName: z.string().trim().max(300).nullish(),
  locationAddress: z.string().trim().max(500).nullish(),
  locationField: z.string().trim().max(100).nullish(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).nullish(),
  allDay: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullish(),
  // Series-only: new wall-clock times re-applied to every future occurrence,
  // preserving each row's own date. Needs tzOffsetMinutes to resolve.
  startTime: timeZ.optional(),
  endTime: timeZ.nullish(),
  tzOffsetMinutes: z.number().int().min(-840).max(840).optional(),
});

const cancelZ = z.object({
  status: z.enum(["canceled", "postponed"]),
  reason: z.string().trim().max(300).nullish(),
});

const linkRecapZ = z.object({
  recapId: z.string().uuid(),
});

async function loadTeam(teamId: string) {
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return team ?? null;
}

// ---------------------------------------------------------------------------
// GET /teams/:teamId/schedule — list events (members-only).
// `?upcoming=N` returns the next N non-canceled/non-completed events from now
// (for the "Up Next" card); otherwise returns the full schedule ascending.
// ---------------------------------------------------------------------------
router.get(
  "/teams/:teamId/schedule",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canViewTeamSchedule(me.id, team))) {
      return apiError(res, 403, "Team members only");
    }
    const canManage = await canManageTeam(me.id, team);

    const upcomingRaw = req.query.upcoming;
    if (upcomingRaw != null) {
      const n = Math.min(
        Math.max(parseInt(String(upcomingRaw), 10) || 0, 1),
        10,
      );
      const rows = await db
        .select()
        .from(scheduleEvents)
        .where(
          and(
            eq(scheduleEvents.teamId, team.id),
            gte(scheduleEvents.startAt, new Date()),
            sql`${scheduleEvents.status} in ('scheduled','postponed')`,
          ),
        )
        .orderBy(asc(scheduleEvents.startAt))
        .limit(n);
      return res.json(paginate(rows.map((e) => toScheduleEvent(e, { canManage }))));
    }

    const rows = await db
      .select()
      .from(scheduleEvents)
      .where(eq(scheduleEvents.teamId, team.id))
      .orderBy(asc(scheduleEvents.startAt));
    res.json(paginate(rows.map((e) => toScheduleEvent(e, { canManage }))));
  }),
);

// ---------------------------------------------------------------------------
// GET /teams/:teamId/schedule/:eventId — single event detail (members-only).
// ---------------------------------------------------------------------------
router.get(
  "/teams/:teamId/schedule/:eventId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canViewTeamSchedule(me.id, team))) {
      return apiError(res, 403, "Team members only");
    }
    const [event] = await db
      .select()
      .from(scheduleEvents)
      .where(
        and(
          eq(scheduleEvents.id, req.params.eventId),
          eq(scheduleEvents.teamId, team.id),
        ),
      )
      .limit(1);
    if (!event) return notFound(res);
    const canManage = await canManageTeam(me.id, team);
    res.json(toScheduleEvent(event, { canManage }));
  }),
);

// ---------------------------------------------------------------------------
// POST /teams/:teamId/schedule — create a single event OR a recurring weekly
// practice (expanded into concrete rows sharing one recurrence_id).
// ---------------------------------------------------------------------------
router.post(
  "/teams/:teamId/schedule",
  scheduleWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canManageTeam(me.id, team))) {
      return apiError(res, 403, "Team coaches or org admins only");
    }
    const parsed = createZ.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }
    const body = parsed.data;

    if (body.eventType === "other" && !body.title) {
      return apiError(res, 400, 'title is required for "other" events');
    }

    const common = {
      teamId: team.id,
      organizationId: team.organizationId,
      eventType: body.eventType,
      title: body.title ?? null,
      opponent: body.opponent ?? null,
      homeAway: body.homeAway ?? null,
      locationName: body.locationName ?? null,
      locationAddress: body.locationAddress ?? null,
      locationField: body.locationField ?? null,
      allDay: body.allDay ?? false,
      notes: body.notes ?? null,
      createdById: me.id,
    };

    // --- Recurring weekly practice -----------------------------------------
    if (body.recurrence) {
      if (body.eventType !== "practice") {
        return apiError(res, 400, "Recurring events must be practices");
      }
      if (body.tzOffsetMinutes == null) {
        return apiError(res, 400, "tzOffsetMinutes is required for recurring events");
      }
      const rec = body.recurrence;
      const offset = body.tzOffsetMinutes;
      const seriesStart = new Date(`${rec.seriesStartDate}T00:00:00Z`);
      const seriesEnd = new Date(`${rec.seriesEndDate}T00:00:00Z`);
      if (seriesEnd < seriesStart) {
        return apiError(res, 400, "seriesEndDate must be on or after seriesStartDate");
      }
      const days = new Set(rec.daysOfWeek);

      // Walk the date range day-by-day in UTC (dates are calendar-only here).
      const occurrences: Array<{ startAt: Date; endAt: Date | null }> = [];
      for (
        let cursor = new Date(seriesStart);
        cursor <= seriesEnd && occurrences.length <= MAX_RECURRENCE_EVENTS;
        cursor.setUTCDate(cursor.getUTCDate() + 1)
      ) {
        if (!days.has(cursor.getUTCDay())) continue;
        const dateStr = cursor.toISOString().slice(0, 10);
        const startAt = combineLocal(dateStr, rec.startTime, offset);
        const endAt = rec.endTime
          ? combineLocal(dateStr, rec.endTime, offset)
          : null;
        if (endAt && endAt <= startAt) {
          return apiError(res, 400, "endTime must be after startTime");
        }
        occurrences.push({ startAt, endAt });
      }
      if (occurrences.length === 0) {
        return apiError(res, 400, "Recurrence produced no events in the given range");
      }
      if (occurrences.length > MAX_RECURRENCE_EVENTS) {
        return apiError(res, 400, "Recurrence range is too large");
      }

      const created = await db.transaction(async (tx) => {
        const [recurrence] = await tx
          .insert(scheduleRecurrences)
          .values({
            teamId: team.id,
            frequency: "weekly",
            daysOfWeek: rec.daysOfWeek,
            startTime: rec.startTime,
            endTime: rec.endTime ?? null,
            seriesStartDate: rec.seriesStartDate,
            seriesEndDate: rec.seriesEndDate,
            createdById: me.id,
          })
          .returning();
        const rows = await tx
          .insert(scheduleEvents)
          .values(
            occurrences.map((o) => ({
              ...common,
              startAt: o.startAt,
              endAt: o.endAt,
              recurrenceId: recurrence.id,
            })),
          )
          .returning();
        return rows;
      });

      return res
        .status(201)
        .json(paginate(created.map((e) => toScheduleEvent(e, { canManage: true }))));
    }

    // --- Single event ------------------------------------------------------
    if (!body.startAt) {
      return apiError(res, 400, "startAt is required");
    }
    const startAt = new Date(body.startAt);
    const endAt = body.endAt ? new Date(body.endAt) : null;
    if (endAt && endAt <= startAt) {
      return apiError(res, 400, "endAt must be after startAt");
    }
    const [event] = await db
      .insert(scheduleEvents)
      .values({ ...common, startAt, endAt })
      .returning();
    res.status(201).json(toScheduleEvent(event, { canManage: true }));
  }),
);

// ---------------------------------------------------------------------------
// PATCH /teams/:teamId/schedule/:eventId — edit one occurrence, or
// `scope: "series"` to update every future occurrence in the same series.
// ---------------------------------------------------------------------------
router.patch(
  "/teams/:teamId/schedule/:eventId",
  scheduleWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canManageTeam(me.id, team))) {
      return apiError(res, 403, "Team coaches or org admins only");
    }
    const [event] = await db
      .select()
      .from(scheduleEvents)
      .where(
        and(
          eq(scheduleEvents.id, req.params.eventId),
          eq(scheduleEvents.teamId, team.id),
        ),
      )
      .limit(1);
    if (!event) return notFound(res);

    const parsed = updateZ.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }
    const body = parsed.data;

    // Shared fields that apply to either scope.
    const shared: Partial<typeof scheduleEvents.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.title !== undefined) shared.title = body.title ?? null;
    if (body.opponent !== undefined) shared.opponent = body.opponent ?? null;
    if (body.homeAway !== undefined) shared.homeAway = body.homeAway ?? null;
    if (body.locationName !== undefined) shared.locationName = body.locationName ?? null;
    if (body.locationAddress !== undefined)
      shared.locationAddress = body.locationAddress ?? null;
    if (body.locationField !== undefined)
      shared.locationField = body.locationField ?? null;
    if (body.allDay !== undefined) shared.allDay = body.allDay;
    if (body.notes !== undefined) shared.notes = body.notes ?? null;

    if (body.scope === "series" && event.recurrenceId) {
      // Re-applying wall-clock times across the series needs a timezone to
      // resolve each row's date, and the new window must still be valid.
      // Mirror the single-occurrence guard so off-spec clients can't write
      // an inverted (endTime <= startTime) or timezone-ambiguous window.
      if (body.startTime && body.tzOffsetMinutes === undefined) {
        return apiError(res, 400, "tzOffsetMinutes is required when changing series times");
      }
      if (body.startTime && body.endTime && body.endTime <= body.startTime) {
        return apiError(res, 400, "endTime must be after startTime");
      }
      // Update this and every later occurrence in the series. New wall-clock
      // times (if supplied) are re-resolved per row, preserving each date.
      const futureRows = await db
        .select()
        .from(scheduleEvents)
        .where(
          and(
            eq(scheduleEvents.recurrenceId, event.recurrenceId),
            gte(scheduleEvents.startAt, event.startAt),
          ),
        );
      const offset = body.tzOffsetMinutes ?? 0;
      await db.transaction(async (tx) => {
        for (const row of futureRows) {
          const patch: Partial<typeof scheduleEvents.$inferInsert> = { ...shared };
          if (body.startTime) {
            const dateStr = new Date(row.startAt).toISOString().slice(0, 10);
            patch.startAt = combineLocal(dateStr, body.startTime, offset);
            patch.endAt = body.endTime
              ? combineLocal(dateStr, body.endTime, offset)
              : body.endTime === null
                ? null
                : row.endAt;
          }
          await tx
            .update(scheduleEvents)
            .set(patch)
            .where(eq(scheduleEvents.id, row.id));
        }
        // Keep the recurrence rule row in sync for future "edit series".
        if (body.startTime || body.endTime !== undefined) {
          await tx
            .update(scheduleRecurrences)
            .set({
              ...(body.startTime ? { startTime: body.startTime } : {}),
              ...(body.endTime !== undefined ? { endTime: body.endTime ?? null } : {}),
            })
            .where(eq(scheduleRecurrences.id, event.recurrenceId!));
        }
      });
      const updated = await db
        .select()
        .from(scheduleEvents)
        .where(eq(scheduleEvents.id, event.id))
        .limit(1);
      return res.json(toScheduleEvent(updated[0]!, { canManage: true }));
    }

    // Single-occurrence edit.
    const patch = { ...shared };
    if (body.startAt !== undefined) patch.startAt = new Date(body.startAt);
    if (body.endAt !== undefined) patch.endAt = body.endAt ? new Date(body.endAt) : null;
    const nextStart = patch.startAt ?? event.startAt;
    const nextEnd = patch.endAt !== undefined ? patch.endAt : event.endAt;
    if (nextEnd && nextEnd <= nextStart) {
      return apiError(res, 400, "endAt must be after startAt");
    }
    const [updated] = await db
      .update(scheduleEvents)
      .set(patch)
      .where(eq(scheduleEvents.id, event.id))
      .returning();
    res.json(toScheduleEvent(updated, { canManage: true }));
  }),
);

// ---------------------------------------------------------------------------
// POST /teams/:teamId/schedule/:eventId/cancel — cancel or postpone (kept
// visible to families with a short reason).
// ---------------------------------------------------------------------------
router.post(
  "/teams/:teamId/schedule/:eventId/cancel",
  scheduleWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canManageTeam(me.id, team))) {
      return apiError(res, 403, "Team coaches or org admins only");
    }
    const parsed = cancelZ.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }
    const [updated] = await db
      .update(scheduleEvents)
      .set({
        status: parsed.data.status,
        statusReason: parsed.data.reason ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduleEvents.id, req.params.eventId),
          eq(scheduleEvents.teamId, team.id),
        ),
      )
      .returning();
    if (!updated) return notFound(res);
    res.json(toScheduleEvent(updated, { canManage: true }));
  }),
);

// ---------------------------------------------------------------------------
// DELETE /teams/:teamId/schedule/:eventId — delete one occurrence, or
// `?scope=series` to delete this + every future occurrence in the series.
// ---------------------------------------------------------------------------
router.delete(
  "/teams/:teamId/schedule/:eventId",
  scheduleWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canManageTeam(me.id, team))) {
      return apiError(res, 403, "Team coaches or org admins only");
    }
    const [event] = await db
      .select()
      .from(scheduleEvents)
      .where(
        and(
          eq(scheduleEvents.id, req.params.eventId),
          eq(scheduleEvents.teamId, team.id),
        ),
      )
      .limit(1);
    if (!event) return notFound(res);

    if (req.query.scope === "series" && event.recurrenceId) {
      await db
        .delete(scheduleEvents)
        .where(
          and(
            eq(scheduleEvents.recurrenceId, event.recurrenceId),
            gte(scheduleEvents.startAt, event.startAt),
          ),
        );
    } else {
      await db.delete(scheduleEvents).where(eq(scheduleEvents.id, event.id));
    }
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// POST /teams/:teamId/schedule/:eventId/link-recap — attach a published game
// recap to a game event, flipping it to "completed". Called after the coach
// publishes the recap from the prefilled editor.
// ---------------------------------------------------------------------------
router.post(
  "/teams/:teamId/schedule/:eventId/link-recap",
  scheduleWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canManageTeam(me.id, team))) {
      return apiError(res, 403, "Team coaches or org admins only");
    }
    const parsed = linkRecapZ.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }
    const [event] = await db
      .select()
      .from(scheduleEvents)
      .where(
        and(
          eq(scheduleEvents.id, req.params.eventId),
          eq(scheduleEvents.teamId, team.id),
        ),
      )
      .limit(1);
    if (!event) return notFound(res);

    // The recap must be a published article on the SAME team.
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, parsed.data.recapId))
      .limit(1);
    if (!article || article.teamId !== team.id) {
      return apiError(res, 404, "Recap not found for this team", {
        code: "RECAP_NOT_FOUND",
      });
    }
    const [updated] = await db
      .update(scheduleEvents)
      .set({
        gameRecapId: article.id,
        status: "completed",
        updatedAt: new Date(),
      })
      .where(eq(scheduleEvents.id, event.id))
      .returning();
    res.json(toScheduleEvent(updated, { canManage: true }));
  }),
);

// ---------------------------------------------------------------------------
// RSVP / Availability (Phase 2). Athletes — and parents on behalf of a linked
// child — mark Going/Maybe/Out per event. Coaches and org admins may VIEW the
// whole roster's responses but the answer belongs to the athlete/parent.
// ---------------------------------------------------------------------------

type RsvpStatus = "going" | "maybe" | "out";

const setRsvpZ = z.object({
  athleteId: z.string().uuid(),
  status: z.enum(["going", "maybe", "out"]),
  note: z.string().trim().max(300).nullish(),
});

// Athletes the caller may answer for on this team: themselves if they are an
// accepted rostered player, plus any accepted-player child linked via
// `users.parentId`. The server computes this so the client needs no roster
// knowledge to render the right controls.
async function myAthletesOnTeam(
  userId: string,
  teamId: string,
): Promise<Array<{ athleteId: string; athleteName: string }>> {
  const self = await db
    .select({ athleteId: users.id, athleteName: users.name })
    .from(rosterEntries)
    .innerJoin(users, eq(users.id, rosterEntries.userId))
    .where(
      and(
        eq(rosterEntries.teamId, teamId),
        eq(rosterEntries.userId, userId),
        eq(rosterEntries.role, "player"),
        eq(rosterEntries.status, "accepted"),
      ),
    );
  const children = await db
    .select({ athleteId: users.id, athleteName: users.name })
    .from(rosterEntries)
    .innerJoin(users, eq(users.id, rosterEntries.userId))
    .where(
      and(
        eq(rosterEntries.teamId, teamId),
        eq(rosterEntries.role, "player"),
        eq(rosterEntries.status, "accepted"),
        eq(users.parentId, userId),
      ),
    );
  const byId = new Map<string, { athleteId: string; athleteName: string }>();
  for (const a of [...self, ...children]) byId.set(a.athleteId, a);
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// GET /teams/:teamId/schedule/:eventId/rsvps — the caller's own athlete(s) +
// their current response, plus (managers only) the full roster tally + list.
// ---------------------------------------------------------------------------
router.get(
  "/teams/:teamId/schedule/:eventId/rsvps",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canViewTeamSchedule(me.id, team))) {
      return apiError(res, 403, "Team members only");
    }
    const [event] = await db
      .select({ id: scheduleEvents.id })
      .from(scheduleEvents)
      .where(
        and(
          eq(scheduleEvents.id, req.params.eventId),
          eq(scheduleEvents.teamId, team.id),
        ),
      )
      .limit(1);
    if (!event) return notFound(res);

    const canManage = await canManageTeam(me.id, team);

    // The caller's own athletes + whatever they've already answered.
    const mine = await myAthletesOnTeam(me.id, team.id);
    let myAthletes: Array<{
      athleteId: string;
      athleteName: string;
      status: RsvpStatus | null;
      note: string | null;
    }> = [];
    if (mine.length) {
      const ids = mine.map((a) => a.athleteId);
      const existing = await db
        .select({
          athleteId: scheduleEventRsvps.athleteId,
          status: scheduleEventRsvps.status,
          note: scheduleEventRsvps.note,
        })
        .from(scheduleEventRsvps)
        .where(
          and(
            eq(scheduleEventRsvps.eventId, event.id),
            inArray(scheduleEventRsvps.athleteId, ids),
          ),
        );
      const byId = new Map(existing.map((e) => [e.athleteId, e]));
      myAthletes = mine.map((a) => ({
        athleteId: a.athleteId,
        athleteName: a.athleteName,
        status: byId.get(a.athleteId)?.status ?? null,
        note: byId.get(a.athleteId)?.note ?? null,
      }));
    }

    // Managers additionally see every accepted player's response (with the
    // parent's name when a parent answered) and a tally.
    let summary:
      | { going: number; maybe: number; out: number; noResponse: number }
      | null = null;
    let responses:
      | Array<{
          athleteId: string;
          athleteName: string;
          status: RsvpStatus | "no_response";
          note: string | null;
          respondedByName: string | null;
          respondedAt: string | null;
        }>
      | null = null;
    if (canManage) {
      const responder = alias(users, "rsvp_responder");
      const rows = await db
        .select({
          athleteId: users.id,
          athleteName: users.name,
          status: scheduleEventRsvps.status,
          note: scheduleEventRsvps.note,
          respondedAt: scheduleEventRsvps.respondedAt,
          respondedById: scheduleEventRsvps.respondedById,
          respondedByName: responder.name,
        })
        .from(rosterEntries)
        .innerJoin(users, eq(users.id, rosterEntries.userId))
        .leftJoin(
          scheduleEventRsvps,
          and(
            eq(scheduleEventRsvps.eventId, event.id),
            eq(scheduleEventRsvps.athleteId, users.id),
          ),
        )
        .leftJoin(responder, eq(responder.id, scheduleEventRsvps.respondedById))
        .where(
          and(
            eq(rosterEntries.teamId, team.id),
            eq(rosterEntries.role, "player"),
            eq(rosterEntries.status, "accepted"),
          ),
        )
        .orderBy(asc(users.name));
      responses = rows.map((r) => ({
        athleteId: r.athleteId,
        athleteName: r.athleteName,
        status: r.status ?? "no_response",
        note: r.note ?? null,
        respondedByName:
          r.respondedById && r.respondedById !== r.athleteId
            ? r.respondedByName ?? null
            : null,
        respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
      }));
      summary = {
        going: responses.filter((x) => x.status === "going").length,
        maybe: responses.filter((x) => x.status === "maybe").length,
        out: responses.filter((x) => x.status === "out").length,
        noResponse: responses.filter((x) => x.status === "no_response").length,
      };
    }

    res.json({ canViewAll: canManage, myAthletes, summary, responses });
  }),
);

// ---------------------------------------------------------------------------
// PUT /teams/:teamId/schedule/:eventId/rsvp — upsert one athlete's response.
// Last write wins via the (event_id, athlete_id) unique index.
// ---------------------------------------------------------------------------
router.put(
  "/teams/:teamId/schedule/:eventId/rsvp",
  scheduleWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canViewTeamSchedule(me.id, team))) {
      return apiError(res, 403, "Team members only");
    }
    const parsed = setRsvpZ.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }
    const { athleteId, status, note } = parsed.data;

    const [event] = await db
      .select({ id: scheduleEvents.id })
      .from(scheduleEvents)
      .where(
        and(
          eq(scheduleEvents.id, req.params.eventId),
          eq(scheduleEvents.teamId, team.id),
        ),
      )
      .limit(1);
    if (!event) return notFound(res);

    // The athlete must be an accepted rostered player on this team, and the
    // caller must be that athlete OR their linked parent.
    const [athlete] = await db
      .select({ id: users.id, parentId: users.parentId })
      .from(rosterEntries)
      .innerJoin(users, eq(users.id, rosterEntries.userId))
      .where(
        and(
          eq(rosterEntries.teamId, team.id),
          eq(rosterEntries.userId, athleteId),
          eq(rosterEntries.role, "player"),
          eq(rosterEntries.status, "accepted"),
        ),
      )
      .limit(1);
    if (!athlete) {
      return apiError(res, 404, "Not a rostered athlete on this team", {
        code: "ATHLETE_NOT_FOUND",
      });
    }
    if (athlete.id !== me.id && athlete.parentId !== me.id) {
      return apiError(res, 403, "You can only respond for yourself or your child", {
        code: "RSVP_FORBIDDEN",
      });
    }

    const now = new Date();
    const [row] = await db
      .insert(scheduleEventRsvps)
      .values({
        eventId: event.id,
        athleteId,
        respondedById: me.id,
        status,
        note: note ?? null,
        respondedAt: now,
      })
      .onConflictDoUpdate({
        target: [scheduleEventRsvps.eventId, scheduleEventRsvps.athleteId],
        set: { respondedById: me.id, status, note: note ?? null, respondedAt: now },
      })
      .returning();
    res.json({
      athleteId: row.athleteId,
      status: row.status,
      note: row.note,
      respondedAt: row.respondedAt.toISOString(),
    });
  }),
);

export default router;
