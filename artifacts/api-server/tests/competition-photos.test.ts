import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  competitionAdmins,
  competitionOrganizers,
  competitionPhotoNotificationOutbox,
  competitionPhotos,
  db,
  guardianLinks,
  notifications,
  rosterEntries,
  teamFollowers,
  teams,
  tournamentParticipants,
  tournaments,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";
import type { Agent } from "supertest";
import { runStartupMigrations } from "../src/lib/migrations";

const storageMocks = vi.hoisted(() => {
  class MockCompetitionPhotoValidationError extends Error {}
  return {
    MockCompetitionPhotoValidationError,
    createCompetitionPhotoUpload: vi.fn(async () => ({
      uploadUrl: "https://uploads.example.invalid/safe-photo-upload",
    })),
    sealCompetitionPhotoUpload: vi.fn(async (photoId: string, fileType: string) => {
      if (!["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"].includes(fileType)) {
        throw new MockCompetitionPhotoValidationError("Unsupported image format");
      }
      return {
        objectPath: `/private/competition-photos/sealed/${photoId}/sealed-object`,
        fileSize: 8,
      };
    }),
    streamCompetitionPhoto: vi.fn(async (
      res: { setHeader: (name: string, value: string) => void; end: (bytes: Buffer) => void },
    ) => {
      res.setHeader("Content-Type", "image/jpeg");
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }),
    deleteCompetitionPhotoObject: vi.fn(async () => undefined),
  };
});

const mailMocks = vi.hoisted(() => ({
  dispatch: vi.fn(async (_args: unknown) => undefined),
}));

vi.mock("../src/lib/competition-photo-storage", () => ({
  CompetitionPhotoValidationError: storageMocks.MockCompetitionPhotoValidationError,
  COMPETITION_PHOTO_MAX_BYTES: 10 * 1024 * 1024,
  createCompetitionPhotoUpload: storageMocks.createCompetitionPhotoUpload,
  sealCompetitionPhotoUpload: storageMocks.sealCompetitionPhotoUpload,
  streamCompetitionPhoto: storageMocks.streamCompetitionPhoto,
  deleteCompetitionPhotoObject: storageMocks.deleteCompetitionPhotoObject,
}));

// Every email dispatch is intercepted here; no test can call a mail provider.
vi.mock("../src/lib/notification-email", () => ({
  dispatchNotificationEmail: mailMocks.dispatch,
}));

type Member = Awaited<ReturnType<typeof loginAs>>;
type Fixture = {
  competitionId: string;
  competitionName: string;
  owner: Member;
  member: Member;
  outsider: Member;
  teamId: string;
};

let counter = 0;
const competitionIds: string[] = [];
const teamIds: string[] = [];
const organizerIds: string[] = [];

function unique(label: string): string {
  counter += 1;
  return `${label}-album-regression-${Date.now()}-${counter}`;
}

async function createFixture(options: { contributionsOpen?: boolean } = {}): Promise<Fixture> {
  const owner = await loginAs("coach@kinectem.demo");
  const member = await loginAs("daniela@kinectem.demo");
  const outsider = await loginAs("marcus@kinectem.demo");
  const competitionName = unique("Photo Album Competition");
  const [competition] = await db
    .insert(tournaments)
    .values({
      slug: unique("photo-album"),
      name: competitionName,
      startDate: "2026-08-01",
      endDate: "2026-08-02",
      ownerUserId: owner.user.id,
      contributionsOpen: options.contributionsOpen ?? true,
    })
    .returning({ id: tournaments.id });
  competitionIds.push(competition.id);
  const [team] = await db
    .insert(teams)
    .values({ name: unique("Album Team"), createdById: owner.user.id })
    .returning({ id: teams.id });
  teamIds.push(team.id);
  await db.insert(tournamentParticipants).values({
    tournamentId: competition.id,
    name: unique("Album Participant"),
    nameKey: unique("album-participant-key").toLowerCase(),
    teamId: team.id,
  });
  await db.insert(rosterEntries).values({
    teamId: team.id,
    userId: member.user.id,
    role: "player",
    status: "accepted",
  });
  return {
    competitionId: competition.id,
    competitionName,
    owner,
    member,
    outsider,
    teamId: team.id,
  };
}

