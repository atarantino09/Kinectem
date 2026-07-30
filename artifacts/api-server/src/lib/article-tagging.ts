import { db, articleTags, articles, notifications, rosterEntries, users } from "@workspace/db";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { articlePostId, displayNameForViewer, highlightPostId } from "./spec-helpers";
import type { MinorNameViewerContext, PostTaggedUserView } from "./spec-helpers";
import { buildPostUrl, buildTagEmail, isEmailConfiguredAsync } from "./email";
import { dispatchNotificationEmailToMany } from "./notification-email";
import {
  getActiveGuardianIdsForChildren,
  notifyAllGuardiansOfPendingItem,
} from "./guardian-links";

// Task #363 Phase 2 — fire a `child_pending_tag` bell on the linked
// guardian for every pending tag whose target is a minor. This is the
// missing fourth `kind` from `notifyGuardianOfPendingItem` (follow,
// dm, comment, tag) so the family dashboard surfaces tags the same
// way it surfaces the other pending items. Independent of the existing
// recap/highlight tag-email channel, which targets the player.
async function notifyGuardiansOfPendingTags(args: {
  pendingUserIds: string[];
  postTitle: string;
}): Promise<void> {
  if (args.pendingUserIds.length === 0) return;
  const childRows = await db
    .select({
      id: users.id,
      isMinor: users.isMinor,
      parentId: users.parentId,
    })
    .from(users)
    .where(inArray(users.id, args.pendingUserIds));
  for (const c of childRows) {
    if (!c.isMinor || !c.parentId) continue;
    // Task #755 — notify ALL active guardians, not just the primary.
    await notifyAllGuardiansOfPendingItem({
      childUserId: c.id,
      kind: "tag",
      message: `Please review a pending tag in "${args.postTitle}"`,
    });
  }
}

// Task #800 — tags now auto-approve by default, so guardians no longer
// see a "please review" prompt for most recap tags. To keep parents in
// the loop we drop a plain informational bell on every active guardian
// of a tagged minor whose tag went live immediately. Dedupe mirrors the
// highlight guardian fan-out: one row per (guardian, child, post) inside
// the throttle window, keyed on the `?asChild=` link. The actor is
// skipped (a parent tagging their own child doesn't need a ping).
async function notifyGuardiansOfApprovedTags(args: {
  approvedUserIds: string[];
  postTitle: string;
  link: string;
  actorUserId: string | null;
}): Promise<void> {
  if (args.approvedUserIds.length === 0) return;
  const childRows = await db
    .select({ id: users.id, isMinor: users.isMinor, name: users.name })
    .from(users)
    .where(inArray(users.id, args.approvedUserIds));
  const minors = childRows.filter((c) => c.isMinor);
  if (minors.length === 0) return;
  const guardianIdsByChild = await getActiveGuardianIdsForChildren(
    minors.map((c) => c.id),
  );
  const targets = minors.flatMap((c) =>
    (guardianIdsByChild.get(c.id) ?? [])
      .filter((gid) => !args.actorUserId || gid !== args.actorUserId)
      .map((gid) => ({
        guardianId: gid,
        childId: c.id,
        childFirst: c.name?.trim().split(/\s+/)[0] || "Your child",
      })),
  );
  if (targets.length === 0) return;
  const since = new Date(Date.now() - TAG_NOTIF_THROTTLE_MS);
  const links = targets.map((t) => `${args.link}?asChild=${t.childId}`);
  const recent = await db
    .select({ userId: notifications.userId, link: notifications.link })
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, "post_tag"),
        inArray(notifications.link, links),
        inArray(
          notifications.userId,
          targets.map((t) => t.guardianId),
        ),
        gt(notifications.createdAt, since),
      ),
    );
  const seen = new Set(recent.map((r) => `${r.userId}|${r.link}`));
  const toInsert = targets.filter(
    (t) => !seen.has(`${t.guardianId}|${args.link}?asChild=${t.childId}`),
  );
  if (toInsert.length === 0) return;
  await db.insert(notifications).values(
    toInsert.map((t) => ({
      userId: t.guardianId,
      kind: "post_tag",
      message: `${t.childFirst} was tagged in "${args.postTitle}"`,
      link: `${args.link}?asChild=${t.childId}`,
      actorUserId: args.actorUserId,
    })),
  );
}

