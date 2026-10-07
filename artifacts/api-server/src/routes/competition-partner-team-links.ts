import { Router, type IRouter } from "express";
import {
  db, tournaments, tournamentParticipants, teams, organizations,
  partnerLandingPages, partnerOrganizationMemberships,
} from "@workspace/db";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../lib/auth";
import { asyncHandler } from "../lib/async-handler";
import { apiError } from "../lib/spec-helpers";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { partnerTeamSuggestionScore } from "../lib/partner-team-suggestion-score";
import { rankTeamSuggestions } from "../lib/partner-team-suggestions";

const router: IRouter = Router();
const uuid = z.string().uuid();
const optionsCursorSchema = z.object({
  scope: z.string().max(1024),
  organizationName: z.string().max(2000),
  organizationId: uuid,
  name: z.string().max(2000),
  id: uuid,
});
const bodySchema = z.object({
  pageId: uuid,
  assignments: z.array(z.object({
    participantId: uuid,
    teamId: uuid,
    nameMismatchAcknowledged: z.boolean().default(false),
  })).min(1).max(100),
}).superRefine((body, ctx) => {
  for (const field of ["teamId", "participantId"] as const) {
    if (new Set(body.assignments.map((item) => item[field])).size !== body.assignments.length) {
      ctx.addIssue({ code: "custom", message: `Each ${field} can only be selected once.` });
    }
  }
});
const writeLimiter = rateLimit({
  name: "admin-partner-team-links", windowMs: 60 * 60 * 1000, max: 120,
  keys: (req) => [ipKey(req)],
  message: "Too many linking requests. Please wait a moment and try again.",
});

function namesMatch(a: string, b: string) {
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const left = norm(a);
  const right = norm(b);
  return !!left && !!right && (left === right || left.includes(right) || right.includes(left));
}

router.get(
  "/admin/competitions/:competitionId/partner-team-clubs",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const competitionId = String(req.params.competitionId);
    const pageId = String(req.query.pageId ?? "");
    if (!uuid.safeParse(competitionId).success || !uuid.safeParse(pageId).success) {
      return apiError(res, 400, "Select a valid competition and partner directory.");
    }
    const [competition] = await db.select({ id: tournaments.id }).from(tournaments)
      .where(eq(tournaments.id, competitionId)).limit(1);
    const [page] = await db.select({ id: partnerLandingPages.id }).from(partnerLandingPages)
      .where(eq(partnerLandingPages.id, pageId)).limit(1);
    if (!competition) return apiError(res, 404, "Competition not found");
    if (!page) return apiError(res, 404, "Partner directory not found");
    // This lightweight club list is independent of the capped team search.
    // Return all clubs with active team pages, including ownerless clubs.
    const clubs = await db.select({
      id: organizations.id, name: organizations.name,
      city: organizations.city, state: organizations.state,
      teamCount: sql<number>`count(*)::int`,
    }).from(organizations)
      .innerJoin(partnerOrganizationMemberships, and(
        eq(partnerOrganizationMemberships.organizationId, organizations.id),
        eq(partnerOrganizationMemberships.partnerPageId, pageId),
      ))
      .innerJoin(teams, and(eq(teams.organizationId, organizations.id), isNull(teams.archivedAt)))
      .groupBy(organizations.id, organizations.name, organizations.city, organizations.state)
      .orderBy(asc(organizations.name), asc(organizations.id));
    return res.json({ data: clubs });
  }),
);

