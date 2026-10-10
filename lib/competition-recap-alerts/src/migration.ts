// Publication capture is transactional: all publishing routes (including
// organization approval) write the same articles table. Never sweep historical
// articles into mail. The ledger also prevents edits/republication re-alerting.
export const COMPETITION_RECAP_MIGRATION = { name: "competition_recap_review_alerts", sql: `
ALTER TABLE articles ADD COLUMN IF NOT EXISTS competition_reviewed_at timestamp,
 ADD COLUMN IF NOT EXISTS competition_reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS published_by_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS competition_recap_mode text NOT NULL DEFAULT 'digest',
 ADD COLUMN IF NOT EXISTS competition_recap_discard_before timestamp;
CREATE TABLE IF NOT EXISTS competition_recap_publications (
 article_id uuid PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
 competition_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS competition_recap_mail (
 article_id uuid NOT NULL REFERENCES competition_recap_publications(article_id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 target_ids uuid[] NOT NULL,
 mode text NOT NULL,
 window_start timestamp NOT NULL,
 finished_at timestamp,
 PRIMARY KEY(article_id,recipient_id)
);
CREATE INDEX IF NOT EXISTS competition_recap_mail_pending ON competition_recap_mail(recipient_id,window_start) WHERE finished_at IS NULL;
CREATE TABLE IF NOT EXISTS competition_recap_deliveries (
 recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 batch_key text NOT NULL,
 completed_at timestamp,
 attempts integer NOT NULL DEFAULT 0,
 retry_at timestamp NOT NULL DEFAULT now(),
 PRIMARY KEY(recipient_id,batch_key)
);
CREATE TABLE IF NOT EXISTS competition_recap_migration_marker (id boolean PRIMARY KEY DEFAULT true);
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM competition_recap_migration_marker) THEN
  UPDATE articles SET competition_reviewed_at=coalesce(published_at,created_at)
   WHERE featured AND competition_id IS NOT NULL AND status='published' AND article_kind='recap';
  INSERT INTO competition_recap_publications(article_id,competition_id,actor_id)
   SELECT id,competition_id,author_id FROM articles
   WHERE competition_id IS NOT NULL AND status='published'
   ON CONFLICT DO NOTHING;
  INSERT INTO competition_recap_migration_marker VALUES(true) ON CONFLICT DO NOTHING;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION competition_recap_admin_ids(cid uuid)
RETURNS TABLE(user_id uuid) LANGUAGE sql STABLE AS $$
 SELECT t.owner_user_id FROM tournaments t WHERE t.id=cid AND t.owner_user_id IS NOT NULL
 UNION SELECT t.created_by_id FROM tournaments t JOIN users u ON u.id=t.created_by_id
   WHERE t.id=cid AND t.owner_user_id IS NULL AND u.role <> 'admin'
 UNION SELECT ca.user_id FROM competition_admins ca WHERE ca.competition_id=cid
 UNION SELECT oa.user_id FROM organizer_admins oa JOIN tournaments t ON t.organizer_id=oa.organizer_id WHERE t.id=cid
 UNION SELECT o.owner_user_id FROM competition_organizers o JOIN tournaments t ON t.organizer_id=o.id WHERE t.id=cid
$$;

CREATE OR REPLACE FUNCTION competition_recap_window_start()
RETURNS timestamp LANGUAGE sql VOLATILE AS $$
 SELECT to_timestamp(floor(extract(epoch FROM clock_timestamp())/7200)*7200) AT TIME ZONE 'UTC'
$$;

CREATE OR REPLACE FUNCTION capture_competition_recap_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inserted_id uuid; target uuid; comp_slug text; comp_name text; team_label text; window_ts timestamp; actor uuid;
BEGIN
 IF NEW.status <> 'published' OR NEW.competition_id IS NULL OR NEW.article_kind <> 'recap'
  OR NEW.recap_kind IS NOT NULL OR NEW.historical IS NOT NULL OR NEW.hidden_at IS NOT NULL THEN RETURN NEW; END IF;
 -- Only a publication transition; linking/editing an already published recap is
 -- not a new publication. Private practice plans and historical/combined stories
 -- never enter this queue.
 IF TG_OP='UPDATE' THEN
  IF OLD.status='published' THEN RETURN NEW; END IF;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM teams t WHERE t.id=NEW.team_id AND t.archived_at IS NULL)
 OR (NEW.author_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=NEW.author_id
  AND u.profile_visibility='public' AND u.deleted_at IS NULL AND u.account_status='active'))
 OR EXISTS (SELECT 1 FROM takedown_requests tr WHERE tr.post_kind='article' AND tr.post_ref_id=NEW.id AND tr.status='pending')
 THEN RETURN NEW; END IF;
 actor := coalesce(NEW.published_by_id,NEW.author_id);
 -- A digest never closes a window while publication transactions for that
 -- window are still committing. Recheck the clock after waiting on its lock.
 LOOP
  window_ts := competition_recap_window_start();
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('competition-recap-window:'||window_ts::text,0));
  EXIT WHEN window_ts=competition_recap_window_start();
 END LOOP;
 INSERT INTO competition_recap_publications(article_id,competition_id,actor_id,created_at)
 VALUES(NEW.id,NEW.competition_id,actor,clock_timestamp() AT TIME ZONE 'UTC') ON CONFLICT DO NOTHING RETURNING article_id INTO inserted_id;
 IF inserted_id IS NULL THEN RETURN NEW; END IF;
 SELECT slug,name INTO comp_slug,comp_name FROM tournaments WHERE id=NEW.competition_id;
 SELECT name INTO team_label FROM teams WHERE id=NEW.team_id;
 FOR target IN SELECT a.user_id FROM competition_recap_admin_ids(NEW.competition_id) a
  JOIN users u ON u.id=a.user_id WHERE a.user_id IS DISTINCT FROM actor AND a.user_id IS DISTINCT FROM NEW.author_id
    AND u.deleted_at IS NULL AND u.account_status='active'
 LOOP
  INSERT INTO notifications(user_id,kind,message,link,actor_user_id)
   VALUES(target,'competition_recap_pending',team_label || ' posted a recap for ' || comp_name || ': "' || NEW.title || '". Review recaps.',
   '/competitions/' || NEW.competition_id || '?recaps=pending#recaps',actor);
 END LOOP;
 -- Resolve recipients before batching; overlapping roles and guardian routes
 -- collapse to one article per actual recipient. Snapshot the chosen mode.
 INSERT INTO competition_recap_mail(article_id,recipient_id,target_ids,mode,window_start)
 SELECT NEW.id,r.recipient_id,array_agg(DISTINCT r.target_id),coalesce(p.competition_recap_mode,'digest'),window_ts
 FROM (
  SELECT u.id target_id, CASE WHEN u.is_minor THEN gl.guardian_id ELSE u.id END recipient_id
  FROM competition_recap_admin_ids(NEW.competition_id) a JOIN users u ON u.id=a.user_id
  LEFT JOIN guardian_links gl ON gl.child_id=u.id AND gl.status='active' AND u.is_minor
  WHERE u.id IS DISTINCT FROM actor AND u.id IS DISTINCT FROM NEW.author_id
    AND u.deleted_at IS NULL AND u.account_status='active'
 ) r JOIN users recipient ON recipient.id=r.recipient_id
 LEFT JOIN notification_preferences p ON p.user_id=r.recipient_id
 WHERE r.recipient_id IS DISTINCT FROM actor AND r.recipient_id IS DISTINCT FROM NEW.author_id AND recipient.email IS NOT NULL
  AND NOT recipient.is_minor AND recipient.deleted_at IS NULL AND recipient.account_status='active'
  AND NOT coalesce(p.pause_all,false) AND coalesce(p.competition_recap_mode,'digest') <> 'off'
 GROUP BY r.recipient_id,p.competition_recap_mode
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS competition_recap_publication ON articles;
CREATE TRIGGER competition_recap_publication AFTER INSERT OR UPDATE OF status ON articles
 FOR EACH ROW EXECUTE FUNCTION capture_competition_recap_publication();
` };
