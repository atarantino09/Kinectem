-- Team Schedule Phase 2 — per-athlete RSVP / availability for an event.
-- Idempotent: guarded CREATE TYPE, IF NOT EXISTS table/indexes. The unique
-- index on (event_id, athlete_id) makes a re-submit a last-write-wins upsert.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_rsvp_status') THEN
    CREATE TYPE schedule_rsvp_status AS ENUM ('going','maybe','out');
  END IF;
END$migration$;

CREATE TABLE IF NOT EXISTS schedule_event_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES schedule_events(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  responded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status schedule_rsvp_status NOT NULL,
  note text,
  responded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS schedule_event_rsvps_event_athlete_uq
  ON schedule_event_rsvps (event_id, athlete_id);
CREATE INDEX IF NOT EXISTS schedule_event_rsvps_event_id_idx
  ON schedule_event_rsvps (event_id);
CREATE INDEX IF NOT EXISTS schedule_event_rsvps_athlete_id_idx
  ON schedule_event_rsvps (athlete_id);
