// Task #363 — COPPA Phase 2.
//
// Guardian-only endpoints powering the family dashboard's pending-item
// queues, DM allowlist management, recent-activity feed, data export,
// and consent revoke / regrant flows. All routes authorize on
// `users.parentId === me.id` for the path's `:childId` so a parent can
// only see and act on accounts they're linked to.

import { Router, type IRouter } from "express";
import {
  db,
  users,
  userFollowers,
  postComments,
  messages,
  conversationParticipants,
  conversations,
  articles,
  highlights,
  articleTags,
  highlightTags,
  parentalConsents,
  consentAuditLog,
  dmAllowlist,
  notifications,
  takedownRequests,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import {
  apiError,
  displayName,
  safeAvatarUrl,
  paginate,
} from "../lib/spec-helpers";
import { logConsentEvent, clientIp } from "../lib/coppa";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Authorization helper
// ---------------------------------------------------------------------------

async function authorizeGuardianForChild(
  req: Parameters<Parameters<typeof router.get>[1]>[0],
  res: Parameters<Parameters<typeof router.get>[1]>[1],
  childId: string,
): Promise<{ guardianId: string; childId: string } | null> {
  const me = req.sessionUser;
  if (!me) {
    apiError(res, 401, "Not authenticated");
    return null;
  }
  const [child] = await db
    .select({ id: users.id, parentId: users.parentId })
    .from(users)
    .where(eq(users.id, childId))
    .limit(1);
  if (!child || child.parentId !== me.id) {
    apiError(res, 404, "Child not found");
    return null;
  }
  return { guardianId: me.id, childId: child.id };
}

// ---------------------------------------------------------------------------
// Pending follows / dms / comments / tags — list endpoints
// ---------------------------------------------------------------------------

router.get(
  "/guardians/children/:childId/pending-follows",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    const rows = await db
      .select({
        followerUserId: userFollowers.followerUserId,
        createdAt: userFollowers.createdAt,
        name: users.name,
        avatarUrl: users.avatarUrl,
      })
      .from(userFollowers)
      .innerJoin(users, eq(users.id, userFollowers.followerUserId))
      .where(
        and(
          eq(userFollowers.followingUserId, auth.childId),
          eq(userFollowers.moderationStatus, "pending"),
        ),
      )
      .orderBy(desc(userFollowers.createdAt));
    return res.json(
      paginate(
        rows.map((r) => ({
          id: r.followerUserId,
          actor: {
            id: r.followerUserId,
            displayName: displayName({ name: r.name }),
            avatarUrl: safeAvatarUrl(r.avatarUrl),
          },
          createdAt: r.createdAt.toISOString(),
        })),
      ),
    );
  }),
);

router.get(
  "/guardians/children/:childId/pending-dms",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    // DMs pending review = messages where the recipient (other party)
    // is the child and moderation_status='pending'. We scope by joining
    // through conversation_participants to find conversations the child
    // is part of, then keep only messages NOT sent by them.
    const rows = await db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        body: messages.body,
        createdAt: messages.createdAt,
        senderUserId: messages.senderUserId,
        senderName: users.name,
        senderAvatarUrl: users.avatarUrl,
      })
      .from(messages)
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, messages.conversationId),
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, auth.childId),
        ),
      )
      .leftJoin(users, eq(users.id, messages.senderUserId))
      .where(
        and(
          eq(messages.moderationStatus, "pending"),
          sql`${messages.senderUserId} <> ${auth.childId}`,
        ),
      )
      .orderBy(desc(messages.createdAt));
    return res.json(
      paginate(
        rows.map((r) => ({
          id: r.id,
          conversationId: r.conversationId,
          body: r.body,
          createdAt: r.createdAt.toISOString(),
          actor: {
            id: r.senderUserId,
            displayName: displayName({ name: r.senderName ?? "Unknown" }),
            avatarUrl: safeAvatarUrl(r.senderAvatarUrl),
          },
        })),
      ),
    );
  }),
);

