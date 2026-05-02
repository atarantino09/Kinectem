-- Task #355 — Refresh tokens for the bearer-token auth flow used by the
-- mobile app and other non-browser clients. Idempotent.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  device_label  text,
  issued_at     timestamp NOT NULL DEFAULT now(),
  expires_at    timestamp NOT NULL,
  revoked_at    timestamp,
  last_used_at  timestamp
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx
  ON refresh_tokens(user_id);
