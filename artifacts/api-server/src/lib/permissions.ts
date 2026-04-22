import { db, organizationAdmins, rosterEntries, teams, type teams as TeamsT } from "@workspace/db";
import { and, eq } from "drizzle-orm";

type Team = typeof TeamsT.$inferSelect;

export async function canManageTeam(userId: string, team: Team): Promise<boolean> {
  const [orgAdmin] = await db
    .select()
    .from(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.organizationId, team.organizationId),
        eq(organizationAdmins.userId, userId),
      ),
    )
    .limit(1);
  if (orgAdmin) return true;

  const [coachEntry] = await db
    .select()
    .from(rosterEntries)
    .where(
      and(
        eq(rosterEntries.teamId, team.id),
        eq(rosterEntries.userId, userId),
        eq(rosterEntries.role, "coach"),
        eq(rosterEntries.status, "accepted"),
      ),
    )
    .limit(1);
  return Boolean(coachEntry);
}

export async function canManageOrganization(userId: string, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.organizationId, organizationId),
        eq(organizationAdmins.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(rosterEntries)
    .where(
      and(
        eq(rosterEntries.teamId, teamId),
        eq(rosterEntries.userId, userId),
        eq(rosterEntries.status, "accepted"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function canCreateRecap(
  userId: string,
  team: Team,
): Promise<boolean> {
  // Org admins and team coaches can always author recaps.
  if (await canManageTeam(userId, team)) return true;
  // Parents/members granted the explicit "author" position can also author.
  const [authorEntry] = await db
    .select()
    .from(rosterEntries)
    .where(
      and(
        eq(rosterEntries.teamId, team.id),
        eq(rosterEntries.userId, userId),
        eq(rosterEntries.status, "accepted"),
        eq(rosterEntries.position, "author"),
      ),
    )
    .limit(1);
  return Boolean(authorEntry);
}

export async function isOrgMember(userId: string, organizationId: string): Promise<boolean> {
  if (await canManageOrganization(userId, organizationId)) return true;
  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .innerJoin(rosterEntries, eq(rosterEntries.teamId, teams.id))
    .where(
      and(
        eq(teams.organizationId, organizationId),
        eq(rosterEntries.userId, userId),
        eq(rosterEntries.status, "accepted"),
      ),
    )
    .limit(1);
  return Boolean(row);
}
