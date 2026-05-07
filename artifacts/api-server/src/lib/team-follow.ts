import {
  db,
  teams,
  users,
  teamFollowers,
  organizationFollowers,
  organizationFollowOptouts,
  rosterEntries,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

// Auto-follow the parent organization when a user joins one of its team
// rosters. Tolerant of failures (e.g. unique constraint races).
export async function ensureOrgFollowedForTeam(userId: string, teamId: string): Promise<void> {
  try {
    const [team] = await db
      .select({ orgId: teams.organizationId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) return;
    // Respect a prior manual unfollow: if the user has explicitly opted out,
    // we do not silently re-follow them when they join a team in this org.
    const [optout] = await db
      .select()
      .from(organizationFollowOptouts)
      .where(
        and(
          eq(organizationFollowOptouts.organizationId, team.orgId),
          eq(organizationFollowOptouts.userId, userId),
        ),
      )
      .limit(1);
    if (optout) return;
    await db
      .insert(organizationFollowers)
      .values({ organizationId: team.orgId, userId })
      .onConflictDoNothing();
  } catch (err) {
    logger.warn({ err, userId, teamId }, "ensureOrgFollowedForTeam failed");
  }
}

// Auto-follow a team on behalf of a guardian when their child is rostered
// on it. Mirrors `ensureOrgFollowedForTeam`: idempotent insert, best-effort
// (warn-and-continue) so it never blocks the primary roster operation.
// Caller is expected to have already verified the parent↔child link.
export async function ensureTeamFollowedAsGuardian(
  parentUserId: string,
  teamId: string,
): Promise<void> {
  try {
    await db
      .insert(teamFollowers)
      .values({ teamId, userId: parentUserId })
      .onConflictDoNothing();
  } catch (err) {
    logger.warn(
      { err, parentUserId, teamId },
      "ensureTeamFollowedAsGuardian failed",
    );
  }
}

// Convenience: given a child user id, look up their parent (if any) and
// auto-follow the team on the parent's behalf. No-op when the child has
// no linked guardian.
export async function ensureChildsParentFollowsTeam(
  childUserId: string,
  teamId: string,
): Promise<void> {
  try {
    const [child] = await db
      .select({ parentId: users.parentId })
      .from(users)
      .where(eq(users.id, childUserId))
      .limit(1);
    if (!child?.parentId) return;
    await ensureTeamFollowedAsGuardian(child.parentId, teamId);
  } catch (err) {
    logger.warn(
      { err, childUserId, teamId },
      "ensureChildsParentFollowsTeam failed",
    );
  }
}

// Backfill helper for "link existing child": for every team the child is
// already accepted on, auto-follow on the parent's behalf. Best-effort.
export async function backfillTeamFollowsForLinkedChild(
  parentUserId: string,
  childUserId: string,
): Promise<void> {
  try {
    const rows = await db
      .select({ teamId: rosterEntries.teamId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.userId, childUserId),
          eq(rosterEntries.status, "accepted"),
        ),
      );
    for (const r of rows) {
      await ensureTeamFollowedAsGuardian(parentUserId, r.teamId);
    }
  } catch (err) {
    logger.warn(
      { err, parentUserId, childUserId },
      "backfillTeamFollowsForLinkedChild failed",
    );
  }
}
