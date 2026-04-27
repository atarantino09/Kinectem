import { Router, type IRouter } from "express";
import {
  db,
  articles,
  highlights,
  orgPosts,
  postComments,
  contentReports,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { z } from "zod";
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
import { requireAuth } from "../middlewares/auth";
import { notFound } from "../lib/spec-helpers";
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
// User-facing reports
// ---------------------------------------------------------------------------

const ReportBody = z.object({
  contentType: z.enum(["article", "highlight", "org_post", "comment"]),
  contentId: z.string().uuid(),
  reason: z.string().min(1).max(120),
  note: z.string().max(2000).optional(),
});

router.post(
  "/reports",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser!;
    const body = ReportBody.parse(req.body);

    // Verify the content exists.
    let exists = false;
    if (body.contentType === "article") {
      const [r] = await db.select({ id: articles.id }).from(articles).where(eq(articles.id, body.contentId)).limit(1);
      exists = !!r;
    } else if (body.contentType === "highlight") {
      const [r] = await db.select({ id: highlights.id }).from(highlights).where(eq(highlights.id, body.contentId)).limit(1);
      exists = !!r;
    } else if (body.contentType === "org_post") {
      const [r] = await db.select({ id: orgPosts.id }).from(orgPosts).where(eq(orgPosts.id, body.contentId)).limit(1);
      exists = !!r;
    } else {
      const [r] = await db.select({ id: postComments.id }).from(postComments).where(eq(postComments.id, body.contentId)).limit(1);
      exists = !!r;
    }
    if (!exists) return notFound(res);

    // Dedupe: do not create another open report from the same reporter on the
    // same content.
    const [dupe] = await db
      .select()
      .from(contentReports)
      .where(
        and(
          eq(contentReports.reporterUserId, me.id),
          eq(contentReports.contentType, body.contentType),
          eq(contentReports.contentId, body.contentId),
          eq(contentReports.status, "open"),
        ),
      )
      .limit(1);
    if (dupe) {
      res.status(200).json({
        id: dupe.id,
        status: dupe.status,
        alreadyReported: true,
      });
      return;
    }

    const [created] = await db
      .insert(contentReports)
      .values({
        reporterUserId: me.id,
        contentType: body.contentType,
        contentId: body.contentId,
        reason: body.reason,
        note: body.note ?? null,
      })
      .returning();
    res.status(201).json({ id: created.id, status: created.status, alreadyReported: false });
  }),
);

// Returns whether the current viewer already has an open report against the
// given content. Used by the report dialog to disable submission when the
// user has already reported the item.
router.get(
  "/reports/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser!;
    const contentType = String(req.query["contentType"] ?? "");
    const contentId = String(req.query["contentId"] ?? "");
    if (!["article", "highlight", "org_post", "comment"].includes(contentType)) {
      res.status(400).json({ error: "Invalid contentType" });
      return;
    }
    if (!/^[0-9a-f-]{36}$/i.test(contentId)) {
      res.status(400).json({ error: "Invalid contentId" });
      return;
    }
    const [row] = await db
      .select({
        id: contentReports.id,
        reason: contentReports.reason,
        note: contentReports.note,
        status: contentReports.status,
        createdAt: contentReports.createdAt,
      })
      .from(contentReports)
      .where(
        and(
          eq(contentReports.reporterUserId, me.id),
          eq(
            contentReports.contentType,
            contentType as "article" | "highlight" | "org_post" | "comment",
          ),
          eq(contentReports.contentId, contentId),
          eq(contentReports.status, "open"),
        ),
      )
      .limit(1);
    res.json({
      alreadyReported: !!row,
      report: row
        ? {
            id: row.id,
            reason: row.reason,
            note: row.note ?? null,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
          }
        : null,
    });
  }),
);

export default router;
