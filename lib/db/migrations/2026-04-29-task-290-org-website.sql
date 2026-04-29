-- Task #290 — Add website column to organizations.
-- Idempotent. Mirrors the inline migration in
-- artifacts/api-server/src/lib/migrations.ts so ops can review.
--
-- The OpenAPI response and frontend have always expected the
-- organizations table to expose a `website` column, but the column
-- itself was never added. The previous create-org endpoint passed
-- `website: req.body.website` to drizzle, which silently dropped the
-- unknown field. Adding the column unbreaks that path. Kept nullable
-- so existing rows are unaffected — there is no backfill.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS website text;
