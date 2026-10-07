// Synthetic local browser verification only; never imported by app startup.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, users, notificationPreferences, organizations, teams, tournaments,
  partnerLandingPages, partnerOrganizationMemberships, tournamentParticipants, tournamentMatches,
} from "@workspace/db";
import { hashPassword } from "../src/lib/passwords";

async function create() {
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await hashPassword("PartnerLinkCheck2026!");
  const fixture = await db.transaction(async (tx) => {
    const [admin, coach] = await tx.insert(users).values([
      { name: "Partner Link Test Admin", email: `prelink-admin-${suffix}@example.invalid`, role: "admin" as const, passwordHash, isMinor: false, accountStatus: "active" as const },
      { name: "Partner Link Test Coach", email: `prelink-coach-${suffix}@example.invalid`, role: "coach" as const, passwordHash, isMinor: false, accountStatus: "active" as const },
    ]).returning();
    await tx.insert(notificationPreferences).values([admin, coach].map((user) => ({
      userId: user.id, unsubscribeToken: randomUUID(), pauseAll: true,
    })));
    const orgs = await tx.insert(organizations).values([
      { name: `Prelink Test United ${suffix}` }, { name: `Prelink Test City ${suffix}` },
    ]).returning();
    const linkedTeams = await tx.insert(teams).values([
      { organizationId: orgs[0].id, name: "United U12", sport: "Soccer", gender: "Boys" },
      { organizationId: orgs[1].id, name: "City U12", sport: "Soccer", gender: "Girls" },
    ]).returning();
    // Long-list layout coverage, scoped to the same disposable clubs.
    await tx.insert(teams).values(Array.from({ length: 225 }, (_, i) => ({
      organizationId: orgs[0].id, name: `Practice Team ${String(i + 1).padStart(3, "0")}`, sport: "Soccer", gender: "Boys",
    })));
    const [page] = await tx.insert(partnerLandingPages).values({
      officialName: `Prelink Test League ${suffix}`, slug: `prelink-test-league-${suffix}`,
      associationLabel: "League", published: false,
    }).returning();
    await tx.insert(partnerOrganizationMemberships).values(orgs.map((org) => ({
      partnerPageId: page.id, organizationId: org.id,
    })));
    const [competition] = await tx.insert(tournaments).values({
      name: `Prelink Verification ${suffix}`, slug: `prelink-verification-${suffix}`,
      startDate: "2026-10-01", endDate: "2026-10-31", type: "league",
      ownerUserId: coach.id, autoApproveClaims: false, brandColor: "#6d28d9",
    }).returning();
    const slots = await tx.insert(tournamentParticipants).values(linkedTeams.map((team) => ({
      tournamentId: competition.id, name: team.name, nameKey: team.name.toLowerCase(),
      gender: team.gender, age: "U12", division: "Premier",
    }))).returning();
    await tx.insert(tournamentParticipants).values(Array.from({ length: 51 }, (_, i) => ({
      tournamentId: competition.id, name: `Extra Verification Team ${i + 1}`,
      nameKey: `extra verification team ${i + 1}`, age: "U12", gender: "Boys", division: "Premier",
    })));
    await tx.insert(tournamentMatches).values({
      tournamentId: competition.id, matchNumber: "1", matchDate: "2026-10-10", startTime: "10:00",
      homeParticipantId: slots[0].id, awayParticipantId: slots[1].id, venue: "Verification Park",
    });
    return {
      competitionId: competition.id, slug: competition.slug, pageId: page.id, pageName: page.officialName,
      admin: { id: admin.id, email: admin.email }, coach: { id: coach.id, email: coach.email },
      organizations: orgs.map((org) => ({ id: org.id, name: org.name })),
      teams: linkedTeams.map((team) => ({ id: team.id, name: team.name })),
    };
  });
  process.stdout.write(`${JSON.stringify(fixture)}\n`);
}

async function cleanup(path: string) {
  const fixture = JSON.parse(await readFile(path, "utf8"));
  const [competition] = await db.select().from(tournaments).where(eq(tournaments.id, fixture.competitionId));
  const [page] = await db.select().from(partnerLandingPages).where(eq(partnerLandingPages.id, fixture.pageId));
  const userIds = [fixture.admin.id, fixture.coach.id];
  const accounts = await db.select({ email: users.email }).from(users).where(inArray(users.id, userIds));
  const orgIds = fixture.organizations.map((org: { id: string }) => org.id);
  const orgs = await db.select({ name: organizations.name }).from(organizations).where(inArray(organizations.id, orgIds));
  if (competition?.slug !== fixture.slug || !competition.slug.startsWith("prelink-verification-") ||
      !page?.slug.startsWith("prelink-test-league-") || accounts.length !== 2 ||
      accounts.some((user) => !user.email?.startsWith("prelink-") || !user.email.endsWith("@example.invalid")) ||
      orgs.length !== 2 || orgs.some((org) => !org.name.startsWith("Prelink Test "))) {
    throw new Error("Refusing to delete anything other than the synthetic prelink fixture.");
  }
  await db.transaction(async (tx) => {
    await tx.delete(tournaments).where(eq(tournaments.id, competition.id));
    await tx.delete(partnerLandingPages).where(eq(partnerLandingPages.id, page.id));
    await tx.delete(organizations).where(inArray(organizations.id, orgIds));
    await tx.delete(users).where(inArray(users.id, userIds));
  });
  process.stdout.write("Synthetic prelink competition, directory, clubs, teams, and accounts removed.\n");
}

if (process.env.NODE_ENV === "production") throw new Error("Local verification fixtures must never run in production.");
const run = process.argv[2] === "--cleanup" ? cleanup(process.argv[3] ?? "") : create();
run.finally(() => pool.end());
