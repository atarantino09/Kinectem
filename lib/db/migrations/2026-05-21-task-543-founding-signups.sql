-- Task #543 — Founding 100 signup capture. Standalone table for the
-- marketing site's "Join the Founding 100" CTA. Not linked to users
-- (these are pre-launch prospects, not platform accounts). Email is
-- stored lower-cased + unique so re-submits update in place.
CREATE TABLE IF NOT EXISTS founding_signups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name          text NOT NULL,
  admin_name        text NOT NULL,
  admin_email       text NOT NULL UNIQUE,
  role_title        text NOT NULL,
  estimated_teams   integer NOT NULL,
  estimated_players integer NOT NULL,
  sport             text,
  submitted_at      timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS founding_signups_submitted_at_idx
  ON founding_signups (submitted_at DESC);
