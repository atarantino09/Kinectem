import { Router, type IRouter } from "express";
import { db, articles, highlights, teams, organizations, users, articleTags, highlightTags } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { safeAvatarUrl } from "../lib/spec-helpers";

const router: IRouter = Router();

router.get(
  "/feed",
  asyncHandler(async (_req, res) => {
    const articleRows = await db
      .select({
        id: articles.id,
        title: articles.title,
        summary: articles.summary,
        body: articles.body,
        coverImageUrl: articles.coverImageUrl,
        teamId: articles.teamId,
        teamName: teams.name,
        organizationId: organizations.id,
        organizationName: organizations.name,
        opponentName: articles.opponentName,
        teamScore: articles.teamScore,
        opponentScore: articles.opponentScore,
        gameDate: articles.gameDate,
        createdAt: articles.createdAt,
        authorId: articles.authorId,
      })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .orderBy(desc(articles.createdAt))
      .limit(30);

    const articleIds = articleRows.map((a) => a.id);
    const articleTagRows = articleIds.length
      ? await db
          .select({
            articleId: articleTags.articleId,
            userId: users.id,
            name: users.name,
            role: users.role,
            avatarUrl: users.avatarUrl,
          })
          .from(articleTags)
          .innerJoin(users, eq(articleTags.userId, users.id))
          .where(inArray(articleTags.articleId, articleIds))
      : [];

    const articleTagMap = new Map<string, Array<{ id: string; name: string; role: string; avatarUrl?: string }>>();
    for (const t of articleTagRows) {
      const arr = articleTagMap.get(t.articleId) ?? [];
      arr.push({ id: t.userId, name: t.name, role: t.role, avatarUrl: safeAvatarUrl(t.avatarUrl) ?? undefined });
      articleTagMap.set(t.articleId, arr);
    }

    const highlightRows = await db
      .select({
        id: highlights.id,
        title: highlights.title,
        description: highlights.description,
        videoUrl: highlights.videoUrl,
        thumbnailUrl: highlights.thumbnailUrl,
        durationSeconds: highlights.durationSeconds,
        teamId: highlights.teamId,
        teamName: teams.name,
        organizationId: organizations.id,
        organizationName: organizations.name,
        createdAt: highlights.createdAt,
      })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .orderBy(desc(highlights.createdAt))
      .limit(30);

    const highlightIds = highlightRows.map((h) => h.id);
    const highlightTagRows = highlightIds.length
      ? await db
          .select({
            highlightId: highlightTags.highlightId,
            userId: users.id,
            name: users.name,
            role: users.role,
            avatarUrl: users.avatarUrl,
          })
          .from(highlightTags)
          .innerJoin(users, eq(highlightTags.userId, users.id))
          .where(inArray(highlightTags.highlightId, highlightIds))
      : [];

    const highlightTagMap = new Map<string, Array<{ id: string; name: string; role: string; avatarUrl?: string }>>();
    for (const t of highlightTagRows) {
      const arr = highlightTagMap.get(t.highlightId) ?? [];
      arr.push({ id: t.userId, name: t.name, role: t.role, avatarUrl: safeAvatarUrl(t.avatarUrl) ?? undefined });
      highlightTagMap.set(t.highlightId, arr);
    }

    const items = [
      ...articleRows.map((a) => {
        const gameScore =
          a.teamScore != null && a.opponentScore != null
            ? `${a.teamScore}-${a.opponentScore}`
            : undefined;
        return {
          id: `article-${a.id}`,
          kind: "article" as const,
          createdAt: a.createdAt,
          article: {
            id: a.id,
            teamId: a.teamId,
            teamName: a.teamName,
            title: a.title,
            snippet: a.summary ?? undefined,
            coverImageUrl: a.coverImageUrl ?? undefined,
            opponentName: a.opponentName ?? undefined,
            gameScore,
            gameDate: a.gameDate ?? undefined,
            createdAt: a.createdAt,
            taggedUsers: articleTagMap.get(a.id) ?? [],
          },
          team: { id: a.teamId, name: a.teamName, organizationId: a.organizationId },
          organization: { id: a.organizationId, name: a.organizationName },
        };
      }),
      ...highlightRows.map((h) => ({
        id: `highlight-${h.id}`,
        kind: "highlight" as const,
        createdAt: h.createdAt,
        highlight: {
          id: h.id,
          teamId: h.teamId,
          teamName: h.teamName,
          title: h.title,
          description: h.description ?? undefined,
          videoUrl: h.videoUrl,
          thumbnailUrl: h.thumbnailUrl ?? undefined,
          durationSeconds: h.durationSeconds ?? undefined,
          createdAt: h.createdAt,
          taggedUsers: highlightTagMap.get(h.id) ?? [],
        },
        team: { id: h.teamId, name: h.teamName, organizationId: h.organizationId },
        organization: { id: h.organizationId, name: h.organizationName },
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.json(items);
  }),
);

export default router;
