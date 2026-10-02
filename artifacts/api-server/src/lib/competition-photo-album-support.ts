import {
  db,
  competitionAdmins,
  competitionOrganizers,
  competitionPhotoBatches,
  competitionPhotoNotificationOutbox,
  competitionPhotos,
  competitionPhotoTeams,
  notifications,
  organizerAdmins,
  teams,
  tournamentParticipants,
  tournaments,
  users,
} from "@workspace/db";
import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { dispatchNotificationEmail } from "./notification-email";
import { buildBroadcastEmail } from "./email";
import { maskedDisplayName } from "./spec-helpers";
import { logger } from "./logger";
import { getCompetitionPhotoOwnerId } from "./competition-photo-permissions";

const uuid = z.string().uuid();

export async function loadPhotoCompetition(id: string) {
  if (!uuid.safeParse(id).success) return null;
  const [competition] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, id))
    .limit(1);
  return competition ?? null;
}

export async function loadPhotoUploader(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      isMinor: users.isMinor,
      accountStatus: users.accountStatus,
      consentFinalizedAt: users.consentFinalizedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user ?? null;
}

export async function serializeCompetitionPhoto(photoId: string, canDelete: boolean) {
  const [row] = await db
    .select({
      photo: competitionPhotos,
      batch: competitionPhotoBatches,
      uploaderName: users.name,
      uploaderMinor: users.isMinor,
    })
    .from(competitionPhotos)
    .innerJoin(competitionPhotoBatches, eq(competitionPhotoBatches.id, competitionPhotos.batchId))
    .leftJoin(users, eq(users.id, competitionPhotos.uploaderUserId))
    .where(eq(competitionPhotos.id, photoId))
    .limit(1);
  if (!row) return null;
  const tagRows = await db
    .select({ id: teams.id, name: teams.name })
    .from(competitionPhotoTeams)
    .innerJoin(teams, eq(teams.id, competitionPhotoTeams.teamId))
    .innerJoin(competitionPhotos, eq(competitionPhotos.id, competitionPhotoTeams.photoId))
    .innerJoin(tournamentParticipants, and(
      eq(tournamentParticipants.tournamentId, competitionPhotos.competitionId),
      eq(tournamentParticipants.teamId, competitionPhotoTeams.teamId),
    ))
    .where(eq(competitionPhotoTeams.photoId, photoId))
    .orderBy(asc(teams.name));
  const uniqueTags = Array.from(new Map(tagRows.map((tag) => [tag.id, tag])).values());
  return {
    response: {
      id: row.photo.id,
      batchId: row.photo.batchId,
      url: `/api/v1/competitions/${row.photo.competitionId}/album/photos/${row.photo.id}/data`,
      fileName: row.photo.fileName,
      status: row.photo.status,
      uploadedByName: row.uploaderName
        ? row.uploaderMinor
          ? "A team member"
          : row.uploaderName
        : "Former member",
      createdAt: row.photo.createdAt.toISOString(),
      teamIds: uniqueTags.map((tag) => tag.id),
      teamNames: uniqueTags.map((tag) => tag.name),
      canDelete,
    },
    row,
  };
}

async function getRealAdminRecipients(competition: typeof tournaments.$inferSelect) {
  const recipients = new Set<string>();
  const ownerId = await getCompetitionPhotoOwnerId(competition);
  if (ownerId) recipients.add(ownerId);
  const direct = await db
    .select({ userId: competitionAdmins.userId })
    .from(competitionAdmins)
    .where(eq(competitionAdmins.competitionId, competition.id));
  direct.forEach((row) => recipients.add(row.userId));
  if (competition.organizerId) {
    const [organizer] = await db
      .select({ ownerUserId: competitionOrganizers.ownerUserId })
      .from(competitionOrganizers)
      .where(eq(competitionOrganizers.id, competition.organizerId))
      .limit(1);
    if (organizer) recipients.add(organizer.ownerUserId);
    const hub = await db
      .select({ userId: organizerAdmins.userId })
      .from(organizerAdmins)
      .where(eq(organizerAdmins.organizerId, competition.organizerId));
    hub.forEach((row) => recipients.add(row.userId));
  }
  return Array.from(recipients);
}

