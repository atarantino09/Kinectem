// Task #367 — COPPA Phase 3 right-to-delete operator script.
//
// Single-user hard-delete: pass the userId to purge. The script
// validates the user is `pending_deletion` and that the request is
// older than the configured cooling-off window (default 24 hours),
// then cascades through every FK (every minor-touching table is
// declared with ON DELETE CASCADE in `lib/db/src/schema/index.ts`).
//
// Per-table row counts are captured before the delete and written
// into the `guardian_data_deleted` audit row so the consent_audit_log
// preserves an exact accounting of what was purged.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run coppa:delete -- <userId>
//   pnpm --filter @workspace/scripts run coppa:delete -- <userId> --apply
//
// The default cooling-off window is 24h; override with
// COPPA_DELETION_GRACE_HOURS for ops drills or production policy
// changes. The script is intentionally separate from the API server:
// hard deletion of a child account is a high-risk operation that an
// operator opts into manually after reviewing the candidate.

import {
  db,
  users,
  consentAuditLog,
  articles,
  articleTags,
  highlights,
  highlightTags,
  postShares,
  postReactions,
  postComments,
  userFollowers,
  rosterEntries,
  notifications,
  conversationParticipants,
  messages,
  takedownRequests,
} from "@workspace/db";
import { and, eq, or, sql } from "drizzle-orm";

const GRACE_HOURS = Number(process.env.COPPA_DELETION_GRACE_HOURS ?? "24");
const APPLY = process.argv.includes("--apply");
const USER_ID = process.argv.find(
  (a, i) => i >= 2 && !a.startsWith("--"),
);

async function countWhere(
  table: { id?: unknown; toString(): string },
  whereSql: ReturnType<typeof sql>,
): Promise<number> {
  const [row] = (await db.execute(
    sql`select count(*)::int as c from ${table as never} where ${whereSql}`,
  )) as unknown as { c: number }[];
  return row?.c ?? 0;
}

async function main(): Promise<void> {
  if (!USER_ID) {
    console.error(
      "Usage: pnpm --filter @workspace/scripts run coppa:delete -- <userId> [--apply]",
    );
    process.exit(2);
  }

  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      accountStatus: users.accountStatus,
      requestedAt: users.deletionRequestedAt,
    })
    .from(users)
    .where(eq(users.id, USER_ID))
    .limit(1);

  if (!u) {
    console.error(`No user found with id=${USER_ID}.`);
    process.exit(1);
  }
  if (u.accountStatus !== "pending_deletion") {
    console.error(
      `Refusing: user ${u.id} is in accountStatus=${u.accountStatus}. Hard-delete only runs against 'pending_deletion'.`,
    );
    process.exit(1);
  }
  if (!u.requestedAt) {
    console.error(
      `Refusing: user ${u.id} has no deletionRequestedAt timestamp. Refusing to purge a row with missing audit metadata.`,
    );
    process.exit(1);
  }
  const ageMs = Date.now() - u.requestedAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < GRACE_HOURS) {
    console.error(
      `Refusing: deletion request is ${ageHours.toFixed(1)}h old; minimum ${GRACE_HOURS}h cooling-off window not yet elapsed.`,
    );
    process.exit(1);
  }

  // Per-table row counts captured BEFORE the cascade so the audit
  // log records what we actually purged. Tables not listed cascade
  // implicitly via FK definitions.
  const counts: Record<string, number> = {};
  const collect = async (label: string, where: ReturnType<typeof sql>): Promise<void> => {
    counts[label] = await countWhere(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ toString: () => label } as any),
      where,
    );
  };
  // We can't pass drizzle table objects to raw SQL by reference, so
  // run explicit COUNT queries with the typed query builder instead.
  counts.articles = (
    await db.select({ c: sql<number>`count(*)::int` }).from(articles).where(eq(articles.authorId, u.id))
  )[0]?.c ?? 0;
  counts.article_tags = (
    await db.select({ c: sql<number>`count(*)::int` }).from(articleTags).where(eq(articleTags.userId, u.id))
  )[0]?.c ?? 0;
  counts.highlights = (
    await db.select({ c: sql<number>`count(*)::int` }).from(highlights).where(eq(highlights.uploaderId, u.id))
  )[0]?.c ?? 0;
  counts.highlight_tags = (
    await db.select({ c: sql<number>`count(*)::int` }).from(highlightTags).where(eq(highlightTags.userId, u.id))
  )[0]?.c ?? 0;
  counts.post_shares = (
    await db.select({ c: sql<number>`count(*)::int` }).from(postShares).where(eq(postShares.sharerUserId, u.id))
  )[0]?.c ?? 0;
  counts.post_reactions = (
    await db.select({ c: sql<number>`count(*)::int` }).from(postReactions).where(eq(postReactions.userId, u.id))
  )[0]?.c ?? 0;
  counts.post_comments = (
    await db.select({ c: sql<number>`count(*)::int` }).from(postComments).where(eq(postComments.authorId, u.id))
  )[0]?.c ?? 0;
  counts.user_followers = (
    await db.select({ c: sql<number>`count(*)::int` }).from(userFollowers).where(
      or(eq(userFollowers.followerUserId, u.id), eq(userFollowers.followingUserId, u.id)),
    )
  )[0]?.c ?? 0;
  counts.roster_entries = (
    await db.select({ c: sql<number>`count(*)::int` }).from(rosterEntries).where(eq(rosterEntries.userId, u.id))
  )[0]?.c ?? 0;
  counts.notifications = (
    await db.select({ c: sql<number>`count(*)::int` }).from(notifications).where(eq(notifications.userId, u.id))
  )[0]?.c ?? 0;
  counts.conversation_participants = (
    await db.select({ c: sql<number>`count(*)::int` }).from(conversationParticipants).where(
      and(
        eq(conversationParticipants.participantType, "user"),
        eq(conversationParticipants.participantId, u.id),
      ),
    )
  )[0]?.c ?? 0;
  counts.messages = (
    await db.select({ c: sql<number>`count(*)::int` }).from(messages).where(eq(messages.senderUserId, u.id))
  )[0]?.c ?? 0;
  counts.takedown_requests = (
    await db.select({ c: sql<number>`count(*)::int` }).from(takedownRequests).where(eq(takedownRequests.childUserId, u.id))
  )[0]?.c ?? 0;
  // The users row itself is the final cascade root.
  counts.users = 1;

  console.log(
    `${APPLY ? "DELETING" : "Would delete"} user ${u.id} (email=${u.email ?? "(none)"}, name=${u.name})`,
  );
  console.log(
    `  requestedAt=${u.requestedAt.toISOString()}  ageHours=${ageHours.toFixed(1)}  grace=${GRACE_HOURS}h`,
  );
  console.log("  per-table row counts to be cascaded:");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`    ${k.padEnd(28)} ${v}`);
  }

  if (!APPLY) {
    console.log(
      "\nDry-run only. Re-run with `--apply` to actually purge these rows.",
    );
    return;
  }

  // Audit row first so even a partial-failure mid-delete leaves a
  // record of intent + the per-table accounting.
  await db.insert(consentAuditLog).values({
    event: "guardian_data_deleted",
    childUserId: u.id,
    actorEmail: "operator-script",
    details: JSON.stringify({
      graceHours: GRACE_HOURS,
      ageHours: Number(ageHours.toFixed(2)),
      counts,
    }),
  });
  await db.delete(users).where(eq(users.id, u.id));
  console.log(`  deleted ${u.id}`);
  console.log("Done.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("coppa-hard-delete failed:", err);
    process.exit(1);
  },
);
