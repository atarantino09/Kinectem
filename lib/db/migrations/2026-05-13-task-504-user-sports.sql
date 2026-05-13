-- Task #504 — Per-user sports list backing the multi-select picker on
-- EditProfileDialog (Task #500). Composite PK (user_id, sport) is the
-- natural dedupe so no surrogate id or separate unique index. Idempotent.
CREATE TABLE IF NOT EXISTS user_sports (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport   text NOT NULL,
  PRIMARY KEY (user_id, sport)
);
