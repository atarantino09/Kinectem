-- Task #610 — Per-org secret claim-invite token.
--
-- Stored in plaintext (a re-displayable shareable invite link, NOT a
-- password) so the admin screen + CSV can re-display it on demand for
-- re-sending. Only ever issued for ownerless (bulk-imported) pages;
-- possessing the link is the authorization to become the page owner.
-- Nullable: orgs created the normal way (with an owner) never get one.
-- Idempotent — safe to re-run.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS claim_token text;

-- Partial unique index so the many orgs without a token don't collide
-- on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_claim_token_idx
  ON organizations (claim_token)
  WHERE claim_token IS NOT NULL;
