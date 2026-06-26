import { customFetch } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Team Schedule — client types + fetch helpers.
//
// The schedule endpoints are intentionally NOT in the locked `openapi.yaml`,
// so there are no generated hooks/Zod schemas for them. We mirror the
// server's `toScheduleEvent` shape here and talk to the API through the same
// `customFetch` + narrow-cast pattern the Newsletter / AI-Assist features use.
// ---------------------------------------------------------------------------

export type EventType =
  | "practice"
  | "game"
  | "scrimmage"
  | "tournament"
  | "other";

export type HomeAway = "home" | "away" | "neutral";

export type EventStatus = "scheduled" | "canceled" | "postponed" | "completed";

export interface ScheduleEvent {
  id: string;
  teamId: string;
  organizationId: string;
  eventType: EventType;
  title: string | null;
  opponent: string | null;
  homeAway: HomeAway | null;
  locationName: string | null;
  locationAddress: string | null;
  locationField: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  notes: string | null;
  status: EventStatus;
  statusReason: string | null;
  recurrenceId: string | null;
  gameRecapId: string | null;
  scoreTeam: number | null;
  scoreOpponent: number | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
}

export interface RecurrenceInput {
  daysOfWeek: number[];
  startTime: string;
  endTime?: string | null;
  seriesStartDate: string;
  seriesEndDate: string;
}

export interface CreateEventInput {
  eventType: EventType;
  title?: string | null;
  opponent?: string | null;
  homeAway?: HomeAway | null;
  locationName?: string | null;
  locationAddress?: string | null;
  locationField?: string | null;
  startAt?: string;
  endAt?: string | null;
  allDay?: boolean;
  notes?: string | null;
  recurrence?: RecurrenceInput;
  tzOffsetMinutes?: number;
}

export interface UpdateEventInput {
  scope?: "single" | "series";
  title?: string | null;
  opponent?: string | null;
  homeAway?: HomeAway | null;
  locationName?: string | null;
  locationAddress?: string | null;
  locationField?: string | null;
  startAt?: string;
  endAt?: string | null;
  allDay?: boolean;
  notes?: string | null;
  startTime?: string;
  endTime?: string | null;
  tzOffsetMinutes?: number;
}

// Query keys (kept local — these aren't generated).
export const scheduleQueryKey = (teamId: string) =>
  ["team-schedule", teamId] as const;
export const scheduleUpcomingQueryKey = (teamId: string, n: number) =>
  ["team-schedule", teamId, "upcoming", n] as const;

export async function fetchSchedule(teamId: string): Promise<ScheduleEvent[]> {
  const res = await customFetch<{ data: ScheduleEvent[] }>(
    `/api/v1/teams/${teamId}/schedule`,
  );
  return res.data;
}

export async function fetchUpcoming(
  teamId: string,
  n: number,
): Promise<ScheduleEvent[]> {
  const res = await customFetch<{ data: ScheduleEvent[] }>(
    `/api/v1/teams/${teamId}/schedule?upcoming=${n}`,
  );
  return res.data;
}

