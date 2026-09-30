import { db, coachInviteGroups, organizationAdmins, rosterEntries, rosterInvites, users } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export type RosterTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Lock the team, rather than a roster row that may not yet exist. All add/invite
// writers take this lock before checking, so simultaneous submissions serialize.
export async function lockRosterTeam(tx: RosterTx, teamId: string) {
  await tx.execute(sql`SELECT id FROM teams WHERE id = ${teamId} FOR UPDATE`);
}

export async function findRosterEntry(tx: RosterTx, teamId: string, userId: string) {
  const [entry] = await tx.select().from(rosterEntries).where(and(
    eq(rosterEntries.teamId, teamId), eq(rosterEntries.userId, userId),
  )).orderBy(sql`CASE WHEN status = 'accepted' THEN 0 ELSE 1 END`).limit(1);
  return entry;
}

export async function findAccountByEmail(tx: RosterTx, email: string) {
  const [user] = await tx.select().from(users)
    .where(sql`lower(btrim(${users.email})) = ${email.toLowerCase().trim()}`).limit(1);
  return user;
}

export async function findPendingInvite(
  tx: RosterTx, teamId: string, email: string, role: "coach" | "player",
) {
  const [invite] = await tx.select().from(rosterInvites).where(and(
    eq(rosterInvites.teamId, teamId),
    eq(rosterInvites.status, "pending"),
    eq(rosterInvites.role, role),
    sql`lower(btrim(${rosterInvites.invitedEmail})) = ${email.toLowerCase().trim()}`,
  )).limit(1);
  return invite;
}

// Resolve only invitations addressed to this account on this team. Keep
// accepted roster entries untouched; leave groups with other pending children
// actionable, and close empty groups so their links cannot grant a new role.
export async function revokeRedundantInvites(
  tx: RosterTx, teamId: string, email: string, role: "coach" | "player" = "coach",
) {
  const revoked = await tx.update(rosterInvites).set({ status: "revoked" }).where(and(
    eq(rosterInvites.teamId, teamId),
    eq(rosterInvites.status, "pending"),
    eq(rosterInvites.role, role),
    sql`lower(btrim(${rosterInvites.invitedEmail})) = ${email.toLowerCase().trim()}`,
  )).returning({ groupId: rosterInvites.coachInviteGroupId });
  for (const groupId of new Set(revoked.map((row) => row.groupId).filter((id): id is string => !!id))) {
    const [remaining] = await tx.select({ id: rosterInvites.id }).from(rosterInvites)
      .where(and(eq(rosterInvites.coachInviteGroupId, groupId), eq(rosterInvites.status, "pending"))).limit(1);
    if (!remaining) {
      await tx.update(coachInviteGroups).set({ status: "revoked", updatedAt: new Date() })
        .where(and(eq(coachInviteGroups.id, groupId), eq(coachInviteGroups.status, "pending")));
    }
  }
}

export async function isOrganizationManager(userId: string, organizationId: string | null) {
  if (!organizationId) return false;
  // Platform-wide admin bypass must not auto-approve an operator's self-add.
  const [membership] = await db.select({ role: organizationAdmins.role })
    .from(organizationAdmins)
    .where(and(eq(organizationAdmins.organizationId, organizationId), eq(organizationAdmins.userId, userId)))
    .limit(1);
  return membership?.role === "owner" || membership?.role === "admin";
}