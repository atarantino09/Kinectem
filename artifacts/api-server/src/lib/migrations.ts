import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

// Task #190 — This project uses `drizzle-kit push`, which has no
// concept of file-backed migrations. Push is destructive when a column
// is renamed/replaced (e.g. `post_shares.article_id` →
// `(post_kind, post_ref_id)`), so a deploy that just runs push would
// silently lose every existing share row from task #162.
//
// The fix is to ship idempotent SQL backfill scripts alongside the
// schema and run them at boot, *before* the new code touches the
// affected tables. Each script is gated on the legacy schema still
// being present, so re-running on a freshly-pushed DB is a no-op.
//
// We inline the SQL as string constants (rather than reading from
// disk) so the bundler captures it at build time — `__dirname` is
// not stable across `tsx watch` and the esbuild bundle. The canonical
// SQL also lives at `lib/db/migrations/` for ops review.

const TASK_190_POST_SHARES_POLYMORPHIC = `
-- Task #190 — Post-shares polymorphic migration. Idempotent.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'post_kind') THEN
    CREATE TYPE post_kind AS ENUM ('article', 'highlight', 'org_post');
  END IF;
END$migration$;

ALTER TABLE post_shares
  ADD COLUMN IF NOT EXISTS post_kind   post_kind,
  ADD COLUMN IF NOT EXISTS post_ref_id uuid;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'post_shares' AND column_name = 'article_id'
  ) THEN
    UPDATE post_shares
       SET post_kind   = 'article',
           post_ref_id = article_id
     WHERE post_kind IS NULL OR post_ref_id IS NULL;
  END IF;
END$migration$;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM post_shares WHERE post_kind IS NULL OR post_ref_id IS NULL
  ) THEN
    ALTER TABLE post_shares
      ALTER COLUMN post_kind   SET NOT NULL,
      ALTER COLUMN post_ref_id SET NOT NULL;
  END IF;
END$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS post_shares_kind_ref_sharer_uniq
  ON post_shares (post_kind, post_ref_id, sharer_user_id);
DROP INDEX IF EXISTS post_shares_article_sharer_uniq;

ALTER TABLE post_shares
  DROP COLUMN IF EXISTS article_id;
`;

// Task #208 — Organization membership gains an explicit role column
// (owner / admin / member). Before this change the table only held
// admins, with the implicit "owner = first row" rule. Drizzle push
// happily adds the new column with a default, but every existing org
// then has zero owners (all rows defaulted to 'admin') and the org-page
// "Manage members" UI has no one to demote / transfer from. This
// backfill is idempotent: it picks one admin per org and sets it to
// 'owner', preferring the original creator when still present, else
// the earliest-joined admin. Runs before the new code reads `role`.
const TASK_208_ORG_MEMBER_ROLES = `
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_member_role') THEN
    CREATE TYPE org_member_role AS ENUM ('owner', 'admin', 'member');
  END IF;
END$migration$;

ALTER TABLE organization_admins
  ADD COLUMN IF NOT EXISTS role org_member_role NOT NULL DEFAULT 'admin';

-- Promote the creator (or earliest admin) of every org to owner exactly
-- once. Skips orgs that already have an owner so re-runs are no-ops.
WITH ranked AS (
  SELECT
    oa.organization_id,
    oa.user_id,
    ROW_NUMBER() OVER (
      PARTITION BY oa.organization_id
      ORDER BY (CASE WHEN o.created_by_id = oa.user_id THEN 0 ELSE 1 END),
               oa.created_at,
               oa.user_id
    ) AS rn
  FROM organization_admins oa
  JOIN organizations o ON o.id = oa.organization_id
  WHERE NOT EXISTS (
    SELECT 1 FROM organization_admins oa2
     WHERE oa2.organization_id = oa.organization_id
       AND oa2.role = 'owner'
  )
)
UPDATE organization_admins oa
   SET role = 'owner'
  FROM ranked r
 WHERE r.rn = 1
   AND oa.organization_id = r.organization_id
   AND oa.user_id        = r.user_id;

-- Enforce the "exactly one owner per org" invariant at the DB level so
-- concurrent transfer-ownership requests cannot leave two owners.
CREATE UNIQUE INDEX IF NOT EXISTS organization_admins_one_owner_per_org
  ON organization_admins (organization_id)
  WHERE role = 'owner';
`;

