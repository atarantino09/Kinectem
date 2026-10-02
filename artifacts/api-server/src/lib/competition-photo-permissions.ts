import {
  db,
  competitionAdmins,
  competitionOrganizers,
  guardianLinks,
  organizerAdmins,
  organizationAdmins,
  rosterEntries,
  teams,
  tournamentParticipants,
  tournaments,
  users,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { canOperateCompetition } from "./competition-permissions";

export type CompetitionRow = typeof tournaments.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;

export async function getCompetitionPhotoOwnerId(competition: CompetitionRow): Promise<string | null> {
  if (competition.ownerUserId) return competition.ownerUserId;
  if (!competition.createdById) return null;
  const [creator] = await db.select({ id: users.id, role: users.role })
    .from(users).where(eq(users.id, competition.createdById)).limit(1);
  // Legacy customer creators retain ownership; an ownerless support-created
  // record must not turn support access into automatic publication or alerts.
  return creator && creator.role !== "admin" ? creator.id : null;
}

export async function isRealCompetitionAdmin(
  userId: string,
  competition: CompetitionRow,
): Promise<boolean> {
  if (
    (await getCompetitionPhotoOwnerId(competition)) === userId
  ) return true;
  const [direct] = await db
    .select({ userId: competitionAdmins.userId })
    .from(competitionAdmins)
    .where(and(
      eq(competitionAdmins.competitionId, competition.id),
      eq(competitionAdmins.userId, userId),
    ))
    .limit(1);
  if (direct) return true;
  if (!competition.organizerId) return false;
  const [hub] = await db
    .select({ ownerUserId: competitionOrganizers.ownerUserId })
    .from(competitionOrganizers)
    .where(eq(competitionOrganizers.id, competition.organizerId))
    .limit(1);
  if (hub?.ownerUserId === userId) return true;
  const [hubAdmin] = await db
    .select({ userId: organizerAdmins.userId })
    .from(organizerAdmins)
    .where(and(
      eq(organizerAdmins.organizerId, competition.organizerId),
      eq(organizerAdmins.userId, userId),
    ))
    .limit(1);
  return Boolean(hubAdmin);
}

export async function canReviewCompetitionPhotos(
  user: { id: string; role: string },
  competition: CompetitionRow,
): Promise<boolean> {
  // Existing support operators retain review capability, but do not gain
  // contribution/upload privileges without an actual relationship.
  return canOperateCompetition(user, competition);
}

export async function getParticipatingTeams(competitionId: string) {
  return db
    .select({
      id: teams.id,
      name: teams.name,
      organizationId: teams.organizationId,
      createdById: teams.createdById,
    })
    .from(tournamentParticipants)
    .innerJoin(teams, eq(teams.id, tournamentParticipants.teamId))
    .where(eq(tournamentParticipants.tournamentId, competitionId));
}

export async function isParticipatingTeam(
  competitionId: string,
  teamId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: tournamentParticipants.id })
    .from(tournamentParticipants)
    .where(and(
      eq(tournamentParticipants.tournamentId, competitionId),
      eq(tournamentParticipants.teamId, teamId),
    ))
    .limit(1);
  return Boolean(row);
}

// Accept only claimed/linkable participant teams. Team membership is based
// on accepted roster entries, active guardians of accepted roster members,
// coaches/team creators, and explicit organization owner/admin memberships.
export async function canContributeForTeam(
  userId: string,
  teamId: string,
): Promise<boolean> {
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) return false;
  if (team.createdById === userId) return true;

  const [roster] = await db
    .select({ id: rosterEntries.id })
    .from(rosterEntries)
    .where(and(
      eq(rosterEntries.teamId, teamId),
      eq(rosterEntries.userId, userId),
      eq(rosterEntries.status, "accepted"),
    ))
    .limit(1);
  if (roster) return true;

  const [guardian] = await db
    .select({ id: guardianLinks.id })
    .from(rosterEntries)
    .innerJoin(guardianLinks, eq(guardianLinks.childId, rosterEntries.userId))
    .where(and(
      eq(rosterEntries.teamId, teamId),
      eq(rosterEntries.status, "accepted"),
      eq(guardianLinks.guardianId, userId),
      eq(guardianLinks.status, "active"),
    ))
    .limit(1);
  if (guardian) return true;

  if (team.organizationId) {
    const [organizationManager] = await db
      .select({ userId: organizationAdmins.userId })
      .from(organizationAdmins)
      .where(and(
        eq(organizationAdmins.organizationId, team.organizationId),
        eq(organizationAdmins.userId, userId),
        inArray(organizationAdmins.role, ["owner", "admin"]),
      ))
      .limit(1);
    if (organizationManager) return true;
  }
  return false;
}

export async function validatePhotoTeamIds(
  competitionId: string,
  userId: string,
  teamIds: string[],
  isAdmin: boolean,
): Promise<boolean> {
  if (teamIds.length > 30 || new Set(teamIds).size !== teamIds.length) return false;
  for (const teamId of teamIds) {
    if (!(await isParticipatingTeam(competitionId, teamId))) return false;
    if (!isAdmin && !(await canContributeForTeam(userId, teamId))) return false;
  }
  return true;
}

export async function canContributeToCompetition(
  userId: string,
  competitionId: string,
): Promise<boolean> {
  const participantTeams = await getParticipatingTeams(competitionId);
  for (const team of participantTeams) {
    if (await canContributeForTeam(userId, team.id)) return true;
  }
  return false;
}