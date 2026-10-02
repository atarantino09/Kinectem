import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { db, articles, orgPosts, teams, organizations, users, assets, articleAuthors, takedownRequests } from "@workspace/db";
import { and, eq, isNull, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import { rateLimit } from "../middlewares/rate-limit";
import { apiError, notFound, parsePostId, articleToPost, orgPostToPost, TRUSTED_MINOR_NAME_CONTEXT } from "../lib/spec-helpers";
import { canManageOrganization } from "../lib/permissions";
import {
  HistoricalMetadata, HistoricalScope, HistoricalValidationError, authorizeHistoricalScope,
  validateHistoricalImage, validateHistoricalPublication,
} from "../lib/historical-recaps";
import { saveHistoricalClipping, serveHistoricalClipping } from "../lib/historical-clipping-storage";
import { AiNotConfiguredError, transcribeHistoricalClipping } from "../lib/ai";
import { applyMentionTags, notifyNewlyTaggedInRecap } from "../lib/article-tagging";
import { notifyAdminsOfPendingPostApproval, notifyTeamFollowersOfNewRecap } from "../lib/notifications";
import { HISTORICAL_CLIPPING_PREFIX } from "../lib/historical-clipping-urls";

const router: IRouter = Router();
const PREFIX = HISTORICAL_CLIPPING_PREFIX;
const limiter = rateLimit({
  name: "historical-transcription", windowMs: 60_000, max: 5,
  keys: (req) => [req.sessionUser?.id],
  message: "Please wait a minute before extracting more text.",
});
const uploadLimiter = rateLimit({
  name: "historical-clipping-upload", windowMs: 60_000, max: 10,
  keys: (req) => [req.sessionUser?.id],
});
const Content = z.object({
  title: z.string().trim().max(200).optional(),
  body: z.string().max(50_000).optional(),
  coverImageUrl: z.string().max(200).nullable().optional(),
  historical: HistoricalMetadata.optional(),
  historicalReviewed: z.boolean().optional(),
}).strict();

function reportError(err: unknown, req: Request, res: Response) {
  if (err instanceof HistoricalValidationError) {
    apiError(res, err.status, err.message); return;
  }
  if (err instanceof AiNotConfiguredError) {
    apiError(res, 503, err.message, { code: "AI_NOT_CONFIGURED" }); return;
  }
  // Avoid logging provider payloads, clipping text, or API credentials.
  req.log.error({ errorType: err instanceof Error ? err.name : "Unknown" }, "Historical recap operation failed");
  apiError(res, 502, "The operation failed. Your clipping and manual text are kept; please try again.", { code: "HISTORICAL_OPERATION_FAILED" });
}

router.get("/historical-recaps/destination", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const scope = HistoricalScope.safeParse(req.query);
  if (!scope.success) { apiError(res, 400, "Choose one team or organization."); return; }
  const destination = await authorizeHistoricalScope(req.sessionUser!.id, scope.data);
  if (!destination) { apiError(res, 403, "You cannot author historical recaps for this destination."); return; }
  res.json({
    name: destination.team?.name ?? destination.org!.name,
    teamId: destination.team?.id ?? null,
    organizationId: destination.org?.id ?? null,
  });
}));

router.post("/ai/transcribe", requireAuth, limiter, asyncHandler(async (req, res): Promise<void> => {
  const scope = HistoricalScope.safeParse(req.body);
  if (!scope.success) { apiError(res, 400, "Choose one team or organization."); return; }
  if (!(await authorizeHistoricalScope(req.sessionUser!.id, scope.data))) {
    apiError(res, 403, "You cannot extract text for this destination."); return;
  }
  if (req.body?.rightsConfirmed !== true || req.body?.providerConsent !== true) {
    apiError(res, 400, "Confirm sharing permission and consent to send this image to Anthropic."); return;
  }
  try {
    const image = await validateHistoricalImage(req.body.imageDataUrl);
    const text = await transcribeHistoricalClipping(image);
    res.json({ text });
  } catch (err) { reportError(err, req, res); }
}));

router.post("/historical-recaps/clipping", requireAuth, uploadLimiter, asyncHandler(async (req, res): Promise<void> => {
  const scope = HistoricalScope.safeParse(req.body);
  if (!scope.success) { apiError(res, 400, "Choose one team or organization."); return; }
  if (!(await authorizeHistoricalScope(req.sessionUser!.id, scope.data))) {
    apiError(res, 403, "You cannot upload a clipping for this destination."); return;
  }
  try {
    const image = await validateHistoricalImage(req.body.imageDataUrl);
    const id = randomUUID();
    await saveHistoricalClipping(id, image.buffer, image.mediaType);
    const url = `${PREFIX}${id}`;
    await db.insert(assets).values({
      id, ownerId: req.sessionUser!.id, fileName: "newspaper-clipping",
      fileType: image.mediaType, fileSize: image.buffer.length, url, status: "confirmed",
    });
    res.status(201).json({ url });
  } catch (err) { reportError(err, req, res); }
}));

