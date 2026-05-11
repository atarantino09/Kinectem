-- Task #472 — Archive/unarchive teams.
-- Add nullable archive columns on `teams`; extend admin enums to record
-- archive/unarchive actions in admin_activity_log. Idempotent.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'admin_action_type' AND e.enumlabel = 'archive_team'
  ) THEN
    ALTER TYPE admin_action_type ADD VALUE 'archive_team';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'admin_action_type' AND e.enumlabel = 'unarchive_team'
  ) THEN
    ALTER TYPE admin_action_type ADD VALUE 'unarchive_team';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'admin_target_type' AND e.enumlabel = 'team'
  ) THEN
    ALTER TYPE admin_target_type ADD VALUE 'team';
  END IF;
END$migration$;

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS archived_at timestamp,
  ADD COLUMN IF NOT EXISTS archived_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS teams_archived_at_idx
  ON teams (archived_at)
  WHERE archived_at IS NOT NULL;
