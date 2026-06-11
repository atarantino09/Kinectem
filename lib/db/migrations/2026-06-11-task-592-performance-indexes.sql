-- Task #592 — Add DB indexes and fix slow API queries.
--
-- The API server was running sequential table scans on hot read paths
-- (feed, profiles, teams, search) because foreign-key and filter columns
-- lacked indexes, and the cross-entity search ran `ilike '%q%'` scans
-- against whole tables. This migration adds:
--
--   1. The `pg_trgm` extension + trigram GIN indexes so the `ilike
--      '%q%'` name/email matches in /search become index-backed.
--   2. B-tree indexes on the foreign-key / filter columns that drive the
--      feed fan-in, profile reads, team/org joins, and stat lookups.
--
-- Every statement is `IF NOT EXISTS`, so the whole script is idempotent
-- and safe to re-run. Apply with:
--   psql "$DATABASE_URL" \
--     -f lib/db/migrations/2026-06-11-task-592-performance-indexes.sql
-- The corresponding Drizzle schema (lib/db/src/schema/index.ts) declares
-- the same indexes so `drizzle-kit push` stays a no-op afterwards.

BEGIN;

-- 1) Trigram search support. `pg_trgm` ships with Postgres; the GIN
--    indexes let `name ILIKE '%q%'` / `email ILIKE '%q%'` use an index
--    instead of scanning the table.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS users_name_trgm_idx
  ON users USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_email_trgm_idx
  ON users USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS organizations_name_trgm_idx
  ON organizations USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS teams_name_trgm_idx
  ON teams USING gin (name gin_trgm_ops);

-- 2) Foreign-key / filter column b-tree indexes.

-- teams: team→org join is on every team read path.
CREATE INDEX IF NOT EXISTS teams_organization_id_idx
  ON teams (organization_id);

-- articles / highlights / org_posts: feed + profile + team/org joins.
CREATE INDEX IF NOT EXISTS articles_team_id_idx
  ON articles (team_id);
CREATE INDEX IF NOT EXISTS articles_author_id_idx
  ON articles (author_id);
CREATE INDEX IF NOT EXISTS highlights_team_id_idx
  ON highlights (team_id);
CREATE INDEX IF NOT EXISTS highlights_uploader_id_idx
  ON highlights (uploader_id);
CREATE INDEX IF NOT EXISTS org_posts_organization_id_idx
  ON org_posts (organization_id);
CREATE INDEX IF NOT EXISTS org_posts_author_id_idx
  ON org_posts (author_id);

-- roster_entries: team roster reads (team_id) + "this user's teams"
-- profile reads (user_id).
CREATE INDEX IF NOT EXISTS roster_entries_team_id_idx
  ON roster_entries (team_id);
CREATE INDEX IF NOT EXISTS roster_entries_user_id_idx
  ON roster_entries (user_id);

-- Follow mapping tables. Each composite PK leads with the *target* id
-- (team/org/following user), so the feed fan-in keyed by the *viewer*
-- needs a dedicated index on the membership column.
CREATE INDEX IF NOT EXISTS team_followers_user_id_idx
  ON team_followers (user_id);
CREATE INDEX IF NOT EXISTS organization_followers_user_id_idx
  ON organization_followers (user_id);
CREATE INDEX IF NOT EXISTS user_followers_follower_user_id_idx
  ON user_followers (follower_user_id);
CREATE INDEX IF NOT EXISTS organization_admins_user_id_idx
  ON organization_admins (user_id);

-- Tag tables: tagged-users-for-a-post lookups (article_id/highlight_id)
-- + feed "content tagging users I follow" (user_id).
CREATE INDEX IF NOT EXISTS article_tags_article_id_idx
  ON article_tags (article_id);
CREATE INDEX IF NOT EXISTS article_tags_user_id_idx
  ON article_tags (user_id);
CREATE INDEX IF NOT EXISTS highlight_tags_highlight_id_idx
  ON highlight_tags (highlight_id);
CREATE INDEX IF NOT EXISTS highlight_tags_user_id_idx
  ON highlight_tags (user_id);

-- post_shares: unique index leads with post_kind, so the feed's
-- "shares by users I follow" (sharer_user_id only) needs its own index.
CREATE INDEX IF NOT EXISTS post_shares_sharer_user_id_idx
  ON post_shares (sharer_user_id);

-- post_comments: comment listing + comment-count stats filter on
-- (post_kind, post_ref_id).
CREATE INDEX IF NOT EXISTS post_comments_kind_ref_idx
  ON post_comments (post_kind, post_ref_id);

-- notifications: bell list + unread count, ordered newest-first.
CREATE INDEX IF NOT EXISTS notifications_user_id_created_at_idx
  ON notifications (user_id, created_at DESC);

-- Invite tables: pending invites listed per team/org + matched by email.
CREATE INDEX IF NOT EXISTS roster_invites_team_id_idx
  ON roster_invites (team_id);
CREATE INDEX IF NOT EXISTS roster_invites_invited_email_idx
  ON roster_invites (invited_email);
CREATE INDEX IF NOT EXISTS organization_invites_organization_id_idx
  ON organization_invites (organization_id);
CREATE INDEX IF NOT EXISTS organization_invites_invited_email_idx
  ON organization_invites (invited_email);

COMMIT;
