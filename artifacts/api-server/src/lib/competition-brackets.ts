// Task #852 — competition brackets: organizer-defined labels used to sort
// recaps (no standings/seeding). This helper auto-seeds brackets from the
// imported schedule's division/bracket column. Idempotent: dedupe is on the
// lowercased label key, existing brackets (and their organizer-set order,
// gender, age) are NEVER touched, and new brackets are appended after the
// current max sort_order in a sensible initial order (gender, then age,
// then label).
import { db, tournamentMatches, competitionBrackets } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

export function bracketLabelKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

// Normalize a CSV gender cell to a friendly display value; null when the
// cell is empty or unrecognizable (kept optional — never required).
function normalizeGender(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return null;
  if (["boys", "boy", "b", "m", "male", "men", "mens"].includes(v)) return "Boys";
  if (["girls", "girl", "g", "f", "female", "women", "womens"].includes(v)) return "Girls";
  if (["coed", "co-ed", "mixed", "x"].includes(v)) return "Coed";
  return null;
}

// Numeric age hint for ordering ("U14" / "14U" / "14" → 14); null when the
// age cell has no digits.
function ageNumber(age: string | null): number | null {
  if (!age) return null;
  const m = age.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * Upsert distinct division/bracket values from the ALREADY-IMPORTED schedule
 * as brackets for the competition. Safe to call repeatedly (import apply,
 * console panel first load). Returns the number of brackets created.
 */
export async function seedBracketsFromSchedule(
  tournamentId: string,
): Promise<number> {
  const matches = await db
    .select({
      division: tournamentMatches.division,
      bracket: tournamentMatches.bracket,
      gender: tournamentMatches.gender,
      age: tournamentMatches.age,
    })
    .from(tournamentMatches)
    .where(eq(tournamentMatches.tournamentId, tournamentId));

  // Candidate label per row: the division value when present, else the
  // bracket value (both optional CSV columns; blank rows contribute nothing).
  type Candidate = {
    label: string;
    genders: Set<string>;
    ages: Set<string>;
    sawGenderCell: boolean;
  };
  const candidates = new Map<string, Candidate>();
  for (const m of matches) {
    const label = (m.division || m.bracket || "").trim();
    if (!label) continue;
    const key = bracketLabelKey(label);
    let c = candidates.get(key);
    if (!c) {
      c = { label, genders: new Set(), ages: new Set(), sawGenderCell: false };
      candidates.set(key, c);
    }
    const g = normalizeGender(m.gender);
    if (m.gender && m.gender.trim() !== "") c.sawGenderCell = true;
    if (g) c.genders.add(g);
    const a = (m.age ?? "").trim();
    if (a) c.ages.add(a);
  }
  if (candidates.size === 0) return 0;

  const existing = await db
    .select()
    .from(competitionBrackets)
    .where(eq(competitionBrackets.tournamentId, tournamentId))
    .orderBy(asc(competitionBrackets.sortOrder));
  const existingKeys = new Set(existing.map((b) => b.labelKey));
  let nextOrder =
    existing.length > 0
      ? Math.max(...existing.map((b) => b.sortOrder)) + 1
      : 0;

  const fresh = Array.from(candidates.entries())
    .filter(([key]) => !existingKeys.has(key))
    .map(([key, c]) => ({
      key,
      label: c.label,
      // Pre-fill gender only when every row with this label agrees.
      gender: c.genders.size === 1 ? Array.from(c.genders)[0] : null,
      ageGroup: c.ages.size === 1 ? Array.from(c.ages)[0] : null,
    }));
  if (fresh.length === 0) return 0;

  // Initial grouping order: gender (Boys, Girls, Coed, unknown), then age
  // (numeric when detectable), then label.
  const genderRank = (g: string | null) =>
    g === "Boys" ? 0 : g === "Girls" ? 1 : g === "Coed" ? 2 : 3;
  fresh.sort((a, b) => {
    const gr = genderRank(a.gender) - genderRank(b.gender);
    if (gr !== 0) return gr;
    const an = ageNumber(a.ageGroup);
    const bn = ageNumber(b.ageGroup);
    if (an !== null && bn !== null && an !== bn) return an - bn;
    if ((an === null) !== (bn === null)) return an === null ? 1 : -1;
    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });

  // onConflictDoNothing guards a concurrent seed racing this one — the
  // unique (tournament_id, label_key) index is the real dedupe boundary.
  const inserted = await db
    .insert(competitionBrackets)
    .values(
      fresh.map((f) => ({
        tournamentId,
        label: f.label,
        labelKey: f.key,
        gender: f.gender,
        ageGroup: f.ageGroup,
        sortOrder: nextOrder++,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: competitionBrackets.id });
  return inserted.length;
}
