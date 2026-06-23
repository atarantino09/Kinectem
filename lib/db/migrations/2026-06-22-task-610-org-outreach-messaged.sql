-- Operator outreach tracking for the admin claim-links screen.
--
-- Records when the operator has messaged an org (e.g. on Facebook) to
-- invite them to claim their page. NULL = not yet messaged. Operator
-- bookkeeping only; never exposed on a public org payload.
-- Idempotent — safe to re-run.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS outreach_messaged_at timestamp;
