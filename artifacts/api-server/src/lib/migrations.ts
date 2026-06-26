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

// Task #367 — COPPA Phase 3 launch readiness. Adds the
// `pending_deletion` account-status value, the `profile_visibility`
// enum + column on users, the `deletion_requested_at` timestamp, the
// new `takedown_status` enum + `takedown_requests` table, and the
// new consent-audit events. All idempotent.
const TASK_367_COPPA_PHASE_3 = `
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'account_status' AND e.enumlabel = 'pending_deletion'
  ) THEN
    ALTER TYPE account_status ADD VALUE 'pending_deletion';
  END IF;
END$migration$;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profile_visibility') THEN
    CREATE TYPE profile_visibility AS ENUM ('public','followers','private');
  END IF;
END$migration$;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'takedown_status') THEN
    CREATE TYPE takedown_status AS ENUM ('pending','approved','declined');
  END IF;
END$migration$;

DO $migration$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'guardian_deletion_requested',
    'guardian_data_deleted',
    'guardian_takedown_requested',
    'guardian_takedown_approved',
    'guardian_takedown_declined'
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

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_visibility profile_visibility NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamp;

-- Backfill: every existing minor account starts at the followers tier.
UPDATE users SET profile_visibility = 'followers'
  WHERE is_minor = true AND profile_visibility = 'public';

CREATE TABLE IF NOT EXISTS takedown_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by_guardian_id uuid REFERENCES users(id) ON DELETE SET NULL,
  post_kind post_kind NOT NULL,
  post_ref_id uuid NOT NULL,
  reason text,
  status takedown_status NOT NULL DEFAULT 'pending',
  decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS takedown_requests_pending_idx
  ON takedown_requests (post_kind, post_ref_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS takedown_requests_child_idx
  ON takedown_requests (child_user_id, status);
`;

// Task #32 — Hash guardian-confirmation tokens at rest. The legacy
// `users.guardian_confirm_token` column held the raw token, which is a
// working "I am the parent" capability for the TTL window. We add the
// hash column, backfill existing rows from the plaintext token, then
// drop the plaintext column. Idempotent: safe to re-run.
const TASK_32_HASH_GUARDIAN_TOKENS = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS guardian_confirm_token_hash text;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'guardian_confirm_token'
  ) THEN
    UPDATE users
       SET guardian_confirm_token_hash =
             encode(digest(guardian_confirm_token, 'sha256'), 'hex')
     WHERE guardian_confirm_token IS NOT NULL
       AND guardian_confirm_token_hash IS NULL;
  END IF;
END$migration$;

CREATE INDEX IF NOT EXISTS users_guardian_confirm_token_hash_idx
  ON users (guardian_confirm_token_hash)
  WHERE guardian_confirm_token_hash IS NOT NULL;

ALTER TABLE users DROP COLUMN IF EXISTS guardian_confirm_token;
`;

// Task #426 — Per-field birthday visibility. Adds the
// `date_of_birth_visibility` enum + column on `users`. Default is
// `private` for every existing row, matching today's behavior where
// birthday is only visible to self / linked guardian.
// Task #472 — Archive/unarchive teams. Adds nullable archive columns to
// `teams` and the admin enum values needed to record archive/unarchive
// in admin_activity_log. Idempotent.
const TASK_472_TEAM_ARCHIVE = `
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'admin_action_type' AND e.enumlabel = 'archive_team'
  ) THEN
    ALTER TYPE admin_action_type ADD VALUE 'archive_team';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'admin_action_type' AND e.enumlabel = 'unarchive_team'
  ) THEN
    ALTER TYPE admin_action_type ADD VALUE 'unarchive_team';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'admin_target_type' AND e.enumlabel = 'team'
  ) THEN
    ALTER TYPE admin_target_type ADD VALUE 'team';
  END IF;
END$migration$;

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS archived_at timestamp,
  ADD COLUMN IF NOT EXISTS archived_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS teams_archived_at_idx
  ON teams (archived_at)
  WHERE archived_at IS NOT NULL;
`;

const TASK_426_DOB_VISIBILITY = `
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'date_of_birth_visibility'
  ) THEN
    CREATE TYPE date_of_birth_visibility AS ENUM ('private','followers','public');
  END IF;