router.get(
  "/admin/competitions/:competitionId/partner-team-options",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const competitionId = String(req.params.competitionId);
    const pageId = String(req.query.pageId ?? "");
    const organizationId = req.query.organizationId;
    const suggestedFor = req.query.suggestedFor;
    if (suggestedFor !== undefined && (!uuid.safeParse(suggestedFor).success ||
        organizationId !== undefined || req.query.q !== undefined || req.query.cursor !== undefined ||
        req.query.suggestFor !== undefined)) {
      return apiError(res, 400, "Suggestions require a valid competition team and the whole partner directory.");
    }
    if (!uuid.safeParse(competitionId).success || !uuid.safeParse(pageId).success) {
      return apiError(res, 400, "Select a valid competition and partner directory.");
    }
    if (organizationId !== undefined && !uuid.safeParse(organizationId).success) {
      return apiError(res, 400, "Select a valid club.");
    }
    const [competition] = await db.select({ id: tournaments.id }).from(tournaments)
      .where(eq(tournaments.id, competitionId)).limit(1);
    const [page] = await db.select({ id: partnerLandingPages.id }).from(partnerLandingPages)
      .where(eq(partnerLandingPages.id, pageId)).limit(1);
    if (!competition) return apiError(res, 404, "Competition not found");
    if (!page) return apiError(res, 404, "Partner directory not found");
    let suggestedIds: string[] | undefined;
    if (typeof suggestedFor === "string") {
      const [participant] = await db.select({ name: tournamentParticipants.name }).from(tournamentParticipants)
        .where(and(eq(tournamentParticipants.id, suggestedFor),
          eq(tournamentParticipants.tournamentId, competitionId))).limit(1);
      if (!participant) return apiError(res, 404, "Competition team not found.");
      // The directory-wide UI ranks all names before hydrating its shortlist.
      // Keep the existing suggestFor/club-filter API below compatible with its callers.
      const candidates = await db.select({ id: teams.id, name: teams.name }).from(teams)
        .innerJoin(partnerOrganizationMemberships, and(
          eq(partnerOrganizationMemberships.organizationId, teams.organizationId),
          eq(partnerOrganizationMemberships.partnerPageId, pageId),
        ));
      suggestedIds = rankTeamSuggestions(participant.name, candidates).map((team) => team.id);
      if (!suggestedIds.length) return res.json({ data: [], hasMore: false, nextCursor: null });
    }
    if (typeof organizationId === "string") {
      const [membership] = await db.select({ id: partnerOrganizationMemberships.id })
        .from(partnerOrganizationMemberships).where(and(
          eq(partnerOrganizationMemberships.partnerPageId, pageId),
          eq(partnerOrganizationMemberships.organizationId, organizationId),
        )).limit(1);
      if (!membership) return apiError(res, 404, "Club is not in this partner directory.");
    }
    const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
    const suggestFor = req.query.suggestFor;
    let score: ReturnType<typeof partnerTeamSuggestionScore> | undefined;
    if (suggestFor !== undefined) {
      const sourceId = uuid.safeParse(suggestFor);
      if (!sourceId.success || req.query.cursor !== undefined || search) {
        return apiError(res, 400, "Select a valid competition team for suggestions without search or continuation.");
      }
      const [source] = await db.select().from(tournamentParticipants).where(and(
        eq(tournamentParticipants.id, sourceId.data),
        eq(tournamentParticipants.tournamentId, competitionId),
      )).limit(1);
      if (!source || source.hiddenAt || source.teamId || source.pendingTeamId) {
        return apiError(res, 404, "Competition team is no longer available for matching.");
      }
      score = partnerTeamSuggestionScore(source.name, sql`teams.name`, sql`organizations.name`);
    }
    const scope = JSON.stringify([competitionId, pageId, organizationId ?? "", search]);
    let cursor: z.infer<typeof optionsCursorSchema> | undefined;
    if (req.query.cursor !== undefined) {
      const token = req.query.cursor;
      if (typeof token !== "string" || token.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(token)) {
        return apiError(res, 400, "Invalid team list continuation.");
      }
      try {
        const parsed = optionsCursorSchema.safeParse(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
        if (!parsed.success || parsed.data.scope !== scope) {
          return apiError(res, 400, "Team list continuation does not match these filters.");
        }
        cursor = parsed.data;
      } catch {
        return apiError(res, 400, "Invalid team list continuation.");
      }
    }
    const escapedSearch = search.replace(/[\\%_]/g, "\\$&");
    const rows = await db.select({
      id: teams.id, name: teams.name, gender: teams.gender,
      level: teams.level, organizationId: organizations.id,
      organizationName: organizations.name, city: organizations.city, state: organizations.state,
      archivedAt: teams.archivedAt,
      slotStatus: sql<"linked" | "pending" | null>`(
        SELECT CASE WHEN tp.team_id = teams.id THEN 'linked' ELSE 'pending' END
        FROM tournament_participants tp
        WHERE tp.tournament_id = ${competitionId}
          AND (tp.team_id = teams.id OR tp.pending_team_id = teams.id)
        LIMIT 1
      )`,
    }).from(teams)
      .innerJoin(organizations, eq(organizations.id, teams.organizationId))
      .innerJoin(partnerOrganizationMemberships, and(
        eq(partnerOrganizationMemberships.organizationId, organizations.id),
        eq(partnerOrganizationMemberships.partnerPageId, pageId),
      ))
      .where(and(
        suggestedIds ? inArray(teams.id, suggestedIds) : undefined,
        score ? sql`${score} >= 40` : undefined,
        typeof organizationId === "string" ? eq(teams.organizationId, organizationId) : undefined,
        cursor ? sql`(organizations.name, organizations.id, teams.name, teams.id) >
          (${cursor.organizationName}, ${cursor.organizationId}::uuid, ${cursor.name}, ${cursor.id}::uuid)` : undefined,
        search ? or(
          ilike(teams.name, `%${escapedSearch}%`),
          ilike(organizations.name, `%${escapedSearch}%`),
        ) : undefined,
      ))
      .orderBy(...(score ? [desc(score)] : []), asc(organizations.name), asc(organizations.id), asc(teams.name), asc(teams.id))
      .limit(score ? 6 : 201);
    if (score) {
      return res.json({
        data: rows.slice(0, 5).map(({ archivedAt, ...team }) => ({
          ...team, ageGroup: null, archived: archivedAt != null,
        })),
        hasMoreMatches: rows.length > 5,
      });
    }
    const data = suggestedIds
      ? rows.sort((a, b) => suggestedIds.indexOf(a.id) - suggestedIds.indexOf(b.id))
      : rows.slice(0, 200);
    const last = data.at(-1);
    const hasMore = rows.length > 200;
    return res.json({
      data: data.map(({ archivedAt, ...team }) => ({
        ...team, ageGroup: null, archived: archivedAt != null,
      })),
      hasMore,
      nextCursor: hasMore && last ? Buffer.from(JSON.stringify({
        scope, organizationName: last.organizationName,
        organizationId: last.organizationId, name: last.name, id: last.id,
      })).toString("base64url") : null,
    });
  }),
);