// Task #230 — Add a zip_code column to organizations. The create-org
// endpoint will enforce presence on new orgs going forward, but we
// keep the column nullable so existing rows are unaffected (no
// forced backfill).
const TASK_230_ORG_ZIP_CODE = `
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS zip_code text;
`;

// Task #244 — Add a gender column to teams (Boys / Girls / Coed).
// Nullable so existing teams stay null until edited; the create/edit
// endpoints validate the allowed values but never require it.
const TASK_244_TEAM_GENDER = `
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS gender text;
`;

// Task #290 — Add a website column to organizations. The OpenAPI
// response and frontend already expected this column, but it had
// never been added — values sent to the create-org endpoint were
// silently dropped by drizzle. Nullable, no backfill.
const TASK_290_ORG_WEBSITE = `
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS website text;
`;

// Task #293 — Extend the friendly bare-domain website behavior from
// task #290 (orgs only) to teams and user profiles. Each gets its
// own nullable website column, normalized server-side via
// normalizeWebsite() before being persisted. No backfill — existing
// rows stay null until the user fills the field.
const TASK_293_TEAM_WEBSITE = `
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS website text;
`;

const TASK_293_USER_WEBSITE = `
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS website text;
`;

// Task #349 — Add nullable city + 2-letter US state postal code columns
// to users. Lets a user put a US location ("Austin, TX") on their
// profile, rendered in the hero alongside bio + website. Mirrors the
// shape used by organizations. Nullable, no backfill — existing rows
// stay NULL on both fields and the hero simply hides the line.
const TASK_349_USER_CITY_STATE = `
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS city  text,
  ADD COLUMN IF NOT EXISTS state text;
`;

// Task #355 — Refresh tokens for the bearer-token auth flow used by the
// mobile app and other non-browser clients. Idempotent. Uses pgcrypto's
// gen_random_uuid() which is already available in this project (every
// other table uses it via Drizzle's `defaultRandom()`).
const TASK_355_REFRESH_TOKENS = `
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
`;

// Task #358 — Self-serve API keys for third-party developers. Stores
// only the sha256 hash of the issued plaintext key alongside a short
// `prefix` (the first ~12 characters of the key) so the dev portal can
// render a recognizable fingerprint without ever holding the secret.
// Idempotent — safe to re-run on a schema that already has the table.
const TASK_358_API_KEYS = `
CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  prefix       text NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{}',
  created_at   timestamp NOT NULL DEFAULT now(),
  last_used_at timestamp,
  revoked_at   timestamp
);

CREATE INDEX IF NOT EXISTS api_keys_user_id_idx
  ON api_keys(user_id);
`;

// Task #337 — Add prior_status column to parent_child_notification_reads.
// The family-dashboard Remove action now flips already-`approved`
// highlight / article tags to `declined`. Without remembering the prior
// status an Undo would silently demote those tags to `pending`. The new
// column snapshots the underlying source row's status at decision time
// so Undo can restore it faithfully. Nullable, no backfill.
const TASK_337_PARENT_DECISION_PRIOR_STATUS = `
ALTER TABLE parent_child_notification_reads
  ADD COLUMN IF NOT EXISTS prior_status text;
`;

