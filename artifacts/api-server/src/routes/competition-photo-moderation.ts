import { Router, type IRouter, type Response } from "express";
import {
  db,
  competitionPhotoBatches,
  competitionPhotos,
  competitionPhotoTeams,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { apiError as sendApiError, notFound as sendNotFound } from "../lib/spec-helpers";
import { loadPhotoCompetition } from "../lib/competition-photo-album-support";
import {
  canReviewCompetitionPhotos,
  isRealCompetitionAdmin,
  validatePhotoTeamIds,
} from "../lib/competition-photo-permissions";
import { deleteCompetitionPhotoObject } from "../lib/competition-photo-storage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function pathParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function apiError(...args: Parameters<typeof sendApiError>): void {
  sendApiError(...args);
}

function notFound(res: Response): void {
  sendNotFound(res);
}

router.post(
  "/competitions/:competitionId/album/review",
  asyncHandler(async (req, res): Promise<void> => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadPhotoCompetition(pathParam(req.params.competitionId));
    if (!competition) return notFound(res);
    if (!(await canReviewCompetitionPhotos(me, competition))) return apiError(res, 403, "Forbidden");
    const parsed = z.object({
      photoIds: z.array(z.string().uuid()).min(1).max(100),
      action: z.enum(["approve", "reject"]),
      expectedStatus: z.enum(["pending", "approved", "rejected"]),
    }).safeParse(req.body);
    if (!parsed.success || new Set(parsed.data?.photoIds ?? []).size !== parsed.data?.photoIds.length) {
      return apiError(res, 400, "Review requires 1-100 unique photoIds and valid action/status");
    }
    const finalizedPhotos = await db
      .select({ id: competitionPhotos.id })
      .from(competitionPhotos)
      .innerJoin(competitionPhotoBatches, eq(competitionPhotoBatches.id, competitionPhotos.batchId))
      .where(and(
        eq(competitionPhotos.competitionId, competition.id),
        inArray(competitionPhotos.id, parsed.data.photoIds),
        sql`${competitionPhotoBatches.finalizedAt} IS NOT NULL`,
        sql`${competitionPhotos.confirmedAt} IS NOT NULL`,
        sql`${competitionPhotos.objectPath} IS NOT NULL`,
      ));
    const reviewableIds = new Set(finalizedPhotos.map((item) => item.id));
    const changedIds: string[] = [];
    const conflictIds: string[] = [];
    const nextStatus = parsed.data.action === "approve" ? "approved" : "rejected";
    for (const photoId of parsed.data.photoIds) {
      if (!reviewableIds.has(photoId)) {
        conflictIds.push(photoId);
        continue;
      }
      if (parsed.data.expectedStatus === nextStatus) {
        const [exists] = await db.select({ id: competitionPhotos.id })
          .from(competitionPhotos)
          .where(and(
            eq(competitionPhotos.id, photoId),
            eq(competitionPhotos.competitionId, competition.id),
            eq(competitionPhotos.status, nextStatus),
          )).limit(1);
        if (exists) changedIds.push(photoId);
        else conflictIds.push(photoId);
        continue;
      }
      const [changed] = await db
        .update(competitionPhotos)
        .set({ status: nextStatus })
        .where(and(
          eq(competitionPhotos.id, photoId),
          eq(competitionPhotos.competitionId, competition.id),
          eq(competitionPhotos.status, parsed.data.expectedStatus),
          sql`${competitionPhotos.confirmedAt} IS NOT NULL`,
        ))
        .returning({ id: competitionPhotos.id });
      if (changed) changedIds.push(photoId);
      else conflictIds.push(photoId);
    }
    res.json({ changedIds, conflictIds });
  }),
);

router.patch(
  "/competitions/:competitionId/album/photos/tags",
  asyncHandler(async (req, res): Promise<void> => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadPhotoCompetition(pathParam(req.params.competitionId));
    if (!competition) return notFound(res);
    if (!(await isRealCompetitionAdmin(me.id, competition))) return apiError(res, 403, "Forbidden");
    const parsed = z.object({
      photoIds: z.array(z.string().uuid()).min(1).max(100),
      teamIds: z.array(z.string().uuid()).max(30),
    }).safeParse(req.body);
    if (!parsed.success ||
      new Set(parsed.data?.photoIds ?? []).size !== parsed.data?.photoIds.length ||
      new Set(parsed.data?.teamIds ?? []).size !== parsed.data?.teamIds.length) {
      return apiError(res, 400, "Tag edits require bounded unique photoIds/teamIds");
    }
    if (!(await validatePhotoTeamIds(competition.id, me.id, parsed.data.teamIds, true))) {
      return apiError(res, 400, "Only participating teams may be tagged");
    }
    const updatedCount = await db.transaction(async (tx) => {
      const photos = await tx
        .select({ id: competitionPhotos.id })
        .from(competitionPhotos)
        .where(and(
          eq(competitionPhotos.competitionId, competition.id),
          inArray(competitionPhotos.id, parsed.data.photoIds),
        ))
        .for("update");
      if (photos.length !== parsed.data.photoIds.length) return null;
      await tx.delete(competitionPhotoTeams).where(inArray(competitionPhotoTeams.photoId, parsed.data.photoIds));
      if (parsed.data.teamIds.length) {
        await tx.insert(competitionPhotoTeams).values(
          parsed.data.photoIds.flatMap((photoId) =>
            parsed.data.teamIds.map((teamId) => ({ photoId, teamId })),
          ),
        ).onConflictDoNothing();
      }
      return photos.length;
    });
    if (updatedCount === null) return apiError(res, 404, "One or more photos were not found");
    res.json({ updatedCount });
  }),
);

router.delete(
  "/competitions/:competitionId/album/photos/:photoId",
  asyncHandler(async (req, res): Promise<void> => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadPhotoCompetition(pathParam(req.params.competitionId));
    if (!competition) return notFound(res);
    const photoId = pathParam(req.params.photoId);
    const [photo] = await db
      .select()
      .from(competitionPhotos)
      .where(and(
        eq(competitionPhotos.id, photoId),
        eq(competitionPhotos.competitionId, competition.id),
      ))
      .limit(1);
    if (!photo) return notFound(res);
    if (photo.uploaderUserId !== me.id && !(await isRealCompetitionAdmin(me.id, competition))) {
      return apiError(res, 403, "Forbidden");
    }
    // Withdraw visibility before object I/O so a concurrent list/stream cannot
    // expose a row whose object has already been removed.
    await db
      .update(competitionPhotos)
      .set({ status: "rejected" })
      .where(eq(competitionPhotos.id, photo.id));
    if (photo.objectPath) {
      try {
        await deleteCompetitionPhotoObject(photo.objectPath);
      } catch {
        logger.warn({ photoId }, "Competition photo object cleanup failed");
        return apiError(res, 503, "Photo was withdrawn, but storage cleanup failed. Retry deletion.");
      }
    }
    await db.delete(competitionPhotos).where(eq(competitionPhotos.id, photo.id));
    res.status(204).end();
  }),
);

export default router;