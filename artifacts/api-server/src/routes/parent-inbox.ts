import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  users,
  organizations,
  organizationAdmins,
  userFollowers,
  teams,
  rosterEntries,
  rosterInvites,
  articles,
  articleTags,
  highlights,
  highlightTags,
  notifications,
  postReactions,
  postComments,
  conversationParticipants,
  messages,
  parentChildNotificationReads,
  messageChildHides,
} from "@workspace/db";
import {
  and,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
} from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import { sendGuardianConfirmationEmail, sendGuardianExpiredEmail, sendPasswordResetEmail } from "../lib/email";
import { canCreateRecap, canManageOrganization, isTeamMember, canManageTeam } from "../lib/permissions";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../lib/auth";
import {
  toPublicUser,
  displayName,
  toTeamMember,
  toInvite,
  paginate,
  parsePostId,
  articlePostId,
  highlightPostId,
  apiError,
  safeAvatarUrl,
  notFound,
  type PostKind,
} from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostOwnerId,
  type PostStats,
  type StatsKind,
} from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap, TAG_NOTIF_THROTTLE_MS } from "../lib/article-tagging";
import { ensureOrgFollowedForTeam } from "../lib/team-follow";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Parent inbox: unified per-child notification stream
// ---------------------------------------------------------------------------
// Roster invites are not the only thing parents need to see. Coaches tag
// children in game recaps, comment on those recaps, and DM the child
// directly. Today the only of those that fans out to the parent is the
// roster invite. This endpoint aggregates every recent event addressed to
// the child so the parent can supervise without logging in as the child.
//
// The stream is computed on the fly from:
//   - `notifications` rows addressed to the child (mention, roster_invite,
//     ...) — these are the events the child themselves sees
//   - `articleTags` for the child (tags in posts / recaps)
//   - `postComments` on articles authored by the child OR articles the
//     child is tagged in, excluding the child's own comments
//   - `messages` in conversations the child participates in, sent by
//     someone other than the child
//   - `rosterEntries` for the child (roster events: invites + status)
//
// Each item is keyed `kind:underlyingId`. Per-parent read state is stored
// in `parent_child_notification_reads`, keyed by (parentId, childId,
// itemKey), so marking-as-seen by the parent does NOT touch the child's
// own read flags. Auth shape mirrors the pending-team-invites endpoint:
// real (non-masquerading) parent or real admin.

type ChildItemKind =
  | "notification"
  | "tag"
  | "comment"
  | "message"
  | "roster"
  | "authoredArticle"
  | "authoredHighlight";
type ChildItemDecision = "approved" | "removed";

interface ChildItem {
  itemKey: string;
  kind: ChildItemKind;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  // Whether the parent has explicitly approved or removed this item, or
  // null if it's still awaiting their decision (or was only ever marked
  // as seen via the legacy read overlay).
  decision: ChildItemDecision | null;
  createdAt: string;
  actor: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
}

const CHILD_ITEM_LOOKBACK_DAYS = 90;
const CHILD_ITEM_PER_SOURCE_LIMIT = 50;
const CHILD_ITEM_TOTAL_LIMIT = 50;

