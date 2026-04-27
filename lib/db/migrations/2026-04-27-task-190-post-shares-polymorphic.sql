-- Task #190 — Post-shares polymorphic migration
--
-- This project uses `drizzle-kit push`, which on its own would simply
-- DROP `post_shares.article_id` and ADD `(post_kind, post_ref_id)`,
-- losing every existing share row from task #162. This script bridges
-- the gap by:
--   1. Adding the new columns as NULLABLE (so existing rows survive).
--   2. Backfilling each legacy article-only row with
--      (post_kind='article', post_ref_id=article_id).
--   3. Promoting the new columns to NOT NULL.
--   4. Replacing the old (article_id, sharer_user_id) unique index
--      with the polymorphic (post_kind, post_ref_id, sharer_user_id)
--      unique index.
--   5. Dropping the old `article_id` FK column.
--
-- The whole script is idempotent: each step is gated on whether the
-- prior schema is still in place, so running it twice (or running it
-- after `drizzle-kit push` has already been applied) is a no-op.
--
-- Apply with:
--   psql "$DATABASE_URL" \
--     -f lib/db/migrations/2026-04-27-task-190-post-shares-polymorphic.sql
-- BEFORE running `pnpm --filter @workspace/db push`. After this script
-- runs cleanly, push will detect the schema is already in the desired
-- shape and skip the destructive column rewrite.

BEGIN;

-- 1) Make sure the post_kind enum exists. drizzle defines it elsewhere
--    in the schema, but if this script is the first thing to run on a
--    fresh deploy we still need it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'post_kind') THEN
    CREATE TYPE post_kind AS ENUM ('article', 'highlight', 'org_post');
  END IF;
END$$;

-- 2) Add the new polymorphic columns as nullable so the table stays
--    writable during the migration window.
ALTER TABLE post_shares
  ADD COLUMN IF NOT EXISTS post_kind   post_kind,
  ADD COLUMN IF NOT EXISTS post_ref_id uuid;

-- 3) Backfill existing rows from the legacy article_id column. Skip
--    cleanly if the legacy column has already been dropped.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'post_shares' AND column_name = 'article_id'
  ) THEN
    UPDATE post_shares
       SET post_kind   = 'article',
           post_ref_id = article_id
     WHERE post_kind IS NULL OR post_ref_id IS NULL;
  END IF;
END$$;

-- 4) Promote the new columns to NOT NULL once the backfill is done.
--    Guarded so we don't try to NOT NULL columns that still hold
--    legitimate NULLs (e.g. on a partial run).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM post_shares WHERE post_kind IS NULL OR post_ref_id IS NULL
  ) THEN
    ALTER TABLE post_shares
      ALTER COLUMN post_kind   SET NOT NULL,
      ALTER COLUMN post_ref_id SET NOT NULL;
  END IF;
END$$;

-- 5) Replace the old uniqueness constraint with the new polymorphic
--    one. Both index names are deterministic so we can drop by name.
CREATE UNIQUE INDEX IF NOT EXISTS post_shares_kind_ref_sharer_uniq
  ON post_shares (post_kind, post_ref_id, sharer_user_id);
DROP INDEX IF EXISTS post_shares_article_sharer_uniq;

-- 6) Finally, drop the old foreign-key column. Guarded so the script
--    is safe to re-run.
ALTER TABLE post_shares
  DROP COLUMN IF EXISTS article_id;

COMMIT;