router.get(
  "/guardians/children/:childId/pending-comments",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    // Posts owned by the child: articles where they're the primary
    // author and highlights they uploaded. We collect both id sets and
    // query post_comments for pending rows pointing at them.
    const childArticles = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.authorId, auth.childId));
    const childHighlights = await db
      .select({ id: highlights.id })
      .from(highlights)
      .where(eq(highlights.uploaderId, auth.childId));
    const articleIds = childArticles.map((r) => r.id);
    const highlightIds = childHighlights.map((r) => r.id);
    if (articleIds.length === 0 && highlightIds.length === 0) {
      return res.json(paginate([]));
    }
    const conds = [eq(postComments.moderationStatus, "pending")];
    const refConds = [];
    if (articleIds.length > 0) {
      refConds.push(
        and(
          eq(postComments.postKind, "article"),
          inArray(postComments.postRefId, articleIds),
        ),
      );
    }
    if (highlightIds.length > 0) {
      refConds.push(
        and(
          eq(postComments.postKind, "highlight"),
          inArray(postComments.postRefId, highlightIds),
        ),
      );
    }
    const rows = await db
      .select({
        id: postComments.id,
        body: postComments.body,
        postKind: postComments.postKind,
        postRefId: postComments.postRefId,
        createdAt: postComments.createdAt,
        authorId: postComments.authorId,
        authorName: users.name,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(postComments)
      .leftJoin(users, eq(users.id, postComments.authorId))
      .where(
        and(
          ...conds,
          refConds.length === 1
            ? refConds[0]
            : sql`(${refConds[0]}) OR (${refConds[1]})`,
        ),
      )
      .orderBy(desc(postComments.createdAt));
    return res.json(
      paginate(
        rows.map((r) => ({
          id: r.id,
          body: r.body,
          postId: `${r.postKind}:${r.postRefId}`,
          createdAt: r.createdAt.toISOString(),
          actor: {
            id: r.authorId,
            displayName: displayName({ name: r.authorName ?? "Unknown" }),
            avatarUrl: safeAvatarUrl(r.authorAvatarUrl),
          },
        })),
      ),
    );
  }),
);

