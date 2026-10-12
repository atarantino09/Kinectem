import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ACHIEVEMENT_CATALOG } from "./achievement-catalog";

/**
 * Feature previously earned collections once. Quiet backfills used to leave
 * these empty. Preserve privacy and nonempty selections; subsequent manual
 * unfeaturing must survive both restarts and reconciliation.
 * Data only: the existing marker table is managed by the project's schema.
 */
export async function featureExistingAchievements() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('achievement-evaluation',0))`);
    const marker = "achievement-existing-badges-featured";
    if ((await tx.execute(sql`SELECT 1 FROM one_time_migration_markers WHERE name=${marker}`)).rows.length) return;
    const collections = (await tx.execute(sql`
      SELECT subject,subject_id AS id,array_agg(DISTINCT key) AS keys
      FROM achievement_awards GROUP BY subject,subject_id ORDER BY subject,subject_id
    `)).rows as { subject: string; id: string; keys: string[] }[];
    for (const collection of collections) {
      const keys = ACHIEVEMENT_CATALOG
        .filter((badge) => badge.subject === collection.subject && collection.keys.includes(badge.key))
        .map((badge) => badge.key);
      if (!keys.length) continue;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`achievement-settings:${collection.subject}:${collection.id}`},0))`);
      await tx.execute(sql`
        INSERT INTO achievement_settings(subject,subject_id,visibility,featured)
        VALUES(${collection.subject},${collection.id}::uuid,'public',
          ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)))
        ON CONFLICT(subject,subject_id) DO UPDATE SET featured=excluded.featured
          WHERE cardinality(achievement_settings.featured)=0
      `);
    }
    await tx.execute(sql`INSERT INTO one_time_migration_markers(name) VALUES(${marker})`);
  });
}