END$migration$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS date_of_birth_visibility date_of_birth_visibility
    NOT NULL DEFAULT 'private';
`;

// Task #504 — Per-user sports list backing the multi-select picker on
// EditProfileDialog (Task #500). Composite PK (user_id, sport) is the
// natural dedupe so no surrogate id or separate unique index. Idempotent.
const TASK_504_USER_SPORTS = `
CREATE TABLE IF NOT EXISTS user_sports (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport   text NOT NULL,
  PRIMARY KEY (user_id, sport)
);
`;

// Task #541 — organization_invites table. Mirrors roster_invites but
// scoped to org membership/admin. Hashed token at rest (`token_hash`).
// Idempotent (re-runs are no-ops on an already-migrated DB).
const TASK_541_ORGANIZATION_INVITES = `
CREATE TABLE IF NOT EXISTS organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  invited_email text NOT NULL,
  role org_member_role NOT NULL DEFAULT 'admin',
  note text,
  token_hash text NOT NULL,
  status invite_status NOT NULL DEFAULT 'pending',
  resolved_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  withdrawn_at timestamptz,
  accepted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_invites_token_hash_unique
  ON organization_invites(token_hash);
CREATE INDEX IF NOT EXISTS organization_invites_org_status_idx
  ON organization_invites(organization_id, status);
`;

// Task #543 — Founding 100 signup capture for the marketing site.
// Standalone table, not linked to platform users. Idempotent.
const TASK_543_FOUNDING_SIGNUPS = `
CREATE TABLE IF NOT EXISTS founding_signups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name          text NOT NULL,
  admin_name        text NOT NULL,
  admin_email       text NOT NULL UNIQUE,
  role_title        text NOT NULL,
  estimated_teams   integer NOT NULL,
  estimated_players integer NOT NULL,
  sport             text,
  submitted_at      timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS founding_signups_submitted_at_idx
  ON founding_signups (submitted_at DESC);
`;

// Task #548 — Per-user-per-org dismissal of the org setup checklist.
// Adds a nullable `dismissed_setup_at` timestamp on organization_admins.
// Without this, POST /organizations (and any other write that touches
// the membership row) 500s on databases that predate task #548 with
// `column "dismissed_setup_at" of relation "organization_admins" does
// not exist`. Idempotent.
const TASK_548_ORG_ADMIN_DISMISSED_SETUP_AT = `
ALTER TABLE organization_admins
  ADD COLUMN IF NOT EXISTS dismissed_setup_at timestamp;
`;

// AI Assist "context & personality" — an optional admin-authored instruction
// block prepended to the AI Assist system prompt so operators can tune the
// assistant's voice and organization-specific context. Nullable, no backfill.
const AI_PROVIDER_SYSTEM_CONTEXT = `
ALTER TABLE ai_provider_keys
  ADD COLUMN IF NOT EXISTS system_context text;
`;

// Code review B3 — converge the live DB with the FK / hot-filter indexes
// that were declared in the Drizzle schema (Task #592) but never pushed
// to the running database. Pure `CREATE INDEX IF NOT EXISTS`, so it is
// idempotent and the names match the schema exactly (a later
// `drizzle-kit push` then sees no diff). These back the feed / profile /
// notification read paths and are the single biggest latency win there.
const CODE_REVIEW_B3_HOT_INDEXES = `
CREATE INDEX IF NOT EXISTS articles_team_id_idx
  ON articles (team_id);
CREATE INDEX IF NOT EXISTS articles_author_id_idx
  ON articles (author_id);
CREATE INDEX IF NOT EXISTS highlights_team_id_idx
  ON highlights (team_id);
CREATE INDEX IF NOT EXISTS highlights_uploader_id_idx
  ON highlights (uploader_id);
CREATE INDEX IF NOT EXISTS post_shares_sharer_user_id_idx
  ON post_shares (sharer_user_id);
CREATE INDEX IF NOT EXISTS notifications_user_id_created_at_idx
  ON notifications (user_id, created_at DESC);
`;

