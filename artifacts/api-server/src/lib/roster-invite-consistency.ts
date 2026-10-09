import { db, coachInviteGroups, organizationAdmins, rosterEntries, rosterInvites, teams, users } from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

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
  invitedById?: string,
) {
  const revoked = await tx.update(rosterInvites).set({ status: "revoked" }).where(and(
    eq(rosterInvites.teamId, teamId),
    eq(rosterInvites.status, "pending"),
    eq(rosterInvites.role, role),
    invitedById ? eq(rosterInvites.invitedById, invitedById) : undefined,
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

// Self-invites identify the admin personally, including player assignments.
// Never revoke somebody else's parent-facing player invitation to that email.
export async function revokeSelfInvites(tx: RosterTx, teamId: string, email: string, userId: string) {
  await revokeRedundantInvites(tx, teamId, email, "coach", userId);
  await revokeRedundantInvites(tx, teamId, email, "player", userId);
}

// Repair legacy self-invites when a manager loads the roster or Pending tab.
// Both reads use this repair so the two views cannot disagree after promotion.
export async function reconcileOrganizationSelfInvites(teamId: string, organizationId: string | null) {
  if (!organizationId) return [];
  return db.transaction(async (tx) => {
    await lockRosterTeam(tx, teamId);
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team || team.organizationId !== organizationId) return [];
    const pending = await tx.select({ invite: rosterInvites, account: users })
      .from(rosterInvites)
      .innerJoin(users, and(
        eq(rosterInvites.invitedById, users.id),
        sql`lower(btrim(${rosterInvites.invitedEmail})) = lower(btrim(${users.email}))`,
      ))
      .innerJoin(organizationAdmins, and(
        eq(organizationAdmins.organizationId, organizationId),
        eq(organizationAdmins.userId, users.id),
      ))
      .where(and(
        eq(rosterInvites.teamId, teamId), eq(rosterInvites.status, "pending"),
        inArray(organizationAdmins.role, ["owner", "admin"]),
      ))
      .orderBy(desc(rosterInvites.createdAt))
      .for("share");
    const processed = new Set<string>();
    const activated: string[] = [];
    for (const { invite, account } of pending) {
      if (processed.has(account.id)) continue;
      processed.add(account.id);
      const existing = await findRosterEntry(tx, teamId, account.id);
      if (existing?.status !== "accepted") {
        // Archived teams remain read-only; only clear already-active duplicates.
        if (team.archivedAt) continue;
        const values = {
          status: "accepted" as const, role: invite.role,
          position: invite.position, invitedById: account.id,
        };
        if (existing) {
          await tx.update(rosterEntries).set(values).where(eq(rosterEntries.id, existing.id));
        } else {
          await tx.insert(rosterEntries).values({ ...values, teamId, userId: account.id });
        }
        activated.push(account.id);
      }
      if (account.email) await revokeSelfInvites(tx, teamId, account.email, account.id);
    }
    return activated;
  });
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