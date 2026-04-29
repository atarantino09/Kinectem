-- Task #293 — Add website column to users.
-- Idempotent. Mirrors the inline migration in
-- artifacts/api-server/src/lib/migrations.ts so ops can review.
--
-- Extends the friendly bare-domain → https:// website normalization that
-- task #290 added for organizations to user profiles. The OpenAPI
-- response and the profile edit dialog now expose a `website` field on
-- users; this column backs it. Kept nullable so existing rows are
-- unaffected — there is no backfill.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS website text;
