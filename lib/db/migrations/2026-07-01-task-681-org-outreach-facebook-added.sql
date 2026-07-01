-- Operator outreach tracking for the admin claim-links screen.
--
-- Records when the operator has added an org on Facebook. NULL = not yet
-- added. Operator bookkeeping only; never exposed on a public org payload.
-- Independent from outreach_messaged_at.
-- Idempotent — safe to re-run.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS outreach_facebook_added_at timestamp;