async function startBatch(
  agent: Agent,
  competitionId: string,
  clientBatchId = unique("client-batch"),
): Promise<string> {
  const res = await agent
    .post(`/api/v1/competitions/${competitionId}/album/batches`)
    .send({ clientBatchId });
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
  return res.body.id as string;
}

async function createPhotoSlot(
  agent: Agent,
  competitionId: string,
  batchId: string,
  overrides: Record<string, unknown> = {},
) {
  return agent
    .post(`/api/v1/competitions/${competitionId}/album/batches/${batchId}/photos`)
    .send({
      clientPhotoId: unique("client-photo"),
      fileName: "game-photo.jpg",
      fileType: "image/jpeg",
      fileSize: 8,
      teamIds: [],
      ...overrides,
    });
}

async function uploadAndConfirm(
  agent: Agent,
  competitionId: string,
  batchId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const slot = await createPhotoSlot(agent, competitionId, batchId, overrides);
  expect(slot.status).toBe(201);
  expect(slot.body.uploadUrl).toBe("https://uploads.example.invalid/safe-photo-upload");
  const confirmed = await agent.post(
    `/api/v1/competitions/${competitionId}/album/photos/${slot.body.photoId}/confirm`,
  );
  expect(confirmed.status).toBe(200);
  return slot.body.photoId as string;
}

async function finalize(agent: Agent, competitionId: string, batchId: string) {
  return agent.post(
    `/api/v1/competitions/${competitionId}/album/batches/${batchId}/complete`,
  );
}

beforeEach(() => {
  storageMocks.createCompetitionPhotoUpload.mockClear();
  storageMocks.sealCompetitionPhotoUpload.mockClear();
  storageMocks.streamCompetitionPhoto.mockClear();
  storageMocks.deleteCompetitionPhotoObject.mockClear();
  mailMocks.dispatch.mockClear();
});

afterEach(async () => {
  for (const id of competitionIds.splice(0)) {
    await db.delete(tournaments).where(eq(tournaments.id, id));
  }
  for (const id of teamIds.splice(0)) {
    await db.delete(teams).where(eq(teams.id, id));
  }
  for (const id of organizerIds.splice(0)) {
    await db.delete(competitionOrganizers).where(eq(competitionOrganizers.id, id));
  }
});

