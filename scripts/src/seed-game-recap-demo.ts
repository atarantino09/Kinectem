// Demo seed for the game-recap-walkthrough video capture.
//
// The walkthrough screenshots the Legacy Black 2014 (soccer) team page, the
// "Legacy test" org page, and Samira Carter's multi-sport player profile. The
// demo DB was full of junk test recaps ("edit test", "test delete", ...) which
// made those pages look broken on camera. This script:
//   1. Hides the junk test/edit articles on the soccer team (soft delete).
//   2. Seeds realistic, published game recaps on the soccer + basketball teams,
//      each tagging Samira (and a teammate) so they fan out to her profile and
//      drive the team/sport filter story.
//   3. Makes Samira's demo profile public so the owner capture sees the full page.
//
// Idempotent: re-running deletes the previously-seeded recaps (by team + title,
// which cascades their tags) and re-inserts them, so there are never duplicates.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run seed-game-recap-demo
import {
  db,
  articles,
  articleTags,
  highlights,
  highlightTags,
  rosterEntries,
  users,
} from "@workspace/db";
import { and, eq, ilike, inArray, isNull, or } from "drizzle-orm";

const SOCCER_TEAM = "e2da9c36-af84-40a0-a769-d31368f77c46"; // Legacy Black 2014
const BASKETBALL_TEAM = "be3f681b-63ff-45f0-bc84-4e84e6f04c81"; // Varsity Boys Basketball

const SAMIRA = "09ff98fd-9909-4720-bbdf-26c735e9bdf9";
const LISA = "964b4f02-cb4d-43a8-a918-193ad3f3a704"; // Lisa Carter (soccer)
const MARCUS = "48708568-6af8-467e-ae3e-d7cfd032be6d"; // Marcus Rivera (coach)
const DANIELA = "4d1c00c8-2f0f-4020-8672-5d7c5032138b"; // Daniela Ortiz (basketball)
const FOOTBALL_TEAM = "182275b6-ff4c-4e63-9534-d72933e0da6e"; // Varsity Football
const DEMO_TEAMS = [SOCCER_TEAM, BASKETBALL_TEAM, FOOTBALL_TEAM];

// Junk demo recaps that don't contain "test"/"edit" in the title but are still
// throwaway rows that look broken on camera. Hidden alongside the pattern match.
const JUNK_TITLES = [
  "multiple photos on post",
  "recap notification approval",
  "big win",
  "Samira game winning goal yay",
];

type Recap = {
  teamId: string;
  authorId: string;
  title: string;
  summary: string;
  body: string;
  opponentName: string;
  teamScore: number;
  opponentScore: number;
  gameDate: string; // ISO date
  tag: string[]; // extra users to tag besides Samira
};

