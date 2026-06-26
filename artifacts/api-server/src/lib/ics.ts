// Minimal, dependency-free iCalendar (RFC 5545) writer for the team schedule
// feed + single-event download. We only emit the fields the schedule actually
// has (summary, start/end, location NAME, description) and deliberately never
// include a street address — same privacy rule as the schedule emails.

export interface IcsEvent {
  uid: string;
  // Instant the event starts. `allDay` events use a DATE value (no time).
  start: Date;
  end?: Date | null;
  allDay?: boolean;
  summary: string;
  // Location NAME only (never the full street address).
  location?: string | null;
  description?: string | null;
  // Last-modified instant, used for DTSTAMP / LAST-MODIFIED.
  stamp?: Date | null;
  // When true the client should treat the event as canceled (STATUS:CANCELLED).
  canceled?: boolean;
}

// RFC 5545 text escaping: backslash, semicolon, comma, and newlines.
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// UTC timestamp form: YYYYMMDDTHHMMSSZ.
function formatUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// DATE form for all-day events: YYYYMMDD (UTC calendar date).
function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

// Fold lines longer than 75 octets per RFC 5545 (continuation starts with a
// space). We approximate by character count, which is safe for our ASCII-ish
// content and never splits below the limit.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(` ${rest}`);
  return parts.join("\r\n");
}

function eventLines(ev: IcsEvent): string[] {
  const lines: string[] = ["BEGIN:VEVENT", `UID:${escapeText(ev.uid)}`];
  const stamp = ev.stamp ?? new Date();
  lines.push(`DTSTAMP:${formatUtc(stamp)}`);
  if (ev.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatDate(ev.start)}`);
    // All-day DTEND is exclusive; default to the day after start.
    const end = ev.end ?? new Date(ev.start.getTime() + 24 * 60 * 60 * 1000);
    lines.push(`DTEND;VALUE=DATE:${formatDate(end)}`);
  } else {
    lines.push(`DTSTART:${formatUtc(ev.start)}`);
    if (ev.end) lines.push(`DTEND:${formatUtc(ev.end)}`);
  }
  lines.push(`SUMMARY:${escapeText(ev.summary)}`);
  if (ev.location?.trim()) {
    lines.push(`LOCATION:${escapeText(ev.location.trim())}`);
  }
  if (ev.description?.trim()) {
    lines.push(`DESCRIPTION:${escapeText(ev.description.trim())}`);
  }
  if (ev.canceled) lines.push("STATUS:CANCELLED");
  lines.push(`LAST-MODIFIED:${formatUtc(stamp)}`);
  lines.push("END:VEVENT");
  return lines;
}

export interface IcsCalendarOptions {
  // Human calendar name shown in the subscriber's client (X-WR-CALNAME).
  calendarName?: string;
}

export function buildIcsCalendar(
  events: IcsEvent[],
  opts: IcsCalendarOptions = {},
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kinectem//Team Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (opts.calendarName?.trim()) {
    lines.push(`X-WR-CALNAME:${escapeText(opts.calendarName.trim())}`);
  }
  for (const ev of events) lines.push(...eventLines(ev));
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