// Code review S6 — shared, Postgres-backed rate-limit store so the
// signup / login / founding-signup / AI limiters survive process
// restarts and apply across multiple Autoscale instances (the previous
// store was a per-process in-memory Map, trivially bypassed round-robin
// and reset on every deploy). `key_hash` is a sha256 of the raw limiter
// key, so raw IPs / emails are never persisted at rest. Idempotent.
const CODE_REVIEW_S6_RATE_LIMIT_BUCKETS = `
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  name      text NOT NULL,
  key_hash  text NOT NULL,
  count     integer NOT NULL DEFAULT 0,
  reset_at  timestamp NOT NULL,
  PRIMARY KEY (name, key_hash)
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_reset_at_idx
  ON rate_limit_buckets (reset_at);
`;

// B3 (code review) — composite indexes for the multi-column filters on the
// hot feed/profile paths. Complements the single-column indexes in
// CODE_REVIEW_B3_HOT_INDEXES; idempotent.
const CODE_REVIEW_B3_COMPOSITE_INDEXES = `
CREATE INDEX IF NOT EXISTS articles_status_author_team_idx
  ON articles (status, author_id, team_id);
CREATE INDEX IF NOT EXISTS highlights_uploader_approval_team_idx
  ON highlights (uploader_id, approval_status, team_id);
`;

const TASK_603_ORG_CLAIM_REQUESTS = `
DO $$ BEGIN
  CREATE TYPE org_claim_status AS ENUM ('pending', 'approved', 'declined');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS organization_claim_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status org_claim_status NOT NULL DEFAULT 'pending',
  decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS org_claim_unique_pending_per_user
  ON organization_claim_requests (organization_id, requested_by_user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS org_claim_by_org
  ON organization_claim_requests (organization_id);
CREATE INDEX IF NOT EXISTS org_claim_by_status
  ON organization_claim_requests (status);
`;

// Task #610 — Per-org secret claim-invite token. Plaintext (re-displayable
// shareable invite link, not a password), only ever set for ownerless
// pages. Nullable column + a partial unique index so the many orgs without
// a token don't collide on NULL. Idempotent. No backfill here — tokens are
// minted lazily by the admin screen / backfill script for ownerless orgs.
const TASK_610_ORG_CLAIM_LINKS = `
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS claim_token text;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_claim_token_idx
  ON organizations (claim_token)
  WHERE claim_token IS NOT NULL;
`;

// Additive: field / court / diamond number within the venue. Idempotent.
const SCHEDULE_LOCATION_FIELD = `
ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS location_field text;
`;

const SCHEDULE_RECAP_REMINDER = `
ALTER TABLE schedule_events
  ADD COLUMN IF NOT EXISTS recap_reminder_sent_at timestamptz;
`;

// Phase 2 — stamp for the durable ~24h-before reminder email sweep so it
// never double-sends. Idempotent.
const SCHEDULE_REMINDER_24H = `
ALTER TABLE schedule_events
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at timestamptz;
`;

// Phase 2 — unguessable per-team capability token for the read-only iCal
// (.ics) subscription feed. Unique so a token resolves to exactly one team.
// Idempotent.
const SCHEDULE_FEED_TOKEN = `
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS schedule_feed_token text;
CREATE UNIQUE INDEX IF NOT EXISTS teams_schedule_feed_token_key
  ON teams (schedule_feed_token);
`;

// Phase 2 — final-score capture for completed game/scrimmage events, surfaced
// in the members-only Season Results list. Nullable: a game can be completed
// (recap linked) without a recorded score. Idempotent.
const SCHEDULE_EVENT_SCORE = `
ALTER TABLE schedule_events
  ADD COLUMN IF NOT EXISTS score_team integer,
  ADD COLUMN IF NOT EXISTS score_opponent integer;
`;

// Combined season/tournament recaps (woven from many game recaps) carry
// this marker so the post card can render a distinct pill. NULL = normal
// single-game recap; "combined" = multi-game recap. Idempotent.
const ARTICLE_RECAP_KIND = `
ALTER TABLE articles ADD COLUMN IF NOT EXISTS recap_kind text;
`;

