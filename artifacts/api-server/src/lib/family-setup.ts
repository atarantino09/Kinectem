import { db, users, guardianLinks, rosterEntries, rosterInvites, teams } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { SessionUser } from "./auth";
import { lockRosterTeam, findRosterEntry } from "./roster-invite-consistency";
import { isActiveGuardian } from "./guardian-links";

export const FAMILY_SETUP_MIGRATION = `
CREATE TABLE IF NOT EXISTS family_player_setups (
  parent_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  name_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_id, request_id)
);
ALTER TABLE guardian_links
  ADD COLUMN IF NOT EXISTS invite_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_email_attempted_at timestamptz;
`;

export class FamilySetupError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

export function normalizedPlayerName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "").trim().replace(/\s+/g, " ");
}

/** Advisory only: names never confer family access or identify a child. */
export function similarPlayerNames(left: string, right: string): boolean {
  const a = normalizedPlayerName(left), b = normalizedPlayerName(right);
  if (a === b) return true;
  const aa = a.split(" "), bb = b.split(" ");
  return aa.length > 1 && bb.length > 1 &&
    aa.at(-1) === bb.at(-1) &&
    aa[0]!.length >= 3 && bb[0]!.length >= 3 &&
    aa[0]!.slice(0, 3) === bb[0]!.slice(0, 3);
}

function fail(status: number, message: string, code: string): never {
  throw new FamilySetupError(status, message, code);
}

export function maySetUpFamily(me: SessionUser): boolean {
  if (me.dateOfBirth) {
    const adultDate = new Date();
    adultDate.setUTCFullYear(adultDate.getUTCFullYear() - 18);
    if (me.dateOfBirth > adultDate) return false;
  }
  return me.role === "parent" || me.role === "coach" || me.role === "admin" ||
    (!!me.dateOfBirth && me.dateOfBirth.getTime() <= Date.now() - 18 * 365.25 * 86400000);
}

interface Input {
  firstName?: unknown;
  lastName?: unknown;
  childId?: unknown;
  setupRequestId?: unknown;
  confirmDistinctPlayer?: unknown;
}

