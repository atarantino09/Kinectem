// Competition schedule/recap weeks are calendar weeks, not rolling
// seven-day windows. Dates are deliberately parsed as UTC calendar values so
// a date-only value never moves weeks based on the server's local timezone.

export type CompetitionWeek = {
  key: string;
  start: string;
  end: string;
};

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateOnlyParts(value: string | null | undefined): [number, number, number] | null {
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
  return [year, month, day];
}

function formatDateOnly(date: Date): string {
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

/**
 * Return the Monday-through-Sunday range containing a date-only value.
 * Invalid, missing, and non-date-only values return null.
 */
export function competitionWeekForDate(
  value: string | null | undefined,
): CompetitionWeek | null {
  const parts = dateOnlyParts(value);
  if (!parts) return null;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const daysFromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  const start = formatDateOnly(date);
  date.setUTCDate(date.getUTCDate() + 6);
  const end = formatDateOnly(date);
  return { key: start, start, end };
}

/** Convert a timestamp column used by recap gameDate into a date-only value. */
export function timestampToCompetitionDate(value: Date | null | undefined): string | null {
  return value && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : null;
}