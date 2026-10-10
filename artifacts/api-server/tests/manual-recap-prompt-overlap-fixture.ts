// Temporary synthetic overlap fixture; never used by app startup.
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, pool, users, teams, tournaments, tournamentParticipants, tournamentMatches } from "@workspace/db";

const basePath = "/tmp/recap-prompt-browser-fixture.json";
const outPath = "/tmp/recap-prompt-overlap-fixture.json";
async function create() {
  const base = JSON.parse(await readFile(basePath, "utf8"));
  const [coach] = await db.select().from(users).where(eq(users.id, base.users[0].id));
  const [team] = await db.select().from(teams).where(eq(teams.id, base.teamIds[0]));
  if (!coach?.email?.startsWith("removal-e2e-") || !team?.name.startsWith("Removal ")) throw new Error("Unexpected base fixture");
  const suffix = randomUUID(), today = new Date().toISOString().slice(0, 10);
  const fixture = await db.transaction(async (tx) => {
    const [cup] = await tx.insert(tournaments).values({
      name: `Recap Verification Tournament ${suffix}`, slug: `recap-verification-${suffix}`,
      type: "tournament", startDate: today, endDate: today, ownerUserId: base.users[1].id, autoApproveClaims: true,
    }).returning();
    const slots = await tx.insert(tournamentParticipants).values([
      { tournamentId: cup.id, name: team.name, nameKey: team.name.toLowerCase(), teamId: team.id, claimedByUserId: coach.id, claimedAt: new Date() },
      { tournamentId: cup.id, name: "Recap Verification Opponent", nameKey: `recap verification opponent ${suffix}` },
    ]).returning();
    const [match] = await tx.insert(tournamentMatches).values({
      tournamentId: cup.id, matchNumber: "1", matchDate: today, startTime: "09:00",
      homeParticipantId: slots[0].id, awayParticipantId: slots[1].id, homeScore: 3, awayScore: 1, status: "completed",
    }).returning();
    return { competitionId: cup.id, slug: cup.slug, matchId: match.id, today };
  });
  await writeFile(outPath, JSON.stringify(fixture)); console.log(JSON.stringify(fixture));
}
async function cleanup() {
  const fixture = JSON.parse(await readFile(outPath, "utf8"));
  const [cup] = await db.select().from(tournaments).where(eq(tournaments.id, fixture.competitionId));
  if (!cup?.slug.startsWith("recap-verification-") || cup.slug !== fixture.slug) throw new Error("Refusing unrelated cleanup");
  await db.delete(tournaments).where(eq(tournaments.id, cup.id)); console.log("Synthetic overlap cleaned.");
}
try { if (process.argv[2] === "--cleanup") await cleanup(); else await create(); }
finally { await pool.end(); }
