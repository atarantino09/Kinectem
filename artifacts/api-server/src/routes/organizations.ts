import { Router, type IRouter } from "express";
import { db, organizations, teams, rosterEntries, articles, highlights } from "@workspace/db";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { toOrganization, toTeamSummary } from "../lib/serializers";
import { CreateOrganizationBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get(
  "/organizations",
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(organizations).orderBy(organizations.name);
    res.json(rows.map(toOrganization));
  }),
);

router.post(
  "/organizations",
  asyncHandler(async (req, res) => {
    const body = CreateOrganizationBody.parse(req.body);
    const [created] = await db.insert(organizations).values(body).returning();
    res.status(201).json(toOrganization(created));
  }),
);

router.get(
  "/organizations/:orgId",
  asyncHandler(async (req, res) => {
    const { orgId } = req.params;
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    const teamRows = await db.select().from(teams).where(eq(teams.organizationId, orgId));

    const rosterCounts = await db
      .select({ teamId: rosterEntries.teamId, count: sql<number>`count(*)::int` })
      .from(rosterEntries)
      .where(eq(rosterEntries.role, "player"))
      .groupBy(rosterEntries.teamId);
    const rosterMap = new Map(rosterCounts.map((r) => [r.teamId, r.count]));

    res.json({
      organization: toOrganization(org),
      teams: teamRows.map((t) =>
        toTeamSummary(t, {
          organizationName: org.name,
          playerCount: rosterMap.get(t.id) ?? 0,
        }),
      ),
    });
  }),
);

router.get(
  "/organizations/:orgId/activity",
  asyncHandler(async (req, res) => {
    const { orgId } = req.params;
    const teamIds = (
      await db.select({ id: teams.id }).from(teams).where(eq(teams.organizationId, orgId))
    ).map((t) => t.id);

    if (teamIds.length === 0) {
      res.json([]);
      return;
    }

    const articleRows = await db
      .select({
        id: articles.id,
        title: articles.title,
        teamId: articles.teamId,
        teamName: teams.name,
        snippet: articles.summary,
        opponentName: articles.opponentName,
        teamScore: articles.teamScore,
        opponentScore: articles.opponentScore,
        createdAt: articles.createdAt,
      })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .where(inArray(articles.teamId, teamIds))
      .orderBy(desc(articles.createdAt))
      .limit(20);

    const highlightRows = await db
      .select({
        id: highlights.id,
        title: highlights.title,
        teamId: highlights.teamId,
        teamName: teams.name,
        thumbnailUrl: highlights.thumbnailUrl,
        durationSeconds: highlights.durationSeconds,
        createdAt: highlights.createdAt,
      })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .where(inArray(highlights.teamId, teamIds))
      .orderBy(desc(highlights.createdAt))
      .limit(20);

    const items = [
      ...articleRows.map((a) => ({
        id: `article-${a.id}`,
        kind: "article" as const,
        createdAt: a.createdAt,
        article: {
          id: a.id,
          title: a.title,
          teamId: a.teamId,
          teamName: a.teamName,
          snippet: a.snippet ?? undefined,
          opponentName: a.opponentName ?? undefined,
          gameScore:
            a.teamScore != null && a.opponentScore != null
              ? `${a.teamScore}-${a.opponentScore}`
              : undefined,
          createdAt: a.createdAt,
        },
      })),
      ...highlightRows.map((h) => ({
        id: `highlight-${h.id}`,
        kind: "highlight" as const,
        createdAt: h.createdAt,
        highlight: {
          id: h.id,
          title: h.title,
          teamId: h.teamId,
          teamName: h.teamName,
          thumbnailUrl: h.thumbnailUrl ?? undefined,
          durationSeconds: h.durationSeconds ?? undefined,
          createdAt: h.createdAt,
        },
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.json(items);
  }),
);

export default router;
