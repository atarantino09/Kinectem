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
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { apiError, notFound, paginate } from "../lib/spec-helpers";
import { canManageTeam, canViewTeamSchedule } from "../lib/permissions";
import { notifyTeamOfScheduleChange } from "../lib/schedule-notifications";
import { buildIcsCalendar, type IcsEvent } from "../lib/ics";
import { appBaseUrl } from "../lib/email";
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
    scoreTeam: e.scoreTeam,
    scoreOpponent: e.scoreOpponent,
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

    // Phase 2 — fire an immediate change notice to the team (COPPA-routed).
    // Fan-out is best-effort and must not fail the request or block the
    // response, so it runs detached with its own error logging.
    void notifyTeamOfScheduleChange({
      teamId: team.id,
      teamName: team.name,
      eventType: updated.eventType,
      opponent: updated.opponent,
      locationName: updated.locationName,
      startAt: new Date(updated.startAt),
      allDay: updated.allDay,
      status: parsed.data.status,
      reason: parsed.data.reason ?? null,
    }).catch((err) =>
      req.log.error({ err, eventId: updated.id }, "schedule change notice failed"),
    );

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

// ---------------------------------------------------------------------------
// PUT /teams/:teamId/schedule/:eventId/score — record (or clear) the final
// score on a game-type event. Recording a score on a past, non-canceled event
// also flips it to "completed" so it surfaces in Season Results. Coach/admin.
// ---------------------------------------------------------------------------
const scoreZ = z
  .object({
    scoreTeam: z.number().int().min(0).max(999).nullable(),
    scoreOpponent: z.number().int().min(0).max(999).nullable(),
  })
  .refine(
    (v) =>
      (v.scoreTeam === null) === (v.scoreOpponent === null),
    { message: "Provide both scores or clear both" },
  );

router.put(
  "/teams/:teamId/schedule/:eventId/score",
  scheduleWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canManageTeam(me.id, team))) {
      return apiError(res, 403, "Team coaches or org admins only");
    }
    const parsed = scoreZ.safeParse(req.body);
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
    if (
      event.eventType !== "game" &&
      event.eventType !== "scrimmage" &&
      event.eventType !== "tournament"
    ) {
      return apiError(res, 400, "Scores apply to games, scrimmages, and tournaments only");
    }

    // Final scores belong to games that have actually happened: already marked
    // completed, or still "scheduled" but past their start time. Future,
    // canceled, and postponed events are not scoreable.
    const eligible =
      event.status === "completed" ||
      (event.status === "scheduled" && new Date(event.startAt) < new Date());
    if (!eligible) {
      return apiError(
        res,
        400,
        "Scores can only be recorded once a game has started",
        { code: "EVENT_NOT_SCOREABLE" },
      );
    }

    const hasScore = parsed.data.scoreTeam !== null;
    const patch: Partial<typeof scheduleEvents.$inferInsert> = {
      scoreTeam: parsed.data.scoreTeam,
      scoreOpponent: parsed.data.scoreOpponent,
      updatedAt: new Date(),
    };
    // Recording a score on a finished, still-"scheduled" game marks it done so
    // it drops into Season Results; never override a canceled/postponed status.
    if (hasScore && event.status === "scheduled") {
      patch.status = "completed";
    }
    // Guard the write on the status we just read so a concurrent cancel/postpone
    // can't be clobbered (TOCTOU): if the status moved underneath us, 0 rows
    // update and we surface a conflict instead of overwriting.
    const [updated] = await db
      .update(scheduleEvents)
      .set(patch)
      .where(
        and(
          eq(scheduleEvents.id, event.id),
          eq(scheduleEvents.status, event.status),
        ),
      )
      .returning();
    if (!updated) {
      return apiError(res, 409, "Event was just changed; reload and try again", {
        code: "EVENT_CONFLICT",
      });
    }
    res.json(toScheduleEvent(updated, { canManage: true }));
  }),
);

