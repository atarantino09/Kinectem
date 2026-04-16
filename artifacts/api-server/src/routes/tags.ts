import { Router, type IRouter } from "express";
import { db, articleTags, highlightTags, articles, highlights, teams, users, organizationAdmins } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../lib/auth";
import { toArticle, toHighlight } from "../lib/serializers";

const router: IRouter = Router();

router.get(
  "/me/tags",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.sessionUser!.id;

    const articleRows = await db
      .select({ tagId: articleTags.id, article: articles, teamName: teams.name })
      .from(articleTags)
      .innerJoin(articles, eq(articleTags.articleId, articles.id))
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .where(eq(articleTags.userId, userId))
      .orderBy(desc(articles.createdAt));

    const highlightRows = await db
      .select({ tagId: highlightTags.id, highlight: highlights, teamName: teams.name })
      .from(highlightTags)
      .innerJoin(highlights, eq(highlightTags.highlightId, highlights.id))
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .where(eq(highlightTags.userId, userId))
      .orderBy(desc(highlights.createdAt));

    res.json({
      articleTags: articleRows.map((r) => ({
        tagId: r.tagId,
        article: toArticle(r.article, { teamName: r.teamName }),
      })),
      highlightTags: highlightRows.map((r) => ({
        tagId: r.tagId,
        highlight: toHighlight(r.highlight, { teamName: r.teamName }),
      })),
    });
  }),
);

router.delete(
  "/article-tags/:tagId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { tagId } = req.params;
    const userId = req.sessionUser!.id;
    const [tag] = await db.select().from(articleTags).where(eq(articleTags.id, tagId)).limit(1);
    if (!tag) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }
    // Allow if it's the player's own tag, or org admin of article's team
    if (tag.userId !== userId) {
      const [art] = await db.select().from(articles).where(eq(articles.id, tag.articleId));
      if (!art) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
      const [team] = await db.select().from(teams).where(eq(teams.id, art.teamId));
      const isAdmin = team
        ? (await db
            .select()
            .from(organizationAdmins)
            .where(and(eq(organizationAdmins.organizationId, team.organizationId), eq(organizationAdmins.userId, userId)))
            .limit(1)
          ).length > 0
        : false;
      if (!isAdmin) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
    }
    await db.delete(articleTags).where(eq(articleTags.id, tagId));
    res.status(204).end();
  }),
);

router.delete(
  "/highlight-tags/:tagId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { tagId } = req.params;
    const userId = req.sessionUser!.id;
    const [tag] = await db.select().from(highlightTags).where(eq(highlightTags.id, tagId)).limit(1);
    if (!tag) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }
    if (tag.userId !== userId) {
      const [hl] = await db.select().from(highlights).where(eq(highlights.id, tag.highlightId));
      const [team] = hl ? await db.select().from(teams).where(eq(teams.id, hl.teamId)) : [];
      const isAdmin = team
        ? (await db
            .select()
            .from(organizationAdmins)
            .where(and(eq(organizationAdmins.organizationId, team.organizationId), eq(organizationAdmins.userId, userId)))
            .limit(1)
          ).length > 0
        : false;
      if (!isAdmin) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
    }
    await db.delete(highlightTags).where(eq(highlightTags.id, tagId));
    res.status(204).end();
  }),
);

export default router;
