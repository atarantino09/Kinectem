import { db } from "@workspace/db";
import {
  users,
  organizations,
  organizationAdmins,
  organizationFollowers,
  teams,
  teamFollowers,
  rosterEntries,
  rosterInvites,
  articles,
  articleAuthors,
  highlights,
  articleTags,
  highlightTags,
  notifications,
  userFollowers,
  postReactions,
  postComments,
  postShares,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "./logger";
import { hashPassword } from "./passwords";

export const DEMO_PASSWORD = "demo1234";

// Demo users that must always exist so common test queries (e.g. searching
// for "morgan") succeed regardless of whether the DB was seeded before this
// user was added to the seed list.
const REQUIRED_DEMO_USERS: Array<typeof users.$inferInsert> = [
  {
    name: "Morgan Lee",
    email: "morgan@kinectem.demo",
    role: "athlete",
    sport: "Soccer",
    position: "Midfielder",
    jerseyNumber: 10,
    grade: "Class of 2026",
    location: "Westfield, NJ",
    bio: "Two-footed midfielder. Captain of the school squad.",
  },
  {
    name: "Andrew Tarantino",
    email: "andrew@kinectem.com",
    role: "admin",
    location: "Westfield, NJ",
    bio: "Kinectem global admin.",
  },
];

async function ensureRequiredDemoUsers(passwordHash: string): Promise<void> {
  for (const u of REQUIRED_DEMO_USERS) {
    const email = u.email;
    if (typeof email !== "string") continue;
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) continue;
    const row: typeof users.$inferInsert & { passwordHash: string } = {
      ...u,
      passwordHash,
    };
    await db.insert(users).values(row);
    logger.info({ email }, "Inserted required demo user");
  }
}

export async function seedIfEmpty(): Promise<void> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);

  const demoPasswordHash = await hashPassword(DEMO_PASSWORD);

  if (count > 0) {
    // Backfill: any pre-existing users without a password hash get the demo
    // password so the seeded accounts remain usable after the auth migration.
    const updated = await db
      .update(users)
      .set({ passwordHash: demoPasswordHash })
      .where(sql`${users.passwordHash} IS NULL`)
      .returning({ id: users.id });
    if (updated.length > 0) {
      logger.info({ backfilled: updated.length }, "Backfilled demo password on existing users");
    }
    // Ensure newly-required demo users (added after the initial seed) are
    // present even when the DB already has data.
    await ensureRequiredDemoUsers(demoPasswordHash);
    // Backfill demo activity (follows / reactions / comments / extra shares)
    // for partially-seeded DBs that pre-date this helper. Wrapped so a
    // schema mismatch never blocks server boot.
    try {
      await backfillDemoActivityIfMissing();
    } catch (err) {
      logger.warn({ err }, "Demo activity backfill failed (non-fatal)");
    }
    // Idempotently ensure the bell-notification fixtures used by the
    // roster deep-link e2e test exist on long-lived DBs that were seeded
    // before they were added.
    try {
      await ensureSamiraDemoNotifications();
    } catch (err) {
      logger.warn({ err }, "Samira demo notifications backfill failed (non-fatal)");
    }
    logger.info({ userCount: count }, "Database already seeded");
    return;
  }

  logger.info("Seeding database...");


  const withPw = <T extends Record<string, unknown>>(u: T): T & { passwordHash: string } => ({
    ...u,
    passwordHash: demoPasswordHash,
  });

  const seedUserRows: Array<typeof users.$inferInsert> = [
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
      ...REQUIRED_DEMO_USERS,
    ];

  const [marcus, jordan, tyler, coachDavis, adminSam, daniela, chris, parentLisa, childSamira] = await db
    .insert(users)
    .values(seedUserRows.map(withPw))
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
    { organizationId: westfield.id, userId: adminSam.id, role: "owner" },
    { organizationId: westfield.id, userId: coachDavis.id, role: "admin" },
  ]);

  const [varsityFootball, jvFootball, varsityBasketball] = await db
    .insert(teams)
    .values([
      { organizationId: westfield.id, name: "Varsity Football", season: "Fall 2025", sport: "Football", level: "Varsity" },
      { organizationId: westfield.id, name: "JV Football", season: "Fall 2025", sport: "Football", level: "JV" },
      { organizationId: westfield.id, name: "Varsity Boys Basketball", season: "Winter 2025", sport: "Basketball", level: "Varsity" },
    ])
    .returning();

  await db
    .insert(rosterEntries)
    .values([
      { teamId: varsityFootball.id, userId: marcus.id, role: "player", status: "accepted", position: "WR", jerseyNumber: 12 },
      { teamId: varsityFootball.id, userId: jordan.id, role: "player", status: "accepted", position: "QB", jerseyNumber: 7 },
      { teamId: varsityFootball.id, userId: tyler.id, role: "player", status: "accepted", position: "RB", jerseyNumber: 24 },
      { teamId: varsityFootball.id, userId: chris.id, role: "player", status: "accepted", position: "LB", jerseyNumber: 55 },
      { teamId: varsityFootball.id, userId: coachDavis.id, role: "coach", status: "accepted", position: "Head Coach" },
      { teamId: jvFootball.id, userId: tyler.id, role: "player", status: "accepted", position: "RB", jerseyNumber: 24 },
      { teamId: varsityBasketball.id, userId: daniela.id, role: "player", status: "accepted", position: "PG", jerseyNumber: 3 },
      // A pending invitation already accepted by player
      { teamId: varsityBasketball.id, userId: childSamira.id, role: "player", status: "pending", position: "SG", jerseyNumber: 22 },
    ])
    .returning();

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

  // Samira's bell notifications (the deep-link roster invite + a static,
  // unlinked one used by the e2e tests) are inserted via the same idempotent
  // helper the existing-DB branch uses, so both branches converge on the
  // same notification fixtures.
  await ensureSamiraDemoNotifications();

  // Use the same backfill helper that runs on subsequent boots so the
  // empty-seed branch and the already-seeded branch converge on identical
  // activity state. The helper does its own email-based user lookup, so
  // it picks up REQUIRED_DEMO_USERS (e.g. Morgan) that aren't bound to
  // local vars in this scope.
  await backfillDemoActivityIfMissing();

  logger.info("Database seeded successfully");
}