export async function createEvent(
  teamId: string,
  input: CreateEventInput,
): Promise<unknown> {
  return customFetch(`/api/v1/teams/${teamId}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateEvent(
  teamId: string,
  eventId: string,
  input: UpdateEventInput,
): Promise<ScheduleEvent> {
  return customFetch<ScheduleEvent>(
    `/api/v1/teams/${teamId}/schedule/${eventId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export async function deleteEvent(
  teamId: string,
  eventId: string,
  scope?: "series",
): Promise<void> {
  const qs = scope === "series" ? "?scope=series" : "";
  await customFetch(`/api/v1/teams/${teamId}/schedule/${eventId}${qs}`, {
    method: "DELETE",
  });
}

export async function cancelEvent(
  teamId: string,
  eventId: string,
  input: { status: "canceled" | "postponed"; reason?: string | null },
): Promise<ScheduleEvent> {
  return customFetch<ScheduleEvent>(
    `/api/v1/teams/${teamId}/schedule/${eventId}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

// ---------------------------------------------------------------------------
// RSVP / Availability (Phase 2)
// ---------------------------------------------------------------------------

export type RsvpStatus = "going" | "maybe" | "out";

// One athlete the current viewer can answer for (self, or a linked child).
export interface MyAthleteRsvp {
  athleteId: string;
  athleteName: string;
  status: RsvpStatus | null;
  note: string | null;
}

// A row in the manager-only roster response list. `status` is "no_response"
// for athletes who haven't answered yet.
export interface RsvpResponseRow {
  athleteId: string;
  athleteName: string;
  status: RsvpStatus | "no_response";
  note: string | null;
  respondedByName: string | null;
  respondedAt: string | null;
}

export interface RsvpSummary {
  going: number;
  maybe: number;
  out: number;
  noResponse: number;
}

export interface EventRsvps {
  canViewAll: boolean;
  myAthletes: MyAthleteRsvp[];
  summary: RsvpSummary | null;
  responses: RsvpResponseRow[] | null;
}

export const rsvpQueryKey = (teamId: string, eventId: string) =>
  ["team-schedule", teamId, "rsvps", eventId] as const;

export async function fetchEventRsvps(
  teamId: string,
  eventId: string,
): Promise<EventRsvps> {
  return customFetch<EventRsvps>(
    `/api/v1/teams/${teamId}/schedule/${eventId}/rsvps`,
  );
}

export async function setRsvp(
  teamId: string,
  eventId: string,
  input: { athleteId: string; status: RsvpStatus; note?: string | null },
): Promise<unknown> {
  return customFetch(`/api/v1/teams/${teamId}/schedule/${eventId}/rsvp`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export const RSVP_STATUS_LABEL: Record<RsvpStatus, string> = {
  going: "Going",
  maybe: "Maybe",
  out: "Out",
};

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  practice: "Practice",
  game: "Game",
  scrimmage: "Scrimmage",
  tournament: "Tournament",
  other: "Event",
};

// Chip classes per event type. Games lead with the in-app blue; the others
// use distinct, muted tints so a packed agenda/calendar stays scannable.
export const EVENT_TYPE_CHIP: Record<EventType, string> = {
  game: "bg-blue-100 text-blue-800 border-blue-200",
  practice: "bg-emerald-100 text-emerald-800 border-emerald-200",
  scrimmage: "bg-amber-100 text-amber-900 border-amber-200",
  tournament: "bg-indigo-100 text-indigo-800 border-indigo-200",
  other: "bg-slate-100 text-slate-700 border-slate-200",
};

// A short, human title for an event when the coach didn't set one.
export function eventTitle(e: ScheduleEvent): string {
  const custom = e.title?.trim();
  const isGameGroup =
    e.eventType === "game" ||
    e.eventType === "scrimmage" ||
    e.eventType === "tournament";
  const base = custom || EVENT_TYPE_LABEL[e.eventType];
  // Surface the opponent on the card for any game-type event — including
  // tournaments and games that already have a custom title.
  if (isGameGroup && e.opponent) {
    const vs = e.homeAway === "away" ? "at" : "vs";
    return `${base} ${vs} ${e.opponent}`;
  }
  return base;
}

export function isPast(e: ScheduleEvent): boolean {
  const ref = e.endAt ?? e.startAt;
  return new Date(ref).getTime() < Date.now();
}

// "Tue, Apr 14" style day header (local).
export function formatDayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// "3:30 PM" (local). All-day events render an em dash.
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// "3:30 – 5:00 PM" when an end time exists, otherwise just the start.
export function formatTimeRange(e: ScheduleEvent): string {
  if (e.allDay) return "All day";
  const start = formatTime(e.startAt);
  if (!e.endAt) return start;
  return `${start} – ${formatTime(e.endAt)}`;
}

// Local YYYY-MM-DD key for grouping (avoids the UTC slice() off-by-one).
export function localDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface DayGroup {
  key: string;
  iso: string;
  events: ScheduleEvent[];
}

// ---------------------------------------------------------------------------
// iCal feed + single-event download (Phase 2)
// ---------------------------------------------------------------------------

export interface CalendarInfo {
  feedUrl: string;
  canManage: boolean;
}

export const calendarInfoQueryKey = (teamId: string) =>
  ["team-schedule", teamId, "calendar-info"] as const;

export async function fetchCalendarInfo(teamId: string): Promise<CalendarInfo> {
  return customFetch<CalendarInfo>(
    `/api/v1/teams/${teamId}/schedule/calendar/info`,
  );
}

export async function rotateCalendarToken(
  teamId: string,
): Promise<CalendarInfo> {
  return customFetch<CalendarInfo>(
    `/api/v1/teams/${teamId}/schedule/calendar/rotate`,
    { method: "POST" },
  );
}

function icsEscape(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function icsPad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function icsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${icsPad(d.getUTCMonth() + 1)}${icsPad(d.getUTCDate())}` +
    `T${icsPad(d.getUTCHours())}${icsPad(d.getUTCMinutes())}${icsPad(d.getUTCSeconds())}Z`
  );
}

function icsDate(d: Date): string {
  return `${d.getUTCFullYear()}${icsPad(d.getUTCMonth() + 1)}${icsPad(d.getUTCDate())}`;
}

// Build + download a single event's .ics client-side (the viewer already has
// the event, so no server round-trip). Mirrors the server's privacy rule:
// location NAME only, never the street address.
export function downloadEventIcs(e: ScheduleEvent): void {
  const start = new Date(e.startAt);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kinectem//Team Schedule//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${e.id}@kinectem`,
    `DTSTAMP:${icsUtc(new Date())}`,
  ];
  if (e.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`);
    const end = e.endAt
      ? new Date(e.endAt)
      : new Date(start.getTime() + 24 * 60 * 60 * 1000);
    lines.push(`DTEND;VALUE=DATE:${icsDate(end)}`);
  } else {
    lines.push(`DTSTART:${icsUtc(start)}`);
    if (e.endAt) lines.push(`DTEND:${icsUtc(new Date(e.endAt))}`);
  }
  lines.push(`SUMMARY:${icsEscape(eventTitle(e))}`);
  if (e.locationName?.trim()) {
    lines.push(`LOCATION:${icsEscape(e.locationName.trim())}`);
  }
  if (e.notes?.trim()) {
    lines.push(`DESCRIPTION:${icsEscape(e.notes.trim())}`);
  }
  if (e.status === "canceled") lines.push("STATUS:CANCELLED");
  lines.push("END:VEVENT", "END:VCALENDAR");

  const blob = new Blob([lines.join("\r\n") + "\r\n"], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug =
    eventTitle(e)
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "event";
  a.download = `${slug}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Score capture (Phase 2)
// ---------------------------------------------------------------------------

// Set both scores, or pass nulls to clear. Recording a score on a finished
// game also flips it to "completed" server-side (drops into Season Results).
export async function setEventScore(
  teamId: string,
  eventId: string,
  input: { scoreTeam: number | null; scoreOpponent: number | null },
): Promise<ScheduleEvent> {
  return customFetch<ScheduleEvent>(
    `/api/v1/teams/${teamId}/schedule/${eventId}/score`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

// A game-type event with a recorded score, for the Season Results list.
export function hasScore(e: ScheduleEvent): boolean {
  return e.scoreTeam != null && e.scoreOpponent != null;
}

// "W 3–1" / "L 0–2" / "T 2–2" from the team's perspective.
export function scoreResult(
  e: ScheduleEvent,
): { outcome: "W" | "L" | "T"; text: string } | null {
  if (e.scoreTeam == null || e.scoreOpponent == null) return null;
  const outcome =
    e.scoreTeam > e.scoreOpponent
      ? "W"
      : e.scoreTeam < e.scoreOpponent
        ? "L"
        : "T";
  return { outcome, text: `${e.scoreTeam}–${e.scoreOpponent}` };
}

// ---------------------------------------------------------------------------
// Bulk CSV import (Phase 2)
// ---------------------------------------------------------------------------

export interface ImportPreviewRow {
  line: number;
  eventType: string;
  date: string;
  startTime: string;
  endTime: string;
  opponent: string;
  homeAway: string;
  locationName: string;
  startAt: string | null;
  error: string | null;
}

export interface ImportPreview {
  validCount: number;
  errorCount: number;
  rows: ImportPreviewRow[];
}

export interface ImportResult {
  createdCount: number;
  data: ScheduleEvent[];
}

export const IMPORT_CSV_HEADER =
  "event_type,date,start_time,end_time,opponent,home_away,location_name,location_address,notes";

// commit=false → dry-run preview (writes nothing); commit=true → create all
// rows (server rejects unless every row is valid).
export async function importSchedule(
  teamId: string,
  csv: string,
  commit: boolean,
): Promise<ImportPreview | ImportResult> {
  return customFetch<ImportPreview | ImportResult>(
    `/api/v1/teams/${teamId}/schedule/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        csv,
        commit,
        tzOffsetMinutes: new Date().getTimezoneOffset(),
      }),
    },
  );
}

// Group a (sorted) event list by local calendar day.
export function groupByDay(events: ScheduleEvent[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const e of events) {
    const key = localDateKey(e.startAt);
    let g = byKey.get(key);
    if (!g) {
      g = { key, iso: e.startAt, events: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.events.push(e);
  }
  return groups;
}
