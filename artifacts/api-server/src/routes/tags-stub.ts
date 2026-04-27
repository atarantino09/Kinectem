import { Router, type IRouter, type Request, type Response } from "express";
import { db, articleTags, highlightTags } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
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
  paginate,
  articlePostId,
  highlightPostId,
  apiError,
  notFound,
} from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostOwnerId,
  type PostStats,
  type StatsKind,
} from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap, TAG_NOTIF_THROTTLE_MS } from "../lib/article-tagging";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Tags (pending) — stubs
// ---------------------------------------------------------------------------

router.get(
  "/tags/pending",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json(paginate([]));
    const aRows = await db
      .select()
      .from(articleTags)
      .where(and(eq(articleTags.userId, me.id), eq(articleTags.status, "pending")))
      .orderBy(desc(articleTags.createdAt));
    const hRows = await db
      .select()
      .from(highlightTags)
      .where(and(eq(highlightTags.userId, me.id), eq(highlightTags.status, "pending")))
      .orderBy(desc(highlightTags.createdAt));
    const data = [
      ...aRows.map((t) => ({
        id: t.id,
        postId: articlePostId(t.articleId),
        taggedEntityType: "user" as const,
        taggedEntityId: t.userId,
        direction: "lateral" as const,
        status: t.status,
        approverId: t.userId,
        createdBy: t.taggerUserId ?? null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      ...hRows.map((t) => ({
        id: t.id,
        postId: highlightPostId(t.highlightId),
        taggedEntityType: "user" as const,
        taggedEntityId: t.userId,
        direction: "lateral" as const,
        status: t.status,
        approverId: t.userId,
        createdBy: t.taggerUserId ?? null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json(paginate(data));
  }),
);

async function decidePendingTag(
  req: Request,
  res: Response,
  decision: "approved" | "declined",
) {
  const me = req.sessionUser;
  if (!me) return apiError(res, 401, "Not authenticated");
  const tagId = req.params.tagId;
  const [a] = await db.select().from(articleTags).where(eq(articleTags.id, tagId)).limit(1);
  if (a) {
    if (a.userId !== me.id)
      return apiError(res, 403, "Only the tagged user can decide this tag");
    const [updated] = await db
      .update(articleTags)
      .set({ status: decision, updatedAt: new Date() })
      .where(eq(articleTags.id, tagId))
      .returning();
    return res.json({
      id: updated.id,
      postId: articlePostId(updated.articleId),
      taggedEntityType: "user" as const,
      taggedEntityId: updated.userId,
      direction: "lateral" as const,
      status: updated.status,
      approverId: updated.userId,
      createdBy: updated.taggerUserId ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  }
  const [h] = await db.select().from(highlightTags).where(eq(highlightTags.id, tagId)).limit(1);
  if (!h) return notFound(res);
  if (h.userId !== me.id)
    return apiError(res, 403, "Only the tagged user can decide this tag");
  const [updated] = await db
    .update(highlightTags)
    .set({ status: decision, updatedAt: new Date() })
    .where(eq(highlightTags.id, tagId))
    .returning();
  res.json({
    id: updated.id,
    postId: highlightPostId(updated.highlightId),
    taggedEntityType: "user" as const,
    taggedEntityId: updated.userId,
    direction: "lateral" as const,
    status: updated.status,
    approverId: updated.userId,
    createdBy: updated.taggerUserId ?? null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
}

router.post(
  "/tags/:tagId/approve",
  asyncHandler((req, res) => decidePendingTag(req, res, "approved")),
);
router.post(
  "/tags/:tagId/decline",
  asyncHandler((req, res) => decidePendingTag(req, res, "declined")),
);

export default router;
