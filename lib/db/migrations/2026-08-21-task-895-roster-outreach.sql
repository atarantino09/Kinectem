CREATE TABLE IF NOT EXISTS organization_roster_outreach (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  sent_at timestamp,
  sent_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, team_id)
);

CREATE INDEX IF NOT EXISTS organization_roster_outreach_team_id_idx
  ON organization_roster_outreach (team_id);