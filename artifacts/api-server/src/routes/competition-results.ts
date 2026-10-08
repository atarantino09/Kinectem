import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, tournaments, competitionBrackets, tournamentParticipants, teams,
  competitionResultImports, competitionTournamentRecaps, competitionRecapPlacements,
  type ResultGroup, type TournamentStoryContent,
} from "@workspace/db";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { rateLimit } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import { apiError } from "../lib/spec-helpers";
import { canOperateCompetition } from "../lib/competition-permissions";
import { canManageTeam } from "../lib/permissions";
import { ingestResultsUrl, parseResultsTable, ResultGroupSchema } from "../lib/competition-results-intake";
import { AiNotConfiguredError, generateTournamentRecapText } from "../lib/ai";
import { loadTournamentCoverage, type TournamentCoverage } from "../lib/competition-recap-coverage";

const router: IRouter = Router();
const uuid = z.string().uuid();
const revision = z.number().int().min(0);
const limiter = rateLimit({ name: "competition-results", windowMs: 60_000, max: 15, keys: req => [req.sessionUser?.id ?? req.ip ?? "anonymous"] });
const aiLimiter = rateLimit({ name: "competition-tournament-generation", windowMs: 60_000, max: 8, keys: req => [req.sessionUser?.id ?? "anonymous"] });
class ResultsError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "VALIDATION_FAILED") { super(message); }
}
const handler = (fn: (req: Request, res: Response) => Promise<void>) => asyncHandler(async (req, res) => {
  try { await fn(req, res); } catch (error) {
    if (error instanceof z.ZodError) { apiError(res, 400, error.errors[0]?.message ?? "Invalid request.", { code: "VALIDATION_FAILED" }); return; }
    if (error instanceof ResultsError) { apiError(res, error.status, error.message, { code: error.code }); return; }
    throw error;
  }
});
const param = (req: Request, name: string) => uuid.parse(String(req.params[name]));
async function operator(req: Request) {
  const id = param(req, "id");
  const [competition] = await db.select().from(tournaments).where(eq(tournaments.id, id));
  if (!competition) throw new ResultsError("Competition not found.", 404, "NOT_FOUND");
  if (!req.sessionUser || !(await canOperateCompetition(req.sessionUser, competition))) {
    throw new ResultsError("Only competition operators can manage results and tournament recaps.", 403, "COMPETITION_FORBIDDEN");
  }
  return competition;
}
const recapWhere = (id: string, recapId: string) => and(eq(competitionTournamentRecaps.competitionId, id), eq(competitionTournamentRecaps.id, recapId));
async function reviewedGroup(competitionId: string, importId: string, key: string) {
  const [snapshot] = await db.select().from(competitionResultImports).where(and(
    eq(competitionResultImports.id, importId), eq(competitionResultImports.competitionId, competitionId),
  ));
  const group = snapshot?.groups.find(g => g.key === key);
  if (!snapshot?.confirmed || !group?.bracketId) throw new ResultsError("Confirm reviewed results and bracket mappings before drafting.");
  const [bracket] = await db.select().from(competitionBrackets).where(and(eq(competitionBrackets.id, group.bracketId), eq(competitionBrackets.tournamentId, competitionId)));
  if (!bracket) throw new ResultsError("The reviewed bracket was removed. Import and map these results again.", 409, "RESULTS_STALE");
  return { snapshot, group, bracket };
}
function content(snapshot: typeof competitionResultImports.$inferSelect, group: ResultGroup, title: string, body: string): TournamentStoryContent {
  return { title, body, importId: snapshot.id, groupKey: group.key, sourceUrl: snapshot.sourceUrl, resultsAsOf: snapshot.resultsAsOf,
    partial: !group.complete || group.games.some(g => g.homeScore == null || g.awayScore == null) };
}
type Recap = typeof competitionTournamentRecaps.$inferSelect;
async function publicStories(competitionId: string, selected?: Recap[]) {
  const [competition] = await db.select().from(tournaments).where(eq(tournaments.id, competitionId));
  if (!competition) return { data: [], coverage: [], unattributedCoverage: [] };
  const [rows, brackets, coverage] = await Promise.all([
    selected ?? db.select().from(competitionTournamentRecaps).where(and(eq(competitionTournamentRecaps.competitionId, competitionId), isNotNull(competitionTournamentRecaps.published))),
    db.select().from(competitionBrackets).where(eq(competitionBrackets.tournamentId, competitionId)).orderBy(asc(competitionBrackets.sortOrder)),
    loadTournamentCoverage(competitionId),
  ]);
  return {
    data: rows.filter(r => r.published).map(r => {
      const b = brackets.find(x => x.id === r.bracketId);
      // Deliberately construct a public allowlist: never spread the managed row.
      return { id: r.id, competitionId, bracketId: r.bracketId, bracketLabel: b?.label ?? "Other", bracketOrder: b?.sortOrder ?? 9999,
        title: r.published!.title, body: r.published!.body, sourceUrl: r.published!.sourceUrl, resultsAsOf: r.published!.resultsAsOf,
        partial: r.published!.partial, publishedAt: r.publishedAt, updatedAt: r.publishedAt,
        competition: { id: competition.id, name: competition.name, slug: competition.slug, logoUrl: competition.logoUrl, brandColor: competition.brandColor, secondaryColor: competition.secondaryColor },
        coverage: coverage.filter(c => c.bracketId === r.bracketId),
      };
    }).sort((a, b) => a.bracketOrder - b.bracketOrder || a.id.localeCompare(b.id)),
    coverage: coverage.filter(c => c.bracketId != null),
    unattributedCoverage: coverage.filter(c => c.bracketId == null),
  };
}

