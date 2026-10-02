import { db, orgPosts, organizations, postShares, users, takedownRequests } from "@workspace/db";
import { and, eq, inArray, isNull, desc, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { canManageOrganization } from "./permissions";
import { orgPostToPost, buildMinorNameContext, toPostAuthor } from "./spec-helpers";
import { loadPostStats, loadPostShareStats, statsFor, shareStatsFor } from "./post-stats";

/** Historical org shares only; ordinary organization Updates stay unchanged. */
export async function loadHistoricalOrgShares(args: {
  viewerId: string | null; viewerRole?: string | null; sharerIds: string[];
  limit: number; before?: Date;
}) {
  if (!args.sharerIds.length) return [];
  const sharer = alias(users, "historical_sharer");
  const rows = await db.select({ p: orgPosts, org: organizations, author: users, share: postShares, sharer })
    .from(postShares)
    .innerJoin(orgPosts, and(eq(postShares.postKind, "org_post"), eq(postShares.postRefId, orgPosts.id)))
    .innerJoin(organizations, eq(orgPosts.organizationId, organizations.id))
    .leftJoin(users, eq(orgPosts.authorId, users.id)).leftJoin(sharer, eq(postShares.sharerUserId, sharer.id))
    .where(and(inArray(postShares.sharerUserId, args.sharerIds),
      eq(orgPosts.recapKind, "historical"), eq(orgPosts.status, "published"), isNull(orgPosts.hiddenAt),
      ...(args.before ? [lte(postShares.createdAt, args.before)] : [])))
    .orderBy(desc(postShares.createdAt)).limit(args.limit);
  if (!rows.length) return [];
  const keys = rows.map((r) => ({ kind: "org_post" as const, refId: r.p.id }));
  const [stats, shares, ctx, pending] = await Promise.all([
    loadPostStats(args.viewerId, keys), loadPostShareStats(args.viewerId, keys),
    buildMinorNameContext({ id: args.viewerId, role: args.viewerRole ?? null },
      rows.flatMap((r) => [r.author?.id, r.sharer?.id]).filter((v): v is string => !!v)),
    db.select({ id: takedownRequests.postRefId }).from(takedownRequests).where(and(
      eq(takedownRequests.postKind, "org_post"), eq(takedownRequests.status, "pending"),
      inArray(takedownRequests.postRefId, rows.map((r) => r.p.id)),
    )),
  ]);
  const blocked = new Set(pending.map((r) => r.id));
  const seen = new Set<string>();
  const posts = [];
  for (const r of rows) {
    if (blocked.has(r.p.id) || seen.has(r.p.id)) continue;
    seen.add(r.p.id);
    const sharerUser = r.sharer;
    const sharedBy = sharerUser ? toPostAuthor(sharerUser, { minorNameCtx: ctx }) : null;
    posts.push(orgPostToPost(r.p, {
      org: r.org, author: r.author, minorNameCtx: ctx,
      canEdit: r.p.authorId === args.viewerId || (!!args.viewerId && await canManageOrganization(args.viewerId, r.org.id)),
      ...statsFor(stats, "org_post", r.p.id), ...shareStatsFor(shares, "org_post", r.p.id),
      sharedBy, sharedAt: r.share.createdAt.toISOString(),
    }));
  }
  return posts;
}