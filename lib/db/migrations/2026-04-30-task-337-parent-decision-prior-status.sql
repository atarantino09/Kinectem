-- Task #337 — Add prior_status column to parent_child_notification_reads.
-- Idempotent. Mirrors the inline migration in
-- artifacts/api-server/src/lib/migrations.ts.
--
-- The family-dashboard Remove action now needs to flip an already-
-- `approved` highlight tag (or article tag) to `declined`. Without
-- remembering the prior status, an Undo from the "Recent decisions"
-- strip would silently demote the tag from `approved` to `pending`,
-- forcing the parent to re-approve a tag they had previously
-- approved out-of-band. The new column captures the underlying tag's
-- status at decision time so Undo can restore it faithfully. Nullable
-- so legacy rows and non-tag decisions stay untouched.

ALTER TABLE parent_child_notification_reads
  ADD COLUMN IF NOT EXISTS prior_status text;
