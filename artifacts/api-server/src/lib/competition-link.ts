// Competitions §7 — derive the recap → competition link at recap-creation
// time. When a team writing a game recap holds a CLAIMED slot in a
// competition, the recap gets stamped with `competition_id` (feeds the
// operator curation queue + public featured rail) and, when the game is
// unambiguously identifiable by date, `competition_game_id`.
//
// Resolution is best-effort and never blocks publishing:
//   * exactly one of the slot's games on the recap's game date → link both
//   * multiple games that day (can't disambiguate) → competition only
//   * no game that day but the date falls inside the competition window
//     → competition only
//   * otherwise → no link

import {
  db,
  tournaments,
  tournamentParticipants,
  tournamentMatches,
} from "@workspace/db";
import { and, eq, or } from "drizzle-orm";

export type CompetitionLink = {
  competitionId: string | null;
  competitionGameId: string | null;
};

const NO_LINK: CompetitionLink = { competitionId: null, competitionGameId: null };

export async function deriveCompetitionLink(
  teamId: string,
  gameDate: Date | null,
): Promise<CompetitionLink> {
  if (!gameDate) return NO_LINK;
  const day = gameDate.toISOString().slice(0, 10);

  const slots = await db
    .select({ participant: tournamentParticipants, competition: tournaments })
    .from(tournamentParticipants)
    .innerJoin(tournaments, eq(tournaments.id, tournamentParticipants.tournamentId))
    .where(eq(tournamentParticipants.teamId, teamId));

  let windowOnly: CompetitionLink | null = null;
  for (const { participant, competition } of slots) {
    const games = await db
      .select({ id: tournamentMatches.id })
      .from(tournamentMatches)
      .where(
        and(
          eq(tournamentMatches.tournamentId, competition.id),
          eq(tournamentMatches.matchDate, day),
          or(
            eq(tournamentMatches.homeParticipantId, participant.id),
            eq(tournamentMatches.awayParticipantId, participant.id),
          ),
        ),
      );
    if (games.length === 1) {
      return { competitionId: competition.id, competitionGameId: games[0].id };
    }
    if (games.length > 1) {
      return { competitionId: competition.id, competitionGameId: null };
    }
    if (
      windowOnly === null &&
      day >= competition.startDate &&
      day <= competition.endDate
    ) {
      windowOnly = { competitionId: competition.id, competitionGameId: null };
    }
  }
  return windowOnly ?? NO_LINK;
}
