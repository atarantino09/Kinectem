import { Router, type IRouter } from "express";
import {
  db,
  users,
  organizations,
  teams,
  articles,
  highlights,
  orgPosts,
  conversations,
  conversationParticipants,
  messages,
  messageChildHides,
} from "@workspace/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import { sendGuardianConfirmationEmail, sendGuardianExpiredEmail, sendPasswordResetEmail } from "../lib/email";
import {
  canManageOrganization,
  computeArticleAuthorRoleMap,
} from "../lib/permissions";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../lib/auth";
import {
  displayName,
  articleToPost,
  highlightToPost,
  orgPostToPost,
  paginate,
  parsePostId,
  toMessage,
  apiError,
  safeAvatarUrl,
  notFound,
  TRUSTED_MINOR_NAME_CONTEXT,
} from "../lib/spec-helpers";
import { loadPostStats, statsFor } from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap, TAG_NOTIF_THROTTLE_MS } from "../lib/article-tagging";
import { loadHighlightTagViews } from "../lib/highlight-tagging";
import { authorizeChildAccess } from "./parent-inbox";
import { loadConversationView, loadAssetsForMessages } from "./messages";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Read-only "as your child" conversation views
// ---------------------------------------------------------------------------
// The per-child notification stream surfaces messages addressed to the
// child, but a confirmed guardian isn't a participant in the child's
// conversations and so can't open them through the normal /conversations
// endpoints. These endpoints let the guardian (or a real admin) read —
// and only read — the conversation that a stream item points at, scoped
// to a single child they're authorized for.

async function loadChildConversation(
  childId: string,
  conversationId: string,
): Promise<typeof conversations.$inferSelect | null> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) return null;
  // Confirm the child is a current participant in this conversation.
  // Without this check a parent could probe arbitrary conversation IDs.
  const [childPart] = await db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.participantType, "user"),
        eq(conversationParticipants.participantId, childId),
        isNull(conversationParticipants.leftAt),
      ),
    )
    .limit(1);
  if (!childPart) return null;
  return conv;
}

router.get(
  "/users/me/children/:childId/conversations/:conversationId",
  asyncHandler(async (req, res) => {
    const child = await authorizeChildAccess(req, res);
    if (!child) return;
    const conv = await loadChildConversation(child.id, req.params.conversationId);
    if (!conv) return notFound(res);
    // Render the conversation through the child's eyes so the "other
    // participant" is the person the child is talking to (not the parent).
    const view = await loadConversationView(conv, child.id);
    if (!view) return notFound(res);
    res.json(view);
  }),
);

router.get(
  "/users/me/children/:childId/conversations/:conversationId/messages",
  asyncHandler(async (req, res) => {
    const child = await authorizeChildAccess(req, res);
    if (!child) return;
    const conv = await loadChildConversation(child.id, req.params.conversationId);
    if (!conv) return notFound(res);
    const rows = await db
      .select({ m: messages, sender: users })
      .from(messages)
      .leftJoin(users, eq(messages.senderUserId, users.id))
      .where(eq(messages.conversationId, conv.id))
      .orderBy(asc(messages.createdAt));
    // Honor parent-side hides so the read-only family-stream view matches
    // what the child themselves would now see in their own inbox.
    const hides = await db
      .select({ messageId: messageChildHides.messageId })
      .from(messageChildHides)
      .where(eq(messageChildHides.childId, child.id));
    const hiddenIds = new Set(hides.map((h) => h.messageId));
    const visibleRows = rows.filter((r) => !hiddenIds.has(r.m.id));
    const assetsByMessage = await loadAssetsForMessages(
      visibleRows.map((r) => r.m.id),
    );
    res.json(
      paginate(
        visibleRows.map((r) =>
          toMessage(
            r.m,
            r.sender
              ? {
                  id: r.sender.id,
                  displayName: displayName(r.sender),
                  avatarUrl: safeAvatarUrl(r.sender.avatarUrl),
                }
              : null,
            assetsByMessage.get(r.m.id) ?? [],
          ),
        ),
      ),
    );
  }),
);

