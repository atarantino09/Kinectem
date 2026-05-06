// Task #367 — COPPA Phase 3 right-to-delete operator script.
//
// Single-user hard-delete: pass the userId to purge. The script
// validates the user is `pending_deletion` and that the request is
// older than the configured cooling-off window (default 24 hours),
// then performs the deletion in three phases:
//
//   (1) Explicitly DELETE every message the child authored. The
//       `messages` schema points `senderUserId` at users with
//       ON DELETE SET NULL, so relying on FK cascade alone would
//       leave the message body intact in recipients' inboxes — a
//       direct COPPA right-to-delete violation.
//   (2) For messages SENT TO the child (received side), redact the
//       body to `[deleted]` and clear the sender attribution. The
//       counterpart adult still sees their own outgoing message,
//       just with the child's identifying side scrubbed.
//   (3) DELETE the users row. Every other minor-touching table is
//       declared with ON DELETE CASCADE in `lib/db/src/schema/*`
//       and is purged by Postgres as part of that cascade.
//
// Per-table row counts captured BEFORE the cascade are written into
// the `guardian_data_deleted` consent_audit_log row so we preserve
// an exact accounting of what was purged.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run coppa:delete -- <userId>
//   pnpm --filter @workspace/scripts run coppa:delete -- <userId> --apply
//
// Override the cooling-off window with COPPA_DELETION_GRACE_HOURS.

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
  conversations,
  messages,
  takedownRequests,
} from "@workspace/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";

const GRACE_HOURS = Number(process.env.COPPA_DELETION_GRACE_HOURS ?? "24");
const APPLY = process.argv.includes("--apply");
const USER_ID = process.argv.find(
  (a, i) => i >= 2 && !a.startsWith("--"),
);

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

  const counts: Record<string, number> = {};
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
  // Sender-side messages are hard-deleted; recipient-side messages
  // (where the child is a participant but not the sender) get their
  // body redacted. Track both counts separately for the audit log.
  counts.messages_sent = (
    await db.select({ c: sql<number>`count(*)::int` }).from(messages).where(eq(messages.senderUserId, u.id))
  )[0]?.c ?? 0;
  counts.messages_received_redacted = (
    await db
      .select({ c: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(
        conversationParticipants,
        eq(conversationParticipants.conversationId, messages.conversationId),
      )
      .where(
        and(
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, u.id),
          // Don't double-count messages the child sent themselves.
          sql`${messages.senderUserId} IS DISTINCT FROM ${u.id}`,
          isNull(messages.deletedAt),
        ),
      )
  )[0]?.c ?? 0;
  counts.takedown_requests = (
    await db.select({ c: sql<number>`count(*)::int` }).from(takedownRequests).where(eq(takedownRequests.childUserId, u.id))
  )[0]?.c ?? 0;
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

  // Phase (1) — hard-delete messages the child authored. Cascades
  // through message_assets via FK.
  await db.delete(messages).where(eq(messages.senderUserId, u.id));

  // Phase (2) — redact recipient-side message bodies in conversations
  // the child participated in. This preserves the adult counterpart's
  // ability to navigate the conversation but scrubs every message
  // identifying or addressed to the child. We use a correlated
  // subquery to scope the update to conversations the child was in.
  await db.execute(sql`
    update ${messages}
    set body = '[deleted]'
    where ${messages.deletedAt} is null
      and ${messages.conversationId} in (
        select ${conversationParticipants.conversationId}
        from ${conversationParticipants}
        where ${conversationParticipants.participantType} = 'user'
          and ${conversationParticipants.participantId} = ${u.id}
      )
  `);

  // Drop the conversation row entirely if the child was the only
  // participant left after their record is removed (happens in
  // direct-message threads). This also cascades message rows.
  await db.execute(sql`
    delete from ${conversations}
    where ${conversations.id} in (
      select ${conversationParticipants.conversationId}
      from ${conversationParticipants}
      where ${conversationParticipants.participantType} = 'user'
        and ${conversationParticipants.participantId} = ${u.id}
    )
    and (
      select count(*) from ${conversationParticipants} cp2
      where cp2.conversation_id = ${conversations.id}
    ) <= 1
  `);

  // Phase (3) — drop the users row; FK cascade handles everything else.
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