// Idempotently ensures the two demo notifications used by the e2e roster
// deep-link test exist for Samira (the under-13 athlete fixture):
//   1. A `roster_invite` notification whose `link` deep-links to her pending
//      basketball roster row, used by the test that asserts clicking the
//      bell lands on the Roster panel and briefly highlights her row.
//   2. A static notification with no `link`, used by the test that asserts
//      unlinked notifications render as `notification-static-…` and don't
//      navigate when clicked.
// Called from both seed branches so a fresh seed and a long-lived,
// already-seeded DB converge on the same fixtures.
async function ensureSamiraDemoNotifications(): Promise<void> {
  const [samira] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "samira@kinectem.demo"))
    .limit(1);
  if (!samira) return;

  // 1) Roster-invite deep-link notification, pointed at Samira's pending
  //    basketball roster row. Find that specific entry by joining on her
  //    sole basketball team (the seed gives Samira exactly one player
  //    entry — Varsity Boys Basketball). Long-lived demo DBs may have
  //    flipped that row to `accepted` during a previous interactive
  //    session, so we reset only THAT entry to `pending` (rather than
  //    every roster row Samira owns) to avoid clobbering unrelated
  //    demo state.
  const [basketballEntry] = await db
    .select({ id: rosterEntries.id, teamId: rosterEntries.teamId })
    .from(rosterEntries)
    .innerJoin(teams, eq(teams.id, rosterEntries.teamId))
    .where(
      and(
        eq(rosterEntries.userId, samira.id),
        eq(rosterEntries.role, "player"),
        eq(teams.sport, "Basketball"),
      ),
    )
    .limit(1);

  if (basketballEntry) {
    await db
      .update(rosterEntries)
      .set({ status: "pending" })
      .where(eq(rosterEntries.id, basketballEntry.id));
  }

  const pending = basketballEntry;

  if (pending) {
    const link = `/teams/${pending.teamId}?roster=1&entryId=${pending.id}`;
    const [existingLinked] = await db
      .select({ id: notifications.id, link: notifications.link })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, samira.id),
          eq(notifications.kind, "roster_invite"),
        ),
      )
      .limit(1);
    if (!existingLinked) {
      await db.insert(notifications).values({
        userId: samira.id,
        kind: "roster_invite",
        message:
          "Coach Mike Davis added you to Varsity Boys Basketball — accept your roster spot.",
        link,
      });
    } else if (existingLinked.link !== link) {
      // Older DBs may carry a stale link from a previous deep-link
      // format (e.g. `/u/<userId>`). Repoint it at the current
      // `/teams/{teamId}?roster=1&entryId={entryId}` URL so the bell
      // click lands on the Roster tab as the e2e test expects.
      await db
        .update(notifications)
        .set({ link })
        .where(eq(notifications.id, existingLinked.id));
    }
  }

  // 2) Static (unlinked) notification — its `kind` is intentionally NOT
  //    `guardian_expired` or `roster_invite_for_child`, since the bell
  //    treats those two kinds as clickable even without a link.
  const STATIC_MESSAGE =
    "Welcome to Kinectem — say hi to your team in the Family tab.";
  const [existingStatic] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, samira.id),
        eq(notifications.message, STATIC_MESSAGE),
      ),
    )
    .limit(1);
  if (!existingStatic) {
    await db.insert(notifications).values({
      userId: samira.id,
      kind: "system_message",
      message: STATIC_MESSAGE,
      link: null,
    });
  }
}

