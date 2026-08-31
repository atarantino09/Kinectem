// These helpers mirror the API's date-only competition week semantics. Never
// construct a local-time Date from a YYYY-MM-DD string: it can shift a Sunday
// or Monday into a different week for viewers west/east of UTC.

export type CompetitionWeek = {
  key: string;
  start: string;
  end: string;
};

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCompetitionDate(value: string | null | undefined): boolean {
  if (!value) return false;
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function competitionWeekForDate(
  value: string | null | undefined,
): CompetitionWeek | null {
  if (!value || !isCompetitionDate(value)) return null;
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const daysFromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  const end = date.toISOString().slice(0, 10);
  return { key: start, start, end };
}

function displayDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatCompetitionDate(value: string | null | undefined): string {
  if (!isCompetitionDate(value)) return "Date not listed";
  return displayDate(value!);
}

export function formatCompetitionWeek(week: CompetitionWeek): string {
  return `${displayDate(week.start)} – ${displayDate(week.end)}`;
}

export function formatCompetitionDateRange(
  start: string,
  end: string,
): string {
  const startLabel = displayDate(start);
  if (start === end) return startLabel;
  return `${startLabel} – ${displayDate(end)}`;
}

export function inclusiveDateSpan(
  start: string,
  end: string,
): number | null {
  const startMatch = DATE_ONLY_RE.exec(start);
  const endMatch = DATE_ONLY_RE.exec(end);
  if (!startMatch || !endMatch) return null;

  const startDate = new Date(
    Date.UTC(
      Number(startMatch[1]),
      Number(startMatch[2]) - 1,
      Number(startMatch[3]),
    ),
  );
  const endDate = new Date(
    Date.UTC(
      Number(endMatch[1]),
      Number(endMatch[2]) - 1,
      Number(endMatch[3]),
    ),
  );
  if (
    startDate.getUTCFullYear() !== Number(startMatch[1]) ||
    startDate.getUTCMonth() !== Number(startMatch[2]) - 1 ||
    startDate.getUTCDate() !== Number(startMatch[3]) ||
    endDate.getUTCFullYear() !== Number(endMatch[1]) ||
    endDate.getUTCMonth() !== Number(endMatch[2]) - 1 ||
    endDate.getUTCDate() !== Number(endMatch[3]) ||
    endDate < startDate
  ) {
    return null;
  }

  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
}