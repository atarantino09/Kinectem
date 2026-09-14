-- Task #1027. Partner import decisions are directory-scoped staging data.
-- They must never rewrite canonical organizations, teams, or content.
ALTER TABLE partner_organization_memberships
  ADD COLUMN IF NOT EXISTS position integer;
ALTER TABLE partner_organization_memberships
  ADD COLUMN IF NOT EXISTS replacement_idempotency_key text;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS partner_import_created_by_operation_id uuid;

CREATE INDEX IF NOT EXISTS partner_membership_page_position_idx
  ON partner_organization_memberships (partner_page_id, position, created_at);

CREATE TABLE IF NOT EXISTS partner_replacement_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_page_id uuid NOT NULL REFERENCES partner_landing_pages(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES partner_organization_memberships(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  candidate_organization_id uuid NOT NULL REFERENCES organizations(id),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (partner_page_id, membership_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS partner_replacement_membership_idx
  ON partner_replacement_operations (membership_id);

CREATE TABLE IF NOT EXISTS partner_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES partner_import_operations(id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  source_column text,
  source_name text NOT NULL,
  normalized_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (operation_id, row_index)
);

CREATE TABLE IF NOT EXISTS partner_import_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_row_id uuid NOT NULL REFERENCES partner_import_rows(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  match_kind text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  team_count integer NOT NULL DEFAULT 0,
  page_member boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'candidate',
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (import_row_id, organization_id)
);

CREATE TABLE IF NOT EXISTS partner_import_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_page_id uuid NOT NULL REFERENCES partner_landing_pages(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES partner_import_operations(id) ON DELETE CASCADE,
  import_row_id uuid NOT NULL REFERENCES partner_import_rows(id) ON DELETE CASCADE,
  decision text NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  decided_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reversed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (operation_id, import_row_id)
);

CREATE TABLE IF NOT EXISTS partner_import_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_page_id uuid NOT NULL REFERENCES partner_landing_pages(id) ON DELETE CASCADE,
  normalized_name text NOT NULL,
  import_row_id uuid REFERENCES partner_import_rows(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  decision text NOT NULL DEFAULT 'use_existing',
  rationale jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_used_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (partner_page_id, normalized_name)
);