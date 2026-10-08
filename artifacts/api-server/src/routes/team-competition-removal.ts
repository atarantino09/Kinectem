import { Router } from "express";
import { z } from "zod";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, teams, tournaments, tournamentParticipants, tournamentMatches, teamHiddenCompetitionGames } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { asyncHandler } from "../lib/async-handler";
import { apiError } from "../lib/spec-helpers";
import { canManageTeam } from "../lib/permissions";
import { rateLimit, ipKey } from "../middlewares/rate-limit";

const router = Router();
const writeLimiter = rateLimit({
  name: "team-competition-removal", windowMs: 60_000, max: 30,
  keys: (req) => [req.sessionUser?.id ?? ipKey(req)],
  message: "Too many removal requests. Please wait a moment and try again.",
});
const confirmation = z.object({
  reviewed: z.literal(true),
  confirmation: z.literal("REMOVE"),
  assignments: z.array(z.object({
    participantId: z.string().uuid(),
    claimedAt: z.string().datetime().nullable(),
  })).min(1).max(100),
});

class RemovalConflict extends Error {
  constructor(public status: number, message: string) { super(message); }
}

router.post(
  "/teams/:teamId/competitions/:competitionId/remove",
  requireAuth,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const teamId = String(req.params.teamId);
    const competitionId = String(req.params.competitionId);
    const parsed = confirmation.extend({ matchId: z.string().uuid().optional() }).safeParse(req.body);
    if (!z.string().uuid().safeParse(teamId).success || !z.string().uuid().safeParse(competitionId).success || !parsed.success) {
      return apiError(res, 400, "Review the removal and type REMOVE to confirm.");
    }
    const input = parsed.data;
    // Reject unrelated actors before they can acquire competition-wide locks.
    const [initialTeam] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!initialTeam) return apiError(res, 404, "Team not found.");
    if (!(await canManageTeam(req.sessionUser!.id, initialTeam))) {
      return apiError(res, 403, "Only this team's coaches and organization admins can remove schedules.");
    }
    try {
      const result = await db.transaction(async (tx) => {
        // Match import/clear and ordinary/support claims use these same keys.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`competition-clear:${competitionId}`}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${competitionId}), hashtext(${teamId}))`);
        const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("share").limit(1);
        if (!team) throw new RemovalConflict(404, "Team not found.");
        if (!(await canManageTeam(req.sessionUser!.id, team))) {
          throw new RemovalConflict(403, "Only this team's coaches and organization admins can remove schedules.");
        }
        const [competition] = await tx.select().from(tournaments).where(eq(tournaments.id, competitionId)).limit(1);
        if (!competition) throw new RemovalConflict(404, "Competition not found.");
        const linked = await tx.select().from(tournamentParticipants).where(and(
          eq(tournamentParticipants.tournamentId, competitionId),
          eq(tournamentParticipants.teamId, teamId),
        )).for("update");
        const expected = new Map(input.assignments.map((p) => [p.participantId, p.claimedAt]));
        if (!linked.length || expected.size !== input.assignments.length || expected.size !== linked.length ||
          linked.some((p) => !expected.has(p.id) || expected.get(p.id) !== (p.claimedAt?.toISOString() ?? null))) {
          throw new RemovalConflict(409, "This schedule assignment changed. Refresh and review it again; nothing was removed.");
        }
        if (linked.some((p) => p.pendingTeamId)) {
          throw new RemovalConflict(409, "This entry has a pending claim. Ask the competition administrator to review it first.");
        }
        if (input.matchId) {
          const ids = linked.map((p) => p.id);
          const [match] = await tx.select().from(tournamentMatches).where(and(
            eq(tournamentMatches.id, input.matchId),
            eq(tournamentMatches.tournamentId, competitionId),
            or(inArray(tournamentMatches.homeParticipantId, ids), inArray(tournamentMatches.awayParticipantId, ids)),
          )).for("share").limit(1);
          if (!match) throw new RemovalConflict(404, "Game not found for this team's competition schedule.");
          await tx.insert(teamHiddenCompetitionGames).values({
            teamId, competitionGameId: match.id, hiddenByUserId: req.sessionUser!.id, removed: true,
          }).onConflictDoUpdate({
            target: [teamHiddenCompetitionGames.teamId, teamHiddenCompetitionGames.competitionGameId],
            set: { removed: true, hiddenByUserId: req.sessionUser!.id },
          });
          return { ok: true, scope: "game", competitionSlug: competition.slug };
        }
        await tx.update(tournamentParticipants).set({
          teamId: null, claimedByUserId: null, claimedAt: null,
          pendingTeamId: null, pendingClaimedByUserId: null, pendingClaimedAt: null,
        }).where(and(
          eq(tournamentParticipants.tournamentId, competitionId),
          eq(tournamentParticipants.teamId, teamId),
          inArray(tournamentParticipants.id, linked.map((p) => p.id)),
        ));
        // A future deliberate re-claim starts with the complete original schedule.
        const competitionGames = tx.select({ id: tournamentMatches.id }).from(tournamentMatches)
          .where(eq(tournamentMatches.tournamentId, competitionId));
        await tx.delete(teamHiddenCompetitionGames).where(and(
          eq(teamHiddenCompetitionGames.teamId, teamId),
          inArray(teamHiddenCompetitionGames.competitionGameId, competitionGames),
        ));
        return { ok: true, scope: "competition", competitionSlug: competition.slug, releasedNames: linked.map((p) => p.name) };
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof RemovalConflict) return apiError(res, error.status, error.message);
      throw error;
    }
  }),
);

export default router;