const RECAPS: Recap[] = [
  // ---- Soccer: Legacy Black 2014 ----
  {
    teamId: SOCCER_TEAM,
    authorId: MARCUS,
    title: "Legacy Black Battle Back to Win the Middletown Cup",
    summary: "Down 1-0 at the half, the squad roared back for a 3-2 stoppage-time classic.",
    body: "It looked grim at the half. Trailing 1-0 and pinned in their own end, Legacy Black 2014 needed a spark — and Samira Carter delivered. Two second-half goals and a cool finish in stoppage time sealed a 3-2 comeback and the Middletown Cup. The back line held firm down the stretch, and the bench erupted as the final whistle blew on the program's biggest win of the spring.",
    opponentName: "Riverside United",
    teamScore: 3,
    opponentScore: 2,
    gameDate: "2026-05-24",
    tag: [LISA, MARCUS],
  },
  {
    teamId: SOCCER_TEAM,
    authorId: MARCUS,
    title: "Clean Sheet Caps Statement Road Win",
    summary: "A disciplined defensive shift and a clinical first half make it three straight.",
    body: "Legacy Black 2014 traveled to a hostile pitch and never blinked. An early Lisa Carter strike set the tone, and the defense did the rest, smothering every counter for a 2-0 shutout. Three wins in a row, and the group is peaking at the right time.",
    opponentName: "Hilltop FC",
    teamScore: 2,
    opponentScore: 0,
    gameDate: "2026-05-17",
    tag: [LISA],
  },
  {
    teamId: SOCCER_TEAM,
    authorId: MARCUS,
    title: "Late Equalizer Earns a Hard-Fought Draw",
    summary: "Samira's header in the 88th rescues a point against the league leaders.",
    body: "Against the toughest opponent on the schedule, Legacy Black 2014 refused to fold. Samira Carter rose highest off a corner in the 88th minute to level it, 1-1, and the team weathered a frantic finish to walk away with a deserved point.",
    opponentName: "North Valley SC",
    teamScore: 1,
    opponentScore: 1,
    gameDate: "2026-05-10",
    tag: [LISA, MARCUS],
  },
  {
    teamId: SOCCER_TEAM,
    authorId: MARCUS,
    title: "Five-Goal Flurry Lights Up the Home Opener",
    summary: "A dominant attacking display gives the home crowd plenty to cheer.",
    body: "From the opening whistle it was all Legacy Black. Crisp passing, relentless pressing, and five different scorers powered a 5-1 rout in the home opener. A complete team performance and a statement to the rest of the division.",
    opponentName: "Eastgate Athletic",
    teamScore: 5,
    opponentScore: 1,
    gameDate: "2026-04-26",
    tag: [LISA],
  },
  {
    teamId: SOCCER_TEAM,
    authorId: MARCUS,
    title: "Penalty Shootout Heroics Send Legacy Through",
    summary: "Nerves of steel in the shootout after a 1-1 stalemate over 80 minutes.",
    body: "Eighty minutes couldn't separate them, so it came down to spot kicks. Legacy Black 2014 buried four straight, and a fingertip save from the keeper sealed passage to the semifinal. A night nobody on the roster will forget.",
    opponentName: "Summit City",
    teamScore: 1,
    opponentScore: 1,
    gameDate: "2026-04-12",
    tag: [LISA, MARCUS],
  },
  {
    teamId: SOCCER_TEAM,
    authorId: MARCUS,
    title: "Grit and Grind in a Muddy Season Opener",
    summary: "A scrappy 2-1 win on a rain-soaked pitch kicks off the campaign.",
    body: "Conditions were miserable and the ball barely rolled, but Legacy Black 2014 found a way. Two set-piece goals and a heroic goal-line clearance secured a 2-1 opening-day win and set the tone for the season to come.",
    opponentName: "Lakeside Rovers",
    teamScore: 2,
    opponentScore: 1,
    gameDate: "2026-03-29",
    tag: [LISA],
  },
  // ---- Basketball: Varsity Boys Basketball (Samira's multi-sport story) ----
  {
    teamId: BASKETBALL_TEAM,
    authorId: DANIELA,
    title: "Buzzer-Beater Lifts Varsity in the City Final",
    summary: "A contested three at the horn caps a 58-56 thriller for the title.",
    body: "Tied at 56 with the clock winding down, Varsity ran their out-of-bounds set to perfection. The shot went up, the horn sounded, and the gym exploded — 58-56, city champions. Samira Carter's two-way effort in the fourth quarter set the stage for the game-winner.",
    opponentName: "Central Prep",
    teamScore: 58,
    opponentScore: 56,
    gameDate: "2026-05-20",
    tag: [DANIELA],
  },
  {
    teamId: BASKETBALL_TEAM,
    authorId: DANIELA,
    title: "Defense Travels in a Wire-to-Wire Win",
    summary: "A lockdown second half turns a close game into a comfortable road victory.",
    body: "Varsity clamped down after the break, forcing turnover after turnover and turning defense into easy transition buckets. A 64-49 win that was closer than the final score suggests — until the defense took over.",
    opponentName: "Westwood Academy",
    teamScore: 64,
    opponentScore: 49,
    gameDate: "2026-05-13",
    tag: [DANIELA],
  },
  {
    teamId: BASKETBALL_TEAM,
    authorId: DANIELA,
    title: "Fourth-Quarter Surge Erases a Double-Digit Deficit",
    summary: "Down 12 entering the fourth, Varsity storms back for a signature win.",
    body: "It looked over. Down a dozen with eight minutes to play, Varsity found another gear — a 20-4 run powered by relentless pressure and timely shooting flipped the game. A gutsy 71-67 comeback that the bench will talk about all season.",
    opponentName: "Maple Ridge",
    teamScore: 71,
    opponentScore: 67,
    gameDate: "2026-04-30",
    tag: [DANIELA],
  },
  {
    teamId: BASKETBALL_TEAM,
    authorId: DANIELA,
    title: "Balanced Attack Cruises in Conference Opener",
    summary: "Five players in double figures in a wire-to-wire conference win.",
    body: "Sharing the ball and sharing the load, Varsity opened conference play with a polished 68-55 performance. Five players reached double figures and the ball movement was a clinic from start to finish.",
    opponentName: "Brookfield",
    teamScore: 68,
    opponentScore: 55,
    gameDate: "2026-04-15",
    tag: [DANIELA],
  },
];