/** Parent lock plus team lock keep checks, creation and roster insertion atomic. */
export async function setUpFamilyPlayer(me: SessionUser, input: Input, token?: string) {
  if (!maySetUpFamily(me)) fail(403, "Only an adult parent or guardian can set up a player.", "ADULT_GUARDIAN_REQUIRED");
  const firstName = typeof input.firstName === "string" ? input.firstName.trim() : "";
  const lastName = typeof input.lastName === "string" ? input.lastName.trim() : "";
  const childId = typeof input.childId === "string" ? input.childId.trim() : "";
  const requestId = typeof input.setupRequestId === "string" ? input.setupRequestId : "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (childId && !uuid.test(childId)) fail(400, "Invalid child selection.", "INVALID_CHILD");
  if (!childId && (!firstName || !lastName || firstName.length > 100 || lastName.length > 100))
    fail(400, "Enter the player's first and last name (100 characters maximum each).", "INVALID_PLAYER_NAME");
  if (requestId && !uuid.test(requestId)) fail(400, "Invalid setup request.", "INVALID_SETUP_REQUEST");
  if (!childId && !requestId) fail(400, "Refresh the setup page before creating a player.", "SETUP_REQUEST_REQUIRED");
  const nameKey = normalizedPlayerName(`${firstName} ${lastName}`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`family-setup:${me.id}`}))`);
    let invite: typeof rosterInvites.$inferSelect | undefined;
    if (token) {
      [invite] = await tx.select().from(rosterInvites).where(eq(rosterInvites.token, token)).limit(1);
      if (!invite || invite.position !== "player" || !["pending", "accepted"].includes(invite.status))
        fail(409, "This player invitation is no longer available.", "INVITE_UNAVAILABLE");
      if (invite.invitedEmail && invite.invitedEmail.toLowerCase().trim() !== me.email?.toLowerCase().trim())
        fail(403, "Use the email address that received this invitation.", "INVITE_EMAIL_MISMATCH");
      await lockRosterTeam(tx, invite.teamId);
      // The invite may have been withdrawn while waiting for the team lock.
      [invite] = await tx.select().from(rosterInvites).where(eq(rosterInvites.id, invite.id)).for("update");
      const [team] = await tx.select().from(teams).where(eq(teams.id, invite!.teamId)).limit(1);
      if (!invite || !["pending", "accepted"].includes(invite.status) || !team || team.archivedAt)
        fail(409, "This team invitation is no longer available.", "INVITE_UNAVAILABLE");
    }
    const links = await tx.select({ childId: guardianLinks.childId }).from(guardianLinks)
      .where(and(eq(guardianLinks.guardianId, me.id), eq(guardianLinks.status, "active")));
    const linkedIds = links.map((l) => l.childId);
    let child: typeof users.$inferSelect | undefined;
    let reused = false;
    if (childId) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${childId}))`);
      if (!(await isActiveGuardian(me.id, childId, tx))) fail(404, "Child not found.", "CHILD_NOT_FOUND");
      [child] = await tx.select().from(users).where(eq(users.id, childId)).limit(1);
    } else {
      const receipt = await tx.execute<{ child_id: string; name_key: string; team_id: string | null }>(sql`
        SELECT child_id, name_key, team_id FROM family_player_setups
         WHERE parent_id = ${me.id} AND request_id = ${requestId}::uuid
      `);
      const previous = receipt.rows[0];
      if (previous) {
        if (previous.name_key !== nameKey || previous.team_id !== (invite?.teamId ?? null))
          fail(409, "This setup was already submitted with different details. Select the saved child or start a new setup.", "SETUP_REQUEST_REUSED");
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${previous.child_id}))`);
        if (!(await isActiveGuardian(me.id, previous.child_id, tx))) fail(403, "You no longer have access to this child.", "CHILD_ACCESS_REVOKED");
        [child] = await tx.select().from(users).where(eq(users.id, previous.child_id)).limit(1);
        reused = true;
      } else {
        const family = linkedIds.length ? await tx.select({ name: users.name }).from(users).where(inArray(users.id, linkedIds)) : [];
        const roster = invite ? await tx.select({ name: users.name }).from(rosterEntries)
          .innerJoin(users, eq(users.id, rosterEntries.userId))
          .where(and(eq(rosterEntries.teamId, invite.teamId), eq(rosterEntries.role, "player"))) : [];
        if ([...family, ...roster].some((c) => similarPlayerNames(c.name, `${firstName} ${lastName}`)) &&
            input.confirmDistinctPlayer !== true)
          fail(409, "A player with a similar name may already be in your family or on this team. Check with the other parent before creating another profile. Only continue if this is a different child.", "POSSIBLE_DUPLICATE");
        [child] = await tx.insert(users).values({
          name: `${firstName} ${lastName}`, role: "athlete", email: null, parentId: me.id,
        }).returning();
        await tx.execute(sql`INSERT INTO family_player_setups (parent_id, request_id, child_id, team_id, name_key)
          VALUES (${me.id}, ${requestId}::uuid, ${child!.id}, ${invite?.teamId ?? null}, ${nameKey})`);
      }
    }
    if (!child) fail(404, "Child not found.", "CHILD_NOT_FOUND");
    let member: typeof rosterEntries.$inferSelect | undefined;
    if (invite) {
      member = await findRosterEntry(tx, invite.teamId, child.id);
      if (!member) {
        [member] = await tx.insert(rosterEntries).values({
          teamId: invite.teamId, userId: child.id, role: "player", status: "accepted", position: "player",
        }).returning();
      } else if (member.status !== "accepted") {
        [member] = await tx.update(rosterEntries).set({ status: "accepted", role: "player", position: "player" })
          .where(eq(rosterEntries.id, member.id)).returning();
      }
    }
    return { child, member, reused, teamId: invite?.teamId ?? null };
  });
}
