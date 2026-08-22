CREATE TABLE IF NOT EXISTS coach_invite_groups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_email      text NOT NULL,
  role               roster_role NOT NULL DEFAULT 'coach',
  token_hash         text NOT NULL UNIQUE,
  status             invite_status NOT NULL DEFAULT 'pending',
  delivery_status    invite_delivery_status NOT NULL DEFAULT 'unknown',
  delivery_event_at  timestamp,
  delivery_reason    text,
  invited_by_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  accepted_at        timestamp,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_invite_groups_organization_id_idx
  ON coach_invite_groups (organization_id);
CREATE INDEX IF NOT EXISTS coach_invite_groups_invited_email_idx
  ON coach_invite_groups (invited_email);

ALTER TABLE roster_invites
  ADD COLUMN IF NOT EXISTS coach_invite_group_id uuid
    REFERENCES coach_invite_groups(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS roster_invites_coach_invite_group_id_idx
  ON roster_invites (coach_invite_group_id);