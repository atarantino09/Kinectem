import { Router, type IRouter, type Response } from "express";
import {
  db,
  competitionPhotoBatches,
  competitionPhotos,
  competitionPhotoTeams,
  teams,
  tournaments,
  tournamentParticipants,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { apiError as sendApiError, notFound as sendNotFound } from "../lib/spec-helpers";
import {
  loadPhotoCompetition,
  serializeCompetitionPhoto,
} from "../lib/competition-photo-album-support";
import {
  canContributeForTeam,
  canContributeToCompetition,
  canReviewCompetitionPhotos,
  getParticipatingTeams,
  isRealCompetitionAdmin,
} from "../lib/competition-photo-permissions";
import { streamCompetitionPhoto } from "../lib/competition-photo-storage";
import { canManageOrganization, canManageTeam } from "../lib/permissions";

const router: IRouter = Router();
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

router.get(
  "/competitions/:competitionId/album",
  asyncHandler(async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    if (!req.sessionUser) return apiError(res, 401, "Sign in to see photo albums");
    const competition = await loadPhotoCompetition(pathParam(req.params.competitionId));
    if (!competition) return notFound(res);
    const view = String(req.query.view ?? "approved");
    if (!["approved", "mine", "pending", "rejected"].includes(view)) {
      return apiError(res, 400, "Invalid album view");
    }
    const me = req.sessionUser ?? null;
    const canManage = me ? await canReviewCompetitionPhotos(me, competition) : false;
    const realAdmin = me ? await isRealCompetitionAdmin(me.id, competition) : false;
    if ((view === "pending" || view === "rejected") && !canManage) {
      return apiError(res, 403, "Forbidden");
    }
    if (view === "mine" && !me) return apiError(res, 401, "Not authenticated");

    const participantTeams = await getParticipatingTeams(competition.id);
    const uniqueTeams = Array.from(new Map(participantTeams.map((team) => [team.id, team])).values());
    const teamsResponse = await Promise.all(uniqueTeams.map(async (team) => ({
      id: team.id,
      name: team.name,
      canTag: Boolean(me && (realAdmin || await canContributeForTeam(me.id, team.id))),
    })));
    const canUpload = Boolean(
      me &&
      (realAdmin ||
        (competition.contributionsOpen &&
          (await canContributeToCompetition(me.id, competition.id)))),
    );
    const requestedTeamId = req.query.teamId ? String(req.query.teamId) : null;
    if (requestedTeamId && !uniqueTeams.some((team) => team.id === requestedTeamId)) {
      return apiError(res, 400, "teamId must be a participating team");
    }

    const filters = [eq(competitionPhotos.competitionId, competition.id)];
    if (view === "approved") filters.push(eq(competitionPhotos.status, "approved"));
    if (view === "pending") filters.push(eq(competitionPhotos.status, "pending"));
    if (view === "rejected") filters.push(eq(competitionPhotos.status, "rejected"));
    if (view === "mine") filters.push(eq(competitionPhotos.uploaderUserId, me!.id));
    if (requestedTeamId) {
      const matching = await db
        .select({ photoId: competitionPhotoTeams.photoId })
        .from(competitionPhotoTeams)
        .where(eq(competitionPhotoTeams.teamId, requestedTeamId));
      const ids = matching.map((item) => item.photoId);
      if (!ids.length) filters.push(eq(competitionPhotos.id, "00000000-0000-0000-0000-000000000000"));
      else filters.push(inArray(competitionPhotos.id, ids));
    }
    const rows = await db
      .select({ photo: competitionPhotos })
      .from(competitionPhotos)
      .innerJoin(competitionPhotoBatches, eq(competitionPhotoBatches.id, competitionPhotos.batchId))
      .where(and(
        ...filters,
        sql`${competitionPhotoBatches.finalizedAt} IS NOT NULL`,
        sql`${competitionPhotos.confirmedAt} IS NOT NULL`,
        sql`${competitionPhotos.objectPath} IS NOT NULL`,
      ))
      .orderBy(desc(competitionPhotos.createdAt));
    const photos = [];
    for (const { photo } of rows) {
      const canDelete = Boolean(me && (realAdmin || photo.uploaderUserId === me.id));
      const shaped = await serializeCompetitionPhoto(photo.id, canDelete);
      if (shaped) photos.push(shaped.response);
    }
    const [counts] = await db
      .select({
        pending: sql<number>`count(*) filter (where ${competitionPhotos.status} = 'pending')::int`,
        approved: sql<number>`count(*) filter (where ${competitionPhotos.status} = 'approved')::int`,
      })
      .from(competitionPhotos)
      .innerJoin(competitionPhotoBatches, eq(competitionPhotoBatches.id, competitionPhotos.batchId))
      .where(and(
        eq(competitionPhotos.competitionId, competition.id),
        sql`${competitionPhotoBatches.finalizedAt} IS NOT NULL`,
        sql`${competitionPhotos.confirmedAt} IS NOT NULL`,
        sql`${competitionPhotos.objectPath} IS NOT NULL`,
      ));
    res.json({
      competition: {
        id: competition.id,
        name: competition.name,
        slug: competition.slug,
        logoUrl: competition.logoUrl,
        brandColor: competition.brandColor,
      },
      photos,
      teams: teamsResponse,
      canManage,
      isCompetitionAdmin: realAdmin,
      canUpload,
      contributionsOpen: competition.contributionsOpen,
      pendingCount: counts?.pending ?? 0,
      approvedCount: counts?.approved ?? 0,
    });
  }),
);

