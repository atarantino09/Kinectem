// Explicitly invoked, disposable browser-verification data; never run at startup.
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { db, pool, users, organizations, teams, rosterEntries, notificationPreferences } from "@workspace/db";
import { hashPassword } from "../src/lib/passwords";

const fixturePath = "/tmp/archived-team-deletion-fixture.json";
async function create() {
  const suffix = randomUUID();
  const password = `Fixture-${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  const fixture = await db.transaction(async (tx) => {
    const people = await tx.insert(users).values([
      { name: "Deletion Verification Admin", email: `archived-deletion-admin-${suffix}@example.invalid`, role: "admin" as const, passwordHash, isMinor: false, accountStatus: "active" as const },
      { name: "Deletion Verification Player", email: `archived-deletion-player-${suffix}@example.invalid`, role: "athlete" as const, passwordHash, isMinor: false, accountStatus: "active" as const },
    ]).returning();
    await tx.insert(notificationPreferences).values(people.map((p) => ({
      userId: p.id, unsubscribeToken: randomUUID(), pauseAll: true,
    })));
    const [org] = await tx.insert(organizations).values({ name: `Archived Deletion Verification ${suffix}` }).returning();
    const [team] = await tx.insert(teams).values({ name: "Verification United U12", organizationId: org.id, sport: "Soccer" }).returning();
    await tx.insert(rosterEntries).values({
      teamId: team.id, userId: people[1].id, name: people[1].name,
      role: "player", position: "player", status: "accepted",
    });
    return { userIds: people.map((p) => p.id), adminEmail: people[0].email, password, organizationId: org.id, teamId: team.id, teamName: team.name };
  });
  await writeFile(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
  process.stdout.write(`Disposable fixture saved to ${fixturePath}\n`);
}

async function cleanup() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { userIds: string[]; organizationId: string };
  const people = await db.select().from(users).where(inArray(users.id, fixture.userIds));
  const [org] = await db.select().from(organizations).where(eq(organizations.id, fixture.organizationId));
  if (people.length !== 2 || people.some((p) => !p.email?.startsWith("archived-deletion-") || !p.email.endsWith("@example.invalid")) ||
      !org?.name.startsWith("Archived Deletion Verification ")) throw new Error("Refusing to delete non-fixture data.");
  await db.transaction(async (tx) => {
    await tx.delete(teams).where(eq(teams.organizationId, fixture.organizationId));
    await tx.delete(organizations).where(eq(organizations.id, fixture.organizationId));
    await tx.delete(users).where(inArray(users.id, fixture.userIds));
  });
  process.stdout.write("Disposable archived-team deletion fixture cleaned.\n");
}

try {
  if (process.argv[2] === "--cleanup") await cleanup();
  else await create();
} finally {
  await pool.end();
}
