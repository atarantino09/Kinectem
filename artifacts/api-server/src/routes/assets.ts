import express, { Router, type IRouter, type Request } from "express";
import { db, assets } from "@workspace/db";
import { eq } from "drizzle-orm";
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
import { toAssetResponse, apiError, notFound } from "../lib/spec-helpers";
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
// Assets (3-step upload: requestUpload → PUT data → confirmUpload)
// ---------------------------------------------------------------------------

const ASSET_UPLOAD_TTL_SECONDS = 3600;
const ASSET_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function publicBaseUrl(req: Request): string {
  const proto = req.protocol;
  const host = req.get("host");
  return `${proto}://${host}`;
}

router.post(
  "/assets/upload",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const fileName = String(req.body?.fileName ?? "").trim();
    const fileType = String(req.body?.fileType ?? "").trim();
    const fileSize = Number(req.body?.fileSize);
    if (!fileName || fileName.length > 255) {
      return apiError(res, 400, "fileName is required (max 255)");
    }
    if (!fileType) {
      return apiError(res, 400, "fileType is required");
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return apiError(res, 400, "fileSize must be a positive integer");
    }
    if (fileSize > ASSET_MAX_BYTES) {
      return apiError(res, 400, "fileSize exceeds the 10 MB limit");
    }
    const [created] = await db
      .insert(assets)
      .values({
        ownerId: me.id,
        fileName,
        fileType,
        fileSize,
        status: "pending",
      })
      .returning();
    const uploadUrl = `${publicBaseUrl(req)}/api/v1/assets/${created.id}/data`;
    res.status(201).json({
      assetId: created.id,
      uploadUrl,
      uploadHeaders: { "Content-Type": fileType },
      expiresIn: ASSET_UPLOAD_TTL_SECONDS,
    });
  }),
);

// Internal route used as the `uploadUrl` returned by /assets/upload. Accepts
// the raw binary body and stores it as a data URL on the asset row. This is
// not part of the public OpenAPI surface — clients only ever PUT to the URL
// they received from the upload-request response.
router.put(
  "/assets/:assetId/data",
  express.raw({ type: () => true, limit: `${ASSET_MAX_BYTES}b` }),
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [a] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, req.params.assetId))
      .limit(1);
    if (!a) return notFound(res);
    if (a.ownerId !== me.id) return apiError(res, 403, "Forbidden");
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || buf.length === 0) {
      return apiError(res, 400, "Request body is empty");
    }
    if (buf.length > ASSET_MAX_BYTES) {
      return apiError(res, 413, "Upload exceeds 10 MB");
    }
    const mime = a.fileType || "application/octet-stream";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    await db
      .update(assets)
      .set({ url: dataUrl, fileSize: buf.length })
      .where(eq(assets.id, a.id));
    res.status(204).end();
  }),
);

router.post(
  "/assets/:assetId/confirm",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [a] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, req.params.assetId))
      .limit(1);
    if (!a) return notFound(res);
    if (a.ownerId !== me.id) return apiError(res, 403, "Forbidden");
    if (!a.url) {
      return apiError(res, 422, "Upload has not been received yet");
    }
    const [updated] =
      a.status === "confirmed"
        ? [a]
        : await db
            .update(assets)
            .set({ status: "confirmed" })
            .where(eq(assets.id, a.id))
            .returning();
    res.status(200).json(toAssetResponse(updated));
  }),
);

router.get(
  "/assets/:assetId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [a] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, req.params.assetId))
      .limit(1);
    if (!a) return notFound(res);
    res.json(toAssetResponse(a));
  }),
);

router.delete(
  "/assets/:assetId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [a] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, req.params.assetId))
      .limit(1);
    if (!a) return notFound(res);
    if (a.ownerId !== me.id) return apiError(res, 403, "Forbidden");
    await db.delete(assets).where(eq(assets.id, a.id));
    res.status(204).end();
  }),
);

export default router;