router.get("/competitions/:id/results-workspace", requireAuth, handler(async (req, res) => {
  const competition = await operator(req);
  const [imports, recaps, brackets, participants] = await Promise.all([
    db.select().from(competitionResultImports).where(eq(competitionResultImports.competitionId, competition.id)).orderBy(desc(competitionResultImports.importedAt)).limit(30),
    db.select().from(competitionTournamentRecaps).where(eq(competitionTournamentRecaps.competitionId, competition.id)),
    db.select().from(competitionBrackets).where(eq(competitionBrackets.tournamentId, competition.id)).orderBy(asc(competitionBrackets.sortOrder)),
    db.select().from(tournamentParticipants).where(eq(tournamentParticipants.tournamentId, competition.id)),
  ]);
  res.json({ imports, recaps, brackets, participants: participants.map(p => ({
    id: p.id, name: p.name, gender: p.gender, age: p.age, division: p.division, bracket: p.bracket, bracketId: p.bracketId, teamId: p.teamId,
  })) });
}));

const IntakeBody = z.object({
  kind: z.enum(["url", "csv", "paste"]), url: z.string().trim().max(2000).optional(),
  text: z.string().max(500_000).optional(), clientId: uuid,
}).strict();
router.post("/competitions/:id/results-import", requireAuth, limiter, handler(async (req, res) => {
  const competition = await operator(req);
  const input = IntakeBody.parse(req.body);
  const [existing] = await db.select().from(competitionResultImports).where(and(eq(competitionResultImports.competitionId, competition.id), eq(competitionResultImports.clientId, input.clientId)));
  if (existing) { res.json(existing); return; }
  let result;
  try {
    result = input.kind === "url"
      ? await ingestResultsUrl(z.string().min(1).parse(input.url))
      : { ...parseResultsTable(z.string().min(1).parse(input.text)), sourceUrl: null };
  } catch (err) { throw new ResultsError(err instanceof Error ? err.message : "Could not read these results."); }
  const values = {
    competitionId: competition.id, clientId: input.clientId, kind: input.kind,
    sourceUrl: result.sourceUrl, status: result.status, message: result.message,
    groups: result.groups, resultsAsOf: new Date().toISOString(),
  };
  const [inserted] = await db.insert(competitionResultImports).values(values).onConflictDoNothing().returning();
  const [saved] = inserted ? [inserted] : await db.select().from(competitionResultImports).where(and(eq(competitionResultImports.competitionId, competition.id), eq(competitionResultImports.clientId, input.clientId)));
  res.json(saved);
}));

