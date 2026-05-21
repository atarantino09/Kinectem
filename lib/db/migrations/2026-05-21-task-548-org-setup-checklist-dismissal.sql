-- Task #548 — Per-user-per-org dismissal of the org setup checklist.
-- Stored as a nullable timestamp on the existing organization_admins
-- membership row so we don't introduce a new table just to track an
-- ephemeral UI flag. NULL = checklist is visible; non-NULL = the user
-- dismissed it from this org's dashboard at that time. Re-opening the
-- checklist clears the column back to NULL. Idempotent.
ALTER TABLE organization_admins
  ADD COLUMN IF NOT EXISTS dismissed_setup_at timestamp;
