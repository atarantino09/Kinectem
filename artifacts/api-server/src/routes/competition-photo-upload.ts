import { Router, type IRouter, type Response } from "express";
import {
  db,
  competitionPhotoBatches,
  competitionPhotos,
  competitionPhotoTeams,
  teams,
  tournaments,
  users,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { apiError as sendApiError, notFound as sendNotFound } from "../lib/spec-helpers";
import {
  competitionPhotoActorName,
  dispatchCompetitionPhotoBatchAlerts,
  loadPhotoCompetition,
  loadPhotoUploader,
  serializeCompetitionPhoto,
} from "../lib/competition-photo-album-support";
import {
  canContributeToCompetition,
  isRealCompetitionAdmin,
  validatePhotoTeamIds,
} from "../lib/competition-photo-permissions";
import {
  CompetitionPhotoValidationError,
  COMPETITION_PHOTO_MAX_BYTES,
  createCompetitionPhotoUpload,
  sealCompetitionPhotoUpload,
} from "../lib/competition-photo-storage";

const router: IRouter = Router();
const MAX_BATCH_PHOTOS = 100;
const uuid = z.string().uuid();

function pathParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function apiError(...args: Parameters<typeof sendApiError>): void {
  sendApiError(...args);
}

function notFound(res: Response): void {
  sendNotFound(res);
}

router.patch(
  "/competitions/:competitionId/album",
  asyncHandler(async (req, res): Promise<void> => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadPhotoCompetition(pathParam(req.params.competitionId));
    if (!competition) return notFound(res);
    if (!(await isRealCompetitionAdmin(me.id, competition))) return apiError(res, 403, "Forbidden");
    const parsed = z.object({ contributionsOpen: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, "contributionsOpen must be a boolean");
    const [updated] = await db
      .update(tournaments)
      .set({ contributionsOpen: parsed.data.contributionsOpen, updatedAt: new Date() })
      .where(eq(tournaments.id, competition.id))
      .returning({ contributionsOpen: tournaments.contributionsOpen });
    res.json({ contributionsOpen: updated.contributionsOpen });
  }),
);

router.post(
  "/competitions/:competitionId/album/batches",
  asyncHandler(async (req, res): Promise<void> => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadPhotoCompetition(pathParam(req.params.competitionId));
    if (!competition) return notFound(res);
    const user = await loadPhotoUploader(me.id);
    if (!user || user.accountStatus !== "active" || (user.isMinor && !user.consentFinalizedAt)) {
      return apiError(res, 403, "Account is not eligible to upload");
    }
    const realAdmin = await isRealCompetitionAdmin(me.id, competition);
    if (!realAdmin && (!competition.contributionsOpen || !(await canContributeToCompetition(me.id, competition.id)))) {
      return apiError(res, 403, "Only eligible members of participating teams may contribute");
    }
    const parsed = z.object({ clientBatchId: z.string().trim().min(1).max(120) }).safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, "clientBatchId is required");
    const existing = await db
      .select({ id: competitionPhotoBatches.id, competitionId: competitionPhotoBatches.competitionId })
      .from(competitionPhotoBatches)
      .where(and(
        eq(competitionPhotoBatches.uploaderUserId, me.id),
        eq(competitionPhotoBatches.clientBatchId, parsed.data.clientBatchId),
      ))
      .limit(1);
    if (existing[0]) {
      if (existing[0].competitionId !== competition.id) return apiError(res, 409, "Batch id already used for another competition");
      res.json({ id: existing[0].id });
      return;
    }
    const [batch] = await db
      .insert(competitionPhotoBatches)
      .values({
        competitionId: competition.id,
        uploaderUserId: me.id,
        clientBatchId: parsed.data.clientBatchId,
      })
      .onConflictDoNothing()
      .returning({ id: competitionPhotoBatches.id });
    if (batch) {
      res.status(201).json({ id: batch.id });
      return;
    }
    const [retry] = await db
      .select({ id: competitionPhotoBatches.id })
      .from(competitionPhotoBatches)
      .where(and(
        eq(competitionPhotoBatches.uploaderUserId, me.id),
        eq(competitionPhotoBatches.clientBatchId, parsed.data.clientBatchId),
        eq(competitionPhotoBatches.competitionId, competition.id),
      ))
      .limit(1);
    if (!retry) return apiError(res, 409, "Could not create upload batch");
    res.json({ id: retry.id });
  }),
);

