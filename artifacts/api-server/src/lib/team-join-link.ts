import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, rosterInvites } from "@workspace/db";

function generateTeamJoinToken(): string {
  return `join-${randomBytes(32).toString("base64url")}`;
}

/**
 * Return the one stable, email-less player invite used as a team's shared
 * roster join link. The lock and partial unique index protect against multiple
 * managers preparing the same link at once.
 */
export async function getOrCreateTeamJoinLink(
  teamId: string,
  invitedById: string,
): Promise<{ token: string; createdAt: Date }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"team-join-link:" + teamId}))`,
    );

    const [existing] = await tx
      .select({
        token: rosterInvites.token,
        createdAt: rosterInvites.createdAt,
      })
      .from(rosterInvites)
      .where(
        and(
          eq(rosterInvites.teamId, teamId),
          eq(rosterInvites.status, "pending"),
          eq(rosterInvites.role, "player"),
          isNull(rosterInvites.invitedEmail),
        ),
      )
      .limit(1);
    if (existing) return existing;

    const [created] = await tx
      .insert(rosterInvites)
      .values({
        token: generateTeamJoinToken(),
        teamId,
        invitedEmail: null,
        invitedName: null,
        role: "player",
        position: "player",
        invitedById,
      })
      .returning({
        token: rosterInvites.token,
        createdAt: rosterInvites.createdAt,
      });
    return created;
  });
}