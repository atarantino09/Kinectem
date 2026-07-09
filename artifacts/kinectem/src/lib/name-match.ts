// Loose comparison for the coach-confirmed name-mismatch gate (no fuzzy
// matching in v1 — anything that isn't a plain case/whitespace/containment
// match asks the coach to explicitly confirm they picked the right slot).
export function namesRoughlyMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}
