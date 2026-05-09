// Task #437 — Backfill self team-follows.
//
// For every roster_entries row with status = 'accepted', insert
// (teamId, userId) into team_followers. This closes the gap for
// accounts that accepted before Task #434 made roster accept
// auto-follow the team for the accepter. Idempotent: uses
// ON CONFLICT DO NOTHING, so re-running the script is safe and
// produces no duplicates.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run backfill-self-team-follows

import { db, rosterEntries, teamFollowers } from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      userId: rosterEntries.userId,
      teamId: rosterEntries.teamId,
    })
    .from(rosterEntries)
    .where(eq(rosterEntries.status, "accepted"));
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    const result = await db
      .insert(teamFollowers)
      .values({ teamId: r.teamId, userId: r.userId })
      .onConflictDoNothing()
      .returning();
    if (result.length > 0) {
      inserted += 1;
    } else {
      skipped += 1;
    }
  }
  console.log(
    `Backfill complete: ${rows.length} (user, team) candidates considered, ${inserted} new team_followers rows inserted, ${skipped} skipped (already present).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
