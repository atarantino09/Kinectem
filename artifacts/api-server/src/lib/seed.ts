import { db } from "@workspace/db";
import {
  users,
  organizations,
  organizationAdmins,
  teams,
  rosterEntries,
  rosterInvites,
  articles,
  articleAuthors,
  highlights,
  articleTags,
  highlightTags,
  notifications,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function seedIfEmpty(): Promise<void> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);

  if (count > 0) {
    logger.info({ userCount: count }, "Database already seeded");
    return;
  }

  logger.info("Seeding database...");

  const [marcus, jordan, tyler, coachDavis, adminSam, daniela, chris, parentLisa, childSamira] = await db
    .insert(users)
    .values([
      {
        name: "Marcus Rivera",
        email: "marcus@kinectem.demo",
        role: "athlete",
        sport: "Football",
        position: "Wide Receiver",
        jerseyNumber: 12,
        grade: "Class of 2026",
        location: "Westfield, NJ",
        bio: "Speed, hands, and vision. Dedicated to outworking the competition. 4.45 40-yd dash.",
      },
      {
        name: "Jordan Bennett",
        email: "jordan@kinectem.demo",
        role: "athlete",
        sport: "Football",
        position: "Quarterback",
        jerseyNumber: 7,
        grade: "Class of 2026",
        location: "Westfield, NJ",
        bio: "Pocket presence and a cannon arm. Looking to play at the next level.",
      },
      {
        name: "Tyler Chen",
        email: "tyler@kinectem.demo",
        role: "athlete",
        sport: "Football",
        position: "Running Back",
        jerseyNumber: 24,
        grade: "Class of 2027",
        location: "Westfield, NJ",
        bio: "Explosive first step. Love contact.",
      },
      {
        name: "Coach Mike Davis",
        email: "coach@kinectem.demo",
        role: "coach",
        sport: "Football",
        position: "Head Coach",
        location: "Westfield, NJ",
        bio: "15 years coaching high school football. Focus on fundamentals and character.",
      },
      {
        name: "Sam Patel",
        email: "sam@kinectem.demo",
        role: "admin",
        location: "Westfield, NJ",
        bio: "Athletic Director, Westfield Athletic Club.",
      },
      {
        name: "Daniela Ortiz",
        email: "daniela@kinectem.demo",
        role: "athlete",
        sport: "Basketball",
        position: "Point Guard",
        jerseyNumber: 3,
        grade: "Class of 2026",
        location: "Westfield, NJ",
        bio: "Court vision first. Getting everyone involved.",
      },
      {
        name: "Chris Walker",
        email: "chris@kinectem.demo",
        role: "athlete",
        sport: "Football",
        position: "Linebacker",
        jerseyNumber: 55,
        grade: "Class of 2026",
        location: "Westfield, NJ",
        bio: "Tackle machine. Captain on and off the field.",
      },
      {
        name: "Lisa Carter",
        email: "lisa@kinectem.demo",
        role: "parent",
        location: "Westfield, NJ",
        bio: "Mom of two athletes. Soccer + basketball families never sleep.",
      },
      {
        name: "Samira Carter",
        email: "samira@kinectem.demo",
        role: "athlete",
        sport: "Basketball",
        position: "Shooting Guard",
        jerseyNumber: 22,
        grade: "Class of 2032",
        location: "Westfield, NJ",
        bio: "Middle school hooper, big dreams.",
        dateOfBirth: new Date("2014-03-12"),
      },
    ])
    .returning();

  // Link parent ↔ child
  await db.update(users).set({ parentId: parentLisa.id }).where(sql`id = ${childSamira.id}`);

  const [westfield] = await db
    .insert(organizations)
    .values([
      {
        name: "Westfield Athletic Club",
        sport: "Multi-sport",
        location: "Westfield, NJ",
        description:
          "Premier youth sports organization dedicated to developing student-athletes in Union County. Home of the Blue Devils. Developing talent, character, and leadership since 1995.",
        createdById: adminSam.id,
      },
    ])
    .returning();

  await db.insert(organizationAdmins).values([
    { organizationId: westfield.id, userId: adminSam.id },
    { organizationId: westfield.id, userId: coachDavis.id },
  ]);

  const [varsityFootball, jvFootball, varsityBasketball] = await db
    .insert(teams)
    .values([
      { organizationId: westfield.id, name: "Varsity Football", season: "Fall 2025", sport: "Football", level: "Varsity" },
      { organizationId: westfield.id, name: "JV Football", season: "Fall 2025", sport: "Football", level: "JV" },
      { organizationId: westfield.id, name: "Varsity Boys Basketball", season: "Winter 2025", sport: "Basketball", level: "Varsity" },
    ])
    .returning();

  await db.insert(rosterEntries).values([
    { teamId: varsityFootball.id, userId: marcus.id, role: "player", status: "accepted", position: "WR", jerseyNumber: 12 },
    { teamId: varsityFootball.id, userId: jordan.id, role: "player", status: "accepted", position: "QB", jerseyNumber: 7 },
    { teamId: varsityFootball.id, userId: tyler.id, role: "player", status: "accepted", position: "RB", jerseyNumber: 24 },
    { teamId: varsityFootball.id, userId: chris.id, role: "player", status: "accepted", position: "LB", jerseyNumber: 55 },
    { teamId: varsityFootball.id, userId: coachDavis.id, role: "coach", status: "accepted", position: "Head Coach" },
    { teamId: jvFootball.id, userId: tyler.id, role: "player", status: "accepted", position: "RB", jerseyNumber: 24 },
    { teamId: varsityBasketball.id, userId: daniela.id, role: "player", status: "accepted", position: "PG", jerseyNumber: 3 },
    // A pending invitation already accepted by player
    { teamId: varsityBasketball.id, userId: samiraPlaceholder(childSamira.id), role: "player", status: "pending", position: "SG", jerseyNumber: 22 },
  ]);

  // Pending email invite (no user yet)
  await db.insert(rosterInvites).values([
    {
      token: "demo-invite-token-001",
      teamId: varsityFootball.id,
      invitedEmail: "newrecruit@example.com",
      invitedName: "Devon Williams",
      role: "player",
      position: "Cornerback",
      jerseyNumber: 21,
      status: "pending",
      invitedById: coachDavis.id,
    },
  ]);

  const publishedAt1 = new Date("2025-10-14");
  const publishedAt2 = new Date("2025-09-26");

  const [recap1, recap2, draftRecap] = await db
    .insert(articles)
    .values([
      {
        teamId: varsityFootball.id,
        authorId: coachDavis.id,
        title: "Westfield Dominates Lincoln High 34-14",
        summary:
          "Marcus Rivera put on a clinic with 3 touchdowns and over 150 receiving yards. The offense was clicking on all cylinders as they roll to their 8th win of the season.",
        body: "The Blue Devils put together their most complete game of the season Friday night, dismantling Lincoln High 34-14. Jordan Bennett threw for 285 yards and 3 touchdowns, connecting with Marcus Rivera for a 40-yard score in the first quarter that set the tone. Tyler Chen added 98 rushing yards on 14 carries, and the defense, led by Chris Walker's 12 tackles, forced three turnovers. Head Coach Mike Davis praised the team's discipline and preparation.",
        opponentName: "Lincoln High",
        teamScore: 34,
        opponentScore: 14,
        gameDate: publishedAt1,
        status: "published",
        publishedAt: publishedAt1,
      },
      {
        teamId: varsityFootball.id,
        authorId: coachDavis.id,
        title: "Hard-Fought Win Over Rival Millburn 21-17",
        summary:
          "A grinding defensive battle ended with a late Jordan Bennett drive to secure the rivalry win.",
        body: "Westfield edged Millburn 21-17 in a back-and-forth battle under the lights. The game came down to the final drive, where Jordan Bennett marched the offense 68 yards, finishing with a 12-yard touchdown strike to Marcus Rivera with 1:47 on the clock. The defense held on the final possession with Chris Walker recording the game-sealing sack.",
        opponentName: "Millburn",
        teamScore: 21,
        opponentScore: 17,
        gameDate: publishedAt2,
        status: "published",
        publishedAt: publishedAt2,
      },
      {
        teamId: varsityFootball.id,
        authorId: coachDavis.id,
        title: "Draft: Recap vs. Cranford",
        summary: "Working title — early notes from Friday's game.",
        body: "Notes: Big stop on 4th and 1. Need to mention Tyler's 35-yard run in the third. Add Marcus's two-point conversion catch.",
        opponentName: "Cranford",
        gameDate: new Date("2025-10-21"),
        status: "draft",
      },
    ])
    .returning();

  await db.insert(articleAuthors).values([
    { articleId: draftRecap.id, userId: coachDavis.id },
  ]);

  await db.insert(articleTags).values([
    { articleId: recap1.id, userId: marcus.id },
    { articleId: recap1.id, userId: jordan.id },
    { articleId: recap1.id, userId: tyler.id },
    { articleId: recap1.id, userId: chris.id },
    { articleId: recap2.id, userId: marcus.id },
    { articleId: recap2.id, userId: jordan.id },
    { articleId: recap2.id, userId: chris.id },
  ]);

  const [hl1, hl2, hl3] = await db
    .insert(highlights)
    .values([
      {
        teamId: varsityFootball.id,
        articleId: recap1.id,
        uploaderId: coachDavis.id,
        title: "40-yard TD Catch vs. Lincoln HS",
        description: "Marcus Rivera hauls in a deep ball for the opening score.",
        videoUrl: "https://example.com/videos/rivera-40td.mp4",
        durationSeconds: 45,
      },
      {
        teamId: varsityFootball.id,
        articleId: recap1.id,
        uploaderId: coachDavis.id,
        title: "One-Handed Grab in Double Coverage",
        description: "Rivera with an unbelievable snag on third down.",
        videoUrl: "https://example.com/videos/rivera-onehand.mp4",
        durationSeconds: 72,
      },
      {
        teamId: varsityFootball.id,
        articleId: recap2.id,
        uploaderId: coachDavis.id,
        title: "Walker Game-Sealing Sack vs. Millburn",
        description: "Chris Walker brings down the QB to end it.",
        videoUrl: "https://example.com/videos/walker-sack.mp4",
        durationSeconds: 28,
      },
    ])
    .returning();

  await db.insert(highlightTags).values([
    { highlightId: hl1.id, userId: marcus.id },
    { highlightId: hl1.id, userId: jordan.id },
    { highlightId: hl2.id, userId: marcus.id },
    { highlightId: hl3.id, userId: chris.id },
  ]);

  await db.insert(notifications).values([
    {
      userId: childSamira.id,
      kind: "roster_invite",
      message: "Coach Mike Davis added you to Varsity Boys Basketball — accept your roster spot.",
      link: `/u/${childSamira.id}`,
    },
  ]);

  logger.info("Database seeded successfully");
}

function samiraPlaceholder(id: string) { return id; }