// ---------------------------------------------------------------------------
// Demo activity seeding
// ---------------------------------------------------------------------------
//
// Without follows / reactions / comments the personalized feed is empty for
// every demo signin and the app feels lifeless. These helpers add a small
// realistic graph of social activity. Both branches of seedIfEmpty (empty
// seed and partially-seeded backfill) reuse seedDemoActivity, so every
// insert here uses onConflictDoNothing for idempotency.

type DemoActor = { id: string };

interface DemoActivityInputs {
  org: { id: string };
  teams: { varsityFootball: { id: string }; varsityBasketball: { id: string } };
  users: {
    marcus: DemoActor;
    jordan: DemoActor;
    tyler: DemoActor;
    coachDavis: DemoActor;
    adminSam: DemoActor;
    daniela: DemoActor;
    chris: DemoActor;
    parentLisa: DemoActor;
    childSamira: DemoActor;
    morgan?: DemoActor;
  };
  articles: { recap1: { id: string }; recap2: { id: string } };
  highlights: { hl1: { id: string }; hl2: { id: string }; hl3: { id: string } };
}

async function seedDemoActivity(input: DemoActivityInputs): Promise<void> {
  const {
    org,
    teams: { varsityFootball, varsityBasketball },
    users: u,
    articles: { recap1, recap2 },
    highlights: { hl1, hl2, hl3 },
  } = input;

  // User-to-user follows. Picked so every canonical demo user has an
  // inbound or outbound follow that surfaces real content in their
  // personalized feed (Coach + Marcus author/star in the seeded recaps).
  const follows: Array<{ followingUserId: string; followerUserId: string }> = [
    { followerUserId: u.parentLisa.id, followingUserId: u.marcus.id },
    { followerUserId: u.parentLisa.id, followingUserId: u.jordan.id },
    { followerUserId: u.parentLisa.id, followingUserId: u.childSamira.id },
    { followerUserId: u.parentLisa.id, followingUserId: u.coachDavis.id },
    { followerUserId: u.adminSam.id, followingUserId: u.coachDavis.id },
    { followerUserId: u.adminSam.id, followingUserId: u.marcus.id },
    { followerUserId: u.jordan.id, followingUserId: u.marcus.id },
    { followerUserId: u.tyler.id, followingUserId: u.jordan.id },
    { followerUserId: u.marcus.id, followingUserId: u.jordan.id },
    { followerUserId: u.chris.id, followingUserId: u.coachDavis.id },
    { followerUserId: u.daniela.id, followingUserId: u.marcus.id },
    { followerUserId: u.coachDavis.id, followingUserId: u.marcus.id },
  ];
  if (u.morgan) {
    follows.push(
      { followerUserId: u.morgan.id, followingUserId: u.daniela.id },
      { followerUserId: u.morgan.id, followingUserId: u.coachDavis.id },
    );
  }
  await db.insert(userFollowers).values(follows).onConflictDoNothing();

  // Team follows: parents + admin watch both varsity teams; cross-sport
  // athlete follows so basketball folks see football content too.
  const teamFollowRows: Array<{ teamId: string; userId: string }> = [
    { teamId: varsityFootball.id, userId: u.parentLisa.id },
    { teamId: varsityFootball.id, userId: u.adminSam.id },
    { teamId: varsityBasketball.id, userId: u.parentLisa.id },
    { teamId: varsityBasketball.id, userId: u.adminSam.id },
    { teamId: varsityBasketball.id, userId: u.marcus.id },
    { teamId: varsityBasketball.id, userId: u.jordan.id },
    { teamId: varsityFootball.id, userId: u.daniela.id },
  ];
  await db.insert(teamFollowers).values(teamFollowRows).onConflictDoNothing();

  // Org follows: most demo users follow Westfield Athletic Club.
  const orgFollowRows: Array<{ organizationId: string; userId: string }> = [
    { organizationId: org.id, userId: u.parentLisa.id },
    { organizationId: org.id, userId: u.adminSam.id },
    { organizationId: org.id, userId: u.marcus.id },
    { organizationId: org.id, userId: u.jordan.id },
    { organizationId: org.id, userId: u.daniela.id },
    { organizationId: org.id, userId: u.childSamira.id },
    { organizationId: org.id, userId: u.tyler.id },
    { organizationId: org.id, userId: u.chris.id },
  ];
  if (u.morgan) orgFollowRows.push({ organizationId: org.id, userId: u.morgan.id });
  await db.insert(organizationFollowers).values(orgFollowRows).onConflictDoNothing();

  // Reactions ("like" is the only enum value today). Spread across both
  // recaps and all three highlights so post stats look populated.
  const reactionRows: Array<{ postKind: "article"; postRefId: string; userId: string } | { postKind: "highlight"; postRefId: string; userId: string }> = [
    { postKind: "article", postRefId: recap1.id, userId: u.parentLisa.id },
    { postKind: "article", postRefId: recap1.id, userId: u.adminSam.id },
    { postKind: "article", postRefId: recap1.id, userId: u.jordan.id },
    { postKind: "article", postRefId: recap1.id, userId: u.tyler.id },
    { postKind: "article", postRefId: recap2.id, userId: u.parentLisa.id },
    { postKind: "article", postRefId: recap2.id, userId: u.daniela.id },
    { postKind: "highlight", postRefId: hl1.id, userId: u.parentLisa.id },
    { postKind: "highlight", postRefId: hl1.id, userId: u.adminSam.id },
    { postKind: "highlight", postRefId: hl1.id, userId: u.jordan.id },
    { postKind: "highlight", postRefId: hl2.id, userId: u.parentLisa.id },
    { postKind: "highlight", postRefId: hl3.id, userId: u.parentLisa.id },
    { postKind: "highlight", postRefId: hl3.id, userId: u.adminSam.id },
  ];
  await db.insert(postReactions).values(reactionRows).onConflictDoNothing();

  // Comments — kept short and on-topic. We dedupe within a single insert
  // call by author+body so repeat backfills don't pile on duplicates: the
  // post_comments table has no unique constraint, so the dedupe is done
  // by checking what's already present before inserting.
  const desiredComments: Array<{ postKind: "article"; postRefId: string; authorId: string; body: string }> = [
    { postKind: "article", postRefId: recap1.id, authorId: u.parentLisa.id, body: "So proud of these boys!" },
    { postKind: "article", postRefId: recap1.id, authorId: u.adminSam.id, body: "Great team win." },
    { postKind: "article", postRefId: recap1.id, authorId: u.jordan.id, body: "Locked in. On to the next one." },
    { postKind: "article", postRefId: recap2.id, authorId: u.marcus.id, body: "Big stop by Chris at the end." },
    { postKind: "article", postRefId: recap2.id, authorId: u.parentLisa.id, body: "Heart-stopper. Well played." },
  ];
  for (const c of desiredComments) {
    const [existing] = await db
      .select({ id: postComments.id })
      .from(postComments)
      .where(
        sql`${postComments.postKind} = ${c.postKind}
          AND ${postComments.postRefId} = ${c.postRefId}
          AND ${postComments.authorId} = ${c.authorId}
          AND ${postComments.body} = ${c.body}`,
      )
      .limit(1);
    if (!existing) {
      await db.insert(postComments).values(c);
    }
  }

  // Extra shares so re-shared recaps and highlights appear in
  // followers' feeds. We include shares by users that the canonical
  // demo viewers follow (e.g. Jordan / Marcus, both followed by
  // Lisa) so the personalized feed query surfaces them via the
  // post_shares path — not just direct authorship. Per task #190
  // shares are polymorphic (article|highlight) and team-follower
  // fans (e.g. parentLisa, who only follows the team) can share too.
  await db
    .insert(postShares)
    .values([
      { postKind: "article", postRefId: recap1.id, sharerUserId: u.parentLisa.id },
      { postKind: "article", postRefId: recap2.id, sharerUserId: u.adminSam.id },
      { postKind: "article", postRefId: recap1.id, sharerUserId: u.jordan.id },
      { postKind: "article", postRefId: recap2.id, sharerUserId: u.marcus.id },
      { postKind: "highlight", postRefId: hl1.id, sharerUserId: u.parentLisa.id },
      { postKind: "highlight", postRefId: hl2.id, sharerUserId: u.adminSam.id },
      { postKind: "highlight", postRefId: hl3.id, sharerUserId: u.jordan.id },
    ])
    .onConflictDoNothing();
}

