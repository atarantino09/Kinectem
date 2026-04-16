import { Router, type IRouter } from "express";
import { db, teams, organizations, rosterEntries, users, articles, highlights } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { CreateTeamBody, AddRosterEntryBody } from "@workspace/api-zod";
import { toTeam, toOrganization, toRosterEntry, toUser, toArticle, toHighlight } from "../lib/serializers";

const router: IRouter = Router();

router.post(
  "/teams",
  asyncHandler(async (req, res) => {
    const body = CreateTeamBody.parse(req.body);
    const [created] = await db.insert(teams).values(body).returning();
    res.status(201).json(toTeam(created));
  }),
);

router.get(
  "/teams/:teamId",
  asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.id, team.organizationId));

    const rosterRows = await db
      .select({ entry: rosterEntries, user: users })
      .from(rosterEntries)
      .innerJoin(users, eq(rosterEntries.userId, users.id))
      .where(eq(rosterEntries.teamId, teamId));

    res.json({
      team: toTeam(team),
      organization: org ? toOrganization(org) : undefined,
      roster: rosterRows.map((r) => toRosterEntry(r.entry, toUser(r.user))),
    });
  }),
);

router.get(
  "/teams/:teamId/roster",
  asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const role = typeof req.query["role"] === "string" ? req.query["role"] : undefined;

    const rows = await db
      .select({ entry: rosterEntries, user: users })
      .from(rosterEntries)
      .innerJoin(users, eq(rosterEntries.userId, users.id))
      .where(eq(rosterEntries.teamId, teamId));

    const filtered = role ? rows.filter((r) => r.entry.role === role) : rows;
    res.json(filtered.map((r) => toRosterEntry(r.entry, toUser(r.user))));
  }),
);

router.post(
  "/teams/:teamId/roster",
  asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const body = AddRosterEntryBody.parse(req.body);
    const [created] = await db
      .insert(rosterEntries)
      .values({
        teamId,
        userId: body.userId,
        role: body.role,
        position: body.position,
        jerseyNumber: body.jerseyNumber,
      })
      .returning();
    const [user] = await db.select().from(users).where(eq(users.id, created.userId));
    res.status(201).json(toRosterEntry(created, toUser(user)));
  }),
);

router.get(
  "/teams/:teamId/articles",
  asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    const rows = await db
      .select()
      .from(articles)
      .where(eq(articles.teamId, teamId))
      .orderBy(desc(articles.createdAt));
    res.json(rows.map((a) => toArticle(a, { teamName: team?.name })));
  }),
);

router.get(
  "/teams/:teamId/highlights",
  asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    const rows = await db
      .select()
      .from(highlights)
      .where(eq(highlights.teamId, teamId))
      .orderBy(desc(highlights.createdAt));
    res.json(rows.map((h) => toHighlight(h, { teamName: team?.name })));
  }),
);

export default router;
