-- Per-team one-time secret "adopt this team into your org" capability token.
--
-- A solo team's coach generates this token and shares the resulting
-- `/adopt-team/<token>` link with their organization admin, who opens it and
-- reparents the team into one of their organizations. Stored in plaintext (a
-- re-displayable shareable invite link, NOT a password). Nullable: most teams
-- never get one. Cleared on successful adoption (one-time) and rotatable by
-- the coach to revoke an outstanding link. Idempotent — safe to re-run.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS adopt_token text;

-- Partial unique index so the many teams without a token don't collide on
-- NULL, while a live token still resolves to exactly one team.
CREATE UNIQUE INDEX IF NOT EXISTS teams_adopt_token_idx
  ON teams (adopt_token)
  WHERE adopt_token IS NOT NULL;