router.get(
  "/guardians/children/:childId/pending-tags",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    const aRows = await db
      .select({
        id: articleTags.id,
        articleId: articleTags.articleId,
        createdAt: articleTags.createdAt,
        taggerUserId: articleTags.taggerUserId,
        taggerName: users.name,
        taggerAvatarUrl: users.avatarUrl,
      })
      .from(articleTags)
      .leftJoin(users, eq(users.id, articleTags.taggerUserId))
      .where(
        and(
          eq(articleTags.userId, auth.childId),
          eq(articleTags.status, "pending"),
        ),
      )
      .orderBy(desc(articleTags.createdAt));
    const hRows = await db
      .select({
        id: highlightTags.id,
        highlightId: highlightTags.highlightId,
        createdAt: highlightTags.createdAt,
        taggerUserId: highlightTags.taggerUserId,
        taggerName: users.name,
        taggerAvatarUrl: users.avatarUrl,
      })
      .from(highlightTags)
      .leftJoin(users, eq(users.id, highlightTags.taggerUserId))
      .where(
        and(
          eq(highlightTags.userId, auth.childId),
          eq(highlightTags.status, "pending"),
        ),
      )
      .orderBy(desc(highlightTags.createdAt));
    const merged = [
      ...aRows.map((r) => ({
        id: r.id,
        kind: "article" as const,
        postId: `article:${r.articleId}`,
        createdAt: r.createdAt,
        actor: {
          id: r.taggerUserId,
          displayName: displayName({ name: r.taggerName ?? "Unknown" }),
          avatarUrl: safeAvatarUrl(r.taggerAvatarUrl),
        },
      })),
      ...hRows.map((r) => ({
        id: r.id,
        kind: "highlight" as const,
        postId: `highlight:${r.highlightId}`,
        createdAt: r.createdAt,
        actor: {
          id: r.taggerUserId,
          displayName: displayName({ name: r.taggerName ?? "Unknown" }),
          avatarUrl: safeAvatarUrl(r.taggerAvatarUrl),
        },
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return res.json(
      paginate(
        merged.map((r) => ({
          id: r.id,
          kind: r.kind,
          postId: r.postId,
          createdAt: r.createdAt.toISOString(),
          actor: r.actor,
        })),
      ),
    );
  }),
);

// ---------------------------------------------------------------------------
// Approve / decline a pending item
// ---------------------------------------------------------------------------

const PENDING_KINDS = ["follow", "dm", "comment", "tag"] as const;
type PendingKind = (typeof PENDING_KINDS)[number];

async function decidePending(
  guardianId: string,
  childId: string,
  kind: PendingKind,
  itemId: string,
  decision: "approved" | "declined",
): Promise<{ ok: boolean; message?: string }> {
  const decidedAt = new Date();
  if (kind === "follow") {
    // For follow rows, `id` is the follower's user id (the join is on
    // composite (followingUserId, followerUserId)).
    const updated = await db
      .update(userFollowers)
      .set({
        moderationStatus: decision,
        decidedByGuardianId: guardianId,
        decidedAt,
      })
      .where(
        and(
          eq(userFollowers.followingUserId, childId),
          eq(userFollowers.followerUserId, itemId),
          eq(userFollowers.moderationStatus, "pending"),
        ),
      )
      .returning({ followerId: userFollowers.followerUserId });
    if (updated.length === 0) return { ok: false, message: "Already decided" };
    if (decision === "declined") {
      await db
        .delete(userFollowers)
        .where(
          and(
            eq(userFollowers.followingUserId, childId),
            eq(userFollowers.followerUserId, itemId),
          ),
        );
    }
    return { ok: true };
  }
  if (kind === "dm") {
    // Scope to the authorized child: the message must live in a
    // conversation the child participates in AND must not have been
    // sent by the child themselves. This prevents one guardian from
    // deciding another child's pending DM by knowing the message id.
    const [row] = await db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, messages.conversationId),
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, childId),
        ),
      )
      .where(
        and(
          eq(messages.id, itemId),
          eq(messages.moderationStatus, "pending"),
          sql`${messages.senderUserId} <> ${childId}`,
        ),
      )
      .limit(1);
    if (!row) return { ok: false, message: "Not found" };
    const updated = await db
      .update(messages)
      .set({
        moderationStatus: decision,
        decidedByGuardianId: guardianId,
        decidedAt,
      })
      .where(
        and(
          eq(messages.id, itemId),
          eq(messages.moderationStatus, "pending"),
        ),
      )
      .returning({ id: messages.id });
    if (updated.length === 0) return { ok: false, message: "Already decided" };
    return { ok: true };
  }
  if (kind === "comment") {
    // Scope to the authorized child: the comment must target a post
    // (article or highlight) owned by the child.
    const [comment] = await db
      .select({
        id: postComments.id,
        postKind: postComments.postKind,
        postRefId: postComments.postRefId,
      })
      .from(postComments)
      .where(
        and(
          eq(postComments.id, itemId),
          eq(postComments.moderationStatus, "pending"),
        ),
      )
      .limit(1);
    if (!comment) return { ok: false, message: "Not found" };
    let owned = false;
    if (comment.postKind === "article") {
      const [a] = await db
        .select({ id: articles.id })
        .from(articles)
        .where(
          and(
            eq(articles.id, comment.postRefId),
            eq(articles.authorId, childId),
          ),
        )
        .limit(1);
      owned = !!a;
    } else if (comment.postKind === "highlight") {
      const [h] = await db
        .select({ id: highlights.id })
        .from(highlights)
        .where(
          and(
            eq(highlights.id, comment.postRefId),
            eq(highlights.uploaderId, childId),
          ),
        )
        .limit(1);
      owned = !!h;
    }
    if (!owned) return { ok: false, message: "Not found" };
    const updated = await db
      .update(postComments)
      .set({
        moderationStatus: decision,
        decidedByGuardianId: guardianId,
        decidedAt,
      })
      .where(
        and(
          eq(postComments.id, itemId),
          eq(postComments.moderationStatus, "pending"),
        ),
      )
      .returning({ id: postComments.id });
    if (updated.length === 0) return { ok: false, message: "Already decided" };
    return { ok: true };
  }
  if (kind === "tag") {
    // Tag id may be in either article_tags or highlight_tags. Try
    // article first, fall through to highlight.
    const status = decision === "approved" ? "approved" : "declined";
    const a = await db
      .update(articleTags)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(articleTags.id, itemId),
          eq(articleTags.userId, childId),
          eq(articleTags.status, "pending"),
        ),
      )
      .returning({ id: articleTags.id });
    if (a.length > 0) return { ok: true };
    const h = await db
      .update(highlightTags)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(highlightTags.id, itemId),
          eq(highlightTags.userId, childId),
          eq(highlightTags.status, "pending"),
        ),
      )
      .returning({ id: highlightTags.id });
    if (h.length > 0) return { ok: true };
    return { ok: false, message: "Tag not found" };
  }
  return { ok: false, message: "Unknown kind" };
}

router.post(
  "/guardians/children/:childId/pending/:kind/:id/approve",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    const kind = String(req.params.kind) as PendingKind;
    if (!PENDING_KINDS.includes(kind)) {
      return apiError(res, 400, "Invalid kind");
    }
    const out = await decidePending(
      auth.guardianId,
      auth.childId,
      kind,
      String(req.params.id),
      "approved",
    );
    if (!out.ok) return apiError(res, 404, out.message ?? "Not found");
    void logConsentEvent({
      event: `guardian_approved_${kind}` as never,
      childUserId: auth.childId,
      actorEmail: req.sessionUser?.email ?? null,
      actorIp: clientIp(req),
      details: `${kind}:${String(req.params.id)}`,
    });
    return res.json({ ok: true, decision: "approved" });
  }),
);

