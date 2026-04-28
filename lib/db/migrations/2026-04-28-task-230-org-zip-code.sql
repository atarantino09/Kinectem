-- Task #230 — Add zip_code column to organizations.
-- Idempotent. Mirrors the inline migration in
-- artifacts/api-server/src/lib/migrations.ts so ops can review.
--
-- Kept nullable in the database so existing rows are unaffected. The
-- create-organization endpoint enforces presence on new orgs only.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS zip_code text;