export async function dispatchCompetitionPhotoBatchAlerts(args: {
  batchId: string;
  competition: typeof tournaments.$inferSelect;
  actorId: string;
  actorName: string;
  photoCount: number;
  teamNames: string[];
}): Promise<void> {
  const recipients = (await getRealAdminRecipients(args.competition))
    .filter((recipientId) => recipientId !== args.actorId);
  if (recipients.length === 0) return;
  const uniqueTeamNames = Array.from(new Set(args.teamNames));
  const teamAttribution = uniqueTeamNames.length
    ? ` Tagged teams: ${uniqueTeamNames.slice(0, 3).join(", ")}${uniqueTeamNames.length > 3 ? ` and ${uniqueTeamNames.length - 3} more` : ""}.`
    : "";
  const message = `${args.actorName} submitted ${args.photoCount} photo${args.photoCount === 1 ? "" : "s"} to ${args.competition.name}'s competition album.${teamAttribution}`;
  const bellLink = `/competitions/c/${args.competition.slug}?album=pending#photos`;
  const emailLink = `/app/competitions/c/${args.competition.slug}?album=pending#photos`;
  const preview = `${args.actorName} submitted ${args.photoCount} photo${args.photoCount === 1 ? "" : "s"}${uniqueTeamNames.length ? ` tagged ${uniqueTeamNames.slice(0, 5).join(", ")}` : ""}.`;

  await db
    .insert(competitionPhotoNotificationOutbox)
    .values(recipients.map((recipientUserId) => ({
      batchId: args.batchId,
      recipientUserId,
      photoCount: args.photoCount,
    })))
    .onConflictDoNothing();

  // A prior completion may have committed the outbox row before a bell write
  // failed. Retry those missing bells without creating duplicate rows.
  try {
    await db.transaction(async (tx) => {
      const pending = await tx
        .select()
        .from(competitionPhotoNotificationOutbox)
        .where(and(
          eq(competitionPhotoNotificationOutbox.batchId, args.batchId),
          isNull(competitionPhotoNotificationOutbox.bellCreatedAt),
        ))
        .for("update");
      for (const item of pending) {
        await tx.insert(notifications).values({
          userId: item.recipientUserId,
          kind: "competition_photo_pending",
          message,
          link: bellLink,
          actorUserId: args.actorId,
        });
        await tx
          .update(competitionPhotoNotificationOutbox)
          .set({ bellCreatedAt: new Date() })
          .where(and(
            eq(competitionPhotoNotificationOutbox.id, item.id),
            isNull(competitionPhotoNotificationOutbox.bellCreatedAt),
          ));
      }
    });
  } catch (err) {
    logger.warn({ err, batchId: args.batchId }, "Competition photo bell notification failed");
  }

  // Per-recipient claims prevent completion retries from duplicating email.
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const outbox = await db
    .select()
    .from(competitionPhotoNotificationOutbox)
    .where(and(
      eq(competitionPhotoNotificationOutbox.batchId, args.batchId),
      isNull(competitionPhotoNotificationOutbox.emailAttemptedAt),
      or(
        isNull(competitionPhotoNotificationOutbox.emailClaimedAt),
        lt(competitionPhotoNotificationOutbox.emailClaimedAt, cutoff),
      ),
    ));
  for (const row of outbox) {
    const [claim] = await db
      .update(competitionPhotoNotificationOutbox)
      .set({ emailClaimedAt: new Date() })
      .where(and(
        eq(competitionPhotoNotificationOutbox.id, row.id),
        isNull(competitionPhotoNotificationOutbox.emailAttemptedAt),
        or(
          isNull(competitionPhotoNotificationOutbox.emailClaimedAt),
          lt(competitionPhotoNotificationOutbox.emailClaimedAt, cutoff),
        ),
      ))
      .returning({ id: competitionPhotoNotificationOutbox.id });
    if (!claim) continue;
    try {
      await dispatchNotificationEmail({
        userId: row.recipientUserId,
        category: "team_broadcast",
        build: (ctx) => buildBroadcastEmail(ctx, {
          senderName: args.actorName,
          scopeName: args.competition.name,
          preview,
          link: emailLink,
        }),
      });
      await db
        .update(competitionPhotoNotificationOutbox)
        .set({ emailAttemptedAt: new Date() })
        .where(eq(competitionPhotoNotificationOutbox.id, row.id));
    } catch (err) {
      logger.warn({ err, batchId: args.batchId }, "Competition photo email attempt failed");
    }
  }
}

export function competitionPhotoActorName(
  account: { name: string; isMinor: boolean },
): string {
  return account.isMinor ? maskedDisplayName(account) : account.name;
}