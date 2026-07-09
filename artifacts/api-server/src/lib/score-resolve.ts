// Competitions §6 — score resolution ladder. A game's score is a single fact
// with multiple possible sources, resolved to the highest available tier:
//
//   official  (home/away_score_official set by import or operator) → public
//   confirmed (both claiming teams self-reported the SAME score)   → public
//   disputed  (both reported, numbers disagree — operator flagged) → hidden
//   reported  (exactly one team reported — that team's own view)   → team-local
//   none      (no score at all; recaps still publish)
//
// Score state NEVER blocks recap publishing or featuring.

export type ScoreReportRow = {
  teamId: string;
  homeScore: number;
  awayScore: number;
};

export type ResolvedScore =
  | { state: "official"; public: true; homeScore: number; awayScore: number }
  | { state: "confirmed"; public: true; homeScore: number; awayScore: number }
  | { state: "disputed"; public: false; homeScore: null; awayScore: null }
  | {
      state: "reported";
      public: false;
      homeScore: null;
      awayScore: null;
      teamLocal: { teamId: string; homeScore: number; awayScore: number };
    }
  | { state: "none"; public: false; homeScore: null; awayScore: null };

// `sideTeamIds` = the CURRENT claimed team ids on the game's home/away sides.
// Resolution only considers one report per current side — stale reports left
// behind by claim churn (a slot re-claimed by a different team) are ignored,
// so the outcome is deterministic regardless of row order.
export function resolveScore(
  game: { homeScoreOfficial: number | null; awayScoreOfficial: number | null },
  reports: ScoreReportRow[],
  sideTeamIds: readonly (string | null | undefined)[],
): ResolvedScore {
  if (game.homeScoreOfficial != null && game.awayScoreOfficial != null) {
    return {
      state: "official",
      public: true,
      homeScore: game.homeScoreOfficial,
      awayScore: game.awayScoreOfficial,
    };
  }
  // One report per current side (reports are unique per (game, team) at the
  // DB level; the side filter drops any stale non-side rows).
  const sides = new Set(sideTeamIds.filter((x): x is string => x != null));
  const bySide = new Map<string, ScoreReportRow>();
  for (const r of reports) {
    if (sides.has(r.teamId)) bySide.set(r.teamId, r);
  }
  const sideReports = [...bySide.values()];
  if (sideReports.length >= 2) {
    const [a, b] = sideReports;
    if (a.homeScore === b.homeScore && a.awayScore === b.awayScore) {
      return {
        state: "confirmed",
        public: true,
        homeScore: a.homeScore,
        awayScore: a.awayScore,
      };
    }
    return { state: "disputed", public: false, homeScore: null, awayScore: null };
  }
  if (sideReports.length === 1) {
    return {
      state: "reported",
      public: false,
      homeScore: null,
      awayScore: null,
      teamLocal: {
        teamId: sideReports[0].teamId,
        homeScore: sideReports[0].homeScore,
        awayScore: sideReports[0].awayScore,
      },
    };
  }
  return { state: "none", public: false, homeScore: null, awayScore: null };
}