async function loadChildNotificationItems(
  child: typeof users.$inferSelect,
): Promise<ChildItem[]> {
  const childId = child.id;
  const since = new Date(
    Date.now() - CHILD_ITEM_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  const items: ChildItem[] = [];

  // 1. Notifications addressed to the child
  const childNotifs = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, childId),
        gt(notifications.createdAt, since),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(CHILD_ITEM_PER_SOURCE_LIMIT);
  for (const n of childNotifs) {
    items.push({
      itemKey: `notification:${n.id}`,
      kind: "notification",
      title: n.message,
      body: null,
      link: n.link ?? null,
      isRead: false, // overlaid below from parent's read table
      decision: null, // overlaid below
      createdAt: n.createdAt.toISOString(),
      actor: null,
    });
  }

  // 2. Tags for the child (only `pending` — once the child or the
  //    parent makes a final decision the row should drop out of the
  //    family inbox immediately. `approved` rows are no longer awaiting
  //    the parent's review, and `declined` was already filtered.
  const tagRows = await db
    .select({
      t: articleTags,
      a: articles,
      tagger: users,
    })
    .from(articleTags)
    .innerJoin(articles, eq(articleTags.articleId, articles.id))
    .leftJoin(users, eq(articleTags.taggerUserId, users.id))
    .where(
      and(
        eq(articleTags.userId, childId),
        eq(articleTags.status, "pending"),
        gt(articleTags.createdAt, since),
      ),
    )
    .orderBy(desc(articleTags.createdAt))
    .limit(CHILD_ITEM_PER_SOURCE_LIMIT);
  const childFirst = (child.name?.trim().split(/\s+/)[0] ?? "").length > 0
    ? child.name!.trim().split(/\s+/)[0]
    : "your child";
  for (const r of tagRows) {
    const taggerName = r.tagger ? displayName(r.tagger) : "Someone";
    const articleTitle = r.a.title ?? "Untitled";
    items.push({
      itemKey: `tag:${r.t.id}`,
      kind: "tag",
      title: `${taggerName} tagged ${childFirst} in "${articleTitle}"`,
      body:
        r.t.status === "pending"
          ? "Pending consent — review the tag for your child."
          : null,
      // Carry the childId so the post page can render a "viewing as your
      // child's guardian" banner and offer a back-link to the family stream.
      link: `/posts/${articlePostId(r.a.id)}?asChild=${childId}`,
      isRead: false,
      decision: null,
      createdAt: r.t.createdAt.toISOString(),
      actor: r.tagger
        ? {
            id: r.tagger.id,
            displayName: displayName(r.tagger),
            avatarUrl: safeAvatarUrl(r.tagger.avatarUrl),
          }
        : null,
    });
  }

  // 2b. Highlight-clip tags for the child (only `pending` — same
  //     filter as article tags above). Surfaced in the family inbox so
  //     a parent can approve/decline highlight tags on behalf of their
  //     child. Approved/declined rows drop out of the inbox immediately
  //     so a child-side decision via /tags/:tagId/(approve|decline)
  //     clears the parent's row on the next fetch.
  const highlightTagRows = await db
    .select({
      t: highlightTags,
      h: highlights,
      tagger: users,
    })
    .from(highlightTags)
    .innerJoin(highlights, eq(highlightTags.highlightId, highlights.id))
    .leftJoin(users, eq(highlightTags.taggerUserId, users.id))
    .where(
      and(
        eq(highlightTags.userId, childId),
        eq(highlightTags.status, "pending"),
        gt(highlightTags.createdAt, since),
      ),
    )
    .orderBy(desc(highlightTags.createdAt))
    .limit(CHILD_ITEM_PER_SOURCE_LIMIT);
  for (const r of highlightTagRows) {
    const taggerName = r.tagger ? displayName(r.tagger) : "Someone";
    const highlightTitle = r.h.title ?? "Untitled";
    items.push({
      itemKey: `tag:${r.t.id}`,
      kind: "tag",
      title: `${taggerName} tagged ${childFirst} in "${highlightTitle}"`,
      body:
        r.t.status === "pending"
          ? "Pending consent — review the tag for your child."
          : null,
      link: `/posts/${highlightPostId(r.h.id)}?asChild=${childId}`,
      isRead: false,
      decision: null,
      createdAt: r.t.createdAt.toISOString(),
      actor: r.tagger
        ? {
            id: r.tagger.id,
            displayName: displayName(r.tagger),
            avatarUrl: safeAvatarUrl(r.tagger.avatarUrl),
          }
        : null,
    });
  }

  // 3. Comments on articles where the child is the author OR is tagged
  //    (status approved/pending — declined tag means the child isn't
  //    publicly associated with the article and shouldn't see comments).
  //    Exclude comments authored by the child themselves.
  const taggedArticleRows = await db
    .select({ id: articleTags.articleId })
    .from(articleTags)
    .where(
      and(
        eq(articleTags.userId, childId),
        inArray(articleTags.status, ["approved", "pending"] as const),
      ),
    );
  const authoredArticleRows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.authorId, childId));
  const involvedArticleIds = Array.from(
    new Set<string>([
      ...taggedArticleRows.map((r) => r.id),
      ...authoredArticleRows.map((r) => r.id),
    ]),
  );
  if (involvedArticleIds.length > 0) {
    const commentRows = await db
      .select({ c: postComments, a: articles, author: users })
      .from(postComments)
      .innerJoin(
        articles,
        and(
          eq(articles.id, postComments.postRefId),
          eq(postComments.postKind, "article"),
        ),
      )
      .leftJoin(users, eq(postComments.authorId, users.id))
      .where(
        and(
          inArray(postComments.postRefId, involvedArticleIds),
          eq(postComments.postKind, "article"),
          isNull(postComments.deletedAt),
          isNull(postComments.hiddenAt),
          gt(postComments.createdAt, since),
          ne(postComments.authorId, childId),
        ),
      )
      .orderBy(desc(postComments.createdAt))
      .limit(CHILD_ITEM_PER_SOURCE_LIMIT);
    for (const r of commentRows) {
      const authorName = r.author ? displayName(r.author) : "Someone";
      const articleTitle = r.a.title ?? "Untitled";
      items.push({
        itemKey: `comment:${r.c.id}`,
        kind: "comment",
        title: `${authorName} commented on "${articleTitle}"`,
        body:
          r.c.body.length > 140
            ? `${r.c.body.slice(0, 140)}…`
            : r.c.body,
        link: `/posts/${articlePostId(r.a.id)}?asChild=${childId}`,
        isRead: false,
        decision: null,
        createdAt: r.c.createdAt.toISOString(),
        actor: r.author
          ? {
              id: r.author.id,
              displayName: displayName(r.author),
              avatarUrl: safeAvatarUrl(r.author.avatarUrl),
            }
          : null,
      });
    }
  }

  // 4. Messages in conversations the child participates in, sent by
  //    other users (not the child themselves).
  const childConvRows = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.participantType, "user"),
        eq(conversationParticipants.participantId, childId),
        isNull(conversationParticipants.leftAt),
      ),
    );
  const childConvIds = childConvRows.map((r) => r.conversationId);
  if (childConvIds.length > 0) {
    // Pull message hides for this child so a message removed by the
    // parent stops surfacing in the family stream alongside being hidden
    // from the child's conversation view.
    const hideRows = await db
      .select({ messageId: messageChildHides.messageId })
      .from(messageChildHides)
      .where(eq(messageChildHides.childId, childId));
    const hiddenIds = new Set(hideRows.map((h) => h.messageId));
    const msgRows = await db
      .select({ m: messages, sender: users })
      .from(messages)
      .leftJoin(users, eq(messages.senderUserId, users.id))
      .where(
        and(
          inArray(messages.conversationId, childConvIds),
          ne(messages.senderUserId, childId),
          isNull(messages.deletedAt),
          gt(messages.createdAt, since),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(CHILD_ITEM_PER_SOURCE_LIMIT);
    const visibleMsgRows = msgRows.filter((r) => !hiddenIds.has(r.m.id));
    for (const r of visibleMsgRows) {
      const senderName = r.sender ? displayName(r.sender) : "Someone";
      const preview = r.m.body
        ? r.m.body.length > 140
          ? `${r.m.body.slice(0, 140)}…`
          : r.m.body
        : "Sent an attachment";
      items.push({
        itemKey: `message:${r.m.id}`,
        kind: "message",
        title: `${senderName} messaged ${childFirst}`,
        body: preview,
        // Land the parent on a read-only view of the child's actual
        // conversation (the parent isn't a participant, so /messages on
        // its own would just open the parent's own inbox).
        link: `/family/${childId}/messages/${r.m.conversationId}`,
        isRead: false,
        decision: null,
        createdAt: r.m.createdAt.toISOString(),
        actor: r.sender
          ? {
              id: r.sender.id,
              displayName: displayName(r.sender),
              avatarUrl: safeAvatarUrl(r.sender.avatarUrl),
            }
          : null,
      });
    }
  }

  // 4b. Articles authored by the child themselves (recent, not already
  //     hidden). Surfaced so a parent can take down a post their child
  //     uploaded — Remove flips `articles.hiddenAt = now()`, Approve
  //     just records the verdict. The link still points at the post
  //     page so the parent can preview before deciding.
  const authoredArticleRowsForFeed = await db
    .select({ a: articles })
    .from(articles)
    .where(
      and(
        eq(articles.authorId, childId),
        eq(articles.status, "published"),
        isNull(articles.hiddenAt),
        gt(articles.createdAt, since),
      ),
    )
    .orderBy(desc(articles.createdAt))
    .limit(CHILD_ITEM_PER_SOURCE_LIMIT);
  for (const r of authoredArticleRowsForFeed) {
    const articleTitle = r.a.title ?? "Untitled";
    items.push({
      itemKey: `authoredArticle:${r.a.id}`,
      kind: "authoredArticle",
      title: `${childFirst} wrote "${articleTitle}"`,
      body: null,
      link: `/posts/${articlePostId(r.a.id)}?asChild=${childId}`,
      isRead: false,
      decision: null,
      createdAt: r.a.createdAt.toISOString(),
      // The "actor" on an authored post is the child themselves; we
      // intentionally leave it null so the row doesn't render an
      // avatar that duplicates the child card it sits inside of.
      actor: null,
    });
  }

  // 4c. Highlights uploaded by the child themselves. Mirrors 4b for
  //     `highlights.uploaderId = childId`.
  const authoredHighlightRowsForFeed = await db
    .select({ h: highlights })
    .from(highlights)
    .where(
      and(
        eq(highlights.uploaderId, childId),
        isNull(highlights.hiddenAt),
        gt(highlights.createdAt, since),
      ),
    )
    .orderBy(desc(highlights.createdAt))
    .limit(CHILD_ITEM_PER_SOURCE_LIMIT);
  for (const r of authoredHighlightRowsForFeed) {
    const highlightTitle = r.h.title ?? "Untitled";
    items.push({
      itemKey: `authoredHighlight:${r.h.id}`,
      kind: "authoredHighlight",
      title: `${childFirst} posted a highlight: "${highlightTitle}"`,
      body: null,
      link: `/posts/${highlightPostId(r.h.id)}?asChild=${childId}`,
      isRead: false,
      decision: null,
      createdAt: r.h.createdAt.toISOString(),
      actor: null,
    });
  }

  // 5. Roster events for the child (recent invites + accepted/declined).
  //    These are higher-level than the per-team `roster_invite_for_child`
  //    notification because they cover acceptance/denial too.
  const rosterRows = await db
    .select({ entry: rosterEntries, team: teams })
    .from(rosterEntries)
    .innerJoin(teams, eq(rosterEntries.teamId, teams.id))
    .where(
      and(
        eq(rosterEntries.userId, childId),
        gt(rosterEntries.createdAt, since),
      ),
    )
    .orderBy(desc(rosterEntries.createdAt))
    .limit(CHILD_ITEM_PER_SOURCE_LIMIT);
  for (const r of rosterRows) {
    const verb =
      r.entry.status === "accepted"
        ? `joined ${r.team.name}`
        : r.entry.status === "pending"
          ? `was invited to ${r.team.name}`
          : `${r.entry.status} ${r.team.name}`;
    items.push({
      itemKey: `roster:${r.entry.id}`,
      kind: "roster",
      title: `${childFirst} ${verb}`,
      body: r.entry.position ?? null,
      link: `/family?childId=${childId}&entryId=${r.entry.id}&teamId=${r.team.id}`,
      isRead: false,
      decision: null,
      createdAt: r.entry.createdAt.toISOString(),
      actor: null,
    });
  }

  // Sort and trim to total cap
  items.sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  return items.slice(0, CHILD_ITEM_TOTAL_LIMIT);
}

async function applyParentReadOverlay(
  parentId: string,
  childId: string,
  items: ChildItem[],
): Promise<ChildItem[]> {
  if (items.length === 0) return items;
  const keys = items.map((i) => i.itemKey);
  const reads = await db
    .select({
      itemKey: parentChildNotificationReads.itemKey,
      decision: parentChildNotificationReads.decision,
    })
    .from(parentChildNotificationReads)
    .where(
      and(
        eq(parentChildNotificationReads.parentId, parentId),
        eq(parentChildNotificationReads.childId, childId),
        inArray(parentChildNotificationReads.itemKey, keys),
      ),
    );
  const readMap = new Map(reads.map((r) => [r.itemKey, r.decision]));
  return items.map((i) => {
    if (!readMap.has(i.itemKey)) return i;
    const decision = readMap.get(i.itemKey) ?? null;
    return {
      ...i,
      isRead: true,
      decision: decision === "approved" || decision === "removed"
        ? decision
        : null,
    };
  });
}

// Items the parent has explicitly approved or removed are dropped from
// the default feed so the family dashboard shows only items still
// awaiting their attention. Legacy "mark as seen" rows (decision === null)
// stay in the feed as read so behavior pre-Approve/Remove is preserved.
function visibleAfterDecision(items: ChildItem[]): ChildItem[] {
  return items.filter((i) => i.decision === null);
}

// Reconstruct ChildItem records for the parent's previously-decided
// items that are no longer surfaced by `loadChildNotificationItems`
// (e.g. a tag the parent declined leaves articleTags.status='declined',
// which the live stream filters out). Used only when the caller asks
// for `includeDecided=true` on the family notification feed so the
// parent can see and undo past decisions.
const DECIDED_EXTRAS_LIMIT = 30;
const ALLOWED_DECIDED_KINDS: ReadonlySet<ChildItemKind> = new Set([
  "notification",
  "tag",
  "comment",
  "message",
  "roster",
  "authoredArticle",
  "authoredHighlight",
]);

async function loadDecidedExtraItems(
  parentId: string,
  childId: string,
  child: typeof users.$inferSelect,
  liveKeys: ReadonlySet<string>,
): Promise<ChildItem[]> {
  const decidedRows = await db
    .select()
    .from(parentChildNotificationReads)
    .where(
      and(
        eq(parentChildNotificationReads.parentId, parentId),
        eq(parentChildNotificationReads.childId, childId),
        isNotNull(parentChildNotificationReads.decision),
      ),
    )
    .orderBy(desc(parentChildNotificationReads.decidedAt));

  const childFirst = (child.name?.trim().split(/\s+/)[0] ?? "").length > 0
    ? child.name!.trim().split(/\s+/)[0]
    : "your child";

  const extras: ChildItem[] = [];
  for (const row of decidedRows) {
    if (extras.length >= DECIDED_EXTRAS_LIMIT) break;
    if (liveKeys.has(row.itemKey)) continue;
    const [kind, ...rest] = row.itemKey.split(":");
    const refId = rest.join(":");
    if (!refId) continue;
    if (!ALLOWED_DECIDED_KINDS.has(kind as ChildItemKind)) continue;
    const decision: ChildItemDecision | null =
      row.decision === "approved" || row.decision === "removed"
        ? row.decision
        : null;
    if (!decision) continue;
    const fallbackCreatedAt = (row.decidedAt ?? row.readAt).toISOString();

    let item: ChildItem | null = null;
    if (kind === "tag") {
      const [r] = await db
        .select({ t: articleTags, a: articles, tagger: users })
        .from(articleTags)
        .innerJoin(articles, eq(articleTags.articleId, articles.id))
        .leftJoin(users, eq(articleTags.taggerUserId, users.id))
        .where(eq(articleTags.id, refId))
        .limit(1);
      if (r) {
        const taggerName = r.tagger ? displayName(r.tagger) : "Someone";
        const articleTitle = r.a.title ?? "Untitled";
        item = {
          itemKey: row.itemKey,
          kind: "tag",
          title: `${taggerName} tagged ${childFirst} in "${articleTitle}"`,
          body:
            r.t.status === "declined"
              ? "Tag was declined."
              : r.t.status === "pending"
                ? "Pending consent — review the tag for your child."
                : null,
          link: `/posts/${articlePostId(r.a.id)}?asChild=${childId}`,
          isRead: true,
          decision,
          createdAt: r.t.createdAt.toISOString(),
          actor: r.tagger
            ? {
                id: r.tagger.id,
                displayName: displayName(r.tagger),
                avatarUrl: safeAvatarUrl(r.tagger.avatarUrl),
              }
            : null,
        };
      }
    } else if (kind === "comment") {
      const [r] = await db
        .select({ c: postComments, a: articles, author: users })
        .from(postComments)
        .innerJoin(
          articles,
          and(
            eq(articles.id, postComments.postRefId),
            eq(postComments.postKind, "article"),
          ),
        )
        .leftJoin(users, eq(postComments.authorId, users.id))
        .where(eq(postComments.id, refId))
        .limit(1);
      if (r) {
        const authorName = r.author ? displayName(r.author) : "Someone";
        const articleTitle = r.a.title ?? "Untitled";
        item = {
          itemKey: row.itemKey,
          kind: "comment",
          title: `${authorName} commented on "${articleTitle}"`,
          body:
            r.c.body.length > 140 ? `${r.c.body.slice(0, 140)}…` : r.c.body,
          link: `/posts/${articlePostId(r.a.id)}?asChild=${childId}`,
          isRead: true,
          decision,
          createdAt: r.c.createdAt.toISOString(),
          actor: r.author
            ? {
                id: r.author.id,
                displayName: displayName(r.author),
                avatarUrl: safeAvatarUrl(r.author.avatarUrl),
              }
            : null,
        };
      }
    } else if (kind === "message") {
      const [r] = await db
        .select({ m: messages, sender: users })
        .from(messages)
        .leftJoin(users, eq(messages.senderUserId, users.id))
        .where(eq(messages.id, refId))
        .limit(1);
      if (r) {
        const senderName = r.sender ? displayName(r.sender) : "Someone";
        const preview = r.m.body
          ? r.m.body.length > 140
            ? `${r.m.body.slice(0, 140)}…`
            : r.m.body
          : "Sent an attachment";
        item = {
          itemKey: row.itemKey,
          kind: "message",
          title: `${senderName} messaged ${childFirst}`,
          body: preview,
          link: `/family/${childId}/messages/${r.m.conversationId}`,
          isRead: true,
          decision,
          createdAt: r.m.createdAt.toISOString(),
          actor: r.sender
            ? {
                id: r.sender.id,
                displayName: displayName(r.sender),
                avatarUrl: safeAvatarUrl(r.sender.avatarUrl),
              }
            : null,
        };
      }
    } else if (kind === "roster") {
      const [r] = await db
        .select({ entry: rosterEntries, team: teams })
        .from(rosterEntries)
        .innerJoin(teams, eq(rosterEntries.teamId, teams.id))
        .where(eq(rosterEntries.id, refId))
        .limit(1);
      if (r) {
        const verb =
          r.entry.status === "accepted"
            ? `joined ${r.team.name}`
            : r.entry.status === "pending"
              ? `was invited to ${r.team.name}`
              : `${r.entry.status} ${r.team.name}`;
        item = {
          itemKey: row.itemKey,
          kind: "roster",
          title: `${childFirst} ${verb}`,
          body: r.entry.position ?? null,
          link: `/family?childId=${childId}&entryId=${r.entry.id}&teamId=${r.team.id}`,
          isRead: true,
          decision,
          createdAt: r.entry.createdAt.toISOString(),
          actor: null,
        };
      }
    } else if (kind === "authoredArticle") {
      const [r] = await db
        .select({ a: articles })
        .from(articles)
        .where(eq(articles.id, refId))
        .limit(1);
      if (r) {
        const articleTitle = r.a.title ?? "Untitled";
        item = {
          itemKey: row.itemKey,
          kind: "authoredArticle",
          title: `${childFirst} wrote "${articleTitle}"`,
          body:
            decision === "removed" && r.a.hiddenAt
              ? "Post is hidden — Undo to restore."
              : null,
          link: `/posts/${articlePostId(r.a.id)}?asChild=${childId}`,
          isRead: true,
          decision,
          createdAt: r.a.createdAt.toISOString(),
          actor: null,
        };
      }
    } else if (kind === "authoredHighlight") {
      const [r] = await db
        .select({ h: highlights })
        .from(highlights)
        .where(eq(highlights.id, refId))
        .limit(1);
      if (r) {
        const highlightTitle = r.h.title ?? "Untitled";
        item = {
          itemKey: row.itemKey,
          kind: "authoredHighlight",
          title: `${childFirst} posted a highlight: "${highlightTitle}"`,
          body:
            decision === "removed" && r.h.hiddenAt
              ? "Post is hidden — Undo to restore."
              : null,
          link: `/posts/${highlightPostId(r.h.id)}?asChild=${childId}`,
          isRead: true,
          decision,
          createdAt: r.h.createdAt.toISOString(),
          actor: null,
        };
      }
    } else if (kind === "notification") {
      const [n] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, refId))
        .limit(1);
      if (n) {
        item = {
          itemKey: row.itemKey,
          kind: "notification",
          title: n.message,
          body: null,
          link: n.link ?? null,
          isRead: true,
          decision,
          createdAt: n.createdAt.toISOString(),
          actor: null,
        };
      }
    }

    if (!item) {
      // The underlying source row is gone (e.g. a pending roster invite
      // that the parent declined got hard-deleted). Surface a minimal
      // placeholder so the parent can still see and undo the decision.
      item = {
        itemKey: row.itemKey,
        kind: kind as ChildItemKind,
        title: "Item is no longer available",
        body: null,
        link: null,
        isRead: true,
        decision,
        createdAt: fallbackCreatedAt,
        actor: null,
      };
    }
    extras.push(item);
  }
  return extras;
}