router.post(
  "/guardians/children/:childId/pending/:kind/:id/decline",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    const kind = String(req.params.kind) as PendingKind;
    if (!PENDING_KINDS.includes(kind)) {
      return apiError(res, 400, "Invalid kind");
    }
    const out = await decidePending(
      auth.guardianId,
      auth.childId,
      kind,
      String(req.params.id),
      "declined",
    );
    if (!out.ok) return apiError(res, 404, out.message ?? "Not found");
    void logConsentEvent({
      event: `guardian_declined_${kind}` as never,
      childUserId: auth.childId,
      actorEmail: req.sessionUser?.email ?? null,
      actorIp: clientIp(req),
      details: `${kind}:${String(req.params.id)}`,
    });
    return res.json({ ok: true, decision: "declined" });
  }),
);

// ---------------------------------------------------------------------------
// DM allowlist
// ---------------------------------------------------------------------------

router.get(
  "/guardians/children/:childId/dm-allowlist",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    const rows = await db
      .select({
        counterpartyUserId: dmAllowlist.counterpartyUserId,
        note: dmAllowlist.note,
        createdAt: dmAllowlist.createdAt,
        name: users.name,
        avatarUrl: users.avatarUrl,
      })
      .from(dmAllowlist)
      .leftJoin(users, eq(users.id, dmAllowlist.counterpartyUserId))
      .where(eq(dmAllowlist.childUserId, auth.childId))
      .orderBy(desc(dmAllowlist.createdAt));
    return res.json(
      paginate(
        rows.map((r) => ({
          counterpartyUserId: r.counterpartyUserId,
          displayName: displayName({ name: r.name ?? "Unknown" }),
          avatarUrl: safeAvatarUrl(r.avatarUrl),
          note: r.note,
          createdAt: r.createdAt.toISOString(),
        })),
      ),
    );
  }),
);

router.post(
  "/guardians/children/:childId/dm-allowlist",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    const counterpartyUserId = String(req.body?.counterpartyUserId ?? "").trim();
    if (!counterpartyUserId) {
      return apiError(res, 400, "counterpartyUserId is required");
    }
    if (counterpartyUserId === auth.childId) {
      return apiError(res, 400, "Cannot allowlist the child themselves");
    }
    const [other] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, counterpartyUserId))
      .limit(1);
    if (!other) return apiError(res, 404, "Counterparty not found");
    await db
      .insert(dmAllowlist)
      .values({
        childUserId: auth.childId,
        counterpartyUserId,
        addedByGuardianId: auth.guardianId,
        note: req.body?.note ? String(req.body.note).slice(0, 280) : null,
      })
      .onConflictDoNothing();
    void logConsentEvent({
      event: "guardian_dm_allowlist_add",
      childUserId: auth.childId,
      actorEmail: req.sessionUser?.email ?? null,
      actorIp: clientIp(req),
      details: `counterparty:${counterpartyUserId}`,
    });
    return res.status(201).json({ ok: true, counterpartyUserId });
  }),
);

