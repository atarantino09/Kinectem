-- Phase 2 — final-score capture for completed game/scrimmage events, surfaced
-- in the members-only Season Results list. Nullable: a game can be completed
-- (recap linked) without a recorded score. Idempotent.
ALTER TABLE schedule_events
  ADD COLUMN IF NOT EXISTS score_team integer,
  ADD COLUMN IF NOT EXISTS score_opponent integer;