// Exported so /child-conversations routes (defined in routes/child-conversations.ts)
// can reuse the same parent-or-real-admin authorization rule without duplicating it.
export async function authorizeChildAccess(
  req: Request,
  res: Response,
): Promise<typeof users.$inferSelect | null> {
  const me = req.sessionUser;
  if (!me) {
    apiError(res, 401, "Not authenticated");
    return null;
  }
  const childId = req.params.childId;
  const [child] = await db
    .select()
    .from(users)
    .where(eq(users.id, childId))
    .limit(1);
  if (!child) {
    notFound(res);
    return null;
  }
  const isRealAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
  const isLinkedParent = child.parentId === me.id && !req.isMasquerading;
  // If the child requires a confirmed guardian (i.e. signed up with a
  // guardianEmail), do not expose any of their private context — DMs,
  // notifications, posts, etc. — to a linked parent until the guardian
  // confirmation flow has been completed. Real admins can still access
  // for moderation.
  const guardianRequired = !!child.guardianEmail;
  const isConfirmedGuardian =
    isLinkedParent && (!guardianRequired || !!child.guardianConfirmedAt);
  if (!isConfirmedGuardian && !isRealAdmin) {
    apiError(res, 403, "Forbidden");
    return null;
  }
  return child;
}

router.get(
  "/users/me/children/:childId/notifications",
  asyncHandler(async (req, res) => {
    const child = await authorizeChildAccess(req, res);
    if (!child) return;
    const me = req.sessionUser!;
    const includeDecided =
      String(req.query.includeDecided ?? "").toLowerCase() === "true";
    const raw = await loadChildNotificationItems(child);
    const overlaid = await applyParentReadOverlay(me.id, child.id, raw);
    const visible = visibleAfterDecision(overlaid);
    // Default behavior is unchanged: only items still awaiting the
    // parent's attention. The unread count always reflects the default
    // feed so the bell badge is not inflated by historical decisions.
    const unreadCount = visible.filter((i) => !i.isRead).length;
    if (!includeDecided) {
      res.json({ data: visible, unreadCount });
      return;
    }
    // includeDecided=true: also surface items the parent has already
    // approved or removed so they can review and undo. Decided items
    // whose underlying source row is gone (e.g. a tag the parent
    // declined) are reconstructed from the source table where possible.
    const liveKeys = new Set(overlaid.map((i) => i.itemKey));
    const decidedExtras = await loadDecidedExtraItems(
      me.id,
      child.id,
      child,
      liveKeys,
    );
    const merged = [...overlaid, ...decidedExtras];
    merged.sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
    res.json({ data: merged, unreadCount });
  }),
);

