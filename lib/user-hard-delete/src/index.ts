// Shared COPPA-safe user hard-delete purge logic.
//
// Both the operator right-to-delete script
// (`scripts/src/coppa-hard-delete.ts`) and the admin "permanently
// delete a deactivated account" route call into here so the exact
// same purge phases run in both places. Do NOT duplicate these steps
// elsewhere.
//
// The phases mirror the FK topology in `lib/db/src/schema/*`:
//
//   (1a) Explicitly DELETE rows whose FK to users.id is declared
//        `ON DELETE SET NULL` (articles.author_id, highlights.
//        uploader_id, post_comments.author_id). Relying on the final
//        users-row cascade alone would leave this content in place
//        with a NULLed author — a COPPA right-to-delete violation.
//   (1b) Hard-delete messages the user authored (cascades
//        message_assets via FK).
//   (2)  Redact recipient-side message bodies in every conversation
//        the user participated in, then drop any conversation left
//        with a single participant (direct-message threads).
//   (3)  Explicitly remove the user's conversation_participants rows.
//        participantId is polymorphic (no FK to users.id) so the final
//        users cascade would otherwise orphan them.
//   (4)  DELETE the users row; every remaining minor-touching table is
//        declared ON DELETE CASCADE and is purged by Postgres.

import {
  db,
  users,
  articles,
  postComments,
  highlights,
  conversationParticipants,
  conversations,
  messages,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

// The transaction handle passed to a `db.transaction()` callback. Also
// structurally compatible with the top-level `db` object for the query
// builders used below.
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Run the purge phases inside a caller-provided transaction. The caller
// is responsible for opening the transaction (and any advisory lock /
// audit-log rows it wants in the same atomic unit).
export async function purgeUserWithinTx(
  tx: DbTransaction,
  userId: string,
): Promise<void> {
  // Phase (1a) — SET NULL FK columns: explicitly purge user-authored rows.
  await tx.delete(articles).where(eq(articles.authorId, userId));
  await tx.delete(highlights).where(eq(highlights.uploaderId, userId));
  await tx.delete(postComments).where(eq(postComments.authorId, userId));

  // Phase (1b) — hard-delete messages the user authored. Cascades
  // through message_assets via FK.
  await tx.delete(messages).where(eq(messages.senderUserId, userId));

  // Phase (2) — redact recipient-side message bodies in conversations
  // the user participated in. This preserves the counterpart's ability
  // to navigate the conversation but scrubs every message identifying
  // or addressed to the user. Scoped via a correlated subquery.
  await tx.execute(sql`
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

  // Drop the conversation row entirely if the user was the only
  // participant left after their record is removed (happens in
  // direct-message threads). This also cascades message rows.
  await tx.execute(sql`
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

  // Phase (3) — explicitly remove the user's conversation_participants
  // rows. participantId is polymorphic (no FK to users.id), so the
  // final cascade on `users` would otherwise leave orphaned rows.
  await tx
    .delete(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.participantType, "user"),
        eq(conversationParticipants.participantId, userId),
      ),
    );

  // Phase (4) — drop the users row; FK cascade handles the remaining
  // tables that ARE declared cascade (roster_entries, post_reactions,
  // post_shares, user_followers, parental_consents linkage, etc.).
  await tx.delete(users).where(eq(users.id, userId));
}

// Self-contained hard-delete: opens a transaction, takes a per-user
// advisory lock so concurrent purges of the same account serialize,
// then runs the purge phases. Idempotent — re-running against an
// already-deleted userId is a no-op (every phase matches zero rows).
export async function hardDeleteUser(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('user-hard-delete:' || ${userId}))`,
    );
    await purgeUserWithinTx(tx, userId);
  });
}
