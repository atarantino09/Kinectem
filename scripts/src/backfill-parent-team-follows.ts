// Task #394 — Backfill parent team-follows.
//
// For every (child, team) pair where the child has an accepted
// roster_entries row and the child has a linked guardian (users.parentId
// is non-null), insert the parent into team_followers. Idempotent:
// uses ON CONFLICT DO NOTHING, so re-running the script is safe and
// produces no duplicates.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run backfill-parent-team-follows

import { db, users, rosterEntries, teamFollowers } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      parentId: users.parentId,
      teamId: rosterEntries.teamId,
    })
    .from(rosterEntries)
    .innerJoin(users, eq(rosterEntries.userId, users.id))
    .where(
      and(
        eq(rosterEntries.status, "accepted"),
        isNotNull(users.parentId),
      ),
    );
  let inserted = 0;
  for (const r of rows) {
    if (!r.parentId) continue;
    const result = await db
      .insert(teamFollowers)
      .values({ teamId: r.teamId, userId: r.parentId })
      .onConflictDoNothing()
      .returning();
    if (result.length > 0) inserted += 1;
  }
  console.log(
    `Backfill complete: ${rows.length} (parent, team) candidates considered, ${inserted} new team_followers rows inserted.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