router.post(
  "/users/me/children/:childId/notifications/read",
  asyncHandler(async (req, res) => {
    const child = await authorizeChildAccess(req, res);
    if (!child) return;
    const me = req.sessionUser!;
    const itemKey = String(req.body?.itemKey ?? "").trim();
    if (!itemKey) return apiError(res, 400, "itemKey is required");
    if (itemKey.length > 200)
      return apiError(res, 400, "itemKey too long");
    // Sanity-check the shape so callers can't poison the table with
    // arbitrary strings — we only accept known kinds.
    const [kind] = itemKey.split(":");
    if (!ALLOWED_DECIDED_KINDS.has(kind as ChildItemKind)) {
      return apiError(res, 400, "unknown item kind");
    }
    await db
      .insert(parentChildNotificationReads)
      .values({ parentId: me.id, childId: child.id, itemKey })
      .onConflictDoNothing();
    res.status(204).end();
  }),
);

router.post(
  "/users/me/children/:childId/notifications/read-all",
  asyncHandler(async (req, res) => {
    const child = await authorizeChildAccess(req, res);
    if (!child) return;
    const me = req.sessionUser!;
    const raw = await loadChildNotificationItems(child);
    const overlaid = await applyParentReadOverlay(me.id, child.id, raw);
    const visible = visibleAfterDecision(overlaid);
    const toMark = visible.filter((i) => !i.isRead);
    if (toMark.length === 0) return res.json({ markedCount: 0 });
    await db
      .insert(parentChildNotificationReads)
      .values(
        toMark.map((i) => ({
          parentId: me.id,
          childId: child.id,
          itemKey: i.itemKey,
        })),
      )
      .onConflictDoNothing();
    res.json({ markedCount: toMark.length });
  }),
);

