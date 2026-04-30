import { db, articleTags, articles, notifications, rosterEntries, users } from "@workspace/db";
import { and, eq, gt, inArray } from "drizzle-orm";
import { articlePostId, highlightPostId } from "./spec-helpers";
import {
  buildPostUrl,
  isEmailConfigured,
  sendTagNotificationEmail,
} from "./email";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Article auto-tag fan-out (game recaps)
// ---------------------------------------------------------------------------
// When an article has `gameDate` set, every accepted player on the
// team's roster is auto-tagged. Called from POST /posts (initial
// create) and POST /posts/:postId/publish (draft → publish path) so
// drafts that get a game date added later still tag everyone at
// publish time. ON CONFLICT DO NOTHING keeps re-runs idempotent.
export async function applyArticleTagFanout(args: {
  articleId: string;
  teamId: string;
  taggerUserId: string;
  explicitUserIds: string[];
  gameDate: Date | null;
}): Promise<string[]> {
  type Entry = { status: "approved" | "pending"; source: "manual" | "auto" };
  const tagMap = new Map<string, Entry>();
  for (const uid of args.explicitUserIds) {
    tagMap.set(uid, { status: "approved", source: "manual" });
  }
  if (args.gameDate) {
    const players = await db
      .select({
        userId: rosterEntries.userId,
        requireTagConsent: users.requireTagConsent,
        parentId: users.parentId,
      })
      .from(rosterEntries)
      .innerJoin(users, eq(rosterEntries.userId, users.id))
      .where(
        and(
          eq(rosterEntries.teamId, args.teamId),
          eq(rosterEntries.role, "player"),
          eq(rosterEntries.status, "accepted"),
        ),
      );
    const parentIds = Array.from(
      new Set(players.map((p) => p.parentId).filter((p): p is string => !!p)),
    );
    const parentConsent = new Map<string, boolean>();
    if (parentIds.length > 0) {
      const parents = await db
        .select({ id: users.id, flag: users.requireTagConsent })
        .from(users)
        .where(inArray(users.id, parentIds));
      for (const p of parents) parentConsent.set(p.id, !!p.flag);
    }
    for (const p of players) {
      const parentRequires = p.parentId
        ? !!parentConsent.get(p.parentId)
        : false;
      const requires = !!p.requireTagConsent || parentRequires;
      const rosterStatus: "approved" | "pending" = requires ? "pending" : "approved";
      const existing = tagMap.get(p.userId);
      if (existing) {
        if (rosterStatus === "pending") existing.status = "pending";
      } else {
        tagMap.set(p.userId, { status: rosterStatus, source: "auto" });
      }
    }
  }
  if (tagMap.size === 0) return [];
  const existing = await db
    .select({ userId: articleTags.userId })
    .from(articleTags)
    .where(eq(articleTags.articleId, args.articleId));
  for (const row of existing) tagMap.delete(row.userId);
  if (tagMap.size === 0) return [];
  const inserted = await db
    .insert(articleTags)
    .values(
      Array.from(tagMap.entries()).map(([userId, entry]) => ({
        articleId: args.articleId,
        userId,
        taggerUserId: args.taggerUserId,
        status: entry.status,
        source: entry.source,
      })),
    )
    .onConflictDoNothing()
    .returning({ userId: articleTags.userId });
  return inserted.map((r) => r.userId);
}

// Throttle window for "you were tagged in <recap>" notifications.
export const TAG_NOTIF_THROTTLE_MS = 10 * 60 * 1000;

// Shared email fan-out used by both the recap and highlight notify
// helpers (task #324). The bell-row throttle in the callers acts as the
// throttle for the email channel too — we only ever email users that
// just got a fresh bell row inserted, so re-tagging within the throttle
// window doesn't spam.
//
// `statusByUser` lets us pick the right email copy:
//   * "approved"  → "you were tagged in …"
//   * "pending"   → "please review and approve a tag on you in …"
// Self-tags are filtered defensively here as well as upstream so a
// missed filter at a single call site can't leak a self-ping email.
async function sendTagEmails(args: {
  userIds: string[];
  statusByUser: Map<string, "pending" | "approved">;
  postTitle: string;
  postLink: string;
  actorUserId: string | null;
}): Promise<void> {
  if (args.userIds.length === 0) return;
  // Skip the entire DB roundtrip when SendGrid isn't wired up — keeps
  // tests quiet (no warn-per-recipient log) and avoids a wasted query
  // in environments that intentionally disable email.
  if (!isEmailConfigured()) return;
  const candidates = args.actorUserId
    ? args.userIds.filter((u) => u !== args.actorUserId)
    : args.userIds;
  if (candidates.length === 0) return;
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, candidates));
  const postUrl = buildPostUrl(args.postLink);
  await Promise.all(
    rows
      .filter((r): r is { id: string; email: string } => !!r.email)
      .map(async (r) => {
        const pending =
          (args.statusByUser.get(r.id) ?? "approved") === "pending";
        try {
          await sendTagNotificationEmail(r.email, {
            postTitle: args.postTitle,
            postUrl,
            pending,
          });
        } catch (err) {
          // Email failures must never bubble up and break the request.
          // The bell row is already written; the email is a best-effort
          // additional channel. Log and move on.
          logger.error(
            { err, userId: r.id },
            "Failed to send tag notification email",
          );
        }
      }),
  );
}

