-- Add recap_kind marker to articles.
-- Idempotent. Mirrors the inline migration in
-- artifacts/api-server/src/lib/migrations.ts so ops can review.
--
-- Distinguishes a combined season/tournament recap (woven from many game
-- recaps) from a normal single-game recap. NULL = single game;
-- "combined" = multi-game recap. Drives a distinct post card pill.

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS recap_kind text;