// Looks up the canonical demo users by email and runs seedDemoActivity
// when the activity tables are still empty. Gated on user_followers being
// empty (cheap COUNT), as called out in the task plan, so this skips the
// per-boot work once a DB has been backfilled. Internally seedDemoActivity
// is fully idempotent (onConflictDoNothing + comment dedupe), so the
// empty-seed branch reuses this helper for the same email-based user
// lookup (which picks up REQUIRED_DEMO_USERS like Morgan that aren't
// bound to a local var). Bails out gracefully when any required
// user/team/article is missing — better to leave the DB alone than to
// write half-formed activity.
async function backfillDemoActivityIfMissing(): Promise<void> {
  const [{ count: followCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userFollowers);
  if (followCount > 0) return;

  const REQUIRED_EMAILS = [
    "marcus@kinectem.demo",
    "jordan@kinectem.demo",
    "tyler@kinectem.demo",
    "coach@kinectem.demo",
    "sam@kinectem.demo",
    "daniela@kinectem.demo",
    "chris@kinectem.demo",
    "lisa@kinectem.demo",
    "samira@kinectem.demo",
  ] as const;

  const userRows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, [...REQUIRED_EMAILS, "morgan@kinectem.demo"]));
  const byEmail = new Map(userRows.map((r) => [r.email ?? "", r.id]));
  for (const e of REQUIRED_EMAILS) {
    if (!byEmail.has(e)) {
      logger.info({ missing: e }, "Skipping demo activity backfill (missing demo user)");
      return;
    }
  }

  const [westfield] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.name, "Westfield Athletic Club"))
    .limit(1);
  if (!westfield) return;

  const teamRows = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.organizationId, westfield.id));
  const varsityFootball = teamRows.find((t) => t.name === "Varsity Football");
  const varsityBasketball = teamRows.find((t) => t.name === "Varsity Boys Basketball");
  if (!varsityFootball || !varsityBasketball) return;

  const articleRows = await db
    .select({ id: articles.id, title: articles.title })
    .from(articles)
    .where(eq(articles.teamId, varsityFootball.id));
  const recap1 = articleRows.find((a) => a.title.startsWith("Westfield Dominates"));
  const recap2 = articleRows.find((a) => a.title.startsWith("Hard-Fought Win"));
  if (!recap1 || !recap2) return;

  const highlightRows = await db
    .select({ id: highlights.id, title: highlights.title })
    .from(highlights)
    .where(eq(highlights.teamId, varsityFootball.id));
  const hl1 = highlightRows.find((h) => h.title.startsWith("40-yard TD"));
  const hl2 = highlightRows.find((h) => h.title.startsWith("One-Handed"));
  const hl3 = highlightRows.find((h) => h.title.startsWith("Walker"));
  if (!hl1 || !hl2 || !hl3) return;

  const morganId = byEmail.get("morgan@kinectem.demo");

  await seedDemoActivity({
    org: westfield,
    teams: { varsityFootball, varsityBasketball },
    users: {
      marcus: { id: byEmail.get("marcus@kinectem.demo")! },
      jordan: { id: byEmail.get("jordan@kinectem.demo")! },
      tyler: { id: byEmail.get("tyler@kinectem.demo")! },
      coachDavis: { id: byEmail.get("coach@kinectem.demo")! },
      adminSam: { id: byEmail.get("sam@kinectem.demo")! },
      daniela: { id: byEmail.get("daniela@kinectem.demo")! },
      chris: { id: byEmail.get("chris@kinectem.demo")! },
      parentLisa: { id: byEmail.get("lisa@kinectem.demo")! },
      childSamira: { id: byEmail.get("samira@kinectem.demo")! },
      morgan: morganId ? { id: morganId } : undefined,
    },
    articles: { recap1, recap2 },
    highlights: { hl1, hl2, hl3 },
  });

  logger.info("Backfilled demo activity (follows / reactions / comments / shares)");
}