// Read-only "as your child" view of a single post. Returns the same payload
// shape as GET /posts/:postId but evaluates draft/hidden access and
// "hasReacted" through the child's identity, so the parent sees exactly what
// the child would see (including their own reactions). All published posts
// are universally viewable today, but routing through this endpoint future-
// proofs the experience if per-post audience restrictions are ever added.
router.get(
  "/users/me/children/:childId/posts/:postId",
  asyncHandler(async (req, res) => {
    const child = await authorizeChildAccess(req, res);
    if (!child) return;
    // Mirror /posts/:postId: real admins (acting as themselves) can still
    // see admin-hidden posts, so moderation flows continue to work even
    // when fetched through the child-scoped path.
    const isAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    if (parsed.kind === "article") {
      const [row] = await db
        .select({ a: articles, team: teams, org: organizations, author: users })
        .from(articles)
        .innerJoin(teams, eq(articles.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .leftJoin(users, eq(articles.authorId, users.id))
        .where(eq(articles.id, parsed.id))
        .limit(1);
      if (!row) return notFound(res);
      if (row.a.hiddenAt && !isAdmin) return notFound(res);
      if (row.a.status !== "published") {
        const childIsAuthor = row.a.authorId === child.id;
        const childIsOrgAdmin = await canManageOrganization(child.id, row.org.id);
        if (!childIsAuthor && !childIsOrgAdmin && !isAdmin) return notFound(res);
      }
      const [stats, authorRoleMap] = await Promise.all([
        loadPostStats(child.id, [{ kind: "article", refId: row.a.id }]),
        computeArticleAuthorRoleMap([
          {
            articleId: row.a.id,
            authorId: row.a.authorId,
            teamId: row.team.id,
            orgId: row.org.id,
          },
        ]),
      ]);
      // Task #414 — viewer is a confirmed guardian of `child` (or a
      // platform admin). The whole route is gated by
      // `authorizeChildAccess`, so masking is not needed here per
      // task scope (child-conversations is on the no-mask list).
      res.json(
        articleToPost(row.a, {
          team: row.team,
          org: row.org,
          author: row.author,
          authorRole: authorRoleMap.get(row.a.id) ?? null,
          ...statsFor(stats, "article", row.a.id),
          minorNameCtx: TRUSTED_MINOR_NAME_CONTEXT,
        }),
      );
      return;
    }
    if (parsed.kind === "org_post") {
      const [row] = await db
        .select({ p: orgPosts, org: organizations, author: users })
        .from(orgPosts)
        .innerJoin(organizations, eq(orgPosts.organizationId, organizations.id))
        .leftJoin(users, eq(orgPosts.authorId, users.id))
        .where(eq(orgPosts.id, parsed.id))
        .limit(1);
      if (!row) return notFound(res);
      if (row.p.hiddenAt && !isAdmin) return notFound(res);
      if (row.p.status !== "published") {
        const childIsAuthor = row.p.authorId === child.id;
        const childIsOrgAdmin = await canManageOrganization(child.id, row.org.id);
        if (!childIsAuthor && !childIsOrgAdmin && !isAdmin) return notFound(res);
      }
      const stats = await loadPostStats(child.id, [
        { kind: "org_post", refId: row.p.id },
      ]);
      res.json(
        orgPostToPost(row.p, {
          org: row.org,
          author: row.author,
          ...statsFor(stats, "org_post", row.p.id),
          minorNameCtx: TRUSTED_MINOR_NAME_CONTEXT,
        }),
      );
      return;
    }
    const [row] = await db
      .select({ h: highlights, team: teams, org: organizations, uploader: users })
      .from(highlights)
      // Task #510 — leftJoin to support profile-only highlights.
      .leftJoin(teams, eq(highlights.teamId, teams.id))
      .leftJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(highlights.uploaderId, users.id))
      .where(eq(highlights.id, parsed.id))
      .limit(1);
    if (!row) return notFound(res);
    if (row.h.hiddenAt && !isAdmin) return notFound(res);
    const [stats, tagViews] = await Promise.all([
      loadPostStats(child.id, [{ kind: "highlight", refId: row.h.id }]),
      loadHighlightTagViews(
        child.id,
        [{ id: row.h.id, uploaderId: row.h.uploaderId }],
        TRUSTED_MINOR_NAME_CONTEXT,
      ),
    ]);
    res.json(
      highlightToPost(row.h, {
        team: row.team,
        org: row.org,
        author: row.uploader,
        ...statsFor(stats, "highlight", row.h.id),
        taggedUsers: tagViews.get(row.h.id) ?? [],
        minorNameCtx: TRUSTED_MINOR_NAME_CONTEXT,
      }),
    );
  }),
);

router.patch(
  "/users/me/children/:childId/visibility",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [child] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.params.childId))
      .limit(1);
    if (!child || child.parentId !== me.id) {
      return apiError(res, 404, "Child not found");
    }
    const requireTagConsent = !!req.body?.requireTagConsent;
    const [updated] = await db
      .update(users)
      .set({ requireTagConsent })
      .where(eq(users.id, child.id))
      .returning();
    res.json({
      id: updated.id,
      requireTagConsent: updated.requireTagConsent,
    });
  }),
);

export default router;
