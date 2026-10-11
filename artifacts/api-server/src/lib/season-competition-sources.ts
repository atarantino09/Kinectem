import {
  db, articles, tournaments, tournamentParticipants, tournamentMatches,
  teamHiddenCompetitionGames,
  competitionBrackets,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { resolveTeamCompetitionBracket } from "./competition-brackets";

export const MAX_COMBINED_MATCHES = 25;
export const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function matchEligibility(
  match: { status: string; matchDate: string | null },
  hasRecap: boolean,
  hasScore: boolean,
  today = new Date().toISOString().slice(0, 10),
) {
  const blockedReason = match.status === "canceled" || match.status === "postponed"
    ? match.status
    : match.matchDate && match.matchDate > today ? "Future match" : null;
  const confirmed = match.status === "completed" || hasRecap || hasScore;
  return {
    eligible: !blockedReason,
    blockedReason,
    requiresConfirmation: !blockedReason && !confirmed,
  };
}

export async function loadSeasonCompetitions(teamId: string) {
  const rows = await db.select({ competition: tournaments })
    .from(tournamentParticipants)
    .innerJoin(tournaments, eq(tournaments.id, tournamentParticipants.tournamentId))
    .where(eq(tournamentParticipants.teamId, teamId))
    .orderBy(asc(tournaments.startDate));
  return Array.from(new Map(rows.map(({ competition: c }) => [c.id, {
    id: c.id, name: c.name, startDate: c.startDate, endDate: c.endDate,
  }])).values());
}

export async function loadSeasonCompetitionMatches(teamId: string, competitionId: string) {
  const slots = await db.select().from(tournamentParticipants).where(and(
    eq(tournamentParticipants.teamId, teamId),
    eq(tournamentParticipants.tournamentId, competitionId),
  ));
  if (!slots.length) return null;
  const slotIds = slots.map((s) => s.id);
  const games = await db.select().from(tournamentMatches).where(and(
    eq(tournamentMatches.tournamentId, competitionId),
    or(inArray(tournamentMatches.homeParticipantId, slotIds),
      inArray(tournamentMatches.awayParticipantId, slotIds)),
  )).orderBy(asc(tournamentMatches.matchDate), asc(tournamentMatches.startTime), asc(tournamentMatches.id));
  if (!games.length) return [];
  const gameIds = games.map((g) => g.id);
  const refIds = Array.from(new Set(games.flatMap((g) =>
    [g.homeParticipantId, g.awayParticipantId].filter((id): id is string => !!id))));
  const [participants, recaps, removed, brackets] = await Promise.all([
    db.select().from(tournamentParticipants).where(inArray(tournamentParticipants.id, refIds)),
    db.select().from(articles).where(and(
      eq(articles.teamId, teamId), eq(articles.competitionId, competitionId),
      inArray(articles.competitionGameId, gameIds), eq(articles.status, "published"),
      isNull(articles.hiddenAt),
      or(isNull(articles.articleKind), eq(articles.articleKind, "recap")),
      or(isNull(articles.recapKind), eq(articles.recapKind, "historical")),
    )).orderBy(asc(articles.publishedAt), asc(articles.id)),
    db.select().from(teamHiddenCompetitionGames).where(and(
      eq(teamHiddenCompetitionGames.teamId, teamId),
      inArray(teamHiddenCompetitionGames.competitionGameId, gameIds),
      eq(teamHiddenCompetitionGames.removed, true),
    )),
    db.select().from(competitionBrackets).where(eq(competitionBrackets.tournamentId, competitionId)),
  ]);
  const names = new Map(participants.map((p) => [p.id, p.name]));
  const removedIds = new Set(removed.map((r) => r.competitionGameId));
  return games.filter((g) => !removedIds.has(g.id)).map((g) => {
    const isHome = !!g.homeParticipantId && slotIds.includes(g.homeParticipantId);
    const recap = recaps.find((r) => r.competitionGameId === g.id);
    const officialPair = g.homeScoreOfficial != null && g.awayScoreOfficial != null;
    const homeScore = officialPair ? g.homeScoreOfficial : g.homeScore;
    const awayScore = officialPair ? g.awayScoreOfficial : g.awayScore;
    const hasOfficialScore = homeScore != null && awayScore != null;
    const teamScore = hasOfficialScore ? (isHome ? homeScore : awayScore) : recap?.teamScore ?? null;
    const opponentScore = hasOfficialScore ? (isHome ? awayScore : homeScore) : recap?.opponentScore ?? null;
    return {
      id: g.id, gameDate: g.matchDate, startTime: g.startTime,
      opponentName: names.get((isHome ? g.awayParticipantId : g.homeParticipantId) ?? "") ?? null,
      teamScore, opponentScore, status: g.status,
      recapId: recap?.id ?? null,
      title: recap?.title ?? `Match ${g.matchNumber}`,
      summary: recap?.summary ?? recap?.body?.slice(0, 4000) ?? null,
      bracketId: resolveTeamCompetitionBracket(slots, brackets, g)?.id ?? null,
      ...matchEligibility(g, !!recap, teamScore != null && opponentScore != null),
    };
  });
}
