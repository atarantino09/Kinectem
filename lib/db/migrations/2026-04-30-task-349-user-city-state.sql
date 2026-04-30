-- Task #349 — Add city + 2-letter US state postal code columns to users.
-- Idempotent. Mirrors the inline migration in
-- artifacts/api-server/src/lib/migrations.ts so ops can review.
--
-- Lets users put a US-only location on their profile (rendered as
-- "City, ST" in the profile hero). Both columns are nullable with no
-- backfill — existing users without a location simply have NULL on
-- both fields and continue to render with no location string.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS city  text,
  ADD COLUMN IF NOT EXISTS state text;