// Task #359 — COPPA Phase 1. Adds the minor / account-status / consent
// fields on `users`, plus the `parental_consents` ledger and the
// `consent_audit_log` append-only event log. Idempotent.
const TASK_359_COPPA_PHASE_1 = `
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status') THEN
    CREATE TYPE account_status AS ENUM ('active', 'pending_guardian', 'disabled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'parental_consent_state') THEN
    CREATE TYPE parental_consent_state AS ENUM (
      'pending_notice', 'pending_followup', 'finalized', 'revoked', 'expired'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consent_audit_event') THEN
    CREATE TYPE consent_audit_event AS ENUM (
      'age_gate_attempt', 'age_gate_blocked', 'child_signup',
      'guardian_email_sent', 'guardian_notice_viewed',
      'guardian_first_consent', 'guardian_followup_sent',
      'guardian_finalized', 'guardian_revoked',
      'minor_blocked_action', 'exif_stripped'
    );
  END IF;
END$migration$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_minor              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_status        account_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS consent_finalized_at  timestamp,
  ADD COLUMN IF NOT EXISTS consent_revoked_at    timestamp,
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at timestamp;

-- Append a "deletion_scheduled" event to the audit-log enum so the
-- revoke handler can record the grace-period start. ADD VALUE IF NOT
-- EXISTS makes this safe to re-run.
ALTER TYPE consent_audit_event ADD VALUE IF NOT EXISTS 'deletion_scheduled';

-- Backfill: any existing user under 13 by date_of_birth gets is_minor=true.
-- We do not change account_status for legacy rows — they keep the
-- guardianConfirmedAt-based gate already wired in /auth/login.
UPDATE users
   SET is_minor = true
 WHERE is_minor = false
   AND date_of_birth IS NOT NULL
   AND age(date_of_birth) < interval '13 years';

CREATE TABLE IF NOT EXISTS parental_consents (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guardian_email              text NOT NULL,
  guardian_user_id            uuid REFERENCES users(id) ON DELETE SET NULL,
  state                       parental_consent_state NOT NULL DEFAULT 'pending_notice',
  method                      text NOT NULL DEFAULT 'email-plus',
  notice_version              text NOT NULL,
  notice_text                 text NOT NULL,
  first_token_hash            text UNIQUE,
  first_token_expires_at      timestamp,
  first_consent_at            timestamp,
  first_consent_ip            text,
  followup_token_hash         text UNIQUE,
  followup_token_expires_at   timestamp,
  followup_sent_at            timestamp,
  finalized_at                timestamp,
  finalized_ip                text,
  revoke_token_hash           text UNIQUE,
  revoked_at                  timestamp,
  created_at                  timestamp NOT NULL DEFAULT now()
);
-- Backfill the "method" column on any pre-existing parental_consents
-- rows (an earlier draft of this migration created the table without
-- the column). Safe to re-run thanks to ADD COLUMN IF NOT EXISTS.
ALTER TABLE parental_consents
  ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'email-plus';

CREATE INDEX IF NOT EXISTS parental_consents_child_idx
  ON parental_consents(child_user_id);
CREATE INDEX IF NOT EXISTS parental_consents_state_idx
  ON parental_consents(state);

CREATE TABLE IF NOT EXISTS consent_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  consent_id    uuid REFERENCES parental_consents(id) ON DELETE SET NULL,
  event         consent_audit_event NOT NULL,
  actor_email   text,
  actor_ip      text,
  details       text,
  created_at    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_audit_log_child_idx
  ON consent_audit_log(child_user_id);
CREATE INDEX IF NOT EXISTS consent_audit_log_created_idx
  ON consent_audit_log(created_at);

-- COPPA default: every minor (newly flagged above or already on file)
-- must approve tags one-by-one. Adults keep whatever they chose.
UPDATE users
   SET require_tag_consent = true
 WHERE is_minor = true
   AND require_tag_consent = false;
`;