// A copied image URL cannot expose a private draft or a moderated clipping.
router.get("/historical-clippings/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { notFound(res); return; }
  const [asset] = await db.select().from(assets)
    .where(and(eq(assets.id, id.data), eq(assets.status, "confirmed"))).limit(1);
  if (!asset || asset.url !== `${PREFIX}${id.data}`) { notFound(res); return; }
  const [articleRows, orgRows] = await Promise.all([
    db.select().from(articles).where(and(eq(articles.coverImageUrl, asset.url), eq(articles.recapKind, "historical"))),
    db.select().from(orgPosts).where(and(eq(orgPosts.coverImageUrl, asset.url), eq(orgPosts.recapKind, "historical"))),
  ]);
  // Only validated historical references can release original bytes. Ordinary
  // covers (including legacy or forged references) never grant access. A
  // moderated historical reference cannot be revived by another reference.
  if (articleRows.some((a) => a.hiddenAt) || orgRows.some((p) => p.hiddenAt) ||
      await clippingHasPendingTakedown(articleRows.map((a) => a.id), orgRows.map((p) => p.id))) {
    notFound(res); return;
  }
  const me = req.sessionUser;
  let allowed = articleRows.length + orgRows.length === 0 && me?.id === asset.ownerId;
  for (const row of [...articleRows.map((a) => ({ row: a, kind: "article" as const })),
    ...orgRows.map((p) => ({ row: p, kind: "org_post" as const }))]) {
    if (row.row.status === "published") { allowed = true; break; }
    if (me) {
      const organizationId = "organizationId" in row.row ? row.row.organizationId :
        (await db.select().from(teams).where(eq(teams.id, row.row.teamId)).limit(1))[0]?.organizationId ?? null;
      if (row.row.authorId === me.id || await canManageOrganization(me.id, organizationId)) {
        allowed = true; break;
      }
    }
  }
  if (!allowed) { notFound(res); return; }
  try { await serveHistoricalClipping(asset.id, asset.fileType, res); }
  catch (err) { if (!res.headersSent) reportError(err, req, res); else res.destroy(); }
}));

async function clippingHasPendingTakedown(articleIds: string[], orgIds: string[]) {
  if (!articleIds.length && !orgIds.length) return false;
  const [pending] = await db.select({ id: takedownRequests.id }).from(takedownRequests).where(and(
    eq(takedownRequests.status, "pending"), or(
      articleIds.length ? and(eq(takedownRequests.postKind, "article"), inArray(takedownRequests.postRefId, articleIds)) : undefined,
      orgIds.length ? and(eq(takedownRequests.postKind, "org_post"), inArray(takedownRequests.postRefId, orgIds)) : undefined,
    ),
  )).limit(1);
  return !!pending;
}

async function validCover(userId: string, url: string | null | undefined, previous?: string | null) {
  if (!url) return true; // Incomplete drafts are allowed.
  if (!url.startsWith(PREFIX)) return false;
  if (url === previous) return true;
  const [asset] = await db.select({ id: assets.id }).from(assets).where(and(
    eq(assets.url, url), eq(assets.ownerId, userId), eq(assets.status, "confirmed"),
  )).limit(1);
  if (!asset) return false;
  const [articleRefs, orgRefs] = await Promise.all([
    db.select({ id: articles.id, hiddenAt: articles.hiddenAt }).from(articles)
      .where(and(eq(articles.coverImageUrl, url), eq(articles.recapKind, "historical"))),
    db.select({ id: orgPosts.id, hiddenAt: orgPosts.hiddenAt }).from(orgPosts)
      .where(and(eq(orgPosts.coverImageUrl, url), eq(orgPosts.recapKind, "historical"))),
  ]);
  return !articleRefs.some((a) => a.hiddenAt) && !orgRefs.some((p) => p.hiddenAt) &&
    !(await clippingHasPendingTakedown(articleRefs.map((a) => a.id), orgRefs.map((p) => p.id)));
}