const ReviewBody = z.object({ groups: z.array(ResultGroupSchema).min(1).max(40), resultsAsOf: z.string().datetime(), confirmed: z.literal(true) }).strict();
router.patch("/competitions/:id/results-import/:importId", requireAuth, handler(async (req, res) => {
  const competition = await operator(req);
  const input = ReviewBody.parse(req.body), importId = param(req, "importId");
  const [snapshot] = await db.select().from(competitionResultImports).where(and(eq(competitionResultImports.id, importId), eq(competitionResultImports.competitionId, competition.id)));
  if (!snapshot) throw new ResultsError("Results import not found.", 404, "NOT_FOUND");
  if (snapshot.confirmed) throw new ResultsError("Confirmed snapshots are immutable. Create a new import for revised results.", 409, "RESULTS_CONFIRMED");
  if (snapshot.status === "blocked" || snapshot.status === "unsupported") throw new ResultsError("Blocked/unsupported sources cannot be confirmed. Use CSV or pasted results.");
  if (new Set(input.groups.map(g => g.key)).size !== input.groups.length ||
    input.groups.reduce((n, g) => n + g.games.length + g.standings.length, 0) > 1000) throw new ResultsError("Duplicate groups or too many result rows.");
  const selectedBrackets = input.groups.filter(g => g.bracketId).map(g => g.bracketId);
  if (!selectedBrackets.length || new Set(selectedBrackets).size !== selectedBrackets.length) {
    throw new ResultsError("Map at least one bracket; combine duplicate source groups before mapping them to the same Kinectem bracket.");
  }
  const [brackets, participants] = await Promise.all([
    db.select().from(competitionBrackets).where(eq(competitionBrackets.tournamentId, competition.id)),
    db.select().from(tournamentParticipants).where(eq(tournamentParticipants.tournamentId, competition.id)),
  ]);
  for (const g of input.groups) {
    if (g.bracketId && !brackets.some(b => b.id === g.bracketId)) throw new ResultsError("A mapped bracket does not belong to this competition.");
    if (!g.games.length && !g.standings.length) throw new ResultsError("A result group must contain games or standings.");
    if (new Set(g.games.map(x => x.id)).size !== g.games.length || new Set(g.standings.map(x => x.team)).size !== g.standings.length) throw new ResultsError("Duplicate game ids or standings team names. Distinguish group/gender identities explicitly.");
    const mappings = [...g.games.flatMap(x => [x.homeParticipantId, x.awayParticipantId]), ...g.standings.map(x => x.participantId)].filter(Boolean);
    if (mappings.some(id => !participants.some(p => p.id === id))) throw new ResultsError("A mapped participant does not belong to this competition.");
    if (g.complete && g.games.some(x => x.homeScore == null || x.awayScore == null)) throw new ResultsError("A bracket with missing scores cannot be marked complete.");
  }
  const [saved] = await db.update(competitionResultImports).set(input).where(and(eq(competitionResultImports.id, importId), eq(competitionResultImports.confirmed, false))).returning();
  if (!saved) throw new ResultsError("This snapshot was already confirmed in another session.", 409, "RESULTS_CONFIRMED");
  res.json(saved);
}));

const CreateBody = z.object({ importId: uuid, groupKey: z.string().max(200), title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(50000) }).strict();
router.post("/competitions/:id/tournament-recaps", requireAuth, handler(async (req, res) => {
  const competition = await operator(req);
  const input = CreateBody.parse(req.body);
  const { snapshot, group } = await reviewedGroup(competition.id, input.importId, input.groupKey);
  const [saved] = await db.insert(competitionTournamentRecaps).values({ competitionId: competition.id, bracketId: group.bracketId!, draft: content(snapshot, group, input.title, input.body) }).onConflictDoNothing().returning();
  if (!saved) throw new ResultsError("A recap already exists for this bracket. Edit its draft instead.", 409, "RECAP_EXISTS");
  res.status(201).json(saved);
}));

