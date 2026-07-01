-- Daily Admin Digest — recipient list of arbitrary operator email addresses
-- managed by the platform admin. Idempotent.
CREATE TABLE IF NOT EXISTS daily_admin_digest_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  normalized_email text NOT NULL,
  label text,
  enabled boolean NOT NULL DEFAULT true,
  created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  last_sent_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_admin_digest_recipients_normalized_email_key
  ON daily_admin_digest_recipients (normalized_email);