// Bulk "Approve all" — mark every still-undecided item as approved in
// one round trip. Approving doesn't perform any destructive action; it
// just records the parent's verdict so the item drops out of the feed.
router.post(
  "/users/me/children/:childId/notifications/approve-all",
  asyncHandler(async (req, res) => {
    const child = await authorizeChildAccess(req, res);
    if (!child) return;
    const me = req.sessionUser!;
    const raw = await loadChildNotificationItems(child);
    const overlaid = await applyParentReadOverlay(me.id, child.id, raw);
    const visible = visibleAfterDecision(overlaid);
    if (visible.length === 0) return res.json({ approvedCount: 0 });
    const now = new Date();
    for (const item of visible) {
      await db
        .insert(parentChildNotificationReads)
        .values({
          parentId: me.id,
          childId: child.id,
          itemKey: item.itemKey,
          decision: "approved",
          decidedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            parentChildNotificationReads.parentId,
            parentChildNotificationReads.childId,
            parentChildNotificationReads.itemKey,
          ],
          set: { decision: "approved", decidedAt: now },
        });
      // Bulk approve must mirror the per-item approve flow for tag
      // items: flip the underlying article_tags / highlight_tags row
      // from `pending` to `approved`. Idempotent and safe to re-run.
      if (item.kind === "tag") {
        const refId = item.itemKey.split(":").slice(1).join(":");
        if (refId) await applyApproveTagAction(refId);
      }
    }
    res.json({ approvedCount: visible.length });
  }),
);

// Per-item Approve/Remove. Approving just records the verdict; Removing
// also performs the kind-specific destructive action (decline tag, hide
// comment, hide message, decline roster invite, remove follow, remove
// reaction, or just-dismiss for unhandled notification kinds).
//
// Security: itemKey is validated against the child's CURRENT loaded
// stream so a parent can never mutate an arbitrary tag/comment/message/
// roster/notification id by guessing — only items the family dashboard
// would actually surface for this child are accepted.
router.post(
  "/users/me/children/:childId/notifications/decision",
  asyncHandler(async (req, res) => {
    const child = await authorizeChildAccess(req, res);
    if (!child) return;
    const me = req.sessionUser!;
    const itemKey = String(req.body?.itemKey ?? "").trim();
    // Accept both action verbs ("approve"/"remove") and the past-tense
    // state names ("approved"/"removed") that match the DB enum so older
    // clients and the spec-defined contract both work.
    const rawDecision = String(req.body?.decision ?? "").trim();
    const decision: "approved" | "removed" | null =
      rawDecision === "approve" || rawDecision === "approved"
        ? "approved"
        : rawDecision === "remove" || rawDecision === "removed"
          ? "removed"
          : null;
    if (!itemKey) return apiError(res, 400, "itemKey is required");
    if (itemKey.length > 200)
      return apiError(res, 400, "itemKey too long");
    if (!decision) {
      return apiError(
        res,
        400,
        "decision must be one of 'approve', 'remove', 'approved', 'removed'",
      );
    }
    const [kind, refId] = itemKey.split(":");
    if (!ALLOWED_DECIDED_KINDS.has(kind as ChildItemKind)) {
      return apiError(res, 400, "unknown item kind");
    }
    if (!refId) return apiError(res, 400, "missing item reference");

    // Authoritative membership check: the item must belong to this
    // child's current notification stream (or have already been decided
    // on previously, so the parent can flip an old verdict). Anything
    // else returns 404 — including stale or fabricated itemKeys.
    const raw = await loadChildNotificationItems(child);
    const member = raw.find((i) => i.itemKey === itemKey);
    let underlyingItem: ChildItem | null = member ?? null;
    if (!member) {
      const [prior] = await db
        .select()
        .from(parentChildNotificationReads)
        .where(
          and(
            eq(parentChildNotificationReads.parentId, me.id),
            eq(parentChildNotificationReads.childId, child.id),
            eq(parentChildNotificationReads.itemKey, itemKey),
          ),
        )
        .limit(1);
      if (!prior) {
        return apiError(res, 404, "Notification item not found");
      }
      // A prior decision exists but the live stream no longer surfaces
      // the row. This happens whenever a parent flips an old verdict
      // from the decided-history strip — most notably approve → remove
      // on a tag that the loader filters to `pending` only. Synthesize
      // a minimal item so the kind-specific Approve / Remove helpers
      // still run; each helper guards its own preconditions, so a
      // truly-deleted underlying row is a harmless no-op.
      const synthDecision: ChildItemDecision | null =
        prior.decision === "approved" || prior.decision === "removed"
          ? prior.decision
          : null;
      underlyingItem = {
        itemKey,
        kind: kind as ChildItemKind,
        title: "",
        body: null,
        link: null,
        isRead: true,
        decision: synthDecision,
        createdAt: (prior.decidedAt ?? new Date()).toISOString(),
        actor: null,
      };
    }

    // Snapshot the underlying source row's status BEFORE we mutate it,
    // so an Undo can restore it faithfully. Two cases need this today:
    //   * `tag` items — pending tags surfaced as their own row.
    //   * `notification` items whose underlying notifications.kind is
    //     `post_tag` — i.e. an auto-approved tag that the loader hides
    //     from the `tag` strip but still surfaces as a "X tagged Jake
    //     in 'Y'" row. A Remove on either path declines the underlying
    //     tag, and Undo on either must restore it to whatever status
    //     it had at decision time (an auto-approved tag must come back
    //     as `approved`, not silently demote to `pending`).
    let priorStatus: string | null = null;
    if (underlyingItem?.kind === "tag") {
      priorStatus = await loadTagPriorStatus(refId);
    } else if (underlyingItem?.kind === "notification") {
      const parsed = await loadPostTagFromNotification(refId);
      if (parsed) {
        priorStatus = await loadChildPostTagPriorStatus(parsed, child.id);
      }
    }

    if (decision === "removed" && underlyingItem) {
      await applyRemoveAction(underlyingItem, child.id, me.id);
    }
    // Parent approval on a tag item must also flip the underlying tag
    // row from `pending` to `approved`. Without this, the recap article
    // and the child's pending-tags list keep treating the tag as still
    // awaiting consent — even though the parent has already approved
    // it on the child's behalf. Other item kinds (comment, message,
    // roster, notification, authoredArticle, authoredHighlight)
    // intentionally do not mutate any underlying row on approve; the
    // decision row alone is enough to drop them from the feed.
    if (decision === "approved" && underlyingItem?.kind === "tag") {
      await applyApproveTagAction(refId);
    }

    const now = new Date();
    await db
      .insert(parentChildNotificationReads)
      .values({
        parentId: me.id,
        childId: child.id,
        itemKey,
        decision,
        decidedAt: now,
        priorStatus,
      })
      .onConflictDoUpdate({
        target: [
          parentChildNotificationReads.parentId,
          parentChildNotificationReads.childId,
          parentChildNotificationReads.itemKey,
        ],
        // Only overwrite priorStatus when we actually captured one
        // (i.e. for tag items). Preserves any prior snapshot from a
        // previous decision on the same item if the parent flips
        // from approve → remove (or vice versa) without an Undo.
        set: {
          decision,
          decidedAt: now,
          ...(priorStatus !== null ? { priorStatus } : {}),
        },
      });
    res.json({ ok: true, decision });
  }),
);

