// Local browser-test fixture only. Never import this from application startup.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, users, tournaments, teams, rosterEntries,
  tournamentParticipants, notificationPreferences, competitionPhotos,
} from "@workspace/db";
import { hashPassword } from "../src/lib/passwords";
import { deleteCompetitionPhotoObject } from "../src/lib/competition-photo-storage";

async function cleanup(path: string) {
  const fixture = JSON.parse(await readFile(path, "utf8")) as {
    competitionId: string; slug: string;
    owner: { id: string }; contributor: { id: string }; teams: Array<{ id: string }>;
  };
  const [competition] = await db.select().from(tournaments)
    .where(eq(tournaments.id, fixture.competitionId));
  const userIds = [fixture.owner.id, fixture.contributor.id];
  const accounts = await db.select({ email: users.email }).from(users).where(inArray(users.id, userIds));
  if (!competition?.slug.startsWith("album-verification-") || competition.slug !== fixture.slug ||
      accounts.length !== 2 || accounts.some((u) => !u.email?.endsWith("@example.invalid"))) {
    throw new Error("Refusing to clean up anything other than the synthetic album fixture.");
  }
  const photos = await db.select({ path: competitionPhotos.objectPath }).from(competitionPhotos)
    .where(eq(competitionPhotos.competitionId, competition.id));
  for (const photo of photos) {
    if (photo.path) await deleteCompetitionPhotoObject(photo.path);
  }
  await db.transaction(async (tx) => {
    await tx.delete(tournaments).where(eq(tournaments.id, competition.id));
    await tx.delete(teams).where(inArray(teams.id, fixture.teams.map((t) => t.id)));
    await tx.delete(users).where(inArray(users.id, userIds));
  });
  process.stdout.write("Synthetic competition, photos, teams, accounts, and stored media removed.\n");
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await hashPassword("AlbumCheck2026!");
  const fixture = await db.transaction(async (tx) => {
    const [owner, contributor] = await tx.insert(users).values([
      { name: "Album Test Organizer", email: `album-owner-${suffix}@example.invalid`, role: "coach" as const, passwordHash, isMinor: false, accountStatus: "active" as const },
      { name: "Album Test Contributor", email: `album-contributor-${suffix}@example.invalid`, role: "coach" as const, passwordHash, isMinor: false, accountStatus: "active" as const },
    ]).returning();
    await tx.insert(notificationPreferences).values([owner, contributor].map((user) => ({
      userId: user.id,
      unsubscribeToken: randomUUID(),
      pauseAll: true,
    })));
    const linkedTeams = await tx.insert(teams).values([
      { name: `Album Test United ${suffix}`, sport: "Soccer", createdById: owner.id },
      { name: `Album Test City ${suffix}`, sport: "Soccer", createdById: owner.id },
    ]).returning();
    await tx.insert(rosterEntries).values({
      teamId: linkedTeams[0].id, userId: contributor.id, role: "coach", status: "accepted",
    });
    const [competition] = await tx.insert(tournaments).values({
      name: `Album Verification ${suffix}`, slug: `album-verification-${suffix}`,
      startDate: "2026-10-02", endDate: "2026-10-04", sport: "Soccer",
      ownerUserId: owner.id, createdById: owner.id, contributionsOpen: true, brandColor: "#3457d5",
    }).returning();
    await tx.insert(tournamentParticipants).values(linkedTeams.map((team) => ({
      tournamentId: competition.id, name: team.name, nameKey: team.name.toLowerCase(), teamId: team.id,
    })));
    return {
      competitionId: competition.id, slug: competition.slug,
      owner: { id: owner.id, email: owner.email }, contributor: { id: contributor.id, email: contributor.email },
      teams: linkedTeams.map((team) => ({ id: team.id, name: team.name })),
    };
  });
  // All identities above are new synthetic example.invalid accounts. Emails are paused.
  process.stdout.write(`${JSON.stringify(fixture)}\n`);
}

const run = process.argv[2] === "--cleanup"
  ? cleanup(process.argv[3] ?? "")
  : main();
run.finally(() => pool.end());