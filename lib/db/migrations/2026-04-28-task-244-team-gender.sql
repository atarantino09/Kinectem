-- Task #244 — Add gender column to teams.
-- Idempotent. Mirrors the inline migration in
-- artifacts/api-server/src/lib/migrations.ts so ops can review.
--
-- Nullable so existing teams are unaffected. The create/edit team
-- endpoints validate the value against the allowed set
-- ("boys" / "girls" / "coed") but do not require it.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS gender text;
