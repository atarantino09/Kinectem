-- Task #559 — Highlight pending-approval workflow.
-- Player/parent-uploaded highlights enter `pending` and stay hidden
-- from public read paths until a staff approver (org admin, head /
-- assistant coach, manager, or accepted-roster "author") approves
-- them. Highlights uploaded by staff are inserted directly as
-- `approved`. Existing rows are backfilled to `approved` so the
-- migration is non-destructive to live content. Idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'highlight_approval_status') THEN
    CREATE TYPE highlight_approval_status AS ENUM ('pending', 'approved', 'declined');
  END IF;
END$$;

ALTER TABLE highlights
  ADD COLUMN IF NOT EXISTS approval_status highlight_approval_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_at timestamp,
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS highlights_team_pending_idx
  ON highlights (team_id)
  WHERE approval_status = 'pending';