router.post("/historical-recaps", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const scope = HistoricalScope.safeParse(req.body);
  if (!scope.success) { apiError(res, 400, "Choose one team or organization."); return; }
  const destination = await authorizeHistoricalScope(req.sessionUser!.id, scope.data);
  if (!destination) { apiError(res, 403, "You cannot author historical recaps for this destination."); return; }
  const { teamId: _t, organizationId: _o, ...input } = req.body;
  const content = Content.safeParse(input);
  if (!content.success) { apiError(res, 400, content.error.errors[0]?.message ?? "Invalid historical recap."); return; }
  if (!(await validCover(req.sessionUser!.id, content.data.coverImageUrl))) {
    apiError(res, 400, "Upload a validated clipping first."); return;
  }
  const metadata = { ...HistoricalMetadata.parse(content.data.historical ?? {}), reviewed: false };
  const values = {
    title: content.data.title || "Untitled historical recap", body: content.data.body ?? "",
    coverImageUrl: content.data.coverImageUrl ?? null,
    authorId: req.sessionUser!.id, recapKind: "historical", historical: metadata, status: "draft" as const,
  };
  if (destination.team) {
    const [a] = await db.insert(articles).values({ ...values, teamId: destination.team.id }).returning();
    res.status(201).json(articleToPost(a, { ...destination, author: req.sessionUser!, canEdit: true, minorNameCtx: TRUSTED_MINOR_NAME_CONTEXT }));
  } else {
    const [p] = await db.insert(orgPosts).values({ ...values, organizationId: destination.org!.id }).returning();
    res.status(201).json(orgPostToPost(p, { ...destination, author: req.sessionUser!, canEdit: true, minorNameCtx: TRUSTED_MINOR_NAME_CONTEXT }));
  }
}));

async function loadHistorical(postId: string) {
  const parsed = parsePostId(postId);
  if (!parsed || (parsed.kind !== "article" && parsed.kind !== "org_post")) return null;
  if (parsed.kind === "article") {
    const [row] = await db.select().from(articles).where(eq(articles.id, parsed.id)).limit(1);
    if (!row || row.recapKind !== "historical" || row.hiddenAt) return null;
    return { kind: parsed.kind, row, scope: { teamId: row.teamId } };
  }
  const [row] = await db.select().from(orgPosts).where(eq(orgPosts.id, parsed.id)).limit(1);
  if (!row || row.recapKind !== "historical" || row.hiddenAt) return null;
  return { kind: parsed.kind, row, scope: { organizationId: row.organizationId } };
}

async function mayEdit(userId: string, target: NonNullable<Awaited<ReturnType<typeof loadHistorical>>>) {
  const destination = await authorizeHistoricalScope(userId, target.scope);
  if (!destination) return null;
  if (target.row.authorId === userId || await canManageOrganization(userId, destination.org?.id ?? null)) return destination;
  if (target.kind === "article") {
    const [coauthor] = await db.select().from(articleAuthors)
      .where(and(eq(articleAuthors.articleId, target.row.id), eq(articleAuthors.userId, userId))).limit(1);
    if (coauthor) return destination;
  }
  return null;
}

async function patchHistorical(req: Request, res: Response, target: NonNullable<Awaited<ReturnType<typeof loadHistorical>>>) {
  const me = req.sessionUser!;
  const destination = await mayEdit(me.id, target);
  if (!destination) { apiError(res, 403, "You cannot edit this historical recap."); return; }
  const [author] = target.row.authorId
    ? await db.select().from(users).where(eq(users.id, target.row.authorId)).limit(1)
    : [null];
  const content = Content.safeParse(req.body);
  if (!content.success) { apiError(res, 400, content.error.errors[0]?.message ?? "Invalid historical recap."); return; }
  const c = content.data;
  if (!(await validCover(me.id, c.coverImageUrl, target.row.coverImageUrl))) {
    apiError(res, 400, "Upload a validated clipping first."); return;
  }
  const historical = { ...(c.historical ?? target.row.historical ?? HistoricalMetadata.parse({})), reviewed: false };
  const next = {
    title: c.title ?? target.row.title, body: c.body ?? target.row.body,
    coverImageUrl: c.coverImageUrl === undefined ? target.row.coverImageUrl : c.coverImageUrl,
    historical, updatedAt: new Date(),
  };
  try {
    if (target.row.status !== "draft") {
      // Published/pending text replacements require another explicit review.
      next.historical = validateHistoricalPublication(next, c.historicalReviewed === true || c.historical?.reviewed === true);
    }
    if (target.kind === "article") {
      const [a] = await db.update(articles).set(next).where(and(eq(articles.id, target.row.id),
        eq(articles.status, target.row.status as typeof articles.$inferSelect.status), isNull(articles.hiddenAt))).returning();
      if (!a) { apiError(res, 409, "The recap changed. Reopen it before editing."); return; }
      res.json(articleToPost(a, { ...destination, author: author ?? null, canEdit: true, minorNameCtx: TRUSTED_MINOR_NAME_CONTEXT }));
    } else {
      const [p] = await db.update(orgPosts).set(next).where(and(eq(orgPosts.id, target.row.id),
        eq(orgPosts.status, target.row.status as typeof orgPosts.$inferSelect.status), isNull(orgPosts.hiddenAt))).returning();
      if (!p) { apiError(res, 409, "The recap changed. Reopen it before editing."); return; }
      res.json(orgPostToPost(p, { ...destination, author: author ?? null, canEdit: true, minorNameCtx: TRUSTED_MINOR_NAME_CONTEXT }));
    }
  } catch (err) { reportError(err, req, res); }
}

