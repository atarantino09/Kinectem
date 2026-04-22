import { Router, type IRouter } from "express";
import { db, highlights, highlightTags, users, teams, articles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { CreateHighlightBody } from "../lib/schemas";
import { toHighlight, toArticle, toUser } from "../lib/serializers";

const router: IRouter = Router();

router.post(
  "/highlights",
  asyncHandler(async (req, res) => {
    const body = CreateHighlightBody.parse(req.body);
    const [me] = await db.select().from(users).where(eq(users.role, "athlete")).limit(1);

    const [team] = await db.select().from(teams).where(eq(teams.id, body.teamId));
    if (!team) {
      res.status(400).json({ error: "Invalid teamId" });
      return;
    }

    if (body.articleId) {
      const [art] = await db.select().from(articles).where(eq(articles.id, body.articleId));
      if (!art) {
        res.status(400).json({ error: "Invalid articleId" });
        return;
      }
    }

    const [created] = await db
      .insert(highlights)
      .values({
        teamId: body.teamId,
        articleId: body.articleId,
        uploaderId: me?.id,
        title: body.title,
        videoUrl: body.videoUrl ?? "",
        thumbnailUrl: body.thumbnailUrl,
        durationSeconds: body.durationSeconds,
      })
      .returning();

    if (body.taggedUserIds && body.taggedUserIds.length > 0) {
      await db
        .insert(highlightTags)
        .values(body.taggedUserIds.map((userId: string) => ({ highlightId: created.id, userId })));
    }

    res.status(201).json(toHighlight(created, { teamName: team.name, taggedUsers: [] }));
  }),
);

router.get(
  "/highlights/:highlightId",
  asyncHandler(async (req, res) => {
    const { highlightId } = req.params;
    const [row] = await db
      .select({ highlight: highlights, teamName: teams.name })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .where(eq(highlights.id, highlightId));

    if (!row) {
      res.status(404).json({ error: "Highlight not found" });
      return;
    }

    const taggedRows = await db
      .select({ user: users })
      .from(highlightTags)
      .innerJoin(users, eq(highlightTags.userId, users.id))
      .where(eq(highlightTags.highlightId, highlightId));

    res.json({
      highlight: toHighlight(row.highlight, {
        teamName: row.teamName,
        taggedUsers: taggedRows.map((t) => toUser(t.user)),
      }),
    });
  }),
);

export default router;