// Team Schedule — new additive tables for practices/games posted to a team.
// Idempotent: CREATE TYPE is guarded, every table/index uses IF NOT EXISTS.
const SCHEDULE_TABLES = `
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_event_type') THEN
    CREATE TYPE schedule_event_type AS ENUM ('practice','game','scrimmage','tournament','other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_home_away') THEN
    CREATE TYPE schedule_home_away AS ENUM ('home','away','neutral');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_event_status') THEN
    CREATE TYPE schedule_event_status AS ENUM ('scheduled','canceled','postponed','completed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_frequency') THEN
    CREATE TYPE schedule_frequency AS ENUM ('weekly');
  END IF;
END$migration$;

CREATE TABLE IF NOT EXISTS schedule_recurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  frequency schedule_frequency NOT NULL DEFAULT 'weekly',
  days_of_week integer[] NOT NULL,
  start_time text NOT NULL,
  end_time text,
  series_start_date text NOT NULL,
  series_end_date text NOT NULL,
  created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_recurrences_team_id_idx
  ON schedule_recurrences (team_id);

CREATE TABLE IF NOT EXISTS schedule_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type schedule_event_type NOT NULL,
  title text,
  opponent text,
  home_away schedule_home_away,
  location_name text,
  location_address text,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  notes text,
  status schedule_event_status NOT NULL DEFAULT 'scheduled',
  status_reason text,
  recurrence_id uuid REFERENCES schedule_recurrences(id) ON DELETE SET NULL,
  game_recap_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_events_team_start_idx
  ON schedule_events (team_id, start_at);
CREATE INDEX IF NOT EXISTS schedule_events_organization_id_idx
  ON schedule_events (organization_id);
CREATE INDEX IF NOT EXISTS schedule_events_recurrence_id_idx
  ON schedule_events (recurrence_id);
`;

// Team Schedule Phase 2 — per-athlete RSVP / availability for an event.
// Idempotent: guarded CREATE TYPE, IF NOT EXISTS table/indexes. The unique
// index on (event_id, athlete_id) makes a re-submit a last-write-wins upsert.
const SCHEDULE_EVENT_RSVPS = `
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_rsvp_status') THEN
    CREATE TYPE schedule_rsvp_status AS ENUM ('going','maybe','out');
  END IF;
END$migration$;

CREATE TABLE IF NOT EXISTS schedule_event_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES schedule_events(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  responded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status schedule_rsvp_status NOT NULL,
  note text,
  responded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS schedule_event_rsvps_event_athlete_uq
  ON schedule_event_rsvps (event_id, athlete_id);
CREATE INDEX IF NOT EXISTS schedule_event_rsvps_event_id_idx
  ON schedule_event_rsvps (event_id);
CREATE INDEX IF NOT EXISTS schedule_event_rsvps_athlete_id_idx
  ON schedule_event_rsvps (athlete_id);
`;

const ANNOUNCEMENTS = `
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'announcement_level') THEN
    CREATE TYPE announcement_level AS ENUM ('info','warning','success');
  END IF;
END$migration$;

CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  level announcement_level NOT NULL DEFAULT 'info',
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_active_idx ON announcements (active);
`;

// Task #628 — Tournament signup funnel for outside teams. Makes teams.org
// nullable (solo teams) + adds teams.created_by_id, then the three tournament
// tables. Fully idempotent: DROP NOT NULL / ADD COLUMN IF NOT EXISTS are no-ops
// when already applied; every table/index uses IF NOT EXISTS.
const TASK_628_TOURNAMENTS = `
ALTER TABLE teams ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS created_by_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  location text,
  description text,
  created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_key text NOT NULL,
  division text NOT NULL DEFAULT '',
  bracket text NOT NULL DEFAULT '',
  age text,
  gender text,
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  claimed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  claimed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournament_participants_tournament_id_idx
  ON tournament_participants (tournament_id);
CREATE INDEX IF NOT EXISTS tournament_participants_team_id_idx
  ON tournament_participants (team_id);
CREATE UNIQUE INDEX IF NOT EXISTS tournament_participants_unique_slot
  ON tournament_participants (tournament_id, division, bracket, name_key);

CREATE TABLE IF NOT EXISTS tournament_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  match_number text NOT NULL,
  match_date date,
  start_time text,
  age text,
  gender text,
  division text NOT NULL DEFAULT '',
  bracket text NOT NULL DEFAULT '',
  venue text,
  venue_state text,
  field text,
  home_participant_id uuid REFERENCES tournament_participants(id) ON DELETE SET NULL,
  away_participant_id uuid REFERENCES tournament_participants(id) ON DELETE SET NULL,
  home_score integer,
  away_score integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournament_matches_tournament_id_idx
  ON tournament_matches (tournament_id);
CREATE UNIQUE INDEX IF NOT EXISTS tournament_matches_unique_number
  ON tournament_matches (tournament_id, match_number);
`;

