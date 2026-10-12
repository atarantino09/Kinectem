export type PrevState = { enabled: boolean; season: string; playedDate: string; attested: boolean };
export type PrevBody = { season: string; gamePlayedDate: string; attested: boolean } | null;

export function previousSeasonBody(s: PrevState): PrevBody {
  return s.enabled ? { season: s.season.trim(), gamePlayedDate: s.playedDate, attested: s.attested } : null;
}

/** PATCH fragment: untouched => absent (unchanged); touched+disabled => null (clear). */
export function previousSeasonPatch(touched: boolean, s: PrevState): { previousSeason?: PrevBody } {
  return touched ? { previousSeason: previousSeasonBody(s) } : {};
}

export function previousSeasonProblemFor(s: PrevState, todayIso: string): string | null {
  if (!s.enabled) return null;
  if (!s.season.trim()) return "Enter the season or year of the game.";
  if (!s.playedDate || s.playedDate >= todayIso) return "Enter the actual date the game was played (a past date).";
  if (!s.attested) return "Confirm this is an original recap of a previous-season game.";
  return null;
}