// ---------------------------------------------------------------------------
// Bulk CSV season import (Phase 2). Coaches/admins paste a CSV; the server is
// the single source of truth for parsing + validation. `commit: false` returns
// a per-row preview (with errors) and writes nothing; `commit: true` creates
// every row only when ALL rows are valid (all-or-nothing). Same perms as a
// manual create.
//
// Columns (header required, order-independent):
//   event_type,date,start_time,end_time,opponent,home_away,
//   location_name,location_address,notes
// ---------------------------------------------------------------------------

// Minimal RFC4180-ish parser: handles quoted fields, escaped "" quotes, commas
// and newlines inside quotes, and CRLF. Returns rows of raw string cells.
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

const IMPORT_COLUMNS = [
  "event_type",
  "date",
  "start_time",
  "end_time",
  "opponent",
  "home_away",
  "location_name",
  "location_address",
  "notes",
] as const;

const MAX_IMPORT_ROWS = 200;

const importZ = z.object({
  csv: z.string().min(1).max(100_000),
  tzOffsetMinutes: z.number().int().min(-840).max(840),
  commit: z.boolean().optional(),
});

interface ParsedImportRow {
  line: number; // 1-based source line (data rows only)
  raw: Record<string, string>;
  error: string | null;
  startAt: Date | null;
  endAt: Date | null;
  values: typeof scheduleEvents.$inferInsert | null;
}

function validateImportRow(
  rec: Record<string, string>,
  line: number,
  team: { id: string; organizationId: string },
  createdById: string,
  offset: number,
): ParsedImportRow {
  const base: ParsedImportRow = {
    line,
    raw: rec,
    error: null,
    startAt: null,
    endAt: null,
    values: null,
  };
  const fail = (msg: string): ParsedImportRow => ({ ...base, error: msg });

  const eventType = (rec.event_type ?? "").trim().toLowerCase();
  if (!eventTypeZ.safeParse(eventType).success) {
    return fail(`Invalid event_type "${rec.event_type ?? ""}"`);
  }
  if (eventType === "other") {
    return fail('"other" events need a title — add them manually');
  }
  const date = (rec.date ?? "").trim();
  if (!dateZ.safeParse(date).success) {
    return fail(`Invalid date "${rec.date ?? ""}" (expected YYYY-MM-DD)`);
  }
  const startTime = (rec.start_time ?? "").trim();
  if (!timeZ.safeParse(startTime).success) {
    return fail(`Invalid start_time "${rec.start_time ?? ""}" (expected HH:MM)`);
  }
  const endTimeRaw = (rec.end_time ?? "").trim();
  let endAt: Date | null = null;
  const startAt = combineLocal(date, startTime, offset);
  if (endTimeRaw) {
    if (!timeZ.safeParse(endTimeRaw).success) {
      return fail(`Invalid end_time "${rec.end_time}" (expected HH:MM)`);
    }
    endAt = combineLocal(date, endTimeRaw, offset);
    if (endAt <= startAt) {
      return fail("end_time must be after start_time");
    }
  }
  const homeAwayRaw = (rec.home_away ?? "").trim().toLowerCase();
  let homeAway: "home" | "away" | "neutral" | null = null;
  if (homeAwayRaw) {
    if (!homeAwayZ.safeParse(homeAwayRaw).success) {
      return fail(`Invalid home_away "${rec.home_away}" (home/away/neutral)`);
    }
    homeAway = homeAwayRaw as "home" | "away" | "neutral";
  }
  const trimOrNull = (v: string | undefined, max: number) => {
    const t = (v ?? "").trim();
    return t ? t.slice(0, max) : null;
  };

  return {
    ...base,
    startAt,
    endAt,
    values: {
      teamId: team.id,
      organizationId: team.organizationId,
      eventType: eventType as "practice" | "game" | "scrimmage" | "tournament",
      title: null,
      opponent: trimOrNull(rec.opponent, 200),
      homeAway,
      locationName: trimOrNull(rec.location_name, 300),
      locationAddress: trimOrNull(rec.location_address, 500),
      locationField: null,
      startAt,
      endAt,
      allDay: false,
      notes: trimOrNull(rec.notes, 2000),
      createdById,
    },
  };
}

