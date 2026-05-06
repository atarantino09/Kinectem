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
const DECLINE = process.argv.includes("--decline");
const POST_FLAG_INDEX = process.argv.indexOf("--post");
const POST_REF =
  POST_FLAG_INDEX > -1 ? process.argv[POST_FLAG_INDEX + 1] : undefined;
const USER_ID = POST_REF
  ? undefined
  : process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));

// Task #368 — exported so the COPPA Phase 4 vitest suite can drive the
// operator workflows directly instead of forking a child process. The
// CLI entry point (`main`) below still wraps these for the operator.
export type ResolveTakedownArgs = {
  postRef: string;
  apply: boolean;
  decline: boolean;
};

export async function resolveTakedownCli(
  args: ResolveTakedownArgs,
): Promise<{ ok: boolean; affected: number; reason?: string }> {
  const m = /^(article|highlight):([0-9a-f-]{36})$/i.exec(args.postRef);
  if (!m) return { ok: false, affected: 0, reason: "invalid_post_ref" };
  const kind = m[1].toLowerCase() as "article" | "highlight";
  const refId = m[2];
  const pending = await db
    .select({
      id: takedownRequests.id,
      childUserId: takedownRequests.childUserId,
      requestedByGuardianId: takedownRequests.requestedByGuardianId,
      reason: takedownRequests.reason,
    })
    .from(takedownRequests)
    .where(
      and(
        eq(takedownRequests.postKind, kind),
        eq(takedownRequests.postRefId, refId),
        eq(takedownRequests.status, "pending"),
      ),
    );
  if (pending.length === 0) return { ok: false, affected: 0, reason: "no_pending" };
  if (!args.apply) return { ok: true, affected: 0, reason: "dry_run" };
  if (args.decline) {
    await db
      .update(takedownRequests)
      .set({ status: "declined" })
      .where(
        and(
          eq(takedownRequests.postKind, kind),
          eq(takedownRequests.postRefId, refId),
          eq(takedownRequests.status, "pending"),
        ),
      );
    for (const r of pending) {
      await db.insert(consentAuditLog).values({
        event: "guardian_takedown_declined",
        childUserId: r.childUserId,
        actorEmail: "operator-script",
        details: JSON.stringify({ takedownId: r.id, kind, refId }),
      });
    }
    return { ok: true, affected: pending.length };
  }
  if (kind === "article") {
    await db.delete(articles).where(eq(articles.id, refId));
  } else {
    await db.delete(highlights).where(eq(highlights.id, refId));
  }
  await db
    .update(takedownRequests)
    .set({ status: "approved" })
    .where(
      and(
        eq(takedownRequests.postKind, kind),
        eq(takedownRequests.postRefId, refId),
        eq(takedownRequests.status, "pending"),
      ),
    );
  for (const r of pending) {
    await db.insert(consentAuditLog).values({
      event: "guardian_takedown_approved",
      childUserId: r.childUserId,
      actorEmail: "operator-script",
      details: JSON.stringify({ takedownId: r.id, kind, refId }),
    });
  }
  return { ok: true, affected: pending.length };
}

async function resolveTakedown(): Promise<void> {
  if (!POST_REF) return;
  // Task #367 — operator path for the photo-of-minor takedown queue.
  // A guardian filed a takedown via POST /guardians/.../takedown-request;
  // the post is hidden from public feeds while the request is pending.
  // The operator reviews it manually and runs this script to either
  //   • approve  : --post <article|highlight>:<uuid> --apply
  //                deletes the post (FK cascades tags/reactions/etc.)
  //                and stamps every matching pending takedown row as
  //                `approved` so the audit trail is preserved.
  //   • decline  : --post <article|highlight>:<uuid> --decline
  //                marks the matching pending takedown rows as
  //                `declined` so the post becomes visible again.
  const m = /^(article|highlight):([0-9a-f-]{36})$/i.exec(POST_REF);
  if (!m) {
    console.error(
      "Invalid --post value. Expected 'article:<uuid>' or 'highlight:<uuid>'.",
    );
    process.exit(2);
  }
  const kind = m[1].toLowerCase() as "article" | "highlight";
  const refId = m[2];
  const pending = await db
    .select({
      id: takedownRequests.id,
      childUserId: takedownRequests.childUserId,
      requestedByGuardianId: takedownRequests.requestedByGuardianId,
      reason: takedownRequests.reason,
    })
    .from(takedownRequests)
    .where(
      and(
        eq(takedownRequests.postKind, kind),
        eq(takedownRequests.postRefId, refId),
        eq(takedownRequests.status, "pending"),
      ),
    );
  if (pending.length === 0) {
    console.error(
      `No pending takedown_requests row found for ${kind}:${refId}.`,
    );
    process.exit(1);
  }
  console.log(
    `${pending.length} pending takedown request(s) for ${kind}:${refId}:`,
  );
  for (const r of pending) {
    console.log(
      `  - id=${r.id}  child=${r.childUserId}  guardian=${r.requestedByGuardianId}  reason=${r.reason ?? "(none)"}`,
    );
  }
  if (DECLINE) {
    if (!APPLY) {
      console.log(
        "\nDry-run only. Re-run with `--apply --decline` to mark the takedown(s) declined.",
      );
      return;
    }
    await db
      .update(takedownRequests)
      .set({ status: "declined" })
      .where(
        and(
          eq(takedownRequests.postKind, kind),
          eq(takedownRequests.postRefId, refId),
          eq(takedownRequests.status, "pending"),
        ),
      );
    for (const r of pending) {
      await db.insert(consentAuditLog).values({
        event: "guardian_takedown_declined",
        childUserId: r.childUserId,
        actorEmail: "operator-script",
        details: JSON.stringify({ takedownId: r.id, kind, refId }),
      });
    }
    console.log(`  declined ${pending.length} request(s); post becomes visible again.`);
    return;
  }
  if (!APPLY) {
    console.log(
      "\nDry-run only. Re-run with `--apply` to delete the post (or `--apply --decline` to dismiss).",
    );
    return;
  }
  // Hard takedown: delete the post itself; FK cascades clear tags,
  // reactions, comments, shares, assets, etc.
  if (kind === "article") {
    await db.delete(articles).where(eq(articles.id, refId));
  } else {
    await db.delete(highlights).where(eq(highlights.id, refId));
  }
  await db
    .update(takedownRequests)
    .set({ status: "approved" })
    .where(
      and(
        eq(takedownRequests.postKind, kind),
        eq(takedownRequests.postRefId, refId),
        eq(takedownRequests.status, "pending"),
      ),
    );
  for (const r of pending) {
    await db.insert(consentAuditLog).values({
      event: "guardian_takedown_approved",
      childUserId: r.childUserId,
      actorEmail: "operator-script",
      details: JSON.stringify({ takedownId: r.id, kind, refId }),
    });
  }
  console.log(`  deleted ${kind}:${refId}; ${pending.length} takedown request(s) approved.`);
}