export async function notifyNewlyTaggedInRecap(args: {
  userIds: string[];
  articleId: string;
  articleTitle: string | null;
  actorUserId: string | null;
}): Promise<void> {
  if (args.userIds.length === 0) return;
  // Notification links must use the prefixed post id so /posts/:postId
  // resolves them — the bare uuid form 404s on the post page.
  const link = `/posts/${articlePostId(args.articleId)}`;
  const since = new Date(Date.now() - TAG_NOTIF_THROTTLE_MS);
  const recent = await db
    .select({ userId: notifications.userId })
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, "post_tag"),
        eq(notifications.link, link),
        inArray(notifications.userId, args.userIds),
        gt(notifications.createdAt, since),
      ),
    );
  const skip = new Set(recent.map((r) => r.userId));
  const target = args.userIds.filter((u) => !skip.has(u));
  if (target.length === 0) return;
  const title = args.articleTitle?.trim() ? args.articleTitle.trim() : "Untitled";
  // Look up the per-user tag status so the email channel can pick the
  // "review and approve" copy for pending tags. Bell wording stays
  // status-agnostic for recaps to preserve the existing message format
  // older clients may rely on. (task #324)
  const statusRows = await db
    .select({ userId: articleTags.userId, status: articleTags.status })
    .from(articleTags)
    .where(
      and(
        eq(articleTags.articleId, args.articleId),
        inArray(articleTags.userId, target),
      ),
    );
  const statusByUser = new Map<string, "pending" | "approved">();
  for (const r of statusRows) {
    if (r.status === "pending" || r.status === "approved") {
      statusByUser.set(r.userId, r.status);
    }
  }
  await db.insert(notifications).values(
    target.map((userId) => ({
      userId,
      kind: "post_tag",
      message: `You were tagged in "${title}"`,
      link,
      actorUserId: args.actorUserId,
    })),
  );
  await sendTagEmails({
    userIds: target,
    statusByUser,
    postTitle: title,
    postLink: link,
    actorUserId: args.actorUserId,
  });
}

// ---------------------------------------------------------------------------
// Highlight tag fan-out notification (task #320)
// ---------------------------------------------------------------------------
// Mirrors `notifyNewlyTaggedInRecap` for the highlight-tag insert path
// in POST /posts/:postId/tags. Differences vs. the recap helper:
//   * Self-tags are silently dropped — when the post author tags
//     themselves we don't ping them about their own action. The recap
//     fan-out doesn't need this filter since the auto-tag covers
//     accepted players only and the author (a coach/admin) typically
//     isn't on the player roster.
//   * Pending tags get a "review tag" prompt rather than the plain
//     "you were tagged" line so the player knows the bell row needs
//     a decision before the tag goes live (mirrors the consent prompt
//     parents see for their child's pending tags).
// Throttle window and notification kind/link match the recap path so
// dedupe rules in the bell UI carry over.
export async function notifyNewlyTaggedInHighlight(args: {
  tags: { userId: string; status: "pending" | "approved" }[];
  highlightId: string;
  highlightTitle: string | null;
  actorUserId: string | null;
}): Promise<void> {
  // Drop self-tags before any DB work so the post author proposing
  // themselves is a complete no-op (no row, no throttle entry).
  const candidates = args.tags.filter(
    (t) => !args.actorUserId || t.userId !== args.actorUserId,
  );
  if (candidates.length === 0) return;
  const link = `/posts/${highlightPostId(args.highlightId)}`;
  const since = new Date(Date.now() - TAG_NOTIF_THROTTLE_MS);
  const recent = await db
    .select({ userId: notifications.userId })
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, "post_tag"),
        eq(notifications.link, link),
        inArray(
          notifications.userId,
          candidates.map((t) => t.userId),
        ),
        gt(notifications.createdAt, since),
      ),
    );
  const skip = new Set(recent.map((r) => r.userId));
  const target = candidates.filter((t) => !skip.has(t.userId));
  if (target.length === 0) return;
  const title = args.highlightTitle?.trim() ? args.highlightTitle.trim() : "Untitled";
  await db.insert(notifications).values(
    target.map((t) => ({
      userId: t.userId,
      kind: "post_tag",
      message:
        t.status === "pending"
          ? `Please review a tag on you in "${title}"`
          : `You were tagged in "${title}"`,
      link,
      actorUserId: args.actorUserId,
    })),
  );
  // Mirror the bell channel into email so out-of-app players still find
  // out (task #324). statusByUser carries the pending/approved decision
  // straight from the caller — for highlights we already have it on the
  // inserted tag row, no extra lookup needed.
  const statusByUser = new Map<string, "pending" | "approved">(
    target.map((t) => [t.userId, t.status]),
  );
  await sendTagEmails({
    userIds: target.map((t) => t.userId),
    statusByUser,
    postTitle: title,
    postLink: link,
    actorUserId: args.actorUserId,
  });
}
