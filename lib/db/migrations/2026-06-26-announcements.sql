-- Platform-wide announcements shown as an in-app banner to every logged-in
-- user. Authored by platform admins. Idempotent: guarded CREATE TYPE +
-- IF NOT EXISTS table/index. Per-user dismissal is handled client-side.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'announcement_level') THEN
    CREATE TYPE announcement_level AS ENUM ('info','warning','success');
  END IF;
END$migration$;

CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  level announcement_level NOT NULL DEFAULT 'info',
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_active_idx ON announcements (active);
