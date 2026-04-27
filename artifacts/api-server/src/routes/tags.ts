import { Router, type IRouter } from "express";
import {
  db,
  users,
  organizations,
  teams,
  articles,
  articleTags,
  highlights,
  highlightTags,
} from "@workspace/db";
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
import { articlePostId, highlightPostId, apiError } from "../lib/spec-helpers";
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
// Tag management (player-removable tags)
// ---------------------------------------------------------------------------

router.get(
  "/users/me/tags",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json({ data: [] });
    const aRows = await db
      .select({
        t: articleTags,
        a: articles,
        team: teams,
        org: organizations,
      })
      .from(articleTags)
      .innerJoin(articles, eq(articleTags.articleId, articles.id))
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(and(eq(articleTags.userId, me.id), eq(articleTags.status, "approved")))
      .orderBy(desc(articleTags.createdAt));
    const hRows = await db
      .select({
        t: highlightTags,
        h: highlights,
        team: teams,
        org: organizations,
      })
      .from(highlightTags)
      .innerJoin(highlights, eq(highlightTags.highlightId, highlights.id))
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(and(eq(highlightTags.userId, me.id), eq(highlightTags.status, "approved")))
      .orderBy(desc(highlightTags.createdAt));
    const data = [
      ...aRows.map((r) => ({
        id: r.t.id,
        kind: "article" as const,
        postId: articlePostId(r.a.id),
        title: r.a.title ?? "Untitled",
        teamName: r.team.name,
        orgName: r.org.name,
        createdAt: r.t.createdAt.toISOString(),
      })),
      ...hRows.map((r) => ({
        id: r.t.id,
        kind: "highlight" as const,
        postId: highlightPostId(r.h.id),
        title: r.h.title ?? "Highlight",
        teamName: r.team.name,
        orgName: r.org.name,
        createdAt: r.t.createdAt.toISOString(),
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ data });
  }),
);

router.delete(
  "/article-tags/:tagId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [t] = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.id, req.params.tagId))
      .limit(1);
    if (!t) return res.status(204).end();
    if (t.userId !== me.id)
      return apiError(res, 403, "Not your tag");
    await db.delete(articleTags).where(eq(articleTags.id, t.id));
    res.status(204).end();
  }),
);

router.delete(
  "/highlight-tags/:tagId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [t] = await db
      .select()
      .from(highlightTags)
      .where(eq(highlightTags.id, req.params.tagId))
      .limit(1);
    if (!t) return res.status(204).end();
    if (t.userId !== me.id)
      return apiError(res, 403, "Not your tag");
    await db.delete(highlightTags).where(eq(highlightTags.id, t.id));
    res.status(204).end();
  }),
);

router.delete("/tags/:tagId", (_req, res) => res.status(204).end());

router.patch(
  "/users/me/tag-consent",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const requireTagConsent = !!req.body?.requireTagConsent;
    const [updated] = await db
      .update(users)
      .set({ requireTagConsent })
      .where(eq(users.id, me.id))
      .returning();
    res.json({ requireTagConsent: updated.requireTagConsent });
  }),
);

export default router;
