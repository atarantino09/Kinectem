-- Task #424 — Retire the personal website field on individual user
-- profiles. Team and organization website columns are unaffected.
-- Mirrors the inline migration in
-- artifacts/api-server/src/lib/migrations.ts so ops can review.
-- Idempotent.

ALTER TABLE users DROP COLUMN IF EXISTS website;