router.patch("/historical-recaps/:postId", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const target = await loadHistorical(String(req.params.postId));
  if (!target) { notFound(res); return; }
  await patchHistorical(req, res, target);
}));
// Intercept generic edits so legacy clients cannot attach games, clear metadata,
// or turn history into current recaps. Ordinary posts still use existing paths.
router.patch("/posts/:postId", asyncHandler(async (req, res, next): Promise<void> => {
  const target = await loadHistorical(String(req.params.postId));
  if (!target) {
    if (req.body?.historical !== undefined || req.body?.recapKind === "historical") {
      apiError(res, 400, "A post's subtype cannot be changed to Historical Recap."); return;
    }
    next(); return;
  }
  if (!req.sessionUser) { apiError(res, 401, "Not authenticated"); return; }
  await patchHistorical(req, res, target);
}));

// Draft text/images stay private even when a caller guesses a social URL.
for (const suffix of ["comments", "reactions", "share", "shares"]) {
  router.all(`/posts/:postId/${suffix}`, asyncHandler(async (req, res, next): Promise<void> => {
    const target = await loadHistorical(String(req.params.postId));
    if (target && target.row.status !== "published") { notFound(res); return; }
    next();
  }));
}

router.post("/posts/:postId/publish", asyncHandler(async (req, res, next): Promise<void> => {
  const target = await loadHistorical(String(req.params.postId));
  if (!target) { next(); return; }
  const me = req.sessionUser;
  if (!me) { apiError(res, 401, "Not authenticated"); return; }
  const destination = await mayEdit(me.id, target);
  if (!destination) { apiError(res, 403, "You cannot publish this historical recap."); return; }
  const [author] = target.row.authorId
    ? await db.select().from(users).where(eq(users.id, target.row.authorId)).limit(1)
    : [null];
  try {
    const admin = await canManageOrganization(me.id, destination.org?.id ?? null);
    const status = target.kind === "article" && destination.org?.requireRecapApproval && !admin
      ? "pending_approval" as const : "published" as const;
    // Serialize review and publish against edits to ensure the reviewed draft
    // is the exact version that becomes visible.
    const updated = await db.transaction(async (tx) => {
      if (target.kind === "article") {
        const [row] = await tx.select().from(articles).where(eq(articles.id, target.row.id)).for("update");
        if (!row || row.hiddenAt || row.status !== "draft") throw new HistoricalValidationError("Only a draft can be published.", 409);
        const historical = validateHistoricalPublication(row, req.body?.historicalReviewed);
        return (await tx.update(articles).set({ historical, status, publishedAt: status === "published" ? new Date() : null })
          .where(eq(articles.id, row.id)).returning())[0];
      }
      const [row] = await tx.select().from(orgPosts).where(eq(orgPosts.id, target.row.id)).for("update");
      if (!row || row.hiddenAt || row.status !== "draft") throw new HistoricalValidationError("Only a draft can be published.", 409);
      const historical = validateHistoricalPublication(row, req.body?.historicalReviewed);
      return (await tx.update(orgPosts).set({ historical, status: "published", publishedAt: new Date() })
        .where(eq(orgPosts.id, row.id)).returning())[0];
    });
    if (target.kind === "article" && destination.team) {
      // Preserve explicit mentions; never run current-roster fan-out.
      const mentions = await applyMentionTags({ articleId: updated.id, teamId: destination.team.id, taggerUserId: me.id, body: updated.body });
      if (mentions.sanitizedBody !== null) updated.body = mentions.sanitizedBody;
      if (status === "published") {
        await notifyNewlyTaggedInRecap({ userIds: mentions.mentioned, articleId: updated.id, articleTitle: updated.title, actorUserId: me.id });
        await notifyTeamFollowersOfNewRecap({ teamId: destination.team.id, teamName: destination.team.name,
          articleId: updated.id, articleTitle: updated.title, actorName: me.name, actorUserId: me.id });
      } else if (destination.org) {
        await notifyAdminsOfPendingPostApproval({ organizationId: destination.org.id, teamName: destination.team.name,
          articleId: updated.id, articleTitle: updated.title, actorUserId: me.id, actorDisplayName: me.name });
      }
      res.json(articleToPost(updated as typeof articles.$inferSelect, { ...destination, author: author ?? null, canEdit: true, minorNameCtx: TRUSTED_MINOR_NAME_CONTEXT }));
    } else {
      res.json(orgPostToPost(updated as typeof orgPosts.$inferSelect, { ...destination, author: author ?? null, canEdit: true, minorNameCtx: TRUSTED_MINOR_NAME_CONTEXT }));
    }
  } catch (err) { reportError(err, req, res); }
}));

export default router;