router.post(
  "/teams/:teamId/schedule/import",
  scheduleWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canManageTeam(me.id, team))) {
      return apiError(res, 403, "Team coaches or org admins only");
    }
    // Task #628 — schedule import is an org-team feature (schedule_events
    // requires a non-null organization_id); solo teams have no org.
    if (!team.organizationId) {
      return apiError(
        res,
        400,
        "Schedule import is not available for teams without an organization",
      );
    }
    const organizationId = team.organizationId;
    const parsed = importZ.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }
    const { csv, tzOffsetMinutes, commit } = parsed.data;

    const grid = parseCsv(csv).filter((r) => r.some((c) => c.trim() !== ""));
    if (grid.length === 0) {
      return apiError(res, 400, "CSV is empty");
    }
    const header = grid[0].map((h) => h.trim().toLowerCase());
    const missing = IMPORT_COLUMNS.filter((c) => !header.includes(c));
    if (missing.length > 0) {
      return apiError(res, 400, `CSV is missing columns: ${missing.join(", ")}`);
    }
    const dataRows = grid.slice(1);
    if (dataRows.length > MAX_IMPORT_ROWS) {
      return apiError(res, 400, `Too many rows (max ${MAX_IMPORT_ROWS})`);
    }

    const rows: ParsedImportRow[] = dataRows.map((cells, i) => {
      const rec: Record<string, string> = {};
      header.forEach((col, idx) => {
        rec[col] = cells[idx] ?? "";
      });
      return validateImportRow(rec, i + 2, { id: team.id, organizationId }, me.id, tzOffsetMinutes);
    });

    const errorCount = rows.filter((r) => r.error).length;
    const preview = rows.map((r) => ({
      line: r.line,
      eventType: r.raw.event_type ?? "",
      date: r.raw.date ?? "",
      startTime: r.raw.start_time ?? "",
      endTime: r.raw.end_time ?? "",
      opponent: r.raw.opponent ?? "",
      homeAway: r.raw.home_away ?? "",
      locationName: r.raw.location_name ?? "",
      startAt: r.startAt ? r.startAt.toISOString() : null,
      error: r.error,
    }));

    if (!commit) {
      return res.json({
        validCount: rows.length - errorCount,
        errorCount,
        rows: preview,
      });
    }
    if (errorCount > 0) {
      return apiError(res, 400, "Fix all row errors before importing", {
        code: "IMPORT_HAS_ERRORS",
        extras: { errorCount, rows: preview },
      });
    }

    const toInsert = rows
      .map((r) => r.values)
      .filter((v): v is typeof scheduleEvents.$inferInsert => v !== null);
    const created = await db
      .insert(scheduleEvents)
      .values(toInsert)
      .returning();
    res.status(201).json({
      createdCount: created.length,
      ...paginate(created.map((e) => toScheduleEvent(e, { canManage: true }))),
    });
  }),
);

// ---------------------------------------------------------------------------
// iCal (.ics) subscription feed (Phase 2).
//
// Calendar clients (Google/Apple) fetch the feed on a schedule with no cookies,
// so the per-team `schedule_feed_token` IS the capability: the token alone
// identifies the team and is only ever revealed to members through the
// authenticated info endpoint below. Rotating the token revokes every existing
// subscription. The feed lists non-canceled events with location NAME only.
// ---------------------------------------------------------------------------

function feedUrlFor(token: string): string {
  return `${appBaseUrl()}/api/v1/schedule/feed/${token}/calendar.ics`;
}