router.post(
  "/competitions/:competitionId/album/batches/:batchId/photos",
  asyncHandler(async (req, res): Promise<void> => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadPhotoCompetition(pathParam(req.params.competitionId));
    if (!competition) return notFound(res);
    const batchId = pathParam(req.params.batchId);
    if (!uuid.safeParse(batchId).success) return notFound(res);
    const user = await loadPhotoUploader(me.id);
    if (!user || user.accountStatus !== "active" || (user.isMinor && !user.consentFinalizedAt)) {
      return apiError(res, 403, "Account is not eligible to upload");
    }
    const parsed = z.object({
      clientPhotoId: z.string().trim().min(1).max(120),
      fileName: z.string().trim().min(1).max(255),
      fileType: z.string().trim().min(1).max(120),
      fileSize: z.number().int().positive().max(COMPETITION_PHOTO_MAX_BYTES),
      teamIds: z.array(z.string().uuid()).max(30).default([]),
    }).safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, "Invalid photo metadata");
    const realAdmin = await isRealCompetitionAdmin(me.id, competition);
    if (!realAdmin && (!competition.contributionsOpen || !(await canContributeToCompetition(me.id, competition.id)))) {
      return apiError(res, 403, "Contributions are closed or the user is not eligible");
    }
    if (!(await validatePhotoTeamIds(competition.id, me.id, parsed.data.teamIds, realAdmin))) {
      return apiError(res, 403, "Only eligible participating teams may be tagged");
    }
    const saved = await db.transaction(async (tx) => {
      const [batch] = await tx
        .select()
        .from(competitionPhotoBatches)
        .where(and(
          eq(competitionPhotoBatches.id, batchId),
          eq(competitionPhotoBatches.competitionId, competition.id),
          eq(competitionPhotoBatches.uploaderUserId, me.id),
        ))
        .for("update")
        .limit(1);
      if (!batch) return { kind: "missing" as const };
      if (batch.finalizedAt) return { kind: "finalized" as const };
      const [already] = await tx
        .select()
        .from(competitionPhotos)
        .where(and(
          eq(competitionPhotos.batchId, batch.id),
          eq(competitionPhotos.clientPhotoId, parsed.data.clientPhotoId),
        ))
        .limit(1);
      if (already) return { kind: "existing" as const, photo: already };
      const [batchCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(competitionPhotos)
        .where(eq(competitionPhotos.batchId, batch.id));
      if ((batchCount?.count ?? 0) >= MAX_BATCH_PHOTOS) return { kind: "full" as const };
      const [photo] = await tx
        .insert(competitionPhotos)
        .values({
          batchId: batch.id,
          competitionId: competition.id,
          uploaderUserId: me.id,
          clientPhotoId: parsed.data.clientPhotoId,
          fileName: parsed.data.fileName,
          fileType: parsed.data.fileType,
          declaredFileSize: parsed.data.fileSize,
          status: realAdmin ? "approved" : "pending",
        })
        .onConflictDoNothing()
        .returning();
      if (!photo) {
        const [retry] = await tx
          .select()
          .from(competitionPhotos)
          .where(and(
            eq(competitionPhotos.batchId, batch.id),
            eq(competitionPhotos.clientPhotoId, parsed.data.clientPhotoId),
          ))
          .limit(1);
        return retry
          ? { kind: "existing" as const, photo: retry }
          : { kind: "conflict" as const };
      }
      if (parsed.data.teamIds.length) {
        await tx.insert(competitionPhotoTeams).values(
          parsed.data.teamIds.map((teamId) => ({ photoId: photo.id, teamId })),
        ).onConflictDoNothing();
      }
      return { kind: "created" as const, photo };
    });
    if (saved.kind === "missing") return notFound(res);
    if (saved.kind === "finalized") return apiError(res, 409, "Batch is complete; retry failed photos in a new batch");
    if (saved.kind === "full") return apiError(res, 400, "A batch may contain at most 100 photos");
    if (saved.kind === "conflict") return apiError(res, 409, "Photo request conflicts with an existing client id");
    if (saved.kind === "existing" && saved.photo.uploaderUserId !== me.id) return apiError(res, 403, "Forbidden");
    if (saved.kind === "existing" && saved.photo.confirmedAt) {
      res.json({ photoId: saved.photo.id, uploadUrl: "", confirmed: true });
      return;
    }
    let uploadUrl: string;
    try {
      ({ uploadUrl } = await createCompetitionPhotoUpload(saved.photo.id));
    } catch {
      return apiError(res, 503, "Could not prepare a secure photo upload. Please retry.");
    }
    res.status(saved.kind === "created" ? 201 : 200).json({
      photoId: saved.photo.id,
      uploadUrl,
    });
  }),
);

