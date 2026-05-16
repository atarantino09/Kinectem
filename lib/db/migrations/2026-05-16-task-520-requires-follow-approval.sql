-- Task #520 — Private account toggle for 13+ users. When true, new
-- incoming follow edges land as `pending` (existing `minor_gate_status`
-- enum + `user_followers.moderation_status` column) instead of the
-- default `approved`. Minors are unaffected: the column is forced to
-- false at write time and the server-side toggle endpoint rejects any
-- attempt to flip it on a minor account.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS requires_follow_approval boolean NOT NULL DEFAULT false;
