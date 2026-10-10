// Isolated, disposable development fixture for the browser regression.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { db, pool, users, teams, rosterEntries, tournaments, competitionAdmins,
  competitionOrganizers, organizerAdmins, articles, notificationPreferences } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const file = fileURLToPath(new URL("../../generated-artifacts/competition-review-fixture.json", import.meta.url));
type Fixture = { competitionId: string; slug: string; teamId: string; organizerId: string; articleIds: string[];
  people: Record<string, { id: string; email: string }>; password: string };
async function clean() {
  const fixture = await readFile(file, "utf8").then(JSON.parse).catch(() => null) as Fixture | null;
  if (!fixture) return;
  // All IDs originate only from this fixture; never reset shared seed users.
  await db.delete(tournaments).where(eq(tournaments.id, fixture.competitionId));
  await db.delete(teams).where(eq(teams.id, fixture.teamId));
  await db.delete(competitionOrganizers).where(eq(competitionOrganizers.id, fixture.organizerId));
  await db.delete(users).where(inArray(users.id, Object.values(fixture.people).map(p => p.id)));
  await rm(file, { force: true });
}
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Development fixture cannot run in production");
  if (process.argv.includes("clean")) { await clean(); return; }
  await clean();
  const [coach] = await db.select().from(users).where(eq(users.email, "coach@kinectem.demo"));
  if (!coach?.passwordHash) throw new Error("Seed demo coach is required");
  const suffix = randomUUID();
  const people: Fixture["people"] = {};
  for (const role of ["author", "owner", "direct", "hub", "visitor"]) {
    const [person] = await db.insert(users).values({
      name: `Review fixture ${role}`,
      email: `recap-${role}-${suffix}@example.test`, passwordHash: coach.passwordHash,
      role: role === "author" ? "coach" : "fan",
    }).returning();
    people[role] = { id: person.id, email: person.email! };
    await db.insert(notificationPreferences).values({
      userId: person.id, unsubscribeToken: randomUUID(), competitionRecapMode: "off",
    });
  }
  const [hub] = await db.insert(competitionOrganizers).values({
    name: "Recap browser fixture hub", slug: `recap-hub-${suffix}`, ownerUserId: people.hub.id,
  }).returning();
  await db.insert(organizerAdmins).values({ organizerId: hub.id, userId: people.hub.id });
  const [competition] = await db.insert(tournaments).values({
    name: "Recap Review Browser Cup", slug: `recap-review-${suffix}`,
    ownerUserId: people.owner.id, createdById: people.owner.id, organizerId: hub.id,
    startDate: "2026-10-01", endDate: "2026-10-30",
  }).returning();
  await db.insert(competitionAdmins).values({ competitionId: competition.id, userId: people.direct.id });
  const [team] = await db.insert(teams).values({ name: "Review fixture team", createdById: people.author.id }).returning();
  await db.insert(rosterEntries).values({ teamId: team.id, userId: people.author.id, role: "coach", status: "accepted" });
  const recaps = await db.insert(articles).values([1, 2].map(n => ({
    title: `Browser review recap ${n}`, body: `Full recap ${n}: The team played a complete game and celebrated together.`,
    authorId: people.author.id, teamId: team.id, competitionId: competition.id, gameDate: new Date("2026-10-10"),
  }))).returning();
  const fixture: Fixture = {
    competitionId: competition.id, slug: competition.slug, teamId: team.id, organizerId: hub.id,
    articleIds: recaps.map(a => a.id), people, password: "demo1234",
  };
  await mkdir(fileURLToPath(new URL("../../generated-artifacts/", import.meta.url)), { recursive: true });
  await writeFile(file, JSON.stringify(fixture));
  console.log(JSON.stringify(fixture));
}
main().catch(() => { console.error("Development browser fixture failed"); process.exitCode = 1; }).finally(() => pool.end());
