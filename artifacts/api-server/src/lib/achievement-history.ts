import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Recover eligible pre-rollout posts missed by the original backfill. This is
 * data reconciliation only: no schema changes, invented affiliation, publication
 * events or historical streaks. Existing contribution snapshots remain intact.
 */
export async function reconcileAchievementHistory() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('achievement-evaluation',0))`);
    const result = await tx.execute(sql`
      WITH recovered_articles AS (
        INSERT INTO achievement_contributions
          (kind,ref_id,author_id,team_id,category,eligible_at,personal_eligible,backfilled,org_attribution_captured)
        SELECT 'article',a.id,a.author_id,a.team_id,
          CASE WHEN a.article_kind='practice_plan' THEN 'plan' WHEN a.previous_season IS NOT NULL THEN 'retro'
            WHEN a.game_date IS NOT NULL OR a.recap_kind='combined' THEN 'current' ELSE 'update' END,
          coalesce(a.published_at,a.created_at),
          coalesce(NOT u.is_minor AND u.role<>'admin' AND u.account_status='active' AND u.deleted_at IS NULL
            AND (u.date_of_birth IS NULL OR u.date_of_birth<=now()-interval '18 years')
            AND (EXISTS(SELECT 1 FROM roster_entries r WHERE r.team_id=a.team_id AND r.user_id=u.id
              AND r.status='accepted' AND (r.role='coach' OR r.position IN ('author','manager','assistant_coach','head_coach')))
              OR EXISTS(SELECT 1 FROM teams t WHERE t.id=a.team_id AND t.created_by_id=u.id AND t.organization_id IS NULL)
              OR EXISTS(SELECT 1 FROM teams t JOIN organization_admins oa ON oa.organization_id=t.organization_id
                WHERE t.id=a.team_id AND oa.user_id=u.id AND oa.role IN ('owner','admin'))),false),
          true,true
        FROM articles a LEFT JOIN users u ON u.id=a.author_id
        WHERE a.status='published' AND a.hidden_at IS NULL AND a.recap_kind IS DISTINCT FROM 'historical'
          AND coalesce(a.published_at,a.created_at)<(SELECT started_at FROM achievement_rollout WHERE id=true)
          AND NOT EXISTS(SELECT 1 FROM achievement_contributions c WHERE c.kind='article' AND c.ref_id=a.id)
          AND NOT EXISTS(SELECT 1 FROM takedown_requests r
            WHERE r.post_kind='article' AND r.post_ref_id=a.id AND r.status='pending')
        ON CONFLICT DO NOTHING
        RETURNING author_id,team_id,personal_eligible
      ), recovered_org_posts AS (
        INSERT INTO achievement_contributions
          (kind,ref_id,author_id,organization_id,category,eligible_at,backfilled,org_attribution_captured)
        SELECT 'org_post',p.id,p.author_id,p.organization_id,'org_update',
          coalesce(p.published_at,p.created_at),true,true
        FROM org_posts p
        WHERE p.status='published' AND p.hidden_at IS NULL AND p.recap_kind IS DISTINCT FROM 'historical'
          AND coalesce(p.published_at,p.created_at)<(SELECT started_at FROM achievement_rollout WHERE id=true)
          AND NOT EXISTS(SELECT 1 FROM achievement_contributions c WHERE c.kind='org_post' AND c.ref_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM takedown_requests r
            WHERE r.post_kind='org_post' AND r.post_ref_id=p.id AND r.status='pending')
        ON CONFLICT DO NOTHING
        RETURNING organization_id
      )
      SELECT 'user' AS subject,author_id AS id FROM recovered_articles WHERE personal_eligible AND author_id IS NOT NULL
      UNION SELECT 'team',team_id FROM recovered_articles WHERE team_id IS NOT NULL
      UNION SELECT 'organization',organization_id FROM recovered_org_posts WHERE organization_id IS NOT NULL
    `);
    for (const subject of result.rows as { subject: string; id: string }[]) {
      await tx.execute(sql`SELECT achievement_evaluate(${subject.subject},${subject.id}::uuid,true)`);
    }
  });
}