describe("competition photo album regression coverage", () => {
  it("enables existing competitions once, defaults new ones on, and preserves subsequent opt-outs across startup", async () => {
    const f = await createFixture({ contributionsOpen: false });
    await db.execute(sql`
      DELETE FROM one_time_migration_markers
      WHERE name = '2026-10-02-competition-photo-contributions-default-on'
    `);
    await runStartupMigrations();
    const existingAlbum = await f.member.agent.get(`/api/v1/competitions/${f.competitionId}/album`);
    expect(existingAlbum.body).toMatchObject({ contributionsOpen: true, canUpload: true });
    const [newCompetition] = await db.insert(tournaments).values({
      name: unique("Default-on competition"),
      slug: unique("default-on-competition"),
      startDate: "2026-10-02",
      endDate: "2026-10-04",
      ownerUserId: f.owner.user.id,
      createdById: f.owner.user.id,
    }).returning({ id: tournaments.id, contributionsOpen: tournaments.contributionsOpen });
    competitionIds.push(newCompetition.id);
    expect(newCompetition.contributionsOpen).toBe(true);
    await db.update(tournaments).set({ contributionsOpen: false })
      .where(eq(tournaments.id, f.competitionId));
    await runStartupMigrations();
    const disabledAlbum = await f.member.agent.get(`/api/v1/competitions/${f.competitionId}/album`);
    expect(disabledAlbum.body).toMatchObject({ contributionsOpen: false, canUpload: false });
  });

  it("keeps contributor submissions private before and after finalization", async () => {
    const f = await createFixture();
    const batchId = await startBatch(f.member.agent, f.competitionId);
    const photoId = await uploadAndConfirm(f.member.agent, f.competitionId, batchId, {
      teamIds: [f.teamId],
    });
    const photoUrl = `/api/v1/competitions/${f.competitionId}/album/photos/${photoId}/data`;

    expect((await request(app).get(`/api/v1/competitions/${f.competitionId}/album`)).body.photos)
      .toHaveLength(0);
    expect((await f.outsider.agent.get(`/api/v1/competitions/${f.competitionId}/album?view=mine`)).body.photos)
      .toHaveLength(0);
    expect((await request(app).get(photoUrl)).status).toBe(404);
    expect((await f.outsider.agent.get(photoUrl)).status).toBe(404);

    const ownerPendingBeforeFinalize = await f.owner.agent
      .get(`/api/v1/competitions/${f.competitionId}/album?view=pending`);
    expect(ownerPendingBeforeFinalize.status).toBe(200);
    expect(ownerPendingBeforeFinalize.body.photos).toHaveLength(0);

    expect((await finalize(f.member.agent, f.competitionId, batchId)).body.submittedCount).toBe(1);
    const publicAfterFinalize = await request(app).get(`/api/v1/competitions/${f.competitionId}/album`);
    expect(publicAfterFinalize.body.photos).toHaveLength(0);
    expect((await f.outsider.agent.get(photoUrl)).status).toBe(404);
    expect((await f.outsider.agent.get(`/api/v1/competitions/${f.competitionId}/album?view=mine`)).body.photos)
      .toHaveLength(0);

    const uploaderMine = await f.member.agent
      .get(`/api/v1/competitions/${f.competitionId}/album?view=mine`);
    expect(uploaderMine.status).toBe(200);
    expect(uploaderMine.body.photos).toEqual([
      expect.objectContaining({ id: photoId, status: "pending", teamIds: [f.teamId] }),
    ]);
    expect((await f.member.agent.get(photoUrl)).status).toBe(200);
    expect((await f.owner.agent.get(photoUrl)).status).toBe(200);
    expect(storageMocks.streamCompetitionPhoto).toHaveBeenCalledTimes(2);
  });

  it("approves real-admin uploads immediately but exposes them only after batch completion", async () => {
    const f = await createFixture();
    const batchId = await startBatch(f.owner.agent, f.competitionId);
    const photoId = await uploadAndConfirm(f.owner.agent, f.competitionId, batchId);

    const before = await f.outsider.agent.get(`/api/v1/competitions/${f.competitionId}/album`);
    expect(before.body.photos).toHaveLength(0);
    const rowBefore = await db.select().from(competitionPhotos).where(eq(competitionPhotos.id, photoId));
    expect(rowBefore[0].status).toBe("approved");

    const done = await finalize(f.owner.agent, f.competitionId, batchId);
    expect(done.body.submittedCount).toBe(1);
    const after = await request(app).get(`/api/v1/competitions/${f.competitionId}/album`);
    expect(after.body.photos).toEqual([
      expect.objectContaining({ id: photoId, status: "approved" }),
    ]);
  });

  it("allows accepted members and active guardians, but not followers or unrelated users", async () => {
    const f = await createFixture();
    await db.insert(teamFollowers).values({ teamId: f.teamId, userId: f.outsider.user.id });
    const child = await loginAs("lisa@kinectem.demo");
    const guardian = await loginAs("sam@kinectem.demo");
    await db.insert(rosterEntries).values({
      teamId: f.teamId,
      userId: child.user.id,
      role: "player",
      status: "accepted",
    });
    await db.insert(guardianLinks).values({
      childId: child.user.id,
      guardianId: guardian.user.id,
      status: "active",
      consentGrantedAt: new Date(),
    });

    const memberBatch = await startBatch(f.member.agent, f.competitionId);
    expect(memberBatch).toBeTruthy();
    const guardianBatch = await startBatch(guardian.agent, f.competitionId);
    expect(guardianBatch).toBeTruthy();
    const followerBatch = await f.outsider.agent
      .post(`/api/v1/competitions/${f.competitionId}/album/batches`)
      .send({ clientBatchId: unique("follower-batch") });
    expect(followerBatch.status).toBe(403);

    const nonMemberPhoto = await createPhotoSlot(f.outsider.agent, f.competitionId, memberBatch);
    expect(nonMemberPhoto.status).toBe(403);
    const unrelatedBatch = await request(app)
      .post(`/api/v1/competitions/${f.competitionId}/album/batches`)
      .send({ clientBatchId: unique("anonymous-batch") });
    expect(unrelatedBatch.status).toBe(401);
  });

  it("rejects closed contributions and foreign-team tags, and excludes support-only access from uploads", async () => {
    const f = await createFixture({ contributionsOpen: false });
    const closed = await f.member.agent
      .post(`/api/v1/competitions/${f.competitionId}/album/batches`)
      .send({ clientBatchId: unique("closed-batch") });
    expect(closed.status).toBe(403);

    await db.update(tournaments)
      .set({ contributionsOpen: true })
      .where(eq(tournaments.id, f.competitionId));
    const [foreignTeam] = await db
      .insert(teams)
      .values({ name: unique("Foreign team"), createdById: f.outsider.user.id })
      .returning({ id: teams.id });
    teamIds.push(foreignTeam.id);
    const batchId = await startBatch(f.member.agent, f.competitionId);
    const foreignTag = await createPhotoSlot(f.member.agent, f.competitionId, batchId, {
      teamIds: [foreignTeam.id],
    });
    expect(foreignTag.status).toBe(403);

    const platformSupport = await loginAs("sam@kinectem.demo");
    const supportUpload = await platformSupport.agent
      .post(`/api/v1/competitions/${f.competitionId}/album/batches`)
      .send({ clientBatchId: unique("support-batch") });
    expect(supportUpload.status).toBe(403);
    expect((await platformSupport.agent.get(
      `/api/v1/competitions/${f.competitionId}/album?view=pending`,
    )).status).toBe(200);
  });

  it("bulk reviews with status guards, shares tagged approvals to team pages, and removes withdrawn/deleted photos", async () => {
    const f = await createFixture();
    const batchId = await startBatch(f.member.agent, f.competitionId);
    const first = await uploadAndConfirm(f.member.agent, f.competitionId, batchId);
    const second = await uploadAndConfirm(f.member.agent, f.competitionId, batchId);
    await finalize(f.member.agent, f.competitionId, batchId);

    const approve = await f.owner.agent
      .post(`/api/v1/competitions/${f.competitionId}/album/review`)
      .send({ photoIds: [first, second], action: "approve", expectedStatus: "pending" });
    expect(approve.status).toBe(200);
    expect(approve.body.changedIds).toEqual(expect.arrayContaining([first, second]));
    const staleReview = await f.owner.agent
      .post(`/api/v1/competitions/${f.competitionId}/album/review`)
      .send({ photoIds: [first], action: "reject", expectedStatus: "pending" });
    expect(staleReview.body).toEqual({ changedIds: [], conflictIds: [first] });

    const tags = await f.owner.agent
      .patch(`/api/v1/competitions/${f.competitionId}/album/photos/tags`)
      .send({ photoIds: [first, second], teamIds: [f.teamId] });
    expect(tags.status).toBe(200);
    const teamPhotos = await request(app).get(`/api/v1/teams/${f.teamId}/competition-photos`);
    expect(teamPhotos.body.photos.map((photo: { id: string }) => photo.id))
      .toEqual(expect.arrayContaining([first, second]));

    const withdraw = await f.owner.agent
      .post(`/api/v1/competitions/${f.competitionId}/album/review`)
      .send({ photoIds: [first], action: "reject", expectedStatus: "approved" });
    expect(withdraw.body.changedIds).toEqual([first]);
    const deletePhoto = await f.owner.agent
      .delete(`/api/v1/competitions/${f.competitionId}/album/photos/${second}`);
    expect(deletePhoto.status).toBe(204);
    const after = await request(app).get(`/api/v1/teams/${f.teamId}/competition-photos`);
    expect(after.body.photos).toHaveLength(0);
  });

  it("does not treat an ownerless competition's platform-support creator as its photo owner", async () => {
    const f = await createFixture();
    const support = await loginAs("sam@kinectem.demo");
    await db.update(tournaments).set({ ownerUserId: null, createdById: support.user.id })
      .where(eq(tournaments.id, f.competitionId));
    const album = await support.agent.get(`/api/v1/competitions/${f.competitionId}/album`);
    expect(album.status).toBe(200);
    expect(album.body).toMatchObject({ canManage: true, canUpload: false, isCompetitionAdmin: false });
    expect((await support.agent.post(`/api/v1/competitions/${f.competitionId}/album/batches`)
      .send({ clientBatchId: unique("support-origin") })).status).toBe(403);
    const batchId = await startBatch(f.member.agent, f.competitionId);
    await uploadAndConfirm(f.member.agent, f.competitionId, batchId, { teamIds: [f.teamId] });
    expect((await finalize(f.member.agent, f.competitionId, batchId)).status).toBe(200);
    const recipients = await db.select().from(competitionPhotoNotificationOutbox)
      .where(eq(competitionPhotoNotificationOutbox.batchId, batchId));
    expect(recipients).toHaveLength(0);
    expect(mailMocks.dispatch).not.toHaveBeenCalled();
  });

  it("sends one bell and one mocked email per actual admin recipient for a completed batch, deduplicated on retry", async () => {
    const f = await createFixture();
    const directAdmin = await loginAs("lisa@kinectem.demo");
    const support = await loginAs("sam@kinectem.demo");
    const hubOwner = f.outsider;
    const [hub] = await db
      .insert(competitionOrganizers)
      .values({
        slug: unique("album-hub"),
        name: unique("Album Hub"),
        ownerUserId: hubOwner.user.id,
      })
      .returning({ id: competitionOrganizers.id });
    organizerIds.push(hub.id);
    await db.update(tournaments)
      .set({ organizerId: hub.id })
      .where(eq(tournaments.id, f.competitionId));
    await db.insert(competitionAdmins).values({
      competitionId: f.competitionId,
      userId: directAdmin.user.id,
      grantedById: f.owner.user.id,
    });
    // Support reviewers can moderate but must not receive upload alerts just
    // because their platform role grants review access.
    const batchId = await startBatch(f.member.agent, f.competitionId);
    const photoId = await uploadAndConfirm(f.member.agent, f.competitionId, batchId, {
      teamIds: [f.teamId],
    });
    const concurrentCompletes = await Promise.all([
      finalize(f.member.agent, f.competitionId, batchId),
      finalize(f.member.agent, f.competitionId, batchId),
    ]);
    expect(concurrentCompletes.every((response) => response.status === 200)).toBe(true);
    await finalize(f.member.agent, f.competitionId, batchId);

    const notificationsForBatch = await db
      .select({ recipientUserId: competitionPhotoNotificationOutbox.recipientUserId })
      .from(competitionPhotoNotificationOutbox)
      .where(eq(competitionPhotoNotificationOutbox.batchId, batchId));
    expect(notificationsForBatch.map((row) => row.recipientUserId).sort()).toEqual(
      [f.owner.user.id, directAdmin.user.id, hubOwner.user.id].sort(),
    );
    expect(notificationsForBatch.some((row) => row.recipientUserId === support.user.id)).toBe(false);
    expect(mailMocks.dispatch).toHaveBeenCalledTimes(3);
    expect(mailMocks.dispatch.mock.calls.map(([args]) => (args as { userId: string }).userId).sort())
      .toEqual([f.owner.user.id, directAdmin.user.id, hubOwner.user.id].sort());
    const bells = (await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.kind, "competition_photo_pending"),
        eq(notifications.actorUserId, f.member.user.id),
      ))).filter((bell) => bell.message.includes(f.competitionName));
    expect(bells).toHaveLength(3);
    expect(bells.every((bell) => bell.message.includes("Photo Album Competition"))).toBe(true);
    expect(bells.every((bell) => bell.link.includes("?album=pending#photos"))).toBe(true);
    expect(photoId).toBeTruthy();
  });

  it("reuses batch/photo client ids, seals only once on repeated confirmation, and enforces metadata/type/count limits", async () => {
    const f = await createFixture();
    const clientBatchId = unique("stable-batch");
    const batchId = await startBatch(f.member.agent, f.competitionId, clientBatchId);
    expect(await startBatch(f.member.agent, f.competitionId, clientBatchId)).toBe(batchId);

    const clientPhotoId = unique("stable-photo");
    const slotBody = {
      clientPhotoId,
      fileName: "repeat.jpg",
      fileType: "image/jpeg",
      fileSize: 8,
      teamIds: [],
    };
    const first = await f.member.agent
      .post(`/api/v1/competitions/${f.competitionId}/album/batches/${batchId}/photos`)
      .send(slotBody);
    const retry = await f.member.agent
      .post(`/api/v1/competitions/${f.competitionId}/album/batches/${batchId}/photos`)
      .send(slotBody);
    expect(first.body.photoId).toBe(retry.body.photoId);
    expect((await db.select().from(competitionPhotos).where(eq(competitionPhotos.batchId, batchId))).length)
      .toBe(1);

    const confirmPath = `/api/v1/competitions/${f.competitionId}/album/photos/${first.body.photoId}/confirm`;
    expect((await f.member.agent.post(confirmPath)).status).toBe(200);
    expect((await f.member.agent.post(confirmPath)).status).toBe(200);
    expect(storageMocks.sealCompetitionPhotoUpload).toHaveBeenCalledTimes(1);
    const confirmedRetry = await createPhotoSlot(f.member.agent, f.competitionId, batchId, slotBody);
    expect(confirmedRetry.body).toMatchObject({ photoId: first.body.photoId, uploadUrl: "", confirmed: true });

    const tooLarge = await createPhotoSlot(f.member.agent, f.competitionId, batchId, {
      clientPhotoId: unique("oversize"),
      fileSize: 10 * 1024 * 1024 + 1,
    });
    expect(tooLarge.status).toBe(400);
    const unsupported = await createPhotoSlot(f.member.agent, f.competitionId, batchId, {
      clientPhotoId: unique("unsupported-type"),
      fileType: "image/svg+xml",
    });
    expect(unsupported.status).toBe(201);
    const unsupportedConfirm = await f.member.agent.post(
      `/api/v1/competitions/${f.competitionId}/album/photos/${unsupported.body.photoId}/confirm`,
    );
    expect(unsupportedConfirm.status).toBe(400);
    const excessiveTags = await createPhotoSlot(f.member.agent, f.competitionId, batchId, {
      clientPhotoId: unique("too-many-tags"),
      teamIds: Array.from({ length: 31 }, () => f.teamId),
    });
    expect(excessiveTags.status).toBe(400);

    const fullBatchId = await startBatch(f.member.agent, f.competitionId);
    await db.insert(competitionPhotos).values(
      Array.from({ length: 100 }, (_, index) => ({
        batchId: fullBatchId,
        competitionId: f.competitionId,
        uploaderUserId: f.member.user.id,
        clientPhotoId: `seed-limit-${index}`,
        fileName: "seed-limit.jpg",
        fileType: "image/jpeg",
        declaredFileSize: 8,
      })),
    );
    const overCount = await createPhotoSlot(f.member.agent, f.competitionId, fullBatchId);
    expect(overCount.status).toBe(400);

    const failedBatchId = await startBatch(f.member.agent, f.competitionId);
    const failedSlot = await createPhotoSlot(f.member.agent, f.competitionId, failedBatchId, {
      clientPhotoId: unique("failed-only"),
      fileType: "image/svg+xml",
    });
    const failedConfirm = await f.member.agent.post(
      `/api/v1/competitions/${f.competitionId}/album/photos/${failedSlot.body.photoId}/confirm`,
    );
    expect(failedConfirm.status).toBe(400);
    await finalize(f.member.agent, f.competitionId, failedBatchId);
    expect(await db.select().from(competitionPhotoNotificationOutbox)
      .where(eq(competitionPhotoNotificationOutbox.batchId, failedBatchId))).toHaveLength(0);
  });

  it("rejects another contributor's batches and photos, and keeps support users out of recipient lists", async () => {
    const f = await createFixture();
    const otherContributor = await loginAs("lisa@kinectem.demo");
    await db.insert(rosterEntries).values({
      teamId: f.teamId,
      userId: otherContributor.user.id,
      role: "player",
      status: "accepted",
    });
    const batchId = await startBatch(f.member.agent, f.competitionId);
    const photoId = await uploadAndConfirm(f.member.agent, f.competitionId, batchId);

    expect((await otherContributor.agent.post(
      `/api/v1/competitions/${f.competitionId}/album/batches/${batchId}/complete`,
    )).status).toBe(404);
    expect((await otherContributor.agent.post(
      `/api/v1/competitions/${f.competitionId}/album/photos/${photoId}/confirm`,
    )).status).toBe(404);
    expect((await otherContributor.agent.get(
      `/api/v1/competitions/${f.competitionId}/album/photos/${photoId}/data`,
    )).status).toBe(404);

    const support = await loginAs("sam@kinectem.demo");
    expect((await support.agent.post(
      `/api/v1/competitions/${f.competitionId}/album/batches`,
    ).send({ clientBatchId: unique("support-no-upload") })).status).toBe(403);
    expect((await finalize(f.member.agent, f.competitionId, batchId)).status).toBe(200);
    const outbox = await db.select().from(competitionPhotoNotificationOutbox)
      .where(eq(competitionPhotoNotificationOutbox.batchId, batchId));
    expect(outbox.every((row) => row.recipientUserId !== support.user.id)).toBe(true);
  });
});