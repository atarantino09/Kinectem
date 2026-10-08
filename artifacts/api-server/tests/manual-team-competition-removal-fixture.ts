// Disposable, notification-muted local fixture. Never imported by app startup.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { db, pool, users, notificationPreferences, organizations, organizationAdmins, teams, rosterEntries, tournaments, tournamentParticipants, tournamentMatches } from "@workspace/db";
import { hashPassword } from "../src/lib/passwords";

async function create() {
  const suffix = randomUUID(), passwordHash = await hashPassword("RemovalCheck2026!");
  const fixture = await db.transaction(async (tx) => {
    const people = await tx.insert(users).values([
      { name: "Removal Verification Coach", email: `removal-e2e-coach-${suffix}@example.invalid`, role: "coach" as const, passwordHash, isMinor: false, accountStatus: "active" as const },
      { name: "Removal Verification Org Admin", email: `removal-e2e-admin-${suffix}@example.invalid`, role: "fan" as const, passwordHash, isMinor: false, accountStatus: "active" as const },
      { name: "Removal Verification Visitor", email: `removal-e2e-visitor-${suffix}@example.invalid`, role: "fan" as const, passwordHash, isMinor: false, accountStatus: "active" as const },
    ]).returning();
    await tx.insert(notificationPreferences).values(people.map((p) => ({ userId: p.id, unsubscribeToken: randomUUID(), pauseAll: true })));
    const [org] = await tx.insert(organizations).values({ name: `Removal Verification Club ${suffix}` }).returning();
    await tx.insert(organizationAdmins).values({ organizationId: org.id, userId: people[1].id, role: "admin" });
    const clubTeams = await tx.insert(teams).values([
      { organizationId: org.id, name: "Removal United U12", sport: "Soccer" },
      { organizationId: org.id, name: "Removal Rovers U12", sport: "Soccer" },
    ]).returning();
    await tx.insert(rosterEntries).values({ teamId: clubTeams[0].id, userId: people[0].id, name: people[0].name, role: "coach", position: "coach", status: "accepted" });
    const [cup] = await tx.insert(tournaments).values({
      name: "Removal Verification Cup", slug: `removal-verification-${suffix}`, type: "league",
      startDate: "2026-10-01", endDate: "2026-10-31", ownerUserId: people[1].id, autoApproveClaims: true,
    }).returning();
    const slots = await tx.insert(tournamentParticipants).values([
      { tournamentId: cup.id, name: "Original Imported United", nameKey: "original imported united", teamId: clubTeams[0].id, claimedByUserId: people[1].id, claimedAt: new Date() },
      { tournamentId: cup.id, name: "Original Imported Rovers", nameKey: "original imported rovers", teamId: clubTeams[1].id, claimedByUserId: people[1].id, claimedAt: new Date() },
    ]).returning();
    const games = await tx.insert(tournamentMatches).values([1, 2].map((n) => ({
      tournamentId: cup.id, matchNumber: String(n), matchDate: `2026-10-${10 + n}`, startTime: "10:00",
      homeParticipantId: slots[0].id, awayParticipantId: slots[1].id,
    }))).returning();
    return { users: people.map((p) => ({ id: p.id, email: p.email })), organizationId: org.id, teamIds: clubTeams.map((t) => t.id), competitionId: cup.id, slug: cup.slug, participantIds: slots.map((p) => p.id), matchIds: games.map((g) => g.id) };
  });
  process.stdout.write(`${JSON.stringify(fixture)}\n`);
}

async function cleanup(path: string) {
  const fixture = JSON.parse(await readFile(path, "utf8"));
  const ids = fixture.users.map((p: { id: string }) => p.id);
  const people = await db.select().from(users).where(inArray(users.id, ids));
  const [org] = await db.select().from(organizations).where(eq(organizations.id, fixture.organizationId));
  const [cup] = await db.select().from(tournaments).where(eq(tournaments.id, fixture.competitionId));
  if (people.length !== 3 || people.some((p) => !p.email?.startsWith("removal-e2e-") || !p.email.endsWith("@example.invalid")) ||
    !org?.name.startsWith("Removal Verification Club ") || !cup?.slug.startsWith("removal-verification-") || cup.slug !== fixture.slug) {
    throw new Error("Refusing to delete anything except the synthetic removal fixture.");
  }
  await db.transaction(async (tx) => {
    await tx.delete(tournaments).where(eq(tournaments.id, cup.id));
    await tx.delete(teams).where(eq(teams.organizationId, org.id));
    await tx.delete(organizations).where(eq(organizations.id, org.id));
    await tx.delete(users).where(inArray(users.id, ids));
  });
  process.stdout.write("Synthetic removal fixture cleaned.\n");
}

try {
  if (process.argv[2] === "--cleanup") await cleanup(process.argv[3]!);
  else await create();
} finally { await pool.end(); }