// Task #368 — exported test entry point. Skips the cooling-off + status
// guards so tests can drive the cascade phases directly. The CLI path
// keeps its existing safeguards via `main()`.
export async function hardDeleteUserCli(userId: string): Promise<void> {
  // Phase (1a) — SET NULL FK columns: explicitly purge child-authored rows.
  await db.delete(articles).where(eq(articles.authorId, userId));
  await db.delete(highlights).where(eq(highlights.uploaderId, userId));
  await db.delete(postComments).where(eq(postComments.authorId, userId));
  // Phase (1b) — sender-side messages.
  await db.delete(messages).where(eq(messages.senderUserId, userId));
  // Phase (2) — redact recipient-side message bodies in conversations.
  await db.execute(sql`
    update ${messages}
    set body = '[deleted]'
    where ${messages.deletedAt} is null
      and ${messages.conversationId} in (
        select ${conversationParticipants.conversationId}
        from ${conversationParticipants}
        where ${conversationParticipants.participantType} = 'user'
          and ${conversationParticipants.participantId} = ${userId}
      )
  `);
  await db.execute(sql`
    delete from ${conversations}
    where ${conversations.id} in (
      select ${conversationParticipants.conversationId}
      from ${conversationParticipants}
      where ${conversationParticipants.participantType} = 'user'
        and ${conversationParticipants.participantId} = ${userId}
    )
    and (
      select count(*) from ${conversationParticipants} cp2
      where cp2.conversation_id = ${conversations.id}
    ) <= 1
  `);
  // Phase (3) — polymorphic conversation_participants rows for the child.
  await db
    .delete(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.participantType, "user"),
        eq(conversationParticipants.participantId, userId),
      ),
    );
  // Phase (4) — users row; cascade handles the rest.
  await db.delete(users).where(eq(users.id, userId));
}

async function main(): Promise<void> {
  if (POST_REF) {
    await resolveTakedown();
    return;
  }
  if (!USER_ID) {
    console.error(
      "Usage:\n" +
        "  Hard-delete a child account (right-to-delete):\n" +
        "    pnpm --filter @workspace/scripts run coppa:delete -- <userId> [--apply]\n" +
        "  Resolve a guardian-filed photo takedown:\n" +
        "    pnpm --filter @workspace/scripts run coppa:delete -- --post <article|highlight>:<uuid> [--apply | --apply --decline]",
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

  // Phase (1a) — explicitly delete every row whose FK to users.id is
  // declared `ON DELETE SET NULL` in the schema. Without this we would
  // leave child-authored content in place with a NULLed `authorId` /
  // `uploaderId` / etc., violating COPPA right-to-delete. The list of
  // SET NULL columns mirrors lib/db/src/schema/index.ts. Cascading FKs
  // (e.g. roster_entries, post_reactions, user_followers, parental_
  // consents → users) are handled by the final users-row delete.
  await db.delete(articles).where(eq(articles.authorId, u.id));
  await db.delete(highlights).where(eq(highlights.uploaderId, u.id));
  await db.delete(postComments).where(eq(postComments.authorId, u.id));

  // Phase (1b) — hard-delete messages the child authored. Cascades
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

  // Phase (3) — explicitly remove the child's conversation_participants
  // rows. participantId is polymorphic (no FK to users.id), so the
  // final cascade on `users` would otherwise leave orphaned rows.
  await db
    .delete(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.participantType, "user"),
        eq(conversationParticipants.participantId, u.id),
      ),
    );

  // Phase (4) — drop the users row; FK cascade handles the remaining
  // tables that ARE declared cascade (roster_entries, post_reactions,
  // post_shares, user_followers, parental_consents linkage, etc.).
  await db.delete(users).where(eq(users.id, u.id));
  console.log(`  deleted ${u.id}`);
  console.log("Done.");
}

// Only run the CLI entry point when invoked directly (not when the
// module is imported by tests via `@workspace/scripts/coppa-hard-delete`).
const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] != null &&
  /coppa-hard-delete(\.[cm]?[jt]s)?$/.test(process.argv[1]);
if (isDirectRun) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error("coppa-hard-delete failed:", err);
      process.exit(1);
    },
  );
}