router.delete(
  "/guardians/children/:childId/dm-allowlist/:counterpartyUserId",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    await db
      .delete(dmAllowlist)
      .where(
        and(
          eq(dmAllowlist.childUserId, auth.childId),
          eq(dmAllowlist.counterpartyUserId, String(req.params.counterpartyUserId)),
        ),
      );
    void logConsentEvent({
      event: "guardian_dm_allowlist_remove",
      childUserId: auth.childId,
      actorEmail: req.sessionUser?.email ?? null,
      actorIp: clientIp(req),
      details: `counterparty:${String(req.params.counterpartyUserId)}`,
    });
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Recent activity (read-only summary)
// ---------------------------------------------------------------------------

router.get(
  "/guardians/children/:childId/activity",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    const limit = 25;
    const [
      recentArticles,
      recentHighlights,
      recentComments,
      recentDms,
      recentReceivedDms,
      recentFollowers,
      recentFollowing,
      recentTagsArticles,
      recentTagsHighlights,
      recentReceivedComments,
    ] = await Promise.all([
        db
          .select({
            id: articles.id,
            title: articles.title,
            createdAt: articles.createdAt,
          })
          .from(articles)
          .where(eq(articles.authorId, auth.childId))
          .orderBy(desc(articles.createdAt))
          .limit(limit),
        db
          .select({ id: highlights.id, createdAt: highlights.createdAt })
          .from(highlights)
          .where(eq(highlights.uploaderId, auth.childId))
          .orderBy(desc(highlights.createdAt))
          .limit(limit),
        db
          .select({
            id: postComments.id,
            body: postComments.body,
            createdAt: postComments.createdAt,
            moderationStatus: postComments.moderationStatus,
          })
          .from(postComments)
          .where(eq(postComments.authorId, auth.childId))
          .orderBy(desc(postComments.createdAt))
          .limit(limit),
        db
          .select({
            id: messages.id,
            createdAt: messages.createdAt,
            moderationStatus: messages.moderationStatus,
          })
          .from(messages)
          .where(eq(messages.senderUserId, auth.childId))
          .orderBy(desc(messages.createdAt))
          .limit(limit),
        db
          .select({
            id: messages.id,
            createdAt: messages.createdAt,
            moderationStatus: messages.moderationStatus,
            senderUserId: messages.senderUserId,
          })
          .from(messages)
          .innerJoin(
            conversationParticipants,
            and(
              eq(
                conversationParticipants.conversationId,
                messages.conversationId,
              ),
              eq(conversationParticipants.participantType, "user"),
              eq(conversationParticipants.participantId, auth.childId),
            ),
          )
          .where(sql`${messages.senderUserId} <> ${auth.childId}`)
          .orderBy(desc(messages.createdAt))
          .limit(limit),
        db
          .select({
            followerUserId: userFollowers.followerUserId,
            createdAt: userFollowers.createdAt,
            moderationStatus: userFollowers.moderationStatus,
          })
          .from(userFollowers)
          .where(eq(userFollowers.followingUserId, auth.childId))
          .orderBy(desc(userFollowers.createdAt))
          .limit(limit),
        db
          .select({
            followingUserId: userFollowers.followingUserId,
            createdAt: userFollowers.createdAt,
            moderationStatus: userFollowers.moderationStatus,
          })
          .from(userFollowers)
          .where(eq(userFollowers.followerUserId, auth.childId))
          .orderBy(desc(userFollowers.createdAt))
          .limit(limit),
        db
          .select({
            id: articleTags.id,
            articleId: articleTags.articleId,
            status: articleTags.status,
            createdAt: articleTags.createdAt,
          })
          .from(articleTags)
          .where(eq(articleTags.userId, auth.childId))
          .orderBy(desc(articleTags.createdAt))
          .limit(limit),
        db
          .select({
            id: highlightTags.id,
            highlightId: highlightTags.highlightId,
            status: highlightTags.status,
            createdAt: highlightTags.createdAt,
          })
          .from(highlightTags)
          .where(eq(highlightTags.userId, auth.childId))
          .orderBy(desc(highlightTags.createdAt))
          .limit(limit),
        // Comments received on the child's own posts (articles +
        // highlights), excluding self-comments.
        db
          .select({
            id: postComments.id,
            body: postComments.body,
            createdAt: postComments.createdAt,
            moderationStatus: postComments.moderationStatus,
            authorId: postComments.authorId,
            postKind: postComments.postKind,
            postRefId: postComments.postRefId,
          })
          .from(postComments)
          .where(
            and(
              isNull(postComments.deletedAt),
              sql`${postComments.authorId} <> ${auth.childId}`,
              or(
                and(
                  eq(postComments.postKind, "article"),
                  inArray(
                    postComments.postRefId,
                    db
                      .select({ id: articles.id })
                      .from(articles)
                      .where(eq(articles.authorId, auth.childId)),
                  ),
                ),
                and(
                  eq(postComments.postKind, "highlight"),
                  inArray(
                    postComments.postRefId,
                    db
                      .select({ id: highlights.id })
                      .from(highlights)
                      .where(eq(highlights.uploaderId, auth.childId)),
                  ),
                ),
              ),
            ),
          )
          .orderBy(desc(postComments.createdAt))
          .limit(limit),
      ]);
    return res.json({
      articles: recentArticles.map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.createdAt.toISOString(),
      })),
      highlights: recentHighlights.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
      })),
      comments: recentComments.map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
        moderationStatus: r.moderationStatus,
      })),
      dmsSent: recentDms.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        moderationStatus: r.moderationStatus,
      })),
      dmsReceived: recentReceivedDms.map((r) => ({
        id: r.id,
        senderUserId: r.senderUserId,
        createdAt: r.createdAt.toISOString(),
        moderationStatus: r.moderationStatus,
      })),
      followers: recentFollowers.map((r) => ({
        followerUserId: r.followerUserId,
        createdAt: r.createdAt.toISOString(),
        moderationStatus: r.moderationStatus,
      })),
      following: recentFollowing.map((r) => ({
        followingUserId: r.followingUserId,
        createdAt: r.createdAt.toISOString(),
        moderationStatus: r.moderationStatus,
      })),
      tagsInArticles: recentTagsArticles.map((r) => ({
        id: r.id,
        articleId: r.articleId,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      tagsInHighlights: recentTagsHighlights.map((r) => ({
        id: r.id,
        highlightId: r.highlightId,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      commentsReceived: recentReceivedComments.map((r) => ({
        id: r.id,
        body: r.body,
        authorId: r.authorId,
        postKind: r.postKind,
        postRefId: r.postRefId,
        createdAt: r.createdAt.toISOString(),
        moderationStatus: r.moderationStatus,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Data export — JSON blob the guardian can save off
// ---------------------------------------------------------------------------

router.get(
  "/guardians/children/:childId/export",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    // Task #363 — guardian export must cover every category the
    // platform stores about the child: profile, consent records,
    // audit log, DMs (sent + received), comments authored, posts
    // (articles + highlights), tags they're in, and follow edges in
    // both directions.
    const [
      profile,
      allConsents,
      allAudit,
      sentDms,
      receivedDms,
      allComments,
      allArticles,
      allHighlights,
      tagsArticles,
      tagsHighlights,
      followers,
      following,
      allowlistRows,
      receivedComments,
    ] = await Promise.all([
      db.select().from(users).where(eq(users.id, auth.childId)).limit(1),
      db
        .select()
        .from(parentalConsents)
        .where(eq(parentalConsents.childUserId, auth.childId)),
      db
        .select()
        .from(consentAuditLog)
        .where(eq(consentAuditLog.childUserId, auth.childId))
        .orderBy(desc(consentAuditLog.createdAt)),
      db
        .select()
        .from(messages)
        .where(eq(messages.senderUserId, auth.childId))
        .orderBy(desc(messages.createdAt)),
      db
        .select({ m: messages })
        .from(messages)
        .innerJoin(
          conversationParticipants,
          and(
            eq(
              conversationParticipants.conversationId,
              messages.conversationId,
            ),
            eq(conversationParticipants.participantType, "user"),
            eq(conversationParticipants.participantId, auth.childId),
          ),
        )
        .where(sql`${messages.senderUserId} <> ${auth.childId}`)
        .orderBy(desc(messages.createdAt)),
      db
        .select()
        .from(postComments)
        .where(eq(postComments.authorId, auth.childId))
        .orderBy(desc(postComments.createdAt)),
      db
        .select()
        .from(articles)
        .where(eq(articles.authorId, auth.childId))
        .orderBy(desc(articles.createdAt)),
      db
        .select()
        .from(highlights)
        .where(eq(highlights.uploaderId, auth.childId))
        .orderBy(desc(highlights.createdAt)),
      db
        .select()
        .from(articleTags)
        .where(eq(articleTags.userId, auth.childId)),
      db
        .select()
        .from(highlightTags)
        .where(eq(highlightTags.userId, auth.childId)),
      db
        .select()
        .from(userFollowers)
        .where(eq(userFollowers.followingUserId, auth.childId)),
      db
        .select()
        .from(userFollowers)
        .where(eq(userFollowers.followerUserId, auth.childId)),
      db
        .select()
        .from(dmAllowlist)
        .where(eq(dmAllowlist.childUserId, auth.childId)),
      // Comments received on the child's own posts (articles +
      // highlights), excluding self-comments. Required for full
      // COPPA access parity.
      db
        .select()
        .from(postComments)
        .where(
          and(
            isNull(postComments.deletedAt),
            sql`${postComments.authorId} <> ${auth.childId}`,
            or(
              and(
                eq(postComments.postKind, "article"),
                inArray(
                  postComments.postRefId,
                  db
                    .select({ id: articles.id })
                    .from(articles)
                    .where(eq(articles.authorId, auth.childId)),
                ),
              ),
              and(
                eq(postComments.postKind, "highlight"),
                inArray(
                  postComments.postRefId,
                  db
                    .select({ id: highlights.id })
                    .from(highlights)
                    .where(eq(highlights.uploaderId, auth.childId)),
                ),
              ),
            ),
          ),
        )
        .orderBy(desc(postComments.createdAt)),
    ]);
    void logConsentEvent({
      event: "guardian_data_exported",
      childUserId: auth.childId,
      actorEmail: req.sessionUser?.email ?? null,
      actorIp: clientIp(req),
      details: `export:${new Date().toISOString()}`,
    });
    return res.json({
      exportedAt: new Date().toISOString(),
      childId: auth.childId,
      profile: profile[0]
        ? {
            id: profile[0].id,
            name: profile[0].name,
            email: profile[0].email,
            isMinor: profile[0].isMinor,
            accountStatus: profile[0].accountStatus,
            createdAt: profile[0].createdAt.toISOString(),
          }
        : null,
      consents: allConsents,
      auditLog: allAudit,
      messagesSent: sentDms,
      messagesReceived: receivedDms.map((r) => r.m),
      comments: allComments,
      commentsReceived: receivedComments,
      articles: allArticles,
      highlights: allHighlights,
      tagsInArticles: tagsArticles,
      tagsInHighlights: tagsHighlights,
      followers,
      following,
      dmAllowlist: allowlistRows,
    });
  }),
);

// ---------------------------------------------------------------------------
// Revoke / re-grant consent
// ---------------------------------------------------------------------------

router.post(
  "/guardians/children/:childId/revoke-consent",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    await db
      .update(users)
      .set({
        accountStatus: "pending_revocation",
        consentRevokedAt: new Date(),
      })
      .where(eq(users.id, auth.childId));
    // Also bell the child so they see the change.
    await db.insert(notifications).values({
      userId: auth.childId,
      kind: "guardian_revoked",
      message: "Your guardian has revoked consent. Your account is paused.",
      link: `/`,
      actorUserId: auth.guardianId,
    });
    void logConsentEvent({
      event: "guardian_revoke_requested",
      childUserId: auth.childId,
      actorEmail: req.sessionUser?.email ?? null,
      actorIp: clientIp(req),
      details: "revoke_via_dashboard",
    });
    return res.json({ ok: true, accountStatus: "pending_revocation" });
  }),
);

router.post(
  "/guardians/children/:childId/regrant-consent",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(req, res, String(req.params.childId));
    if (!auth) return;
    await db
      .update(users)
      .set({
        accountStatus: "active",
        consentRevokedAt: null,
        consentFinalizedAt: new Date(),
      })
      .where(eq(users.id, auth.childId));
    void logConsentEvent({
      event: "guardian_consent_regranted",
      childUserId: auth.childId,
      actorEmail: req.sessionUser?.email ?? null,
      actorIp: clientIp(req),
      details: "regrant_via_dashboard",
    });
    return res.json({ ok: true, accountStatus: "active" });
  }),
);

// ---------------------------------------------------------------------------
// Task #367 — COPPA Phase 3: right-to-delete + photo-of-minor takedown.
// ---------------------------------------------------------------------------

// POST /guardians/children/:childId/request-deletion
// Marks the account `pending_deletion` and stamps `deletion_requested_at`
// with the current timestamp (the operator hard-delete script keys
// off this column once the cooling-off window passes). The account is
// immediately locked out — further sign-ins fail the same way as a
// `disabled` account. Idempotent: a second call is a no-op.
router.post(
  "/guardians/children/:childId/request-deletion",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(
      req,
      res,
      String(req.params.childId),
    );
    if (!auth) return;
    // Task #367 — idempotent: only stamp `deletionRequestedAt` on the
    // first transition into `pending_deletion`. Repeated calls leave
    // the original timestamp alone so a confused / malicious caller
    // can't keep pushing out the 30-day hard-delete eligibility
    // window by re-submitting the request.
    const [child] = await db
      .select({
        accountStatus: users.accountStatus,
        deletionRequestedAt: users.deletionRequestedAt,
      })
      .from(users)
      .where(eq(users.id, auth.childId))
      .limit(1);
    const alreadyPending =
      child?.accountStatus === "pending_deletion" && !!child?.deletionRequestedAt;
    if (!alreadyPending) {
      await db
        .update(users)
        .set({
          accountStatus: "pending_deletion",
          deletionRequestedAt: new Date(),
        })
        .where(eq(users.id, auth.childId));
    }
    void logConsentEvent({
      event: "guardian_deletion_requested",
      childUserId: auth.childId,
      actorEmail: req.sessionUser?.email ?? null,
      actorIp: clientIp(req),
      details: "request_via_dashboard",
    });
    req.log.info(
      { childId: auth.childId, guardianId: auth.guardianId },
      "Guardian requested COPPA deletion",
    );
    return res.json({ ok: true, accountStatus: "pending_deletion" });
  }),
);

// POST /guardians/children/:childId/takedown-request
// Body: { postId: "article:<uuid>" | "highlight:<uuid>", reason?: string }
// Files a photo-of-minor takedown for an article or highlight that
// contains an unapproved image of the linked child. While
// `status='pending'`, GET /posts/:postId 404s the post for everyone
// except the requesting guardian and platform admins (who can resolve
// it). Org-post takedowns are out of scope for the launch-readiness
// MVP and rejected with 400.
router.post(
  "/guardians/children/:childId/takedown-request",
  asyncHandler(async (req, res) => {
    const auth = await authorizeGuardianForChild(
      req,
      res,
      String(req.params.childId),
    );
    if (!auth) return;
    const body = (req.body ?? {}) as { postId?: unknown; reason?: unknown };
    const postIdRaw = typeof body.postId === "string" ? body.postId : "";
    const reason =
      typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim().slice(0, 500)
        : null;
    const m = /^(article|highlight):([0-9a-f-]{36})$/i.exec(postIdRaw);
    if (!m) {
      return apiError(res, 400, "Invalid postId. Expected article:<uuid> or highlight:<uuid>.");
    }
    const kind = m[1].toLowerCase() as "article" | "highlight";
    const refId = m[2];
    // Task #367 — authorization: the guardian may only file a
    // takedown for a post that ALREADY links the child somehow.
    // Without this check, any guardian could suppress arbitrary
    // posts platform-wide by abusing the pending-takedown 404 in
    // GET /posts/:postId. Accepted child-relation signals:
    //   • article authored by the child
    //   • article tagging the child (any tag status — including
    //     pending — because a not-yet-approved tag is exactly the
    //     kind of photo a guardian needs to suppress)
    //   • highlight uploaded by the child
    //   • highlight tagging the child
    // A platform admin queue handles false flags + edge cases
    // (e.g. tag missing entirely) out of band.
    if (kind === "article") {
      const [row] = await db
        .select({ id: articles.id, authorId: articles.authorId })
        .from(articles)
        .where(eq(articles.id, refId))
        .limit(1);
      if (!row) return apiError(res, 404, "Post not found");
      let childIsLinked = row.authorId === auth.childId;
      if (!childIsLinked) {
        const [tag] = await db
          .select({ id: articleTags.id })
          .from(articleTags)
          .where(
            and(
              eq(articleTags.articleId, refId),
              eq(articleTags.userId, auth.childId),
            ),
          )
          .limit(1);
        childIsLinked = !!tag;
      }
      if (!childIsLinked) {
        return apiError(
          res,
          403,
          "Child is not linked to this post (not author, not tagged).",
        );
      }
    } else {
      const [row] = await db
        .select({ id: highlights.id, uploaderId: highlights.uploaderId })
        .from(highlights)
        .where(eq(highlights.id, refId))
        .limit(1);
      if (!row) return apiError(res, 404, "Post not found");
      let childIsLinked = row.uploaderId === auth.childId;
      if (!childIsLinked) {
        const [tag] = await db
          .select({ id: highlightTags.id })
          .from(highlightTags)
          .where(
            and(
              eq(highlightTags.highlightId, refId),
              eq(highlightTags.userId, auth.childId),
            ),
          )
          .limit(1);
        childIsLinked = !!tag;
      }
      if (!childIsLinked) {
        return apiError(
          res,
          403,
          "Child is not linked to this post (not uploader, not tagged).",
        );
      }
    }
    // Task #367 — idempotent: a duplicate filing by the same guardian
    // for the same post/child while a request is still pending returns
    // the existing row instead of stacking new ones. Resolved (non-
    // pending) prior requests don't block a fresh filing — once admin
    // ruled, the guardian can re-flag if the post resurfaces.
    const [existing] = await db
      .select()
      .from(takedownRequests)
      .where(
        and(
          eq(takedownRequests.childUserId, auth.childId),
          eq(takedownRequests.requestedByGuardianId, auth.guardianId),
          eq(takedownRequests.postKind, kind),
          eq(takedownRequests.postRefId, refId),
          eq(takedownRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (existing) {
      return res.status(200).json({
        id: existing.id,
        postKind: kind,
        postRefId: refId,
        status: existing.status,
        createdAt: existing.createdAt.toISOString(),
      });
    }
    const [created] = await db
      .insert(takedownRequests)
      .values({
        childUserId: auth.childId,
        requestedByGuardianId: auth.guardianId,
        postKind: kind,
        postRefId: refId,
        reason,
      })
      .returning();
    void logConsentEvent({
      event: "guardian_takedown_requested",
      childUserId: auth.childId,
      actorEmail: req.sessionUser?.email ?? null,
      actorIp: clientIp(req),
      details: `${kind}:${refId}${reason ? ` — ${reason}` : ""}`,
    });
    req.log.info(
      { childId: auth.childId, takedownId: created.id, kind, refId },
      "Guardian filed takedown request",
    );
    return res.status(201).json({
      id: created.id,
      postKind: kind,
      postRefId: refId,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
    });
  }),
);

export default router;
