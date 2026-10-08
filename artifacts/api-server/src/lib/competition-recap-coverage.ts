import { db, articles, teams, users, competitionBrackets, tournamentMatches } from "@workspace/db";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";

export interface TournamentCoverage {
  id: string; title: string; teamId: string; teamName: string;
  bracketId: string | null; bracketLabel: string | null; bracketOrder: number | null;
  summary: string | null; gameDate: string | null;
}
// Shared with the existing featured rail: curation never overrides public
// visibility, and a private practice plan is never competition coverage.
export function publicCompetitionArticleConditions(competitionId: string) {
  return and(
    eq(articles.competitionId, competitionId), eq(articles.articleKind, "recap"),
    eq(articles.status, "published"), isNull(articles.hiddenAt), isNull(teams.archivedAt),
    or(isNull(articles.authorId), and(eq(users.profileVisibility, "public"), isNull(users.deletedAt), eq(users.accountStatus, "active"))),
    sql`NOT EXISTS (SELECT 1 FROM takedown_requests tr WHERE tr.post_kind = 'article' AND tr.post_ref_id = "articles"."id" AND tr.status = 'pending')`,
  );
}
export async function loadTournamentCoverage(competitionId: string): Promise<TournamentCoverage[]> {
  const [rows, brackets] = await Promise.all([
    db.select({ article: articles, teamName: teams.name, matchBracket: tournamentMatches.bracket })
      .from(articles).innerJoin(teams, eq(teams.id, articles.teamId))
      .leftJoin(users, eq(users.id, articles.authorId))
      .leftJoin(tournamentMatches, and(eq(tournamentMatches.id, articles.competitionGameId), eq(tournamentMatches.tournamentId, competitionId)))
      .where(and(
        publicCompetitionArticleConditions(competitionId),
        isNull(articles.historical), isNull(articles.recapKind),
      )).orderBy(desc(articles.publishedAt), desc(articles.id)),
    db.select().from(competitionBrackets).where(eq(competitionBrackets.tournamentId, competitionId)).orderBy(asc(competitionBrackets.sortOrder)),
  ]);
  const bracketIds = new Set(brackets.map(b => b.id));
  return rows.map(({ article: a, teamName, matchBracket }) => {
    const matches = matchBracket ? brackets.filter(b => b.labelKey === matchBracket.trim().toLowerCase().replace(/\s+/g, " ")) : [];
    const bracketId = a.bracketId && bracketIds.has(a.bracketId) ? a.bracketId : matches.length === 1 ? matches[0].id : null;
    const bracket = brackets.find(b => b.id === bracketId);
    return {
      id: `article-${a.id}`, title: a.title, teamId: a.teamId, teamName,
      bracketId, bracketLabel: bracket?.label ?? null, bracketOrder: bracket?.sortOrder ?? null,
      summary: a.summary, gameDate: a.gameDate?.toISOString() ?? null,
    };
  });
}