// Per-team one-time "adopt this team into your org" capability token. A solo
// team's coach mints it and shares the `/adopt-team/<token>` link with their
// org admin, who reparents the team. Plaintext (a shareable link, not a
// password); nullable; cleared on adoption (one-time); rotatable. Idempotent.
const TEAM_ADOPT_TOKEN = `
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS adopt_token text;
CREATE UNIQUE INDEX IF NOT EXISTS teams_adopt_token_idx
  ON teams (adopt_token)
  WHERE adopt_token IS NOT NULL;
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
  {
    name: "2026-05-06-task-367-coppa-phase-3",
    sql: TASK_367_COPPA_PHASE_3,
  },
  {
    name: "2026-05-06-task-32-hash-guardian-tokens",
    sql: TASK_32_HASH_GUARDIAN_TOKENS,
  },
  {
    name: "2026-05-09-task-426-dob-visibility",
    sql: TASK_426_DOB_VISIBILITY,
  },
  {
    name: "2026-05-11-task-472-team-archive",
    sql: TASK_472_TEAM_ARCHIVE,
  },
  {
    name: "2026-05-13-task-504-user-sports",
    sql: TASK_504_USER_SPORTS,
  },
  {
    name: "2026-05-21-task-541-organization-invites",
    sql: TASK_541_ORGANIZATION_INVITES,
  },
  {
    name: "2026-05-21-task-543-founding-signups",
    sql: TASK_543_FOUNDING_SIGNUPS,
  },
  {
    name: "2026-05-21-task-548-org-admin-dismissed-setup-at",
    sql: TASK_548_ORG_ADMIN_DISMISSED_SETUP_AT,
  },
  {
    name: "2026-06-11-ai-provider-system-context",
    sql: AI_PROVIDER_SYSTEM_CONTEXT,
  },
  {
    name: "2026-06-22-code-review-b3-hot-indexes",
    sql: CODE_REVIEW_B3_HOT_INDEXES,
  },
  {
    name: "2026-06-22-code-review-s6-rate-limit-buckets",
    sql: CODE_REVIEW_S6_RATE_LIMIT_BUCKETS,
  },
  {
    name: "2026-06-22-code-review-b3-composite-indexes",
    sql: CODE_REVIEW_B3_COMPOSITE_INDEXES,
  },
  {
    name: "2026-06-22-task-603-org-claim-requests",
    sql: TASK_603_ORG_CLAIM_REQUESTS,
  },
  {
    name: "2026-06-22-task-610-org-claim-links",
    sql: TASK_610_ORG_CLAIM_LINKS,
  },
  {
    name: "2026-06-25-team-schedule-tables",
    sql: SCHEDULE_TABLES,
  },
  {
    name: "2026-06-25-team-schedule-location-field",
    sql: SCHEDULE_LOCATION_FIELD,
  },
  {
    name: "2026-06-25-team-schedule-recap-reminder",
    sql: SCHEDULE_RECAP_REMINDER,
  },
  {
    name: "2026-06-25-article-recap-kind",
    sql: ARTICLE_RECAP_KIND,
  },
  {
    name: "2026-06-26-team-schedule-event-rsvps",
    sql: SCHEDULE_EVENT_RSVPS,
  },
  {
    name: "2026-06-26-announcements",
    sql: ANNOUNCEMENTS,
  },
  {
    name: "2026-06-26-team-schedule-reminder-24h",
    sql: SCHEDULE_REMINDER_24H,
  },
  {
    name: "2026-06-26-team-schedule-feed-token",
    sql: SCHEDULE_FEED_TOKEN,
  },
  {
    name: "2026-06-26-team-schedule-event-score",
    sql: SCHEDULE_EVENT_SCORE,
  },
  {
    name: "2026-06-26-task-628-tournaments",
    sql: TASK_628_TOURNAMENTS,
  },
  {
    name: "2026-06-26-team-adopt-token",
    sql: TEAM_ADOPT_TOKEN,
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
