// Explicitly run for dev browser verification only. Never run at startup/deploy.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool, users, tournaments, teams, competitionBrackets, tournamentParticipants, articles } from "@workspace/db";

const [owner] = await db.select().from(users).where(eq(users.email, "coach@kinectem.demo"));
if (!owner) throw new Error("Demo coach account is required for browser verification.");
const slug = `results-browser-${randomUUID().slice(0, 8)}`;
const [competition] = await db.insert(tournaments).values({
  name: "Results Browser Cup", slug, startDate: "2026-10-01", endDate: "2026-10-03",
  ownerUserId: owner.id, createdById: owner.id, brandColor: "#1538A6", secondaryColor: "#0D9488",
}).returning();
const [bracket] = await db.insert(competitionBrackets).values({
  tournamentId: competition.id, label: "U12 Gold", labelKey: "u12 gold", gender: "Boys",
}).returning();
const [team] = await db.insert(teams).values({name: "Results Browser Rovers", sport: "Soccer", gender: "Boys", createdById: owner.id}).returning();
const slots = await db.insert(tournamentParticipants).values([
  {tournamentId: competition.id, name: "Rovers", nameKey: "rovers", gender: "Boys", age: "U12", teamId: team.id, bracketId: bracket.id},
  {tournamentId: competition.id, name: "Rovers", nameKey: "rovers", gender: "Girls", age: "U12"},
]).returning();
const [article] = await db.insert(articles).values({
  teamId: team.id, authorId: owner.id, title: "Rovers game coverage", body: "A reviewed public game recap from the team.",
  summary: "Rovers and United competed in the Gold group.", competitionId: competition.id, bracketId: bracket.id, status: "published", publishedAt: new Date(),
}).returning();
await db.insert(articles).values([
  {teamId: team.id, authorId: owner.id, title: "PRIVATE PRACTICE MUST NOT APPEAR", body: "Private drills", competitionId: competition.id, bracketId: bracket.id, articleKind: "practice_plan"},
  {teamId: team.id, authorId: owner.id, title: "HIDDEN MUST NOT APPEAR", body: "Hidden", competitionId: competition.id, bracketId: bracket.id, hiddenAt: new Date()},
]);
process.stdout.write(JSON.stringify({competitionId: competition.id, slug, bracketId: bracket.id, teamId: team.id, articleId: `article-${article.id}`, participantIds: slots.map(s => ({id: s.id, gender: s.gender}))}) + "\n");
await pool.end();
