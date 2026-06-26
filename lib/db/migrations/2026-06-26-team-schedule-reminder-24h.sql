-- Phase 2 — stamp for the durable ~24h-before reminder email sweep so it
-- never double-sends. Idempotent.
ALTER TABLE schedule_events
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at timestamptz;
