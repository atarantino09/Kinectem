function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// Loose comparison for the coach-confirmed name-mismatch gate (no fuzzy
// matching in v1 — anything that isn't a plain case/whitespace/containment
// match asks the coach to explicitly confirm they picked the right slot).
export function namesRoughlyMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

type NamedItem = { id: string; name: string };

function matchStrength(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 2;
  return na.includes(nb) || nb.includes(na) ? 1 : 0;
}

// Suggest only mutual, unique best matches. Exact matches outrank containment;
// ties on either side stay unselected for a person to review.
export function suggestDistinctNameMatches(
  teams: NamedItem[],
  slots: NamedItem[],
): Record<string, string> {
  const strengths = teams.flatMap((team) =>
    slots
      .map((slot) => ({
        teamId: team.id,
        slotId: slot.id,
        strength: matchStrength(team.name, slot.name),
      }))
      .filter((candidate) => candidate.strength > 0),
  );

  const uniqueBest = (
    candidates: typeof strengths,
    ownerKey: "teamId" | "slotId",
  ) => {
    const result = new Map<string, (typeof strengths)[number]>();
    const grouped = new Map<string, typeof strengths>();
    for (const candidate of candidates) {
      const ownerId = candidate[ownerKey];
      grouped.set(ownerId, [...(grouped.get(ownerId) ?? []), candidate]);
    }
    for (const [ownerId, group] of grouped) {
      const bestStrength = Math.max(...group.map((item) => item.strength));
      const best = group.filter((item) => item.strength === bestStrength);
      if (best.length === 1) result.set(ownerId, best[0]);
    }
    return result;
  };

  const bestByTeam = uniqueBest(strengths, "teamId");
  const bestBySlot = uniqueBest(strengths, "slotId");

  return Object.fromEntries(
    Array.from(bestByTeam.entries())
      .filter(
        ([teamId, candidate]) =>
          bestBySlot.get(candidate.slotId)?.teamId === teamId,
      )
      .map(([teamId, candidate]) => [teamId, candidate.slotId]),
  );
}