// ---------------------------------------------------------------------------
// Article auto-tag fan-out (game recaps)
// ---------------------------------------------------------------------------
// When an article has `gameDate` set — or is a combined multi-game
// recap (`recapKind === "combined"`, which publishes with no gameDate;
// task #833) — every accepted player on the team's roster is
// auto-tagged. Called from POST /posts (initial create) and
// POST /posts/:postId/publish (draft → publish path) so drafts that
// get a game date added later still tag everyone at publish time.
// ON CONFLICT DO NOTHING keeps re-runs idempotent.
export async function applyArticleTagFanout(args: {
  articleId: string;
  teamId: string;
  taggerUserId: string;
  explicitUserIds: string[];
  gameDate: Date | null;
  recapKind?: string | null;
}): Promise<string[]> {
  type Entry = { status: "approved" | "pending"; source: "manual" | "auto" };
  const tagMap = new Map<string, Entry>();
  for (const uid of args.explicitUserIds) {
    tagMap.set(uid, { status: "approved", source: "manual" });
  }
  if (args.gameDate || args.recapKind === "combined") {
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
    // Task #755 — consent is required if ANY active guardian requires it.
    const guardianIdsByChild = await getActiveGuardianIdsForChildren(
      players.map((p) => p.userId),
    );
    const parentIds = Array.from(
      new Set([...guardianIdsByChild.values()].flat()),
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
      const parentRequires = (guardianIdsByChild.get(p.userId) ?? []).some(
        (gid) => !!parentConsent.get(gid),
      );
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

// ---------------------------------------------------------------------------
// @-mention tags (task #739)
// ---------------------------------------------------------------------------
// Recap bodies may carry inline mention tokens of the form
//   @[Display Name](user:<uuid>)
// The token lives inside the existing `body` string (the OpenAPI spec
// is locked, so no schema change). The server treats each token as an
// explicit manual tag request: the mentioned user must be an accepted
// player on the recap's team roster, and consent-requiring minors get
// a `pending` tag so the existing guardian-approval flow kicks in.
const MENTION_TOKEN_RE =
  /@\[[^\]\n]{1,80}\]\(user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export function extractMentionUserIds(
  body: string | null | undefined,
): string[] {
  if (!body) return [];
  const ids = new Set<string>();
  const re = new RegExp(MENTION_TOKEN_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) ids.add(m[1].toLowerCase());
  return Array.from(ids);
}

// Rewrite `body` so that every mention token whose user id is NOT in
// `validIds` collapses to the plain display name it carried (the
// "@[Jane Doe](user:...)" grammar disappears; "Jane Doe" stays in the
// prose). Forged or stale tokens therefore never persist — the client
// renderer only ever sees tokens the server validated against the
// roster at write time. Pure function, exported for tests.
const MENTION_TOKEN_WITH_NAME_RE =
  /@\[([^\]\n]{1,80})\]\(user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export function sanitizeMentionBody(
  body: string,
  validIds: ReadonlySet<string>,
): string {
  return body.replace(
    new RegExp(MENTION_TOKEN_WITH_NAME_RE.source, "gi"),
    (token, name: string, userId: string) =>
      validIds.has(userId.toLowerCase()) ? token : name,
  );
}

// Parse mention tokens out of `body`, validate each mentioned user is
// an accepted player on the team's roster (invalid tokens are ignored),
// and upsert a manual tag row per valid mention. Consent-requiring
// players (their own `requireTagConsent`, or a linked guardian who
// gates consent) get `status: "pending"` so the existing approval flow
// runs; everyone else is `approved` immediately. `source: "manual"`
// keeps mention tags safe from the auto-fanout OFF-toggle cleanup.
//
// Returns:
//   * `inserted` — user ids whose tag row was created by THIS call
//     (the "notify these" set for paths that notify immediately).
//   * `mentioned` — all valid roster-mention ids that hold a tag row
//     after the call, whether or not this call inserted it. Used by
//     the deferred-notify paths (pending_approval → published) where
//     the row was created earlier but nobody was pinged yet.
//   * `sanitizedBody` — non-null when the body contained tokens for
//     users NOT on the accepted roster: those tokens are collapsed to
//     their plain name, the cleaned body is persisted to
//     `articles.body`, and the caller must echo it in the response so
//     the client never sees (or re-saves) a forged token.
export async function applyMentionTags(args: {
  articleId: string;
  teamId: string;
  taggerUserId: string;
  body: string | null | undefined;
}): Promise<{
  inserted: string[];
  mentioned: string[];
  sanitizedBody: string | null;
}> {
  const mentionIds = extractMentionUserIds(args.body);
  if (mentionIds.length === 0) {
    return { inserted: [], mentioned: [], sanitizedBody: null };
  }
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
        inArray(rosterEntries.userId, mentionIds),
      ),
    );
  // Strip every token that didn't validate against the roster (forged
  // ids, ex-players, non-player roles) and persist the cleaned body.
  const validIdSet = new Set(players.map((p) => p.userId.toLowerCase()));
  let sanitizedBody: string | null = null;
  if (args.body && mentionIds.some((id) => !validIdSet.has(id))) {
    sanitizedBody = sanitizeMentionBody(args.body, validIdSet);
    await db
      .update(articles)
      .set({ body: sanitizedBody })
      .where(eq(articles.id, args.articleId));
  }
  if (players.length === 0) {
    return { inserted: [], mentioned: [], sanitizedBody };
  }
  // Task #755 — consent is required if ANY active guardian requires it.
  const mentionGuardianIdsByChild = await getActiveGuardianIdsForChildren(
    players.map((p) => p.userId),
  );
  const parentIds = Array.from(
    new Set([...mentionGuardianIdsByChild.values()].flat()),
  );
  const parentConsent = new Map<string, boolean>();
  if (parentIds.length > 0) {
    const parents = await db
      .select({ id: users.id, flag: users.requireTagConsent })
      .from(users)
      .where(inArray(users.id, parentIds));
    for (const p of parents) parentConsent.set(p.id, !!p.flag);
  }
  const validIds = players.map((p) => p.userId);
  const existing = await db
    .select({ userId: articleTags.userId })
    .from(articleTags)
    .where(
      and(
        eq(articleTags.articleId, args.articleId),
        inArray(articleTags.userId, validIds),
      ),
    );
  const existingIds = new Set(existing.map((r) => r.userId));
  const toInsert = players.filter((p) => !existingIds.has(p.userId));
  if (toInsert.length === 0) {
    return { inserted: [], mentioned: validIds, sanitizedBody };
  }
  const inserted = await db
    .insert(articleTags)
    .values(
      toInsert.map((p) => {
        const parentRequires = (
          mentionGuardianIdsByChild.get(p.userId) ?? []
        ).some((gid) => !!parentConsent.get(gid));
        const requires = !!p.requireTagConsent || parentRequires;
        return {
          articleId: args.articleId,
          userId: p.userId,
          taggerUserId: args.taggerUserId,
          status: (requires ? "pending" : "approved") as
            | "pending"
            | "approved",
          source: "manual" as const,
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ userId: articleTags.userId });
  return {
    inserted: inserted.map((r) => r.userId),
    mentioned: validIds,
    sanitizedBody,
  };
}

// ---------------------------------------------------------------------------
// Article tag views (task #739 follow-through)
// ---------------------------------------------------------------------------
// Mirrors `loadHighlightTagViews` for recap articles: loads the
// tagged-user list the requesting viewer is allowed to see, in tag
// creation order. Approved tags are visible to everyone; pending tags
// only to the article's author and the tagged player themselves —
// the same visibility rule the recap consent flow already enforces
// elsewhere. The post detail page uses this list to decide which
// mention tokens render as live profile links: a token whose user no
// longer holds a visible tag row (deleted account, removed tag,
// pending consent hidden from this viewer) falls back to plain text.
export async function loadArticleTagViews(
  viewerId: string | null,
  articleList: { id: string; authorId: string | null }[],
  minorNameCtx?: MinorNameViewerContext,
): Promise<Map<string, PostTaggedUserView[]>> {
  const result = new Map<string, PostTaggedUserView[]>();
  for (const a of articleList) result.set(a.id, []);
  if (articleList.length === 0) return result;
  const ids = articleList.map((a) => a.id);
  const authorById = new Map(articleList.map((a) => [a.id, a.authorId]));

  const rows = await db
    .select({
      articleId: articleTags.articleId,
      userId: articleTags.userId,
      status: articleTags.status,
      createdAt: articleTags.createdAt,
      user: users,
    })
    .from(articleTags)
    .innerJoin(users, eq(articleTags.userId, users.id))
    .where(
      and(
        inArray(articleTags.articleId, ids),
        inArray(articleTags.status, ["approved", "pending"] as const),
      ),
    )
    .orderBy(asc(articleTags.createdAt));

  for (const r of rows) {
    if (r.status === "pending") {
      const authorId = authorById.get(r.articleId) ?? null;
      const isAuthor = !!viewerId && authorId === viewerId;
      const isSelf = !!viewerId && r.userId === viewerId;
      if (!isAuthor && !isSelf) continue;
    }
    const arr = result.get(r.articleId);
    if (!arr) continue;
    arr.push({
      id: r.userId,
      displayName: displayNameForViewer(r.user, minorNameCtx),
      avatarUrl: r.user.avatarUrl ?? null,
      tagStatus: r.status as "approved" | "pending",
    });
  }
  return result;
}

// Throttle window for "you were tagged in <recap>" notifications.
export const TAG_NOTIF_THROTTLE_MS = 10 * 60 * 1000;

// Shared email fan-out used by both the recap and highlight notify
// helpers (task #324). The bell-row throttle in the callers acts as the
// throttle for the email channel too — we only ever email users that
// just got a fresh bell row inserted, so re-tagging within the throttle
// window doesn't spam.
//
// Routed through the central dispatch gate (task #633) so each recipient's
// `social_tag` preference is honored, a no-login unsubscribe link is attached,
// and — critically for COPPA — a minor's tag email goes to their linked
// guardian, never the child's own inbox. Self-tags are filtered defensively
// here as well as upstream so a missed filter at a single call site can't
// leak a self-ping email.
async function sendTagEmails(args: {
  userIds: string[];
  postTitle: string;
  postLink: string;
  actorUserId: string | null;
  // Task #828 — recap emails invite recipients to add photos to the
  // recap's fan album (highlights don't get the line).
  isRecap: boolean;
}): Promise<void> {
  if (args.userIds.length === 0) return;
  // Skip the entire DB roundtrip when SendGrid isn't wired up — keeps
  // tests quiet and avoids wasted queries in environments that disable email.
  if (!(await isEmailConfiguredAsync())) return;
  const candidates = args.actorUserId
    ? args.userIds.filter((u) => u !== args.actorUserId)
    : args.userIds;
  if (candidates.length === 0) return;
  const postUrl = buildPostUrl(args.postLink);
  await dispatchNotificationEmailToMany({
    userIds: candidates,
    // Drop the actor even when a tagged minor routes back to a guardian who
    // is also the tagger (e.g. a guardian tagging their own child).
    excludeRecipientUserId: args.actorUserId ?? undefined,
    category: "social_tag",
    build: (ctx) =>
      buildTagEmail(ctx, {
        postTitle: args.postTitle,
        postUrl,
        isRecap: args.isRecap,
      }),
  });
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
    postTitle: title,
    postLink: link,
    actorUserId: args.actorUserId,
    isRecap: true,
  });
  // Task #363 Phase 2 — guardian bell for pending recap tags on minors.
  await notifyGuardiansOfPendingTags({
    pendingUserIds: target.filter((u) => statusByUser.get(u) === "pending"),
    postTitle: title,
  });
  // Task #800 — informational guardian bell for auto-approved tags on
  // minors, so parents keep visibility now that approval is opt-in.
  await notifyGuardiansOfApprovedTags({
    approvedUserIds: target.filter((u) => statusByUser.get(u) === "approved"),
    postTitle: title,
    link,
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
//   * For pending tags on a minor whose linked guardian gates consent
//     (`requireTagConsent = true`), the parent ALSO gets a bell row
//     pointing at the post page in "view as your child" mode — the
//     child can't actually approve the tag themselves, so without
//     this fan-out the parent only ever sees the prompt if they
//     happen to open the family inbox (task #323).
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
  const title = args.highlightTitle?.trim() ? args.highlightTitle.trim() : "Untitled";
  if (target.length > 0) {
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
  }

  // Mirror the player bell channel into email so out-of-app players still
  // find out (task #324). Done before the guardian fan-out below so the
  // early-returns in the parent path don't short-circuit the email channel
  // for tag batches that have no pending rows.
  await sendTagEmails({
    userIds: target.map((t) => t.userId),
    postTitle: title,
    postLink: link,
    actorUserId: args.actorUserId,
    isRecap: false,
  });

  // ---- Guardian fan-out for pending consent (task #323) --------------------
  // Only `pending` tags need a parent prompt; `approved` rows are not awaiting
  // anyone's review. Look up each pending-target's parent and surface the
  // prompt in the parent's bell so they can act from the family inbox even
  // if they never open it. Throttle/dedupe runs separately because the link
  // carries `?asChild=` (so it can't collide with the player's own bell row).
  const pendingChildIds = candidates
    .filter((t) => t.status === "pending")
    .map((t) => t.userId);
  if (pendingChildIds.length === 0) return;

  const childRows = await db
    .select({
      id: users.id,
      name: users.name,
      parentId: users.parentId,
    })
    .from(users)
    .where(inArray(users.id, pendingChildIds));
  // Task #755 — fan out to ALL active guardians, not just the primary.
  const pendingGuardianIdsByChild = await getActiveGuardianIdsForChildren(
    childRows.map((c) => c.id),
  );
  const parentIds = Array.from(
    new Set([...pendingGuardianIdsByChild.values()].flat()),
  );
  if (parentIds.length === 0) return;
  const parents = await db
    .select({ id: users.id, requireTagConsent: users.requireTagConsent })
    .from(users)
    .where(inArray(users.id, parentIds));
  const gatingParents = new Set(
    parents.filter((p) => !!p.requireTagConsent).map((p) => p.id),
  );
  // Drop self-tags by the parent (a parent tagging their own child is the
  // actor — they don't need a prompt to review their own action) and any
  // guardian who doesn't gate consent (the child can decide alone).
  const guardianTargets = childRows.flatMap((c) =>
    (pendingGuardianIdsByChild.get(c.id) ?? [])
      .filter((gid) => gatingParents.has(gid))
      .filter((gid) => !args.actorUserId || gid !== args.actorUserId)
      .map((gid) => ({
        parentId: gid,
        childId: c.id,
        childFirst:
          (c.name?.trim().split(/\s+/)[0] ?? "").length > 0
            ? c.name!.trim().split(/\s+/)[0]
            : "your child",
      })),
  );
  if (guardianTargets.length === 0) return;

  // Each (parent, child) pair has its own link so dedupe is per-child even
  // when one parent has multiple kids tagged on the same post.
  const guardianLinks = guardianTargets.map(
    (g) => `${link}?asChild=${g.childId}`,
  );
  const recentParents = await db
    .select({ userId: notifications.userId, link: notifications.link })
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, "post_tag"),
        inArray(notifications.link, guardianLinks),
        inArray(
          notifications.userId,
          guardianTargets.map((g) => g.parentId),
        ),
        gt(notifications.createdAt, since),
      ),
    );
  const parentSkip = new Set(
    recentParents.map((r) => `${r.userId}|${r.link ?? ""}`),
  );
  const parentInserts = guardianTargets
    .filter(
      (g) => !parentSkip.has(`${g.parentId}|${link}?asChild=${g.childId}`),
    )
    .map((g) => ({
      userId: g.parentId,
      kind: "post_tag",
      message: `Please review a tag on ${g.childFirst} in "${title}"`,
      link: `${link}?asChild=${g.childId}`,
      actorUserId: args.actorUserId,
    }));
  if (parentInserts.length > 0) {
    await db.insert(notifications).values(parentInserts);
  }

  // Task #363 Phase 2 — also fire the family-dashboard bell
  // (`child_pending_tag`) so the guardian sees pending tags in the
  // same queue as pending follows/dms/comments. Distinct from the
  // tag-review bell above, which links into the post page.
  await notifyGuardiansOfPendingTags({
    pendingUserIds: pendingChildIds,
    postTitle: title,
  });
}
