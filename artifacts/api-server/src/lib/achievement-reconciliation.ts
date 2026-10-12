import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { reconcileAchievementHistory } from "./achievement-history";

/** Publication/photo triggers are transactional: failure rolls back the write.
 * This sweep reconciles awards whose rolling participation changed without a
 * publication (for example a team move, archive, or a 90-day window expiring).
 * It never fabricates missing affiliation, publication dates or streak events.
 */
export async function reconcileAchievementAwards() {
  await reconcileAchievementHistory();
  const subjects = (await db.execute(sql`
    SELECT DISTINCT 'user' AS subject,author_id AS id FROM achievement_contributions WHERE personal_eligible AND author_id IS NOT NULL
    UNION SELECT 'team',id FROM teams
    UNION SELECT 'organization',id FROM organizations
  `)).rows as { subject: string; id: string }[];
  for (const subject of subjects) {
    await db.execute(sql`SELECT achievement_evaluate(${subject.subject},${subject.id}::uuid)`);
  }
}

export function startAchievementReconciliation() {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      await reconcileAchievementAwards();
    } catch (err) {
      logger.error({ err }, "Achievement reconciliation failed; the next sweep will retry");
    } finally {
      running = false;
    }
  };
  setTimeout(() => void sweep(), 30_000).unref();
  setInterval(() => void sweep(), 5 * 60_000).unref();
}
