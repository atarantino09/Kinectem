import { db, teams, organizationFollowers, organizationFollowOptouts } from "@workspace/db";
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