// Lazily mint a feed token the first time anyone needs it, race-safely.
async function ensureFeedToken(team: {
  id: string;
  scheduleFeedToken: string | null;
}): Promise<string> {
  if (team.scheduleFeedToken) return team.scheduleFeedToken;
  const token = randomBytes(24).toString("base64url");
  const [updated] = await db
    .update(teams)
    .set({ scheduleFeedToken: token })
    .where(and(eq(teams.id, team.id), isNull(teams.scheduleFeedToken)))
    .returning({ token: teams.scheduleFeedToken });
  if (updated?.token) return updated.token;
  const [fresh] = await db
    .select({ token: teams.scheduleFeedToken })
    .from(teams)
    .where(eq(teams.id, team.id))
    .limit(1);
  return fresh?.token ?? token;
}

const EVENT_TYPE_SUMMARY: Record<string, string> = {
  practice: "Practice",
  game: "Game",
  scrimmage: "Scrimmage",
  tournament: "Tournament",
  other: "Event",
};

function eventSummary(e: ScheduleEventRow): string {
  if (e.title?.trim()) return e.title.trim();
  const base = EVENT_TYPE_SUMMARY[e.eventType] ?? "Event";
  if (
    (e.eventType === "game" || e.eventType === "scrimmage") &&
    e.opponent?.trim()
  ) {
    return `${base} vs ${e.opponent.trim()}`;
  }
  return base;
}

function toIcsEvent(e: ScheduleEventRow): IcsEvent {
  return {
    uid: `${e.id}@kinectem`,
    start: new Date(e.startAt),
    end: e.endAt ? new Date(e.endAt) : null,
    allDay: e.allDay,
    summary: eventSummary(e),
    location: e.locationName,
    description: e.notes,
    stamp: new Date(e.updatedAt),
    canceled: e.status === "canceled",
  };
}

// GET /teams/:teamId/schedule/calendar/info — members get the subscribe URL.
// The token is minted on first access so families always get a working link.
router.get(
  "/teams/:teamId/schedule/calendar/info",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canViewTeamSchedule(me.id, team))) {
      return apiError(res, 403, "Team members only");
    }
    const token = await ensureFeedToken(team);
    const canManage = await canManageTeam(me.id, team);
    res.json({ feedUrl: feedUrlFor(token), canManage });
  }),
);

// POST /teams/:teamId/schedule/calendar/rotate — coach/admin rotates the token,
// revoking every existing calendar subscription.
router.post(
  "/teams/:teamId/schedule/calendar/rotate",
  scheduleWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canManageTeam(me.id, team))) {
      return apiError(res, 403, "Team coaches or org admins only");
    }
    const token = randomBytes(24).toString("base64url");
    await db
      .update(teams)
      .set({ scheduleFeedToken: token })
      .where(eq(teams.id, team.id));
    res.json({ feedUrl: feedUrlFor(token), canManage: true });
  }),
);

// GET /schedule/feed/:token/calendar.ics — PUBLIC, token-authenticated feed.
// No session: calendar clients can't send cookies, so the unguessable token is
// the capability. Returns the team's non-canceled events as text/calendar.
router.get(
  "/schedule/feed/:token/calendar.ics",
  asyncHandler(async (req, res) => {
    const token = req.params.token;
    if (!token) return notFound(res);
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.scheduleFeedToken, token))
      .limit(1);
    if (!team) return notFound(res);
    const rows = await db
      .select()
      .from(scheduleEvents)
      .where(
        and(
          eq(scheduleEvents.teamId, team.id),
          sql`${scheduleEvents.status} <> 'canceled'`,
        ),
      )
      .orderBy(asc(scheduleEvents.startAt));
    const ics = buildIcsCalendar(rows.map(toIcsEvent), {
      calendarName: `${team.name} Schedule`,
    });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'inline; filename="team-schedule.ics"',
    );
    res.send(ics);
  }),
);

export default router;