// Revert a previous Approve/Remove decision back to "needs review".
// The parent's read row is hard-deleted so the item resurfaces in the
// default feed as fresh and unread. For "removed" decisions, the
// reversible kind-specific side effects are also undone (un-decline a
// tag, un-hide a comment, un-hide a message). Hard-deleted side effects
// (e.g. a pending roster invite that Remove deleted) cannot be brought
// back; in that case the row is still cleared so the parent at least
// stops seeing the stale "Removed" badge.
//
// Security: itemKey is validated via the same membership rule used by
// the decision endpoint — it must either still appear in the child's
// live stream or already have a prior decision row owned by this
// parent + child. Otherwise 404.
router.post(
  "/users/me/children/:childId/notifications/unset-decision",
  asyncHandler(async (req, res) => {
    const child = await authorizeChildAccess(req, res);
    if (!child) return;
    const me = req.sessionUser!;
    const itemKey = String(req.body?.itemKey ?? "").trim();
    if (!itemKey) return apiError(res, 400, "itemKey is required");
    if (itemKey.length > 200) return apiError(res, 400, "itemKey too long");
    const [kind, ...rest] = itemKey.split(":");
    const refId = rest.join(":");
    if (!ALLOWED_DECIDED_KINDS.has(kind as ChildItemKind)) {
      return apiError(res, 400, "unknown item kind");
    }
    if (!refId) return apiError(res, 400, "missing item reference");

    const [prior] = await db
      .select()
      .from(parentChildNotificationReads)
      .where(
        and(
          eq(parentChildNotificationReads.parentId, me.id),
          eq(parentChildNotificationReads.childId, child.id),
          eq(parentChildNotificationReads.itemKey, itemKey),
        ),
      )
      .limit(1);
    if (!prior || !prior.decision) {
      return apiError(res, 404, "No decision to revert");
    }
    if (prior.decision === "removed") {
      await applyUnsetAction(
        kind as ChildItemKind,
        refId,
        child.id,
        prior.priorStatus ?? null,
      );
    }
    await db
      .delete(parentChildNotificationReads)
      .where(
        and(
          eq(parentChildNotificationReads.parentId, me.id),
          eq(parentChildNotificationReads.childId, child.id),
          eq(parentChildNotificationReads.itemKey, itemKey),
        ),
      );
    res.json({ ok: true, reverted: prior.decision });
  }),
);

// Reverse the destructive side effects of a prior "Remove" so the item
// can re-enter the live stream as a fresh review. Best-effort: only
// safely-reversible kinds are restored (tag → pending, comment / message
// hide cleared). Roster invites that were hard-deleted and notification
// follow / reaction reversions cannot be reliably restored, so those
// branches no-op and we just clear the parent's decision row.
async function applyUnsetAction(
  kind: ChildItemKind,
  refId: string,
  childId: string,
  priorStatus: string | null,
): Promise<void> {
  if (kind === "tag") {
    // The `tag:` key covers both article tags and highlight tags
    // (see `applyApproveTagAction` below for the same dual update).
    // Try both tables; only `declined` rows flip back so we don't
    // accidentally resurrect a tag the child themselves had approved
    // or declined out-of-band.
    //
    // Restore to whatever status the tag had at decision time, NOT
    // unconditionally to `pending`. A highlight tag that was
    // auto-approved (child with `requireTagConsent = false`) and then
    // Removed by the parent must come back as `approved`, not as a
    // fresh pending row that the child has to re-approve.
    const restoreTo: "approved" | "pending" =
      priorStatus === "approved" ? "approved" : "pending";
    const now = new Date();
    await db
      .update(articleTags)
      .set({ status: restoreTo, updatedAt: now })
      .where(
        and(
          eq(articleTags.id, refId),
          eq(articleTags.status, "declined"),
        ),
      );
    await db
      .update(highlightTags)
      .set({ status: restoreTo, updatedAt: now })
      .where(
        and(
          eq(highlightTags.id, refId),
          eq(highlightTags.status, "declined"),
        ),
      );
    return;
  }
  if (kind === "comment") {
    await db
      .update(postComments)
      .set({ hiddenAt: null })
      .where(eq(postComments.id, refId));
    return;
  }
  if (kind === "message") {
    await db
      .delete(messageChildHides)
      .where(
        and(
          eq(messageChildHides.messageId, refId),
          eq(messageChildHides.childId, childId),
        ),
      );
    return;
  }
  if (kind === "authoredArticle") {
    // Restore the article the parent had taken down. Scoped to articles
    // the child actually authored so a tampered-with itemKey can't
    // un-hide arbitrary content.
    await db
      .update(articles)
      .set({ hiddenAt: null, hiddenByUserId: null })
      .where(and(eq(articles.id, refId), eq(articles.authorId, childId)));
    return;
  }
  if (kind === "authoredHighlight") {
    await db
      .update(highlights)
      .set({ hiddenAt: null, hiddenByUserId: null })
      .where(
        and(eq(highlights.id, refId), eq(highlights.uploaderId, childId)),
      );
    return;
  }
  if (kind === "notification") {
    // The only `notification` Remove that performs a reversible
    // mutation is the `post_tag` arm — it declines the underlying
    // article-tag or highlight-tag for this child. Mirror the `tag`
    // branch above so an Undo restores the tag to whatever status it
    // had at decision time (auto-approved → approved, pending →
    // pending), and only if the row is currently `declined` so we
    // don't overwrite an out-of-band re-decline by the child or
    // another parent.
    //
    // Like / reaction and follow Removes are NOT reversed here: the
    // delete already removed the source row, so there is nothing to
    // restore. The caller still clears the decision row in those
    // cases so the parent stops seeing the stale "Removed" badge.
    const parsed = await loadPostTagFromNotification(refId);
    if (!parsed) return;
    const restoreTo: "approved" | "pending" =
      priorStatus === "approved" ? "approved" : "pending";
    const now = new Date();
    if (parsed.kind === "article") {
      await db
        .update(articleTags)
        .set({ status: restoreTo, updatedAt: now })
        .where(
          and(
            eq(articleTags.userId, childId),
            eq(articleTags.articleId, parsed.id),
            eq(articleTags.status, "declined"),
          ),
        );
    } else if (parsed.kind === "highlight") {
      await db
        .update(highlightTags)
        .set({ status: restoreTo, updatedAt: now })
        .where(
          and(
            eq(highlightTags.userId, childId),
            eq(highlightTags.highlightId, parsed.id),
            eq(highlightTags.status, "declined"),
          ),
        );
    }
    // org_post: no per-user tagging, nothing to restore.
    return;
  }
  // roster: hard-deleted, so reversal is not reliably possible. The
  // caller will simply clear the decision row and the item will come
  // back only if it still surfaces in the live stream.
}

// When a parent approves a tag for their child from the family inbox,
// the underlying tag row must also flip from `pending` to `approved` so
// the rest of the app (recap article, child's pending-tags list, etc.)
// stops treating it as awaiting consent. The flip is intentionally
// idempotent and conservative:
//   * only rows currently `pending` are touched (a `declined` or already
//     `approved` row is left alone — parent approval cannot revive a
//     previously declined tag, and re-running on an approved row is a
//     harmless no-op);
//   * the tagId may belong to either article_tags OR highlight_tags
//     (both flow through the family inbox under the same `tag:` key);
//   * a missing underlying row is silently ignored — the parent's
//     decision row is still recorded by the caller, so the item drops
//     out of the feed even if the source tag was deleted in the meantime.
async function applyApproveTagAction(tagId: string): Promise<void> {
  const now = new Date();
  await db
    .update(articleTags)
    .set({ status: "approved", updatedAt: now })
    .where(
      and(eq(articleTags.id, tagId), eq(articleTags.status, "pending")),
    );
  await db
    .update(highlightTags)
    .set({ status: "approved", updatedAt: now })
    .where(
      and(eq(highlightTags.id, tagId), eq(highlightTags.status, "pending")),
    );
}

