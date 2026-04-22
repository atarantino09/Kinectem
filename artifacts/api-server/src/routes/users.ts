import { Router, type IRouter } from "express";
import { db, users, rosterEntries, teams, organizations, articles, articleTags, highlights, highlightTags } from "@workspace/db";
import { eq, ilike, desc, inArray } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { toUser, toTeamSummary, toArticle, toHighlight } from "../lib/serializers";

const router: IRouter = Router();

router.get(
  "/me",
  asyncHandler(async (_req, res) => {
    const [me] = await db.select().from(users).where(eq(users.role, "athlete")).limit(1);
    if (!me) {
      res.status(404).json({ error: "No users seeded" });
      return;
    }
    res.json(toUser(me));
  }),
);

router.get(
  "/users/me/children",
  asyncHandler(async (req, res) => {
    if (!req.sessionUser) return res.status(401).json({ error: "Not authenticated" });
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.parentId, req.sessionUser.id));
    res.json({ data: rows.map((u) => ({ ...toUser(u), requireTagConsent: u.requireTagConsent })) });
  }),
);

router.post(
  "/users/me/children",
  asyncHandler(async (req, res) => {
    if (!req.sessionUser) return res.status(401).json({ error: "Not authenticated" });
    if (req.sessionUser.role !== "parent") {
      return res.status(403).json({ error: "Only parent accounts can link children" });
    }
    const childId = String(req.body?.childId ?? "").trim();
    if (!childId) return res.status(400).json({ error: "childId required" });
    const [child] = await db.select().from(users).where(eq(users.id, childId)).limit(1);
    if (!child) return res.status(404).json({ error: "User not found" });
    if (child.parentId && child.parentId !== req.sessionUser.id) {
      return res.status(409).json({ error: "Already linked to another guardian" });
    }
    const [updated] = await db
      .update(users)
      .set({ parentId: req.sessionUser.id })
      .where(eq(users.id, childId))
      .returning();
    res.status(201).json({ ...toUser(updated), requireTagConsent: updated.requireTagConsent });
  }),
);

router.patch(
  "/users/me/children/:childId/visibility",
  asyncHandler(async (req, res) => {
    if (!req.sessionUser) return res.status(401).json({ error: "Not authenticated" });
    const [child] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.params.childId))
      .limit(1);
    if (!child || child.parentId !== req.sessionUser.id) {
      return res.status(404).json({ error: "Child not found" });
    }
    const requireTagConsent = !!req.body?.requireTagConsent;
    const [updated] = await db
      .update(users)
      .set({ requireTagConsent })
      .where(eq(users.id, child.id))
      .returning();
    res.json({ ...toUser(updated), requireTagConsent: updated.requireTagConsent });
  }),
);

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const q = typeof req.query["q"] === "string" ? req.query["q"] : undefined;
    const rows = q
      ? await db.select().from(users).where(ilike(users.name, `%${q}%`)).limit(50)
      : await db.select().from(users).limit(50);
    res.json(rows.map(toUser));
  }),
);

router.get(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const teamRows = await db
      .select({
        team: teams,
        organizationName: organizations.name,
      })
      .from(rosterEntries)
      .innerJoin(teams, eq(rosterEntries.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(eq(rosterEntries.userId, userId));

    const [taggedArticleCount, taggedHighlightCount] = await Promise.all([
      db
        .select({ id: articles.id })
        .from(articleTags)
        .innerJoin(articles, eq(articleTags.articleId, articles.id))
        .where(eq(articleTags.userId, userId)),
      db
        .select({ id: highlights.id })
        .from(highlightTags)
        .innerJoin(highlights, eq(highlightTags.highlightId, highlights.id))
        .where(eq(highlightTags.userId, userId)),
    ]);

    res.json({
      user: toUser(user),
      teams: teamRows.map((t) =>
        toTeamSummary(t.team, { organizationName: t.organizationName }),
      ),
      stats: {
        gamesPlayed: taggedArticleCount.length,
        primaryStatLabel: "Articles",
        primaryStatValue: String(taggedArticleCount.length),
        secondaryStatLabel: "Highlights",
        secondaryStatValue: String(taggedHighlightCount.length),
        tertiaryStatLabel: "Teams",
        tertiaryStatValue: String(teamRows.length),
      },
    });
  }),
);

router.get(
  "/users/:userId/tagged-content",
  asyncHandler(async (req, res) => {
    const { userId } = req.params;

    const articleRows = await db
      .select({ article: articles, teamName: teams.name })
      .from(articleTags)
      .innerJoin(articles, eq(articleTags.articleId, articles.id))
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .where(eq(articleTags.userId, userId))
      .orderBy(desc(articles.createdAt));

    const highlightRows = await db
      .select({ highlight: highlights, teamName: teams.name })
      .from(highlightTags)
      .innerJoin(highlights, eq(highlightTags.highlightId, highlights.id))
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .where(eq(highlightTags.userId, userId))
      .orderBy(desc(highlights.createdAt));

    // Tagged users on each
    const articleIds = articleRows.map((r) => r.article.id);
    const highlightIds = highlightRows.map((r) => r.highlight.id);

    const articleTagged = articleIds.length
      ? await db
          .select({ articleId: articleTags.articleId, user: users })
          .from(articleTags)
          .innerJoin(users, eq(articleTags.userId, users.id))
          .where(inArray(articleTags.articleId, articleIds))
      : [];
    const highlightTagged = highlightIds.length
      ? await db
          .select({ highlightId: highlightTags.highlightId, user: users })
          .from(highlightTags)
          .innerJoin(users, eq(highlightTags.userId, users.id))
          .where(inArray(highlightTags.highlightId, highlightIds))
      : [];

    const articleTagMap = new Map<string, ReturnType<typeof toUser>[]>();
    for (const t of articleTagged) {
      const arr = articleTagMap.get(t.articleId) ?? [];
      arr.push(toUser(t.user));
      articleTagMap.set(t.articleId, arr);
    }
    const highlightTagMap = new Map<string, ReturnType<typeof toUser>[]>();
    for (const t of highlightTagged) {
      const arr = highlightTagMap.get(t.highlightId) ?? [];
      arr.push(toUser(t.user));
      highlightTagMap.set(t.highlightId, arr);
    }

    res.json({
      articles: articleRows.map((r) =>
        toArticle(r.article, {
          teamName: r.teamName,
          taggedUsers: articleTagMap.get(r.article.id) ?? [],
        }),
      ),
      highlights: highlightRows.map((r) =>
        toHighlight(r.highlight, {
          teamName: r.teamName,
          taggedUsers: highlightTagMap.get(r.highlight.id) ?? [],
        }),
      ),
    });
  }),
);

export default router;
