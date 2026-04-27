import { db, articles, highlights, orgPosts, postReactions, postComments, postShares, users } from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

export interface PostStats {
  reactionCount: number;
  hasReacted: boolean;
  commentCount: number;
  recentReactorName: string | null;
}

export interface PostShareStats {
  shareCount: number;
  hasShared: boolean;
}

export type StatsKind = "article" | "highlight" | "org_post";

function statsKey(kind: StatsKind, refId: string): string {
  return `${kind}:${refId}`;
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
    });
  }
  const articleIds = items.filter((i) => i.kind === "article").map((i) => i.refId);
  const highlightIds = items.filter((i) => i.kind === "highlight").map((i) => i.refId);
  const orgPostIds = items.filter((i) => i.kind === "org_post").map((i) => i.refId);

  const tasks: Promise<unknown>[] = [];

  if (articleIds.length > 0) {
    tasks.push(
      (async () => {
        const rows = await db
          .select({
            postRefId: postReactions.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(postReactions)
          .where(and(eq(postReactions.postKind, "article"), inArray(postReactions.postRefId, articleIds)))
          .groupBy(postReactions.postRefId);
        for (const r of rows) {
          const k = statsKey("article", r.postRefId);
          const s = map.get(k);
          if (s) s.reactionCount = Number(r.count);
        }
        if (meId) {
          const my = await db
            .select({ postRefId: postReactions.postRefId })
            .from(postReactions)
            .where(
              and(
                eq(postReactions.postKind, "article"),
                eq(postReactions.userId, meId),
                inArray(postReactions.postRefId, articleIds),
              ),
            );
          for (const r of my) {
            const s = map.get(statsKey("article", r.postRefId));
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
          .where(and(eq(postReactions.postKind, "article"), inArray(postReactions.postRefId, articleIds)))
          .orderBy(desc(postReactions.createdAt));
        for (const r of recent) {
          const s = map.get(statsKey("article", r.postRefId));
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
              eq(postComments.postKind, "article"),
              isNull(postComments.deletedAt),
              inArray(postComments.postRefId, articleIds),
            ),
          )
          .groupBy(postComments.postRefId);
        for (const c of cmts) {
          const s = map.get(statsKey("article", c.postRefId));
          if (s) s.commentCount = Number(c.count);
        }
      })(),
    );
  }
  if (highlightIds.length > 0) {
    tasks.push(
      (async () => {
        const rows = await db
          .select({
            postRefId: postReactions.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(postReactions)
          .where(and(eq(postReactions.postKind, "highlight"), inArray(postReactions.postRefId, highlightIds)))
          .groupBy(postReactions.postRefId);
        for (const r of rows) {
          const s = map.get(statsKey("highlight", r.postRefId));
          if (s) s.reactionCount = Number(r.count);
        }
        if (meId) {
          const my = await db
            .select({ postRefId: postReactions.postRefId })
            .from(postReactions)
            .where(
              and(
                eq(postReactions.postKind, "highlight"),
                eq(postReactions.userId, meId),
                inArray(postReactions.postRefId, highlightIds),
              ),
            );
          for (const r of my) {
            const s = map.get(statsKey("highlight", r.postRefId));
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
          .where(and(eq(postReactions.postKind, "highlight"), inArray(postReactions.postRefId, highlightIds)))
          .orderBy(desc(postReactions.createdAt));
        for (const r of recent) {
          const s = map.get(statsKey("highlight", r.postRefId));
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
              eq(postComments.postKind, "highlight"),
              isNull(postComments.deletedAt),
              inArray(postComments.postRefId, highlightIds),
            ),
          )
          .groupBy(postComments.postRefId);
        for (const c of cmts) {
          const s = map.get(statsKey("highlight", c.postRefId));
          if (s) s.commentCount = Number(c.count);
        }
      })(),
    );
  }
  if (orgPostIds.length > 0) {
    tasks.push(
      (async () => {
        const rows = await db
          .select({
            postRefId: postReactions.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(postReactions)
          .where(and(eq(postReactions.postKind, "org_post"), inArray(postReactions.postRefId, orgPostIds)))
          .groupBy(postReactions.postRefId);
        for (const r of rows) {
          const s = map.get(statsKey("org_post", r.postRefId));
          if (s) s.reactionCount = Number(r.count);
        }
        if (meId) {
          const my = await db
            .select({ postRefId: postReactions.postRefId })
            .from(postReactions)
            .where(
              and(
                eq(postReactions.postKind, "org_post"),
                eq(postReactions.userId, meId),
                inArray(postReactions.postRefId, orgPostIds),
              ),
            );
          for (const r of my) {
            const s = map.get(statsKey("org_post", r.postRefId));
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
          .where(and(eq(postReactions.postKind, "org_post"), inArray(postReactions.postRefId, orgPostIds)))
          .orderBy(desc(postReactions.createdAt));
        for (const r of recent) {
          const s = map.get(statsKey("org_post", r.postRefId));
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
              eq(postComments.postKind, "org_post"),
              isNull(postComments.deletedAt),
              inArray(postComments.postRefId, orgPostIds),
            ),
          )
          .groupBy(postComments.postRefId);
        for (const c of cmts) {
          const s = map.get(statsKey("org_post", c.postRefId));
          if (s) s.commentCount = Number(c.count);
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
    }
  );
}

// Share stats — only `article` and `highlight` are valid share targets;
// org_post is rejected at the share API layer (#190).
export type ShareStatsKind = "article" | "highlight";

export async function loadPostShareStats(
  meId: string | null,
  items: Array<{ kind: ShareStatsKind; refId: string }>,
): Promise<Map<string, PostShareStats>> {
  const map = new Map<string, PostShareStats>();
  if (items.length === 0) return map;
  for (const it of items) {
    map.set(statsKey(it.kind, it.refId), { shareCount: 0, hasShared: false });
  }
  const articleIds = items.filter((i) => i.kind === "article").map((i) => i.refId);
  const highlightIds = items.filter((i) => i.kind === "highlight").map((i) => i.refId);

  const tasks: Promise<unknown>[] = [];
  for (const [kind, refIds] of [
    ["article", articleIds] as const,
    ["highlight", highlightIds] as const,
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
  parsed: { kind: "article" | "highlight" | "org_post"; id: string },
): Promise<string | null> {
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