type Assignment = z.infer<typeof bodySchema>["assignments"][number];
class LinkConflict extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

async function linkTeam(competitionId: string, pageId: string, assignment: Assignment, userId: string) {
  return db.transaction(async (tx) => {
    // Hold directory membership and team eligibility stable until the link commits.
    // SHARE permits parallel links, but blocks directory deletion/replacement.
    const [page] = await tx.select({ id: partnerLandingPages.id }).from(partnerLandingPages)
      .where(eq(partnerLandingPages.id, pageId)).for("share").limit(1);
    if (!page) throw new LinkConflict("PAGE_NOT_FOUND", "Partner directory no longer exists.");
    // Same advisory key as ordinary coach/org-admin claims: one slot per team.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${competitionId}), hashtext(${assignment.teamId}))`);
    const [team] = await tx.select().from(teams)
      .where(eq(teams.id, assignment.teamId)).for("share").limit(1);
    if (!team || !team.organizationId) {
      throw new LinkConflict("TEAM_NOT_IN_DIRECTORY", "That team is not in this partner directory.");
    }
    const [membership] = await tx.select({ id: partnerOrganizationMemberships.id })
      .from(partnerOrganizationMemberships).where(and(
        eq(partnerOrganizationMemberships.partnerPageId, pageId),
        eq(partnerOrganizationMemberships.organizationId, team.organizationId),
      )).for("share").limit(1);
    if (!membership) throw new LinkConflict("TEAM_NOT_IN_DIRECTORY", "That team is no longer in this partner directory.");
    if (team.archivedAt) throw new LinkConflict("TEAM_ARCHIVED", "Archived teams cannot be linked.");
    const [participant] = await tx.select().from(tournamentParticipants).where(and(
      eq(tournamentParticipants.id, assignment.participantId),
      eq(tournamentParticipants.tournamentId, competitionId),
    )).limit(1);
    if (!participant || participant.hiddenAt) {
      throw new LinkConflict("SLOT_UNAVAILABLE", "This competition slot is missing or hidden.");
    }
    if (participant.teamId) throw new LinkConflict("ALREADY_CLAIMED", "This competition slot is already linked. No changes were made.");
    if (participant.pendingTeamId) throw new LinkConflict("CLAIM_PENDING", "This slot has a pending claim. Review that claim first.");
    const [alreadyIn] = await tx.select({ id: tournamentParticipants.id }).from(tournamentParticipants)
      .where(and(eq(tournamentParticipants.tournamentId, competitionId), or(
        eq(tournamentParticipants.teamId, team.id), eq(tournamentParticipants.pendingTeamId, team.id),
      ))).limit(1);
    if (alreadyIn) throw new LinkConflict("TEAM_ALREADY_IN_COMPETITION", "That team already has a linked slot or a pending claim in this competition.");
    if (!namesMatch(participant.name, team.name) && !assignment.nameMismatchAcknowledged) {
      throw new LinkConflict("NAME_MISMATCH_ACKNOWLEDGEMENT_REQUIRED", `Confirm that ${participant.name} is the competition slot for ${team.name}.`);
    }
    // Immediate support linking is intentionally separate from claim approval.
    // Do not create owners, staff, followers, invites, or copied schedule events.
    const [linked] = await tx.update(tournamentParticipants).set({
      teamId: team.id, claimedByUserId: userId, claimedAt: new Date(),
    }).where(and(
      eq(tournamentParticipants.id, participant.id),
      eq(tournamentParticipants.tournamentId, competitionId),
      isNull(tournamentParticipants.teamId), isNull(tournamentParticipants.pendingTeamId),
      isNull(tournamentParticipants.hiddenAt),
    )).returning({ id: tournamentParticipants.id });
    if (!linked) throw new LinkConflict("SLOT_CHANGED", "This slot was claimed or changed while you were linking it. Refresh and review.");
  });
}

router.post(
  "/admin/competitions/:competitionId/partner-team-links",
  requireAdmin, writeLimiter,
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const competitionId = String(req.params.competitionId);
    if (!uuid.safeParse(competitionId).success) return apiError(res, 400, "Invalid competition.");
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid matches.");
    const [competition] = await db.select({ id: tournaments.id }).from(tournaments)
      .where(eq(tournaments.id, competitionId)).limit(1);
    if (!competition) return apiError(res, 404, "Competition not found");
    const results = [];
    for (const assignment of parsed.data.assignments) {
      try {
        await linkTeam(competitionId, parsed.data.pageId, assignment, req.sessionUser!.id);
        results.push({ participantId: assignment.participantId, teamId: assignment.teamId, ok: true });
      } catch (error) {
        if (!(error instanceof LinkConflict)) throw error;
        results.push({
          participantId: assignment.participantId, teamId: assignment.teamId, ok: false,
          code: error.code, message: error.message,
        });
      }
    }
    const succeeded = results.filter((result) => result.ok).length;
    return res.json({ ok: succeeded === results.length, succeeded, failed: results.length - succeeded, results });
  }),
);

export default router;
