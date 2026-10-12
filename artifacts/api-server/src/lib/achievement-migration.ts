import { ACHIEVEMENT_CATALOG } from "./achievement-catalog";
const catalogRows = ACHIEVEMENT_CATALOG.flatMap((item) => item.thresholds.map((threshold, i) =>
   `('${item.subject}','${item.key}','${item.metric}',${i + 1},${threshold},${ACHIEVEMENT_CATALOG.indexOf(item)})`,
)).join(",");
// Capture attribution in the content transaction, not in a later HTTP callback.
// Ledger identity is a persisted contribution, never a content hash.
export const ACHIEVEMENT_MIGRATION = {
  name: "community-achievements",
  sql: `
ALTER TABLE articles ADD COLUMN IF NOT EXISTS previous_season jsonb;
CREATE TABLE IF NOT EXISTS achievement_rollout (
  id boolean PRIMARY KEY DEFAULT true CHECK(id = true), started_at timestamptz NOT NULL DEFAULT now(),
  backfill_done boolean NOT NULL DEFAULT false
);
ALTER TABLE achievement_rollout ADD COLUMN IF NOT EXISTS backfill_done boolean NOT NULL DEFAULT false;
INSERT INTO achievement_rollout(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS achievement_contributions (
  kind text NOT NULL, ref_id uuid NOT NULL, author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  category text NOT NULL, eligible_at timestamptz NOT NULL,
  personal_eligible boolean NOT NULL DEFAULT false, backfilled boolean NOT NULL DEFAULT false,
  org_attribution_captured boolean NOT NULL DEFAULT false,
  PRIMARY KEY(kind,ref_id)
);
ALTER TABLE achievement_contributions ADD COLUMN IF NOT EXISTS org_attribution_captured boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS achievement_contributions_team ON achievement_contributions(team_id);
CREATE INDEX IF NOT EXISTS achievement_contributions_author ON achievement_contributions(author_id);
CREATE INDEX IF NOT EXISTS achievement_contributions_org ON achievement_contributions(organization_id);
CREATE TABLE IF NOT EXISTS achievement_awards (
  subject text NOT NULL, subject_id uuid NOT NULL, key text NOT NULL, tier int NOT NULL,
  threshold int NOT NULL, earned_at timestamptz NOT NULL DEFAULT now(),
  celebrated boolean NOT NULL DEFAULT false, PRIMARY KEY(subject,subject_id,key,tier)
);
CREATE TABLE IF NOT EXISTS achievement_settings (
  subject text NOT NULL, subject_id uuid NOT NULL, visibility text NOT NULL DEFAULT 'public',
  featured text[] NOT NULL DEFAULT '{}', PRIMARY KEY(subject,subject_id),
  CHECK(visibility IN ('private','public'))
);
-- Data-only transition: old team/org visibility was ignored. A marker makes
-- subsequent explicit Private choices survive every bootstrap/restart.
CREATE TABLE IF NOT EXISTS one_time_migration_markers (
 name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('achievement-evaluation',0));
 IF NOT EXISTS(SELECT 1 FROM one_time_migration_markers WHERE name='achievement-subject-privacy') THEN
   -- A missing legacy personal row also meant Private. Materialize that
   -- default without exposing or featuring any already-earned badges.
   INSERT INTO achievement_settings(subject,subject_id,visibility)
     SELECT DISTINCT subject,subject_id,'private' FROM achievement_awards WHERE subject='user'
     ON CONFLICT DO NOTHING;
   UPDATE achievement_settings SET visibility='public' WHERE subject IN ('team','organization');
   INSERT INTO one_time_migration_markers(name) VALUES('achievement-subject-privacy');
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS achievement_streaks (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  contributor_id text NOT NULL, current_count int NOT NULL DEFAULT 0, best int NOT NULL DEFAULT 0,
  last_day date, deadline timestamptz, paused boolean NOT NULL DEFAULT false,
  resumed boolean NOT NULL DEFAULT false, PRIMARY KEY(team_id,contributor_id)
);
CREATE TABLE IF NOT EXISTS achievement_streak_events (
  article_id uuid PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS achievement_pauses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 attested_by uuid REFERENCES users(id) ON DELETE SET NULL,
 attested_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW achievement_live_contributions AS
 SELECT c.kind,c.ref_id,c.author_id,c.team_id,c.organization_id,c.category,c.eligible_at,c.personal_eligible,c.backfilled,
    CASE WHEN a.article_kind='practice_plan' THEN 'plan'
    WHEN a.previous_season IS NOT NULL THEN 'retro'
    WHEN a.game_date IS NOT NULL OR a.recap_kind='combined' THEN 'current' ELSE 'update' END AS live_category,
    (a.article_kind<>'practice_plan' AND u.profile_visibility='public' AND u.account_status='active' AND u.deleted_at IS NULL) AS is_public,
    (a.article_kind<>'practice_plan' AND a.recap_kind IS DISTINCT FROM 'historical'
      AND (a.game_date IS NOT NULL OR a.recap_kind='combined' OR a.previous_season IS NOT NULL)
      AND (cardinality(a.photo_urls)>0 OR (a.cover_image_url IS NOT NULL AND a.cover_image_url<>'' AND a.cover_image_url NOT LIKE '%historical-clippings%')
      OR EXISTS(SELECT 1 FROM album_photos p JOIN assets x ON x.id=p.asset_id
        WHERE p.post_kind='article' AND p.post_ref_id=a.id AND x.file_type LIKE 'image/%' AND x.status='confirmed'))) AS has_photos
 FROM achievement_contributions c JOIN articles a ON c.kind='article' AND c.ref_id=a.id
 JOIN users u ON u.id=c.author_id
 WHERE a.status='published' AND a.hidden_at IS NULL AND a.recap_kind IS DISTINCT FROM 'historical'
   AND NOT EXISTS(SELECT 1 FROM takedown_requests r WHERE r.post_kind='article' AND r.post_ref_id=a.id AND r.status='pending')
 UNION ALL
 SELECT c.kind,c.ref_id,c.author_id,c.team_id,c.organization_id,c.category,c.eligible_at,c.personal_eligible,c.backfilled,
    'org_update' AS live_category, true AS is_public, false AS has_photos
 FROM achievement_contributions c JOIN org_posts p ON c.kind='org_post' AND c.ref_id=p.id
 WHERE p.status='published' AND p.hidden_at IS NULL AND p.recap_kind IS DISTINCT FROM 'historical'
   AND NOT EXISTS(SELECT 1 FROM takedown_requests r WHERE r.post_kind='org_post' AND r.post_ref_id=p.id AND r.status='pending');
CREATE OR REPLACE FUNCTION achievement_metrics(p_subject text,p_id uuid)
RETURNS TABLE(metric text,value int) LANGUAGE sql AS $$
 WITH eligible AS (
  SELECT * FROM achievement_live_contributions c WHERE
    (p_subject='user' AND c.author_id=p_id AND c.personal_eligible)
    OR (p_subject='team' AND c.team_id=p_id)
    OR (p_subject='organization' AND c.organization_id=p_id AND c.is_public)
 ), participation AS (
  SELECT t.id, EXISTS(SELECT 1 FROM achievement_live_contributions c
    WHERE c.team_id=t.id AND c.organization_id=p_id AND c.is_public AND c.live_category IN ('current','update')
      AND c.eligible_at>=now()-interval '30 days') AS participating
  FROM teams t WHERE t.organization_id=p_id AND t.archived_at IS NULL
    AND EXISTS(SELECT 1 FROM achievement_live_contributions c WHERE c.team_id=t.id AND c.organization_id=p_id AND c.is_public
      AND c.live_category IN ('current','update') AND c.eligible_at>=now()-interval '90 days')
 )
 SELECT 'current',count(*)::int FROM eligible WHERE live_category='current'
 UNION ALL SELECT 'updates',count(*)::int FROM eligible WHERE live_category IN ('update','plan')
 UNION ALL SELECT 'retro',count(*)::int FROM eligible WHERE live_category='retro'
 UNION ALL SELECT 'photos',count(*)::int FROM eligible WHERE has_photos
 UNION ALL SELECT 'story',count(*)::int FROM eligible WHERE live_category IN ('current','org_update')
 UNION ALL SELECT 'participation',CASE WHEN count(*) FILTER(WHERE participating)>=2
    THEN floor(100.0*count(*) FILTER(WHERE participating)/nullif(count(*),0))::int ELSE 0 END FROM participation
 UNION ALL SELECT 'streak',coalesce(max(best),0)::int FROM achievement_streaks
   WHERE (p_subject='user' AND contributor_id=p_id::text)
     OR (p_subject='team' AND team_id=p_id AND contributor_id='team');
$$;
CREATE OR REPLACE FUNCTION achievement_evaluate(p_subject text,p_id uuid,p_quiet boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE new_keys text[];
BEGIN
  -- Same lock as settings writes, including when there is no settings row yet.
  PERFORM pg_advisory_xact_lock(hashtextextended('achievement-settings:'||p_subject||':'||p_id,0));
  WITH candidates AS (
    SELECT c.* FROM (VALUES ${catalogRows}) AS c(subject,key,metric,tier,threshold,ordinal)
    JOIN achievement_metrics(p_subject,p_id) m ON m.metric=c.metric
    WHERE c.subject=p_subject AND m.value>=c.threshold
  ), first_keys AS (
    SELECT DISTINCT c.key,c.ordinal FROM candidates c WHERE NOT EXISTS(
      SELECT 1 FROM achievement_awards a WHERE a.subject=p_subject AND a.subject_id=p_id AND a.key=c.key)
  ), inserted AS (
    INSERT INTO achievement_awards(subject,subject_id,key,tier,threshold,celebrated)
    SELECT p_subject,p_id,c.key,c.tier,c.threshold,p_quiet FROM candidates c
    ON CONFLICT DO NOTHING RETURNING key
  )
  SELECT array_agg(f.key ORDER BY f.ordinal) INTO new_keys FROM first_keys f
    WHERE EXISTS(SELECT 1 FROM inserted i WHERE i.key=f.key);
  IF new_keys IS NOT NULL THEN
    INSERT INTO achievement_settings(subject,subject_id,visibility,featured)
      VALUES(p_subject,p_id,CASE WHEN p_quiet AND p_subject='user' THEN 'private' ELSE 'public' END,
        CASE WHEN p_quiet THEN '{}'::text[] ELSE new_keys END)
    ON CONFLICT(subject,subject_id) DO UPDATE SET featured=achievement_settings.featured ||
      ARRAY(SELECT k FROM unnest(CASE WHEN p_quiet THEN '{}'::text[] ELSE new_keys END) k
        WHERE NOT k=ANY(achievement_settings.featured));
  END IF;
END $$;
CREATE OR REPLACE FUNCTION achievement_advance(p_team uuid,p_person text,p_at timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s achievement_streaks; n int; d date := (p_at AT TIME ZONE 'UTC')::date;
BEGIN
  INSERT INTO achievement_streaks(team_id,contributor_id) VALUES(p_team,p_person) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM achievement_streaks WHERE team_id=p_team AND contributor_id=p_person FOR UPDATE;
  IF s.last_day=d AND NOT s.paused THEN RETURN; END IF;
  IF s.last_day=d THEN
    UPDATE achievement_streaks SET paused=false,resumed=true,
      deadline=(d+11)::timestamp AT TIME ZONE 'UTC' - interval '1 microsecond'
      WHERE team_id=p_team AND contributor_id=p_person;
    RETURN;
  END IF;
  n := CASE WHEN s.paused OR s.deadline>=p_at THEN s.current_count+1 ELSE 1 END;
  UPDATE achievement_streaks SET current_count=n,best=greatest(best,n),last_day=d,
    deadline=(d+11)::timestamp AT TIME ZONE 'UTC' - interval '1 microsecond',
    paused=false,resumed=s.paused WHERE team_id=p_team AND contributor_id=p_person;
END $$;
CREATE OR REPLACE FUNCTION achievement_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cat text; org uuid; personal boolean; inserted_id uuid; event_id uuid;
BEGIN
  IF NEW.status<>'published' OR NEW.hidden_at IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('achievement-evaluation',0));
  IF TG_TABLE_NAME='articles' THEN
    IF NEW.recap_kind='historical' THEN RETURN NEW; END IF;
    cat := CASE WHEN NEW.article_kind='practice_plan' THEN 'plan'
      WHEN NEW.previous_season IS NOT NULL THEN 'retro'
      WHEN NEW.game_date IS NOT NULL OR NEW.recap_kind='combined' THEN 'current' ELSE 'update' END;
    SELECT organization_id INTO org FROM teams WHERE id=NEW.team_id;
    SELECT NOT u.is_minor AND u.role<>'admin' AND u.account_status='active' AND u.deleted_at IS NULL
      AND (u.date_of_birth IS NULL OR u.date_of_birth<=now()-interval '18 years')
      AND (EXISTS(SELECT 1 FROM roster_entries r WHERE r.team_id=NEW.team_id AND r.user_id=u.id
        AND r.status='accepted' AND (r.role='coach' OR r.position IN ('author','manager','assistant_coach','head_coach')))
        OR EXISTS(SELECT 1 FROM organization_admins oa WHERE oa.organization_id=org AND oa.user_id=u.id AND oa.role IN ('owner','admin'))
        OR EXISTS(SELECT 1 FROM teams t WHERE t.id=NEW.team_id AND t.created_by_id=u.id AND t.organization_id IS NULL))
      INTO personal FROM users u WHERE u.id=NEW.author_id;
    INSERT INTO achievement_contributions(kind,ref_id,author_id,team_id,organization_id,category,eligible_at,personal_eligible,org_attribution_captured)
      VALUES('article',NEW.id,NEW.author_id,NEW.team_id,CASE WHEN cat IN ('current','update') THEN org ELSE NULL END,
        cat,now(),coalesce(personal,false),cat IN ('current','update'))
      ON CONFLICT DO NOTHING RETURNING ref_id INTO inserted_id;
    IF cat IN ('current','update') THEN
      UPDATE achievement_contributions SET organization_id=org,org_attribution_captured=true
        WHERE kind='article' AND ref_id=NEW.id AND NOT org_attribution_captured AND NOT backfilled;
    END IF;
    -- Streaks begin at rollout and never replay historical work or publication retries.
    IF cat='current' AND inserted_id IS NOT NULL THEN
      INSERT INTO achievement_streak_events(article_id) VALUES(NEW.id) ON CONFLICT DO NOTHING RETURNING article_id INTO event_id;
      IF event_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('achievement-team:'||NEW.team_id,0));
        -- A team recap resumes associated contributor runs without crediting non-authors.
        UPDATE achievement_streaks SET paused=false,resumed=true,
          deadline=(((now() AT TIME ZONE 'UTC')::date+11)::timestamp AT TIME ZONE 'UTC')-interval '1 microsecond'
          WHERE team_id=NEW.team_id AND paused AND contributor_id<>'team'
            AND contributor_id<>coalesce(NEW.author_id::text,'');
        PERFORM achievement_advance(NEW.team_id,'team',now());
        IF personal THEN PERFORM achievement_advance(NEW.team_id,NEW.author_id::text,now()); END IF;
      END IF;
    END IF;
    PERFORM achievement_evaluate('team',NEW.team_id);
    IF personal THEN PERFORM achievement_evaluate('user',NEW.author_id); END IF;
    SELECT organization_id INTO org FROM achievement_contributions WHERE kind='article' AND ref_id=NEW.id;
    IF org IS NOT NULL THEN PERFORM achievement_evaluate('organization',org); END IF;
  ELSE
    IF NEW.recap_kind='historical' THEN RETURN NEW; END IF;
    INSERT INTO achievement_contributions(kind,ref_id,author_id,organization_id,category,eligible_at)
      VALUES('org_post',NEW.id,NEW.author_id,NEW.organization_id,'org_update',now()) ON CONFLICT DO NOTHING;
    PERFORM achievement_evaluate('organization',NEW.organization_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS achievement_capture ON articles;
CREATE TRIGGER achievement_capture AFTER INSERT OR UPDATE ON articles FOR EACH ROW EXECUTE FUNCTION achievement_capture();
DROP TRIGGER IF EXISTS achievement_capture ON org_posts;
CREATE TRIGGER achievement_capture AFTER INSERT OR UPDATE ON org_posts FOR EACH ROW EXECUTE FUNCTION achievement_capture();
-- No historical org affiliation or inferred retro markers. Historical awards are acknowledged.
DO $$ DECLARE item record; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('achievement-evaluation',0));
 IF (SELECT backfill_done FROM achievement_rollout WHERE id=true) THEN RETURN; END IF;
INSERT INTO achievement_contributions(kind,ref_id,author_id,team_id,category,eligible_at,personal_eligible,backfilled,org_attribution_captured)
 SELECT 'article',a.id,a.author_id,a.team_id,
  CASE WHEN a.article_kind='practice_plan' THEN 'plan' WHEN a.game_date IS NOT NULL OR a.recap_kind='combined' THEN 'current' ELSE 'update' END,
  coalesce(a.published_at,a.created_at),
  NOT u.is_minor AND u.role<>'admin' AND u.account_status='active' AND u.deleted_at IS NULL
    AND (u.date_of_birth IS NULL OR u.date_of_birth<=now()-interval '18 years')
    AND (EXISTS(SELECT 1 FROM roster_entries r WHERE r.team_id=a.team_id AND r.user_id=u.id
      AND r.status='accepted' AND (r.role='coach' OR r.position IN ('author','manager','assistant_coach','head_coach')))
      OR EXISTS(SELECT 1 FROM teams t WHERE t.id=a.team_id AND t.created_by_id=u.id AND t.organization_id IS NULL)
      OR EXISTS(SELECT 1 FROM teams t JOIN organization_admins oa ON oa.organization_id=t.organization_id
        WHERE t.id=a.team_id AND oa.user_id=u.id AND oa.role IN ('owner','admin'))),true,true
 FROM articles a JOIN users u ON u.id=a.author_id
 WHERE a.status='published' AND a.hidden_at IS NULL AND a.recap_kind IS DISTINCT FROM 'historical'
  AND a.previous_season IS NULL
  AND coalesce(a.published_at,a.created_at)<(SELECT started_at FROM achievement_rollout)
 ON CONFLICT DO NOTHING;
INSERT INTO achievement_contributions(kind,ref_id,author_id,organization_id,category,eligible_at,backfilled,org_attribution_captured)
 SELECT 'org_post',p.id,p.author_id,p.organization_id,'org_update',coalesce(p.published_at,p.created_at),true,true
 FROM org_posts p WHERE p.status='published' AND p.hidden_at IS NULL AND p.recap_kind IS DISTINCT FROM 'historical'
   AND coalesce(p.published_at,p.created_at)<(SELECT started_at FROM achievement_rollout)
 ON CONFLICT DO NOTHING;
 FOR item IN SELECT DISTINCT team_id FROM achievement_contributions WHERE backfilled AND team_id IS NOT NULL LOOP
  PERFORM achievement_evaluate('team',item.team_id,true);
 END LOOP;
 FOR item IN SELECT DISTINCT author_id FROM achievement_contributions WHERE backfilled AND personal_eligible LOOP
  PERFORM achievement_evaluate('user',item.author_id,true);
 END LOOP;
 FOR item IN SELECT DISTINCT organization_id FROM achievement_contributions WHERE backfilled AND organization_id IS NOT NULL LOOP
  PERFORM achievement_evaluate('organization',item.organization_id,true);
 END LOOP;
 UPDATE achievement_rollout SET backfill_done=true WHERE id=true;
END $$;
CREATE OR REPLACE FUNCTION achievement_album_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('achievement-evaluation',0));
 IF NEW.post_kind='article' THEN
  SELECT team_id INTO t FROM articles WHERE id=NEW.post_ref_id;
  IF t IS NOT NULL THEN PERFORM achievement_evaluate('team',t); END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS achievement_album_capture ON album_photos;
CREATE TRIGGER achievement_album_capture AFTER INSERT ON album_photos FOR EACH ROW EXECUTE FUNCTION achievement_album_capture();
`,
};
