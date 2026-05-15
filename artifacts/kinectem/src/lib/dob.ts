// Shared Date-of-Birth helpers used by both the signup age gate
// (SignUpForm) and the profile editor (EditProfileDialog). Extracted
// from EditProfileDialog (Task #432) so the same three-Select pattern
// can be reused on signup (Task #506).
//
// Months are zero-padded so the value can be concatenated directly
// into the YYYY-MM-DD payload. Days always show 1–31; invalid combos
// like Feb 31 are caught by `validateDob`. Years run from the current
// year back to 1900, newest first so adults find their year quickly.

export const DOB_MONTHS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

export const DOB_DAYS: ReadonlyArray<string> = Array.from(
  { length: 31 },
  (_, i) => String(i + 1).padStart(2, "0"),
);

export const DOB_YEARS: ReadonlyArray<string> = (() => {
  const now = new Date().getUTCFullYear();
  const years: string[] = [];
  for (let y = now; y >= 1900; y -= 1) years.push(String(y));
  return years;
})();

export interface DobParts {
  m: string;
  d: string;
  y: string;
}

export function parseDob(v: string | null | undefined): DobParts {
  if (!v) return { m: "", d: "", y: "" };
  const s = String(v).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return { m: "", d: "", y: "" };
  return { y: match[1], m: match[2], d: match[3] };
}

export function composeDob(parts: DobParts): string {
  return `${parts.y}-${parts.m}-${parts.d}`;
}

// True if the three parts form a real calendar date (catches Feb 30,
// Apr 31, etc.) AND fall within a sensible birth-date range.
export function isValidDob(parts: DobParts): boolean {
  if (!parts.y || !parts.m || !parts.d) return false;
  const y = Number(parts.y);
  const m = Number(parts.m);
  const d = Number(parts.d);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return false;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return false;
  }
  // Reject future dates.
  if (dt.getTime() > Date.now()) return false;
  return true;
}
