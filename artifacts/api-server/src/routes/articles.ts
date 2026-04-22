import { Router, type IRouter } from "express";
import { db, articles, articleTags, users, teams, highlights } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { CreateArticleBody } from "../lib/schemas";
import { toArticle, toHighlight, toUser } from "../lib/serializers";

const router: IRouter = Router();

router.post(
  "/articles",
  asyncHandler(async (req, res) => {
    const body = CreateArticleBody.parse(req.body);
    const [me] = await db.select().from(users).where(eq(users.role, "athlete")).limit(1);

    // Validate team exists
    const [team] = await db.select().from(teams).where(eq(teams.id, body.teamId));
    if (!team) {
      res.status(400).json({ error: "Invalid teamId" });
      return;
    }

    // Parse "34-14" style game scores
    let teamScore: number | undefined;
    let opponentScore: number | undefined;
    if (body.gameScore) {
      const match = /^(\d+)\s*-\s*(\d+)$/.exec(body.gameScore);
      if (match) {
        teamScore = Number(match[1]);
        opponentScore = Number(match[2]);
      }
    }

    const [created] = await db
      .insert(articles)
      .values({
        teamId: body.teamId,
        authorId: me?.id,
        title: body.title,
        summary: body.snippet ?? undefined,
        body: body.body,
        coverImageUrl: body.coverImageUrl,
        opponentName: body.opponentName,
        teamScore,
        opponentScore,
        gameDate: body.gameDate ? new Date(body.gameDate) : undefined,
      })
      .returning();

    if (body.taggedUserIds && body.taggedUserIds.length > 0) {
      await db
        .insert(articleTags)
        .values(body.taggedUserIds.map((userId: string) => ({ articleId: created.id, userId })));
    }

    // Link selected highlights to this article
    if (body.highlightIds && body.highlightIds.length > 0) {
      for (const hid of body.highlightIds) {
        await db.update(highlights).set({ articleId: created.id }).where(eq(highlights.id, hid));
      }
    }

    res.status(201).json(toArticle(created, { teamName: team.name, taggedUsers: [] }));
  }),
);

router.get(
  "/articles/:articleId",
  asyncHandler(async (req, res) => {
    const { articleId } = req.params;
    const [row] = await db
      .select({ article: articles, teamName: teams.name })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .where(eq(articles.id, articleId));

    if (!row) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    const taggedRows = await db
      .select({ user: users })
      .from(articleTags)
      .innerJoin(users, eq(articleTags.userId, users.id))
      .where(eq(articleTags.articleId, articleId));

    // Highlights linked to this article
    const relatedHighlights = await db
      .select()
      .from(highlights)
      .where(eq(highlights.articleId, articleId))
      .orderBy(desc(highlights.createdAt));

    res.json({
      article: toArticle(row.article, {
        teamName: row.teamName,
        taggedUsers: taggedRows.map((t) => toUser(t.user)),
      }),
      highlights: relatedHighlights.map((h) => toHighlight(h, { teamName: row.teamName })),
    });
  }),
);

export default router;