const GenerateBody = z.object({
  importId: uuid, groupKeys: z.array(z.string().max(200)).min(1).max(10),
  includeCoverage: z.boolean(), requestId: uuid, expectedRevisions: z.record(revision),
}).strict();
router.post("/competitions/:id/tournament-recaps/generate", requireAuth, aiLimiter, handler(async (req, res) => {
  const competition = await operator(req);
  const me = req.sessionUser!;
  // Explicit actor age boundary independent of fake team membership or admin
  // role shortcuts. No change to the existing team AI/COPPA gates.
  const under18 = me.dateOfBirth && me.dateOfBirth.getTime() > new Date(new Date().setUTCFullYear(new Date().getUTCFullYear() - 18)).getTime();
  if (me.isMinor || me.role === "athlete" || under18) throw new ResultsError("Tournament AI drafting is restricted to adult competition operators.", 403, "AI_FORBIDDEN");
  const input = GenerateBody.parse(req.body);
  const abort = new AbortController();
  const cancel = () => { if (!res.writableEnded) abort.abort(); };
  req.on("aborted", cancel); res.on("close", cancel);
  const data: Recap[] = [], errors: Array<{groupKey: string; error: string; code: string}> = [];
  let coverage: TournamentCoverage[] = [];
  if (input.includeCoverage) coverage = await loadTournamentCoverage(competition.id);
  try {
    for (const groupKey of [...new Set(input.groupKeys)]) {
      if (abort.signal.aborted) break;
      try {
        const { snapshot, group, bracket } = await reviewedGroup(competition.id, input.importId, groupKey);
        if (group.games.length + group.standings.length > 120) throw new ResultsError("AI drafting is limited to 120 results per bracket. Split the import or write a manual draft.");
        const [old] = await db.select().from(competitionTournamentRecaps).where(and(eq(competitionTournamentRecaps.competitionId, competition.id), eq(competitionTournamentRecaps.bracketId, bracket.id)));
        if (old?.generationRequestId === input.requestId) { data.push(old); continue; }
        const expected = input.expectedRevisions[bracket.id];
        if (expected === undefined || (old?.revision ?? 0) !== expected) throw new ResultsError("The draft changed. Reload before regenerating.", 409, "RECAP_STALE");
        const body = await generateTournamentRecapText({
          competitionName: competition.name, group,
          coverage: coverage.filter(c => c.bracketId === bracket.id).slice(0, 12).map(c => ({ title: c.title.slice(0, 200), teamName: c.teamName.slice(0, 200), summary: c.summary?.slice(0, 600) ?? null })),
        }, abort.signal);
        if (abort.signal.aborted) break;
        if (!body.trim() || body.length > 50_000) throw new ResultsError("Generated draft exceeded the editable text limit. Existing edits were kept.", 502, "AI_REQUEST_FAILED");
        const draft = content(snapshot, group, `${bracket.label} — ${group.complete ? "Tournament recap" : "Results so far"}`.slice(0, 200), body);
        // Atomically compare revisions AFTER AI returns; concurrent edits win.
        const saved = await db.transaction(async tx => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${competition.id + ":" + bracket.id}))`);
          const [live] = await tx.select().from(competitionTournamentRecaps).where(and(eq(competitionTournamentRecaps.competitionId, competition.id), eq(competitionTournamentRecaps.bracketId, bracket.id))).for("update");
          if (live?.generationRequestId === input.requestId) return live;
          if ((live?.revision ?? 0) !== expected) throw new ResultsError("Draft edited during generation. Your changes were kept.", 409, "RECAP_STALE");
          const [result] = live
            ? await tx.update(competitionTournamentRecaps).set({ draft, revision: live.revision + 1, generationRequestId: input.requestId, updatedAt: new Date() }).where(eq(competitionTournamentRecaps.id, live.id)).returning()
            : await tx.insert(competitionTournamentRecaps).values({ competitionId: competition.id, bracketId: bracket.id, draft, generationRequestId: input.requestId }).returning();
          return result;
        });
        data.push(saved);
      } catch (error) {
        if (abort.signal.aborted) break;
        const code = error instanceof AiNotConfiguredError ? "AI_NOT_CONFIGURED" : error instanceof ResultsError ? error.code : "AI_REQUEST_FAILED";
        errors.push({ groupKey, code, error: error instanceof AiNotConfiguredError || error instanceof ResultsError ? error.message : "AI drafting failed or returned an unsupported factual plan. Existing edits and publications were kept." });
        if (!(error instanceof ResultsError) && !(error instanceof AiNotConfiguredError)) req.log.warn({ err: error }, "Tournament draft failed");
      }
    }
    if (!abort.signal.aborted) res.json({ data, errors });
  } finally {
    req.off("aborted", cancel); res.off("close", cancel);
  }
}));

const EditBody = z.object({ title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(50000), expectedRevision: revision }).strict();
router.patch("/competitions/:id/tournament-recaps/:recapId", requireAuth, handler(async (req, res) => {
  const competition = await operator(req), recapId = param(req, "recapId");
  const input = EditBody.parse(req.body);
  const [old] = await db.select().from(competitionTournamentRecaps).where(recapWhere(competition.id, recapId));
  if (!old) throw new ResultsError("Recap not found.", 404, "NOT_FOUND");
  const [saved] = await db.update(competitionTournamentRecaps).set({
    draft: { ...old.draft, title: input.title, body: input.body }, revision: old.revision + 1, updatedAt: new Date(),
  }).where(and(recapWhere(competition.id, recapId), eq(competitionTournamentRecaps.revision, input.expectedRevision))).returning();
  if (!saved) throw new ResultsError("Draft changed in another session. Reload before saving.", 409, "RECAP_STALE");
  res.json(saved);
}));

for (const action of ["publish", "unpublish", "delete"] as const) {
  const path = `/competitions/:id/tournament-recaps/:recapId${action === "delete" ? "" : `/${action}`}`;
  router[action === "delete" ? "delete" : "post"](path, requireAuth, handler(async (req, res) => {
    const competition = await operator(req), recapId = param(req, "recapId");
    const input = z.object({ expectedRevision: revision }).strict().parse(req.body);
    const saved = await db.transaction(async tx => {
      const [old] = await tx.select().from(competitionTournamentRecaps).where(recapWhere(competition.id, recapId)).for("update");
      if (!old) throw new ResultsError("Recap not found.", 404, "NOT_FOUND");
      if (old.revision !== input.expectedRevision) throw new ResultsError("Recap changed. Reload before publishing or removing it.", 409, "RECAP_STALE");
      if (action === "delete") {
        await tx.delete(competitionTournamentRecaps).where(eq(competitionTournamentRecaps.id, recapId));
        return { ok: true };
      }
      if (action === "unpublish") {
        // Remove placements, not just their visibility. Re-publishing never
        // silently opts teams back in after a deliberate withdrawal.
        await tx.delete(competitionRecapPlacements).where(eq(competitionRecapPlacements.recapId, recapId));
      }
      const [result] = await tx.update(competitionTournamentRecaps).set({
        published: action === "publish" ? old.draft : null,
        publishedAt: action === "publish" ? new Date() : null,
        updatedAt: new Date(), revision: old.revision + 1,
      }).where(eq(competitionTournamentRecaps.id, recapId)).returning();
      return result;
    });
    res.json(saved);
  }));
}

router.get("/competitions/:id/tournament-recaps", handler(async (req, res) => {
  const id = param(req, "id");
  res.json(await publicStories(id));
}));
router.get("/competition-stories/:recapId", handler(async (req, res) => {
  const [row] = await db.select().from(competitionTournamentRecaps).where(and(eq(competitionTournamentRecaps.id, param(req, "recapId")), isNotNull(competitionTournamentRecaps.published)));
  if (!row) throw new ResultsError("Published tournament recap not found.", 404, "NOT_FOUND");
  const { data } = await publicStories(row.competitionId, [row]);
  res.json(data[0]);
}));

router.get("/competition-stories/:recapId/placement-options", requireAuth, handler(async (req, res) => {
  const recapId = param(req, "recapId");
  const [recap] = await db.select().from(competitionTournamentRecaps).where(and(eq(competitionTournamentRecaps.id, recapId), isNotNull(competitionTournamentRecaps.published)));
  if (!recap) throw new ResultsError("Published recap not found.", 404, "NOT_FOUND");
  const [linked, placements] = await Promise.all([
    db.select({ team: teams }).from(tournamentParticipants).innerJoin(teams, eq(tournamentParticipants.teamId, teams.id)).where(and(eq(tournamentParticipants.tournamentId, recap.competitionId), isNull(teams.archivedAt))),
    db.select().from(competitionRecapPlacements).where(eq(competitionRecapPlacements.recapId, recapId)),
  ]);
  const data = [];
  const visited = new Set<string>();
  for (const { team } of linked) {
    if (!visited.has(team.id) && await canManageTeam(req.sessionUser!.id, team)) {
      data.push({ teamId: team.id, teamName: team.name, placed: placements.some(p => p.teamId === team.id) });
    }
    visited.add(team.id);
  }
  res.json({ data });
}));

for (const method of ["put", "delete"] as const) {
  router[method]("/competition-stories/:recapId/placements/:teamId", requireAuth, handler(async (req, res) => {
    const recapId = param(req, "recapId"), teamId = param(req, "teamId");
    await db.transaction(async tx => {
      const [recap] = await tx.select().from(competitionTournamentRecaps).where(eq(competitionTournamentRecaps.id, recapId)).for("update");
      if (!recap?.published) throw new ResultsError("Published recap not found.", 404, "NOT_FOUND");
      const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
      if (!team || team.archivedAt || !(await canManageTeam(req.sessionUser!.id, team))) throw new ResultsError("Only this team's managers may change its placements.", 403, "TEAM_FORBIDDEN");
      const [slot] = await tx.select().from(tournamentParticipants).where(and(eq(tournamentParticipants.tournamentId, recap.competitionId), eq(tournamentParticipants.teamId, teamId))).for("update");
      // Removing a stale placement stays possible even after the team is unlinked.
      if (!slot && method === "put") throw new ResultsError("This team is not explicitly linked to a participating slot.", 403, "PARTICIPANT_REQUIRED");
      if (method === "put") await tx.insert(competitionRecapPlacements).values({ recapId, teamId }).onConflictDoNothing();
      else await tx.delete(competitionRecapPlacements).where(and(eq(competitionRecapPlacements.recapId, recapId), eq(competitionRecapPlacements.teamId, teamId)));
    });
    res.json({ ok: true });
  }));
}
router.get("/teams/:teamId/tournament-recaps", handler(async (req, res) => {
  const teamId = param(req, "teamId");
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team || team.archivedAt) { res.json({ data: [] }); return; }
  const rows = await db.select({ recap: competitionTournamentRecaps }).from(competitionRecapPlacements)
    .innerJoin(competitionTournamentRecaps, eq(competitionTournamentRecaps.id, competitionRecapPlacements.recapId))
    .where(and(eq(competitionRecapPlacements.teamId, teamId), isNotNull(competitionTournamentRecaps.published),
      sql`EXISTS (SELECT 1 FROM tournament_participants tp WHERE tp.tournament_id = "competition_tournament_recaps"."competition_id" AND tp.team_id = ${teamId})`))
    .orderBy(desc(competitionTournamentRecaps.publishedAt));
  const data = [];
  for (const competitionId of [...new Set(rows.map(r => r.recap.competitionId))]) {
    data.push(...(await publicStories(competitionId, rows.filter(r => r.recap.competitionId === competitionId).map(r => r.recap))).data);
  }
  data.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || a.id.localeCompare(b.id));
  res.json({ data });
}));

export default router;
