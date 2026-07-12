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
    const linked = await linkForSlot(participant.id, competition, day);
    if (linked) {
      if (linked.competitionGameId) return linked;
      if (windowOnly === null && linked.competitionId) windowOnly = linked;
    }
  }
  return windowOnly ?? NO_LINK;
}

// Composer's explicit competition pick. Returns "not_claimed" when the
// team holds no CLAIMED slot in the chosen competition (the caller
// rejects the request), otherwise stamps the competition and, when the
// game is unambiguous on the recap's date, the specific game.
export async function deriveExplicitCompetitionLink(
  teamId: string,
  competitionId: string,
  gameDate: Date | null,
): Promise<CompetitionLink | "not_claimed"> {
  const [slot] = await db
    .select({ participant: tournamentParticipants, competition: tournaments })
    .from(tournamentParticipants)
    .innerJoin(tournaments, eq(tournaments.id, tournamentParticipants.tournamentId))
    .where(
      and(
        eq(tournamentParticipants.teamId, teamId),
        eq(tournamentParticipants.tournamentId, competitionId),
      ),
    )
    .limit(1);
  if (!slot) return "not_claimed";
  if (!gameDate) {
    return { competitionId, competitionGameId: null };
  }
  const day = gameDate.toISOString().slice(0, 10);
  const games = await db
    .select({ id: tournamentMatches.id })
    .from(tournamentMatches)
    .where(
      and(
        eq(tournamentMatches.tournamentId, competitionId),
        eq(tournamentMatches.matchDate, day),
        or(
          eq(tournamentMatches.homeParticipantId, slot.participant.id),
          eq(tournamentMatches.awayParticipantId, slot.participant.id),
        ),
      ),
    );
  return {
    competitionId,
    competitionGameId: games.length === 1 ? games[0].id : null,
  };
}

// Shared per-slot resolution used by the auto-derive loop above.
// Returns a full link when exactly one of the slot's games lands on
// the day, a competition-only link when the day is ambiguous (many
// games) or merely inside the competition window, and null otherwise.
async function linkForSlot(
  participantId: string,
  competition: typeof tournaments.$inferSelect,
  day: string,
): Promise<CompetitionLink | null> {
  const games = await db
    .select({ id: tournamentMatches.id })
    .from(tournamentMatches)
    .where(
      and(
        eq(tournamentMatches.tournamentId, competition.id),
        eq(tournamentMatches.matchDate, day),
        or(
          eq(tournamentMatches.homeParticipantId, participantId),
          eq(tournamentMatches.awayParticipantId, participantId),
        ),
      ),
    );
  if (games.length === 1) {
    return { competitionId: competition.id, competitionGameId: games[0].id };
  }
  if (games.length > 1) {
    return { competitionId: competition.id, competitionGameId: null };
  }
  if (day >= competition.startDate && day <= competition.endDate) {
    return { competitionId: competition.id, competitionGameId: null };
  }
  return null;
}
