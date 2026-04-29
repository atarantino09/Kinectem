-- Task #293 — Add website column to teams.
-- Idempotent. Mirrors the inline migration in
-- artifacts/api-server/src/lib/migrations.ts so ops can review.
--
-- Extends the friendly bare-domain → https:// website normalization that
-- task #290 added for organizations to teams. The OpenAPI response and
-- frontend now expose a `website` field on teams; this column backs it.
-- Kept nullable so existing rows are unaffected — there is no backfill.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS website text;