router.post(
  "/competitions/:competitionId/album/photos/:photoId/confirm",
  asyncHandler(async (req, res): Promise<void> => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadPhotoCompetition(pathParam(req.params.competitionId));
    if (!competition) return notFound(res);
    const photoId = pathParam(req.params.photoId);
    if (!uuid.safeParse(photoId).success) return notFound(res);
    const user = await loadPhotoUploader(me.id);
    if (!user || user.accountStatus !== "active" || (user.isMinor && !user.consentFinalizedAt)) {
      return apiError(res, 403, "Account is not eligible to upload");
    }
    const confirmed = await db.transaction(async (tx) => {
      const [photoHint] = await tx
        .select()
        .from(competitionPhotos)
        .where(and(
          eq(competitionPhotos.id, photoId),
          eq(competitionPhotos.competitionId, competition.id),
          eq(competitionPhotos.uploaderUserId, me.id),
        ))
        .limit(1);
      if (!photoHint) return { kind: "missing" as const };
      const [batch] = await tx
        .select()
        .from(competitionPhotoBatches)
        .where(and(
          eq(competitionPhotoBatches.id, photoHint.batchId),
          eq(competitionPhotoBatches.competitionId, competition.id),
        ))
        .for("update")
        .limit(1);
      if (!batch) return { kind: "missing" as const };
      if (batch.finalizedAt) return { kind: "finalized" as const };
      const [photo] = await tx
        .select()
        .from(competitionPhotos)
        .where(and(
          eq(competitionPhotos.id, photoId),
          eq(competitionPhotos.batchId, batch.id),
          eq(competitionPhotos.competitionId, competition.id),
          eq(competitionPhotos.uploaderUserId, me.id),
        ))
        .for("update")
        .limit(1);
      if (!photo) return { kind: "missing" as const };
      if (photo.confirmedAt && photo.objectPath) return { kind: "confirmed" as const };
      if (!(await isRealCompetitionAdmin(me.id, competition)) &&
        (!competition.contributionsOpen || !(await canContributeToCompetition(me.id, competition.id)))) {
        return { kind: "forbidden" as const };
      }
      try {
        const sealed = await sealCompetitionPhotoUpload(photo.id, photo.fileType, user.isMinor);
        const [updated] = await tx
          .update(competitionPhotos)
          .set({
            objectPath: sealed.objectPath,
            fileSize: sealed.fileSize,
            confirmedAt: new Date(),
          })
          .where(and(
            eq(competitionPhotos.id, photo.id),
            isNull(competitionPhotos.confirmedAt),
          ))
          .returning();
        return { kind: "confirmed" as const, photo: updated };
      } catch (error) {
        if (error instanceof CompetitionPhotoValidationError) {
          return { kind: "validation" as const, error };
        }
        return { kind: "storage-failed" as const };
      }
    });
    if (confirmed.kind === "missing") return notFound(res);
    if (confirmed.kind === "finalized") return apiError(res, 409, "Batch is complete; retry failed photos in a new batch");
    if (confirmed.kind === "forbidden") return apiError(res, 403, "Contributions are closed or the user is not eligible");
    if (confirmed.kind === "validation") return apiError(res, 400, confirmed.error.message);
    if (confirmed.kind === "storage-failed") return apiError(res, 503, "The photo could not be sealed. Please retry.");
    const shaped = await serializeCompetitionPhoto(photoId, true);
    if (!shaped) return notFound(res);
    res.json(shaped.response);
  }),
);

