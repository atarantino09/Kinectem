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

// Inverse of `backfillTeamFollowsForLinkedChild`. When a guardian unlinks a
// child via `DELETE /users/me/children/:childId`, drop the via-child team
// follows so the parent's profile no longer shows that team as a "Parent"
// row. Conservative: only remove the follow if the parent has no other
// reason to be on it — i.e. they're not themselves on the team's roster
// and no *other* linked child of theirs is accepted on it. We don't track
// whether a `team_followers` row was created via auto-follow vs. manually,
// so this can occasionally remove a row the parent had also followed by
// hand; that's acceptable given the alternative is leaving stale "Parent"
// badges around forever.
export async function cleanupTeamFollowsForUnlinkedChild(
  parentUserId: string,
  childUserId: string,
): Promise<void> {
  try {
    const childTeams = await db
      .select({ teamId: rosterEntries.teamId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.userId, childUserId),
          eq(rosterEntries.status, "accepted"),
        ),
      );
    for (const { teamId } of childTeams) {
      // Parent themselves on the roster? Keep the follow.
      const [parentRoster] = await db
        .select({ teamId: rosterEntries.teamId })
        .from(rosterEntries)
        .where(
          and(
            eq(rosterEntries.teamId, teamId),
            eq(rosterEntries.userId, parentUserId),
            eq(rosterEntries.status, "accepted"),
          ),
        )
        .limit(1);
      if (parentRoster) continue;
      // Any *other* linked child of this parent still accepted on this
      // team? Keep the follow so their other "Parent" badge survives.
      const otherChildren = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.parentId, parentUserId));
      let keepForOtherChild = false;
      for (const c of otherChildren) {
        if (c.id === childUserId) continue;
        const [row] = await db
          .select({ teamId: rosterEntries.teamId })
          .from(rosterEntries)
          .where(
            and(
              eq(rosterEntries.teamId, teamId),
              eq(rosterEntries.userId, c.id),
              eq(rosterEntries.status, "accepted"),
            ),
          )
          .limit(1);
        if (row) {
          keepForOtherChild = true;
          break;
        }
      }
      if (keepForOtherChild) continue;
      await db
        .delete(teamFollowers)
        .where(
          and(
            eq(teamFollowers.teamId, teamId),
            eq(teamFollowers.userId, parentUserId),
          ),
        );
    }
  } catch (err) {
    logger.warn(
      { err, parentUserId, childUserId },
      "cleanupTeamFollowsForUnlinkedChild failed",
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
