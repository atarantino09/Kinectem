// These helpers mirror the API's date-only competition week semantics. Never
// construct a local-time Date from a YYYY-MM-DD string: it can shift a Sunday
// or Monday into a different week for viewers west/east of UTC.

export type CompetitionWeek = {
  key: string;
  start: string;
  end: string;
};

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function competitionWeekForDate(
  value: string | null | undefined,
): CompetitionWeek | null {
  if (!value) return null;
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
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

export function formatCompetitionWeek(week: CompetitionWeek): string {
  return `${displayDate(week.start)} – ${displayDate(week.end)}`;
}