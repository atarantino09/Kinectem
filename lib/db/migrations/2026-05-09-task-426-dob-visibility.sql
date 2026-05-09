-- Task #426 — Per-field birthday visibility control. Adds the
-- `date_of_birth_visibility` enum and the matching column on `users`.
-- Idempotent. Mirrors the inline migration in
-- artifacts/api-server/src/lib/migrations.ts so ops can review.
--
-- Default is `private` for every existing row, matching today's
-- behavior where birthday is only visible to self / linked guardian.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'date_of_birth_visibility'
  ) THEN
    CREATE TYPE date_of_birth_visibility AS ENUM ('private','followers','public');
  END IF;
END$migration$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS date_of_birth_visibility date_of_birth_visibility
    NOT NULL DEFAULT 'private';
