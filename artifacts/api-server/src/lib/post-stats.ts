import { db, albumPhotos, articles, highlights, orgPosts, postReactions, postComments, postShares, teamNewsLinks, users } from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { logger } from "./logger.js";

export interface PostStats {
  reactionCount: number;
  hasReacted: boolean;
  commentCount: number;
  recentReactorName: string | null;
  // Number of photos in the post's fan/team photo album, shown as a
  // badge on the feed card's "Photos" button.
  albumPhotoCount: number;
}

export interface PostShareStats {
  shareCount: number;
  hasShared: boolean;
}

export type StatsKind = "article" | "highlight" | "org_post" | "news";

function statsKey(kind: StatsKind, refId: string): string {
  return `${kind}:${refId}`;
}

// B5 (code review) — defensive cap so a future uncapped caller can't
// issue an unbounded `inArray`. Feed/profile callers already cap upstream
// (~70 ids), so this only guards against regressions; any truncated ids
// keep their seeded zero-stats.
const MAX_STATS_BATCH = 500;
function capBatch(ids: string[]): string[] {
  if (ids.length > MAX_STATS_BATCH) {
    logger.warn(
      { count: ids.length, cap: MAX_STATS_BATCH },
      "post-stats batch exceeded cap; truncating",
    );
    return ids.slice(0, MAX_STATS_BATCH);
  }
  return ids;
}