async function main() {
  // 1. Hide the junk test/edit recaps on the soccer team so they don't show.
  const hidden = await db
    .update(articles)
    .set({ hiddenAt: new Date() })
    .where(
      and(
        inArray(articles.teamId, DEMO_TEAMS),
        or(
          ilike(articles.title, "%test%"),
          ilike(articles.title, "%edit%"),
          inArray(articles.title, JUNK_TITLES),
        ),
      ),
    )
    .returning({ id: articles.id });
  console.log(`Hid ${hidden.length} junk articles.`);

  // 2. Re-seed curated recaps (idempotent: delete by team+title, then insert).
  let inserted = 0;
  for (const r of RECAPS) {
    await db
      .delete(articles)
      .where(and(eq(articles.teamId, r.teamId), eq(articles.title, r.title)));

    const [row] = await db
      .insert(articles)
      .values({
        teamId: r.teamId,
        authorId: r.authorId,
        title: r.title,
        summary: r.summary,
        body: r.body,
        opponentName: r.opponentName,
        teamScore: r.teamScore,
        opponentScore: r.opponentScore,
        gameDate: new Date(`${r.gameDate}T12:00:00`),
        status: "published",
        publishedAt: new Date(`${r.gameDate}T15:00:00`),
      })
      .returning({ id: articles.id });

    const tagUsers = Array.from(new Set([SAMIRA, ...r.tag]));
    for (const userId of tagUsers) {
      await db.insert(articleTags).values({
        articleId: row.id,
        userId,
        taggerUserId: r.authorId,
        status: "approved",
        source: "manual",
      });
    }
    inserted += 1;
  }
  console.log(`Seeded ${inserted} curated recaps with tags.`);

  // 2b. Hide the demo highlights. Every highlight in this demo DB has broken
  // media (placeholder / dead video URLs) that renders as an ugly black box in
  // the walkthrough. Hiding the ones that surface on the captured pages (the
  // demo teams + anything tagging Samira) leaves clean recap walls.
  const hiddenHl = await db
    .update(highlights)
    .set({ hiddenAt: new Date() })
    .where(
      and(
        isNull(highlights.hiddenAt),
        or(
          inArray(highlights.teamId, DEMO_TEAMS),
          inArray(
            highlights.id,
            db
              .select({ id: highlightTags.highlightId })
              .from(highlightTags)
              .where(eq(highlightTags.userId, SAMIRA)),
          ),
        ),
      ),
    )
    .returning({ id: highlights.id });
  console.log(`Hid ${hiddenHl.length} demo highlights.`);

  // 3. Ensure Samira is rostered (accepted) on the soccer + basketball teams.
  // The profile team-filter is driven by GET /users/:id/teams (accepted roster
  // memberships only), so without this the multi-sport filter story can't show
  // soccer or basketball even though she's tagged in those recaps.
  const SAMIRA_ROSTERS = [
    { teamId: SOCCER_TEAM, position: "Forward", jerseyNumber: 7 },
    { teamId: BASKETBALL_TEAM, position: "Guard", jerseyNumber: 7 },
  ];
  for (const r of SAMIRA_ROSTERS) {
    await db
      .delete(rosterEntries)
      .where(and(eq(rosterEntries.userId, SAMIRA), eq(rosterEntries.teamId, r.teamId)));
    await db.insert(rosterEntries).values({
      teamId: r.teamId,
      userId: SAMIRA,
      role: "player",
      position: r.position,
      jerseyNumber: r.jerseyNumber,
      status: "accepted",
    });
  }
  console.log("Rostered Samira on soccer + basketball (accepted).");

  // 4. Make the demo player profile public so the owner capture renders fully.
  await db
    .update(users)
    .set({ profileVisibility: "public" })
    .where(inArray(users.id, [SAMIRA]));
  console.log("Set Samira Carter profile to public (demo).");

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
