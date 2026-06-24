// Demo seed for the ai-assist-walkthrough video capture.
//
// The walkthrough screenshots the new-post composer + the AI Assist dialog +
// the published "Tournament Win — Beat Hi Tempo 3-1" recap on the Parsippany
// Soccer Club "2014 boys Pre NPL" team. This script:
//   1. Ensures the capture user (Marcus, marcus@kinectem.demo) is an accepted
//      COACH on the Parsippany team, so the team shows up as an authorable team
//      in the composer's "post to team" picker and the AI Assist button renders.
//   2. Normalizes the existing recap's title/summary/body/score so the published
//      recap reads cleanly on camera and matches the polished copy the AI Assist
//      flow produces in the video.
//
// Idempotent: the roster entry is delete-then-insert by (user, team); the recap
// is updated in place by id.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run seed-ai-assist-demo
import { db, articles, rosterEntries } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const PARSIPPANY_TEAM = "bbc1dba6-c337-4862-8b11-16fd10df0242"; // 2014 boys Pre NPL
const MARCUS = "48708568-6af8-467e-ae3e-d7cfd032be6d"; // marcus@kinectem.demo
const RECAP = "1defc597-36dd-4343-bc04-2633f213f15f"; // Tournament win Beat Hi Tempo 3-1!!

// The polished recap copy. This is also the deterministic body the capture spec
// injects as the AI Assist suggestion (route intercept), so the published recap
// reads as the finished product of the AI Assist flow shown in the video.
const POLISHED_BODY =
  "What a way to close out the season. The 2014 boys Pre NPL squad battled to a 3-1 victory over Hi Tempo in the Gold Bracket final of the Legacy Summer Blast Off Tournament. From the opening whistle it was a complete team effort — relentless pressure up top, composure at the back, and the kind of grit that turns a good season into a memorable one. Tournament champions, and a finish this group will remember for a long time.";

const TITLE = "Tournament Win — Beat Hi Tempo 3-1";
const SUMMARY =
  "A complete team effort caps the season with a 3-1 Gold Bracket final win.";

async function main() {
  // 1. Ensure Marcus is an accepted coach on the Parsippany team so it surfaces
  //    as an authorable team in the composer picker (and AI Assist renders).
  await db
    .delete(rosterEntries)
    .where(
      and(
        eq(rosterEntries.userId, MARCUS),
        eq(rosterEntries.teamId, PARSIPPANY_TEAM),
      ),
    );
  await db.insert(rosterEntries).values({
    teamId: PARSIPPANY_TEAM,
    userId: MARCUS,
    role: "coach",
    position: "admin",
    status: "accepted",
  });
  console.log("Seeded Marcus as accepted coach on the Parsippany team.");

  // 2. Normalize the published recap so it reads cleanly on camera.
  const updated = await db
    .update(articles)
    .set({
      title: TITLE,
      summary: SUMMARY,
      body: POLISHED_BODY,
      opponentName: "Hi Tempo",
      teamScore: 3,
      opponentScore: 1,
      status: "published",
    })
    .where(eq(articles.id, RECAP))
    .returning({ id: articles.id });
  console.log(`Normalized ${updated.length} recap (${TITLE}).`);

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