export async function loadPostStats(
  meId: string | null,
  items: Array<{ kind: StatsKind; refId: string }>,
): Promise<Map<string, PostStats>> {
  const map = new Map<string, PostStats>();
  if (items.length === 0) return map;
  for (const it of items) {
    map.set(statsKey(it.kind, it.refId), {
      reactionCount: 0,
      hasReacted: false,
      commentCount: 0,
      recentReactorName: null,
      albumPhotoCount: 0,
    });
  }
  // Task #867 — one generic per-kind block (was three copy-pasted ones);
  // adding a kind now only means extending STAT_KINDS/StatsKind.
  const STAT_KINDS: StatsKind[] = ["article", "highlight", "org_post", "news"];
  const idsByKind = new Map<StatsKind, string[]>(
    STAT_KINDS.map((kind) => [
      kind,
      capBatch(items.filter((i) => i.kind === kind).map((i) => i.refId)),
    ]),
  );

  const tasks: Promise<unknown>[] = [];

  for (const kind of STAT_KINDS) {
    const refIds = idsByKind.get(kind)!;
    if (refIds.length === 0) continue;
    tasks.push(
      (async () => {
        const rows = await db
          .select({
            postRefId: postReactions.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(postReactions)
          .where(and(eq(postReactions.postKind, kind), inArray(postReactions.postRefId, refIds)))
          .groupBy(postReactions.postRefId);
        for (const r of rows) {
          const s = map.get(statsKey(kind, r.postRefId));
          if (s) s.reactionCount = Number(r.count);
        }
        if (meId) {
          const my = await db
            .select({ postRefId: postReactions.postRefId })
            .from(postReactions)
            .where(
              and(
                eq(postReactions.postKind, kind),
                eq(postReactions.userId, meId),
                inArray(postReactions.postRefId, refIds),
              ),
            );
          for (const r of my) {
            const s = map.get(statsKey(kind, r.postRefId));
            if (s) s.hasReacted = true;
          }
        }
        const recent = await db
          .select({
            postRefId: postReactions.postRefId,
            createdAt: postReactions.createdAt,
            name: users.name,
          })
          .from(postReactions)
          .innerJoin(users, eq(postReactions.userId, users.id))
          .where(and(eq(postReactions.postKind, kind), inArray(postReactions.postRefId, refIds)))
          .orderBy(desc(postReactions.createdAt));
        for (const r of recent) {
          const s = map.get(statsKey(kind, r.postRefId));
          if (s && !s.recentReactorName) s.recentReactorName = r.name;
        }
        const cmts = await db
          .select({
            postRefId: postComments.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(postComments)
          .where(
            and(
              eq(postComments.postKind, kind),
              isNull(postComments.deletedAt),
              eq(postComments.moderationStatus, "approved"),
              inArray(postComments.postRefId, refIds),
            ),
          )
          .groupBy(postComments.postRefId);
        for (const c of cmts) {
          const s = map.get(statsKey(kind, c.postRefId));
          if (s) s.commentCount = Number(c.count);
        }
      })(),
    );
  }
  // Album photo counts — `album_photos` is polymorphic over
  // (postKind, postRefId), so one grouped query covers all kinds.
  // (News posts never have albums; they simply match zero rows.)
  const allIds = Array.from(idsByKind.values()).flat();
  if (allIds.length > 0) {
    tasks.push(
      (async () => {
        const rows = await db
          .select({
            postKind: albumPhotos.postKind,
            postRefId: albumPhotos.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(albumPhotos)
          .where(inArray(albumPhotos.postRefId, allIds))
          .groupBy(albumPhotos.postKind, albumPhotos.postRefId);
        for (const r of rows) {
          const s = map.get(statsKey(r.postKind as StatsKind, r.postRefId));
          if (s) s.albumPhotoCount = Number(r.count);
        }
      })(),
    );
  }
  await Promise.all(tasks);
  return map;
}

export function statsFor(
  map: Map<string, PostStats>,
  kind: StatsKind,
  refId: string,
): PostStats {
  return (
    map.get(statsKey(kind, refId)) ?? {
      reactionCount: 0,
      hasReacted: false,
      commentCount: 0,
      recentReactorName: null,
      albumPhotoCount: 0,
    }
  );
}

// Share stats — `article`, `highlight`, and `news` (#867) are valid share
// targets; org_post is rejected at the share API layer (#190).
export type ShareStatsKind = "article" | "highlight" | "news";

export async function loadPostShareStats(
  meId: string | null,
  items: Array<{ kind: ShareStatsKind; refId: string }>,
): Promise<Map<string, PostShareStats>> {
  const map = new Map<string, PostShareStats>();
  if (items.length === 0) return map;
  for (const it of items) {
    map.set(statsKey(it.kind, it.refId), { shareCount: 0, hasShared: false });
  }
  const articleIds = capBatch(items.filter((i) => i.kind === "article").map((i) => i.refId));
  const highlightIds = capBatch(items.filter((i) => i.kind === "highlight").map((i) => i.refId));
  const newsIds = capBatch(items.filter((i) => i.kind === "news").map((i) => i.refId));

  const tasks: Promise<unknown>[] = [];
  for (const [kind, refIds] of [
    ["article", articleIds] as const,
    ["highlight", highlightIds] as const,
    ["news", newsIds] as const,
  ]) {
    if (refIds.length === 0) continue;
    tasks.push(
      (async () => {
        const counts = await db
          .select({
            postRefId: postShares.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(postShares)
          .where(and(eq(postShares.postKind, kind), inArray(postShares.postRefId, refIds)))
          .groupBy(postShares.postRefId);
        for (const r of counts) {
          const s = map.get(statsKey(kind, r.postRefId));
          if (s) s.shareCount = Number(r.count);
        }
        if (meId) {
          const my = await db
            .select({ postRefId: postShares.postRefId })
            .from(postShares)
            .where(
              and(
                eq(postShares.postKind, kind),
                eq(postShares.sharerUserId, meId),
                inArray(postShares.postRefId, refIds),
              ),
            );
          for (const r of my) {
            const s = map.get(statsKey(kind, r.postRefId));
            if (s) s.hasShared = true;
          }
        }
      })(),
    );
  }
  await Promise.all(tasks);
  return map;
}

export function shareStatsFor(
  map: Map<string, PostShareStats>,
  kind: ShareStatsKind,
  refId: string,
): PostShareStats {
  return map.get(statsKey(kind, refId)) ?? { shareCount: 0, hasShared: false };
}

// Resolve the owner (author / uploader) of a post given its parsed
// (kind, id). Used by the like-notification path to address the bell
// row to the correct user. Returns null when the post can't be located.
export async function loadPostOwnerId(
  parsed: { kind: "article" | "highlight" | "org_post" | "news"; id: string },
): Promise<string | null> {
  // Task #867 — news posts are owned by whoever attached the link; the
  // column is nullable (SET NULL on user delete), so owner may be null.
  if (parsed.kind === "news") {
    const [n] = await db
      .select({ id: teamNewsLinks.addedByUserId })
      .from(teamNewsLinks)
      .where(eq(teamNewsLinks.id, parsed.id))
      .limit(1);
    return n?.id ?? null;
  }
  if (parsed.kind === "article") {
    const [a] = await db
      .select({ id: articles.authorId })
      .from(articles)
      .where(eq(articles.id, parsed.id))
      .limit(1);
    return a?.id ?? null;
  }
  if (parsed.kind === "highlight") {
    const [h] = await db
      .select({ id: highlights.uploaderId })
      .from(highlights)
      .where(eq(highlights.id, parsed.id))
      .limit(1);
    return h?.id ?? null;
  }
  const [o] = await db
    .select({ id: orgPosts.authorId })
    .from(orgPosts)
    .where(eq(orgPosts.id, parsed.id))
    .limit(1);
  return o?.id ?? null;
}