// Look up a notifications row by id and, if it represents a "tagged
// in" event (`notifications.kind = "post_tag"`), parse the post id out
// of its `link` and return it in {kind, id} form. Returns null when
// the row is missing, the kind doesn't match, or the link isn't a
// well-formed `/posts/<postId>` URL the post id parser recognises.
//
// Used by both the priorStatus snapshot in the decision endpoint and
// the Undo restore in `applyUnsetAction` so the two paths agree on
// exactly which `(child, post)` tag row to read or write.
async function loadPostTagFromNotification(
  notificationId: string,
): Promise<{ kind: PostKind; id: string } | null> {
  const [notif] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1);
  if (!notif || notif.kind !== "post_tag") return null;
  const link = notif.link ?? "";
  const m = link.match(/^\/posts\/([^\/?#]+)/);
  if (!m) return null;
  return parsePostId(m[1]);
}

// Snapshot the status of the underlying article-tag or highlight-tag
// for a given child + parsed post id. Mirrors `loadTagPriorStatus` but
// scoped by `(userId = childId, post)` rather than by tag-row id, so
// the auto-approved-tag path can capture the same prior-status info
// the pending-tag path already records. Returns null if no matching
// tag row exists (in which case `applyUnsetAction` will default-restore
// to `pending`, which is the correct fallback).
async function loadChildPostTagPriorStatus(
  parsed: { kind: PostKind; id: string },
  childId: string,
): Promise<string | null> {
  if (parsed.kind === "article") {
    const [row] = await db
      .select({ status: articleTags.status })
      .from(articleTags)
      .where(
        and(
          eq(articleTags.userId, childId),
          eq(articleTags.articleId, parsed.id),
        ),
      )
      .limit(1);
    return row ? row.status : null;
  }
  if (parsed.kind === "highlight") {
    const [row] = await db
      .select({ status: highlightTags.status })
      .from(highlightTags)
      .where(
        and(
          eq(highlightTags.userId, childId),
          eq(highlightTags.highlightId, parsed.id),
        ),
      )
      .limit(1);
    return row ? row.status : null;
  }
  // org_post — no per-user tag table to read.
  return null;
}

// Snapshot the current status of a tag (article or highlight) so an
// Undo can restore it faithfully. Returns the underlying status string
// (`pending` / `approved` / `declined`) or null if no row exists. The
// tagId may belong to either table; we probe both and return whichever
// one matches. A null return is fine — `applyUnsetAction` will then
// default-restore to `pending`.
async function loadTagPriorStatus(tagId: string): Promise<string | null> {
  const [a] = await db
    .select({ status: articleTags.status })
    .from(articleTags)
    .where(eq(articleTags.id, tagId))
    .limit(1);
  if (a) return a.status;
  const [h] = await db
    .select({ status: highlightTags.status })
    .from(highlightTags)
    .where(eq(highlightTags.id, tagId))
    .limit(1);
  return h ? h.status : null;
}

// Dispatch table for the "Remove" action. Each branch is intentionally
// narrow: it touches only the row identified by the family-stream item
// (which the caller has already validated belongs to this child) and
// never escalates to global moderation. For direct notifications, any
// destructive sub-action is additionally scoped to the specific actor +
// post / actor + child pair carried by the notification — never a
// blanket "delete all reactions by this user".
async function applyRemoveAction(
  item: ChildItem,
  childId: string,
  parentId: string,
): Promise<void> {
  const refId = item.itemKey.split(":").slice(1).join(":");
  if (item.kind === "tag") {
    // The tagId may belong to either article_tags OR highlight_tags
    // (both flow through the family inbox under the same `tag:` key),
    // so mirror the dispatch used by `applyApproveTagAction`. Both
    // tables are flipped to `declined` regardless of the prior status:
    // a child whose tags are auto-approved (`requireTagConsent =
    // false`) would otherwise see Remove silently no-op on a highlight
    // tag the parent had explicitly asked to take down. The prior
    // status is captured separately on the parent decision row so an
    // Undo can restore `approved` faithfully (see applyUnsetAction).
    const now = new Date();
    await db
      .update(articleTags)
      .set({ status: "declined", updatedAt: now })
      .where(eq(articleTags.id, refId));
    await db
      .update(highlightTags)
      .set({ status: "declined", updatedAt: now })
      .where(eq(highlightTags.id, refId));
    return;
  }
  if (item.kind === "authoredArticle") {
    // Hide the child's own article. Scoped to articles the child
    // actually authored so a tampered-with itemKey can't take down
    // arbitrary content. Idempotent: re-Removing a row that's already
    // hidden refreshes hiddenAt without effect (and admins keep their
    // existing recovery path through the standard `hiddenAt` column).
    await db
      .update(articles)
      .set({ hiddenAt: new Date(), hiddenByUserId: parentId })
      .where(and(eq(articles.id, refId), eq(articles.authorId, childId)));
    return;
  }
  if (item.kind === "authoredHighlight") {
    await db
      .update(highlights)
      .set({ hiddenAt: new Date(), hiddenByUserId: parentId })
      .where(
        and(eq(highlights.id, refId), eq(highlights.uploaderId, childId)),
      );
    return;
  }
  if (item.kind === "comment") {
    await db
      .update(postComments)
      .set({ hiddenAt: new Date() })
      .where(eq(postComments.id, refId));
    return;
  }
  if (item.kind === "message") {
    await db
      .insert(messageChildHides)
      .values({ messageId: refId, childId })
      .onConflictDoNothing();
    return;
  }
  if (item.kind === "roster") {
    // Remove on a roster item must mirror "decline this invite" semantics
    // — i.e. it is only allowed to undo a not-yet-accepted membership.
    // For an already-accepted entry (the "child joined the team" event)
    // we just-dismiss: the parent can't quietly delete an existing
    // membership through the notifications dashboard. The decision row
    // is still persisted by the caller so the item disappears.
    const [entry] = await db
      .select({ status: rosterEntries.status })
      .from(rosterEntries)
      .where(eq(rosterEntries.id, refId))
      .limit(1);
    if (entry && entry.status === "pending") {
      await db
        .delete(rosterEntries)
        .where(
          and(
            eq(rosterEntries.id, refId),
            eq(rosterEntries.status, "pending"),
          ),
        );
    }
    return;
  }
  if (item.kind === "notification") {
    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, refId))
      .limit(1);
    if (!notif) return;
    const link = notif.link ?? "";

    // post_tag: decline the underlying article-tag or highlight-tag
    // for THIS child on the post the notification points at. Mirrors
    // the `kind=tag` Remove path so an auto-approved tag (the common
    // case for a child whose linked guardian has set
    // `requireTagConsent = false`) actually drops off the child's
    // profile when the parent dismisses the "tagged in" notification.
    // Without this, the parent-facing Remove just records a verdict
    // and the post stays on the child's profile feed — exactly the
    // bug task #342 closes.
    if (notif.kind === "post_tag") {
      // Reuse `loadPostTagFromNotification` so the priorStatus snapshot
      // (decision endpoint), the Undo restore (`applyUnsetAction`), and
      // this Remove path all read the link the same way — no risk of
      // them drifting on which `(child, post)` row they target.
      const parsed = await loadPostTagFromNotification(notif.id);
      if (parsed) {
        const now = new Date();
        if (parsed.kind === "article") {
          await db
            .update(articleTags)
            .set({ status: "declined", updatedAt: now })
            .where(
              and(
                eq(articleTags.userId, childId),
                eq(articleTags.articleId, parsed.id),
              ),
            );
        } else if (parsed.kind === "highlight") {
          await db
            .update(highlightTags)
            .set({ status: "declined", updatedAt: now })
            .where(
              and(
                eq(highlightTags.userId, childId),
                eq(highlightTags.highlightId, parsed.id),
              ),
            );
        }
        // org_post: no per-user tagging table, so nothing to flip;
        // the parent's verdict row alone suppresses the bell entry.
      }
      return;
    }

    // Like/reaction: revoke ONLY this actor's reaction on the specific
    // post the notification points at. We require both an actorUserId
    // and a parseable /posts/<postId> link; if either is missing, fall
    // through to just-dismiss rather than risk an over-broad delete.
    if (notif.actorUserId && /react|like/i.test(notif.message)) {
      const postMatch = link.match(/^\/posts\/([^\/?#]+)/);
      if (postMatch) {
        const parsed = parsePostId(postMatch[1]);
        if (parsed) {
          await db
            .delete(postReactions)
            .where(
              and(
                eq(postReactions.postKind, parsed.kind),
                eq(postReactions.postRefId, parsed.id),
                eq(postReactions.userId, notif.actorUserId),
              ),
            );
        }
      }
      return;
    }

    // Follow: revoke ONLY the (follower → child) edge. Prefer the
    // structured actorUserId when available; fall back to the userId
    // embedded in the /users/<id> link for legacy notifications.
    if (/follow/i.test(notif.message)) {
      const followerMatch = link.match(/^\/users\/([^\/?#]+)/);
      const followerId = notif.actorUserId ?? followerMatch?.[1] ?? null;
      if (followerId) {
        await db
          .delete(userFollowers)
          .where(
            and(
              eq(userFollowers.followerUserId, followerId),
              eq(userFollowers.followingUserId, childId),
            ),
          );
      }
      return;
    }
    // Unhandled kind — Remove just records the verdict (just-dismiss).
    return;
  }
}

// One-shot summary used by the global notification bell so it can show a
// combined badge across the parent's own notifications and every linked
// child's stream without N client round-trips.
router.get(
  "/users/me/children-notifications-summary",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const childRows = await db
      .select()
      .from(users)
      .where(eq(users.parentId, me.id));
    const perChild: Array<{ childId: string; unreadCount: number }> = [];
    let totalUnreadCount = 0;
    for (const child of childRows) {
      const raw = await loadChildNotificationItems(child);
      const overlaid = await applyParentReadOverlay(me.id, child.id, raw);
      const visible = visibleAfterDecision(overlaid);
      const unread = visible.filter((i) => !i.isRead).length;
      perChild.push({ childId: child.id, unreadCount: unread });
      totalUnreadCount += unread;
    }
    res.json({ data: perChild, totalUnreadCount });
  }),
);

// Token-based invite lookup + acceptance for the email-link flow.
router.get(
  "/invites/:token",
  asyncHandler(async (req, res) => {
    const [row] = await db
      .select({ i: rosterInvites, t: teams, org: organizations })
      .from(rosterInvites)
      .innerJoin(teams, eq(rosterInvites.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(eq(rosterInvites.token, req.params.token))
      .limit(1);
    if (!row) return notFound(res);
    res.json({
      invite: toInvite(row.i, null),
      team: { id: row.t.id, name: row.t.name },
      organization: { id: row.org.id, name: row.org.name },
    });
  }),
);

router.post(
  "/invites/:token/accept",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [invite] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.token, req.params.token))
      .limit(1);
    if (!invite) return notFound(res);
    if (invite.status !== "pending")
      return apiError(res, 409, "Invite no longer pending");

    // Player invites are addressed to the parent / guardian. The accepting
    // user does NOT become a player; instead they're prompted to add their
    // child(ren) as players on the roster.
    const isPlayerInvite = invite.position === "player";
    if (isPlayerInvite) {
      // Email-targeted player invites are single-use (mark accepted).
      // Email-less shareable links stay pending so multiple guardians can
      // use the same link to add their kids.
      if (invite.invitedEmail) {
        await db
          .update(rosterInvites)
          .set({ status: "accepted" })
          .where(eq(rosterInvites.id, invite.id));
      }
      return res.status(200).json({
        requiresChildSetup: true,
        teamId: invite.teamId,
        inviteId: invite.id,
      });
    }

    const [entry] = await db
      .insert(rosterEntries)
      .values({
        teamId: invite.teamId,
        userId: me.id,
        role: invite.role,
        status: "accepted",
        position: invite.position,
        invitedById: invite.invitedById,
      })
      .returning();
    await ensureOrgFollowedForTeam(me.id, invite.teamId);
    await db
      .update(rosterInvites)
      .set({ status: "accepted" })
      .where(eq(rosterInvites.id, invite.id));
    res.status(201).json(toTeamMember(entry, me));
  }),
);

// After a parent accepts a player invite, they add 1+ children as players.
router.post(
  "/invites/:token/children",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [invite] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.token, req.params.token))
      .limit(1);
    if (!invite) return notFound(res);
    if (invite.position !== "player") {
      return apiError(res, 400, "Only player invites support adding children");
    }
    const firstName = String(req.body?.firstName ?? "").trim();
    const lastName = String(req.body?.lastName ?? "").trim();
    if (!firstName || !lastName) {
      return apiError(res, 400, "firstName and lastName required");
    }
    const [child] = await db
      .insert(users)
      .values({
        name: `${firstName} ${lastName}`,
        role: "athlete",
        email: null,
        parentId: me.id,
        requireTagConsent: true,
      })
      .returning();
    const [entry] = await db
      .insert(rosterEntries)
      .values({
        teamId: invite.teamId,
        userId: child.id,
        role: "player",
        status: "accepted",
        position: "player",
      })
      .returning();
    await ensureOrgFollowedForTeam(me.id, invite.teamId);
    res.status(201).json({
      child: {
        id: child.id,
        firstName,
        lastName,
        avatarUrl: safeAvatarUrl(child.avatarUrl),
      },
      member: toTeamMember(entry, child),
    });
  }),
);