router.post(
  "/competitions/:competitionId/album/batches/:batchId/complete",
  asyncHandler(async (req, res): Promise<void> => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const competition = await loadPhotoCompetition(pathParam(req.params.competitionId));
    if (!competition) return notFound(res);
    const batchId = pathParam(req.params.batchId);
    if (!uuid.safeParse(batchId).success) return notFound(res);
    const result = await db.transaction(async (tx) => {
      const [batch] = await tx
        .select()
        .from(competitionPhotoBatches)
        .where(and(
          eq(competitionPhotoBatches.id, batchId),
          eq(competitionPhotoBatches.competitionId, competition.id),
          eq(competitionPhotoBatches.uploaderUserId, me.id),
        ))
        .for("update")
        .limit(1);
      if (!batch) return { kind: "missing" as const };
      const [account] = await tx
        .select({
          isMinor: users.isMinor,
          accountStatus: users.accountStatus,
          consentFinalizedAt: users.consentFinalizedAt,
          name: users.name,
        })
        .from(users)
        .where(eq(users.id, me.id))
        .limit(1);
      if (!account || account.accountStatus !== "active" || (account.isMinor && !account.consentFinalizedAt)) {
        return { kind: "forbidden" as const };
      }
      const realAdmin = await isRealCompetitionAdmin(me.id, competition);
      const actorName = competitionPhotoActorName(account);
      if (batch.finalizedAt) {
        const [count] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(competitionPhotos)
          .where(and(
            eq(competitionPhotos.batchId, batch.id),
            sql`${competitionPhotos.confirmedAt} IS NOT NULL`,
            sql`${competitionPhotos.objectPath} IS NOT NULL`,
          ));
        return {
          kind: "done" as const,
          count: count?.count ?? 0,
          notify: (count?.count ?? 0) > 0 && !realAdmin,
          actorName,
        };
      }
      if (!realAdmin && (!competition.contributionsOpen || !(await canContributeToCompetition(me.id, competition.id)))) {
        return { kind: "forbidden" as const };
      }
      const [count] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(competitionPhotos)
        .where(and(
          eq(competitionPhotos.batchId, batch.id),
          sql`${competitionPhotos.confirmedAt} IS NOT NULL`,
          sql`${competitionPhotos.objectPath} IS NOT NULL`,
        ));
      const submittedCount = count?.count ?? 0;
      await tx
        .update(competitionPhotoBatches)
        .set({ finalizedAt: new Date() })
        .where(and(
          eq(competitionPhotoBatches.id, batch.id),
          isNull(competitionPhotoBatches.finalizedAt),
        ));
      return {
        kind: "done" as const,
        count: submittedCount,
        notify: submittedCount > 0 && !realAdmin,
        actorName,
      };
    });
    if (result.kind === "missing") return notFound(res);
    if (result.kind === "forbidden") return apiError(res, 403, "Account is no longer eligible to submit");
    if (result.notify) {
      const tagRows = await db
        .select({ name: teams.name })
        .from(competitionPhotos)
        .innerJoin(competitionPhotoTeams, eq(competitionPhotoTeams.photoId, competitionPhotos.id))
        .innerJoin(teams, eq(teams.id, competitionPhotoTeams.teamId))
        .where(and(
          eq(competitionPhotos.batchId, batchId),
          sql`${competitionPhotos.confirmedAt} IS NOT NULL`,
        ));
      await dispatchCompetitionPhotoBatchAlerts({
        batchId,
        competition,
        actorId: me.id,
        actorName: result.actorName ?? "A team member",
        photoCount: result.count,
        teamNames: tagRows.map((row) => row.name),
      });
    }
    res.json({ submittedCount: result.count });
  }),
);

export default router;