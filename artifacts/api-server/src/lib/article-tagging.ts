import { db, articleTags, articles, notifications, rosterEntries, users } from "@workspace/db";
import { and, eq, gt, inArray } from "drizzle-orm";
import { articlePostId } from "./spec-helpers";

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
  await db.insert(notifications).values(
    target.map((userId) => ({
      userId,
      kind: "post_tag",
      message: `You were tagged in "${title}"`,
      link,
      actorUserId: args.actorUserId,
    })),
  );
}
