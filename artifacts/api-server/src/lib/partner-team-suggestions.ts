// Ranking is advisory only. It must never replace the existing name-warning gate.
const normalize = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const generic = /^(fc|sc|afc|club|team|soccer|football|boys?|girls?|coed|u?\d+)$/;

export function teamNameScore(source: string, destination: string): number {
  const a = normalize(source);
  const b = normalize(destination);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const left = new Set(a.split(" "));
  const right = new Set(b.split(" "));
  const common = [...left].filter((token) => right.has(token));
  // Age/gender/sport labels alone are not evidence of a likely team identity.
  if (!common.some((token) => !generic.test(token))) return 0;
  if (Math.min(a.length, b.length) >= 4 && (` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `))) {
    return 80 + 10 * Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  const overlap = 2 * common.length / (left.size + right.size);
  return overlap >= 0.5 ? 60 * overlap : 0;
}

export function rankTeamSuggestions<T extends { id: string; name: string }>(
  source: string, candidates: T[], limit = 6,
): T[] {
  return candidates.map((team) => ({ team, score: teamNameScore(source, team.name) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.team.name.localeCompare(b.team.name) || a.team.id.localeCompare(b.team.id))
    .slice(0, limit).map(({ team }) => team);
}