// Task #363 — COPPA Phase 2. Adds the gating status columns on
// user_followers / post_comments / messages, the dm_allowlist table,
// and extends the consent_audit_event + account_status enums. Every
// statement is idempotent so re-running on a freshly pushed schema is
// a no-op. Declared before MIGRATIONS so the array can reference it.
const TASK_363_COPPA_PHASE_2 = `
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'minor_gate_status') THEN
    CREATE TYPE minor_gate_status AS ENUM ('pending','approved','declined');
  END IF;
END$migration$;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'account_status' AND e.enumlabel = 'pending_revocation'
  ) THEN
    ALTER TYPE account_status ADD VALUE 'pending_revocation';
  END IF;
END$migration$;

DO $migration$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'child_pending_follow','child_pending_dm','child_pending_comment',
    'child_pending_tag',
    'guardian_approved_follow','guardian_declined_follow',
    'guardian_approved_dm','guardian_declined_dm',
    'guardian_approved_comment','guardian_declined_comment',
    'guardian_approved_tag','guardian_declined_tag',
    'guardian_dm_allowlist_add','guardian_dm_allowlist_remove',
    'guardian_data_exported','guardian_revoke_requested',
    'guardian_consent_regranted'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'consent_audit_event' AND e.enumlabel = v
    ) THEN
      EXECUTE format('ALTER TYPE consent_audit_event ADD VALUE %L', v);
    END IF;
  END LOOP;
END$migration$;

ALTER TABLE user_followers
  ADD COLUMN IF NOT EXISTS moderation_status minor_gate_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS decided_by_guardian_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamp;

ALTER TABLE post_comments
  ADD COLUMN IF NOT EXISTS moderation_status minor_gate_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS decided_by_guardian_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamp;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS moderation_status minor_gate_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS decided_by_guardian_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamp;

CREATE TABLE IF NOT EXISTS dm_allowlist (
  child_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counterparty_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by_guardian_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note text,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (child_user_id, counterparty_user_id)
);

CREATE INDEX IF NOT EXISTS user_followers_pending_idx
  ON user_followers (following_user_id) WHERE moderation_status = 'pending';
CREATE INDEX IF NOT EXISTS post_comments_pending_idx
  ON post_comments (post_kind, post_ref_id) WHERE moderation_status = 'pending';
CREATE INDEX IF NOT EXISTS messages_pending_idx
  ON messages (conversation_id) WHERE moderation_status = 'pending';
`;

const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: "2026-04-27-task-190-post-shares-polymorphic",
    sql: TASK_190_POST_SHARES_POLYMORPHIC,
  },
  {
    name: "2026-04-27-task-208-org-member-roles",
    sql: TASK_208_ORG_MEMBER_ROLES,
  },
  {
    name: "2026-04-28-task-230-org-zip-code",
    sql: TASK_230_ORG_ZIP_CODE,
  },
  {
    name: "2026-04-28-task-244-team-gender",
    sql: TASK_244_TEAM_GENDER,
  },
  {
    name: "2026-04-29-task-290-org-website",
    sql: TASK_290_ORG_WEBSITE,
  },
  {
    name: "2026-04-29-task-293-team-website",
    sql: TASK_293_TEAM_WEBSITE,
  },
  {
    name: "2026-04-29-task-293-user-website",
    sql: TASK_293_USER_WEBSITE,
  },
  {
    name: "2026-04-30-task-337-parent-decision-prior-status",
    sql: TASK_337_PARENT_DECISION_PRIOR_STATUS,
  },
  {
    name: "2026-04-30-task-349-user-city-state",
    sql: TASK_349_USER_CITY_STATE,
  },
  {
    name: "2026-05-02-task-355-refresh-tokens",
    sql: TASK_355_REFRESH_TOKENS,
  },
  {
    name: "2026-05-02-task-358-api-keys",
    sql: TASK_358_API_KEYS,
  },
  {
    name: "2026-05-06-task-359-coppa-phase-1",
    sql: TASK_359_COPPA_PHASE_1,
  },
  {
    name: "2026-05-06-task-363-coppa-phase-2",
    sql: TASK_363_COPPA_PHASE_2,
  },
];

export async function runStartupMigrations(): Promise<void> {
  for (const m of MIGRATIONS) {
    try {
      await db.execute(sql.raw(m.sql));
      logger.info({ migration: m.name }, "Applied startup migration");
    } catch (err) {
      // Migrations are written to be idempotent, so a failure here is
      // worth surfacing loudly — but it should not stop the server
      // from booting (the schema may already be in the desired shape).
      logger.error({ err, migration: m.name }, "Startup migration failed");
    }
  }
}