// User search — returns up to 25 users matching name or email.
router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return res.json(paginate([]));
    const like = `%${q}%`;
    const rows = await db
      .select()
      .from(users)
      .where(or(ilike(users.name, like), ilike(users.email, like)))
      .limit(25);
    res.json(paginate(rows.map((u) => toPublicUser(u))));
  }),
);

router.post(
  "/teams/:teamId/join-link",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    // Only org admins of the owning organization can mint join links.
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) return notFound(res);
    const [adminRow] = await db
      .select()
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, team.organizationId),
          eq(organizationAdmins.userId, me.id),
          inArray(organizationAdmins.role, ["owner", "admin"]),
        ),
      )
      .limit(1);
    if (!adminRow) return apiError(res, 403, "Not a team admin");
    // Reuse a pending email-less player invite for this team if one exists,
    // so admins always share a stable parent-onboarding link.
    const [existing] = await db
      .select()
      .from(rosterInvites)
      .where(
        and(
          eq(rosterInvites.teamId, teamId),
          eq(rosterInvites.status, "pending"),
          isNull(rosterInvites.invitedEmail),
        ),
      )
      .limit(1);
    let token = existing?.token;
    let createdAt = existing?.createdAt ?? new Date();
    if (!existing) {
      const newToken = `join-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      const [row] = await db
        .insert(rosterInvites)
        .values({
          token: newToken,
          teamId,
          invitedEmail: null,
          invitedName: null,
          role: "player",
          position: "player",
          invitedById: me?.id ?? null,
        })
        .returning();
      token = row.token;
      createdAt = row.createdAt;
    }
    res.json({
      token,
      teamId,
      expiresAt: null,
      createdAt: createdAt.toISOString(),
    });
  }),
);

router.get(
  "/teams/:teamId/seasons",
  asyncHandler(async (req, res) => {
    const [t] = await db.select().from(teams).where(eq(teams.id, req.params.teamId)).limit(1);
    if (!t) return notFound(res);
    res.json(
      paginate([
        {
          id: t.id,
          name: t.season ?? "Current Season",
          startDate: null,
          endDate: null,
          status: "active" as const,
          createdAt: t.createdAt.toISOString(),
        },
      ]),
    );
  }),
);

export default router;
