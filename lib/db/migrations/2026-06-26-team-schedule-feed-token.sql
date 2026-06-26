-- Phase 2 — unguessable per-team capability token for the read-only iCal
-- (.ics) subscription feed. Unique so a token resolves to exactly one team.
-- Idempotent.
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS schedule_feed_token text;
CREATE UNIQUE INDEX IF NOT EXISTS teams_schedule_feed_token_key
  ON teams (schedule_feed_token);