router.get(
  "/teams/:teamId/competition-photos",
  asyncHandler(async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    if (!req.sessionUser) return apiError(res, 401, "Sign in to see photo albums");
    const teamId = pathParam(req.params.teamId);
    if (!uuid.safeParse(teamId).success) return notFound(res);
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) return notFound(res);
    if (team.archivedAt) {
      const me = req.sessionUser;
      const canSeeArchived = me
        ? team.organizationId
          ? await canManageOrganization(me.id, team.organizationId)
          : await canManageTeam(me.id, team)
        : false;
      if (!canSeeArchived) return notFound(res);
    }
    const rows = await db
      .select({
        photoId: competitionPhotos.id,
        competition: tournaments,
      })
      .from(competitionPhotoTeams)
      .innerJoin(competitionPhotos, eq(competitionPhotos.id, competitionPhotoTeams.photoId))
      .innerJoin(competitionPhotoBatches, eq(competitionPhotoBatches.id, competitionPhotos.batchId))
      .innerJoin(tournaments, eq(tournaments.id, competitionPhotos.competitionId))
      .innerJoin(tournamentParticipants, and(
        eq(tournamentParticipants.tournamentId, competitionPhotos.competitionId),
        eq(tournamentParticipants.teamId, teamId),
      ))
      .where(and(
        eq(competitionPhotoTeams.teamId, teamId),
        eq(competitionPhotos.status, "approved"),
        sql`${competitionPhotoBatches.finalizedAt} IS NOT NULL`,
        sql`${competitionPhotos.confirmedAt} IS NOT NULL`,
        sql`${competitionPhotos.objectPath} IS NOT NULL`,
      ))
      .orderBy(desc(competitionPhotos.createdAt));
    const uniqueRows = Array.from(new Map(rows.map((row) => [row.photoId, row])).values());
    const photos = [];
    for (const row of uniqueRows) {
      const shaped = await serializeCompetitionPhoto(row.photoId, false);
      if (shaped) photos.push({
        ...shaped.response,
        competition: {
          id: row.competition.id,
          name: row.competition.name,
          slug: row.competition.slug,
          logoUrl: row.competition.logoUrl,
          brandColor: row.competition.brandColor,
        },
      });
    }
    res.json({ photos });
  }),
);

router.get(
  "/competitions/:competitionId/album/photos/:photoId/data",
  asyncHandler(async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    if (!req.sessionUser) return apiError(res, 401, "Sign in to see photo albums");
    const photoId = pathParam(req.params.photoId);
    if (!uuid.safeParse(photoId).success) return notFound(res);
    const competition = await loadPhotoCompetition(pathParam(req.params.competitionId));
    if (!competition) return notFound(res);
    const [row] = await db
      .select({ photo: competitionPhotos, batch: competitionPhotoBatches })
      .from(competitionPhotos)
      .innerJoin(competitionPhotoBatches, eq(competitionPhotoBatches.id, competitionPhotos.batchId))
      .where(and(
        eq(competitionPhotos.id, photoId),
        eq(competitionPhotos.competitionId, competition.id),
      ))
      .limit(1);
    if (!row || !row.photo.confirmedAt || !row.photo.objectPath || !row.batch.finalizedAt) {
      return notFound(res);
    }
    const me = req.sessionUser;
    const approved = row.photo.status === "approved";
    const uploader = Boolean(me && row.photo.uploaderUserId === me.id);
    const reviewer = Boolean(me && await canReviewCompetitionPhotos(me, competition));
    if (!approved && !uploader && !reviewer) return notFound(res);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      await streamCompetitionPhoto(res, row.photo.objectPath, row.photo.fileType);
    } catch {
      if (!res.headersSent) apiError(res, 503, "Photo could not be streamed.");
      else res.destroy();
    }
  }),
);

export default router;