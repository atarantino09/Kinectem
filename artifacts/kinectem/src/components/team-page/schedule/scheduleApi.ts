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
