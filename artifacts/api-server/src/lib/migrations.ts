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

-- (Task #800 removed the old "flip require_tag_consent on for every
-- minor" statement that used to live here. Migrations re-run on every
-- boot, so it kept re-asserting per-tag consent for all minors — the
-- product default is now auto-approve with an explicit opt-in from the
-- Family dashboard; see TASK_800_AUTO_APPROVE_TAGS below.)
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

// Operator outreach tracking for the admin claim-links screen — records
// when the operator has added the org on Facebook. Independent from
// outreach_messaged_at. Idempotent.
const TASK_681_ORG_OUTREACH_FACEBOOK_ADDED = `
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS outreach_messaged_at timestamp;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS outreach_facebook_added_at timestamp;
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

// Broadcasts (bulk messaging). Idempotent: guarded CREATE TYPE, IF NOT EXISTS
// tables/indexes. `broadcast_recipients` PK (broadcast_id, user_id) dedupes a
// user delivered under multiple roles. Distinct from platform `announcements`.
const BROADCASTS = `
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'broadcast_scope') THEN
    CREATE TYPE broadcast_scope AS ENUM ('organization','team');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'broadcast_recipient_role') THEN
    CREATE TYPE broadcast_recipient_role AS ENUM ('coach','player','parent');
  END IF;
END$migration$;

CREATE TABLE IF NOT EXISTS broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope broadcast_scope NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  allow_replies boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broadcasts_organization_id_idx ON broadcasts (organization_id);
CREATE INDEX IF NOT EXISTS broadcasts_team_id_idx ON broadcasts (team_id);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_role broadcast_recipient_role NOT NULL,
  child_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  read_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (broadcast_id, user_id)
);
CREATE INDEX IF NOT EXISTS broadcast_recipients_user_id_idx ON broadcast_recipients (user_id);

CREATE TABLE IF NOT EXISTS broadcast_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  family_parent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broadcast_replies_thread_idx
  ON broadcast_replies (broadcast_id, family_parent_user_id);

CREATE TABLE IF NOT EXISTS broadcast_assets (
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (broadcast_id, asset_id)
);
`;

// Task #633 — Per-user email notification preferences. One row per user,
// lazily created in app code (which mints the unsubscribe_token). Idempotent.
const TASK_633_NOTIFICATION_PREFERENCES = `
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  social_follow boolean NOT NULL DEFAULT true,
  social_comment boolean NOT NULL DEFAULT true,
  social_reaction boolean NOT NULL DEFAULT true,
  social_tag boolean NOT NULL DEFAULT true,
  team_recap boolean NOT NULL DEFAULT true,
  team_roster boolean NOT NULL DEFAULT true,
  team_broadcast boolean NOT NULL DEFAULT true,
  reminder_schedule boolean NOT NULL DEFAULT true,
  reminder_game_recap boolean NOT NULL DEFAULT true,
  digest_weekly boolean NOT NULL DEFAULT true,
  motivational boolean NOT NULL DEFAULT true,
  pause_all boolean NOT NULL DEFAULT false,
  unsubscribe_token text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_unsubscribe_token_key
  ON notification_preferences (unsubscribe_token);
`;

// Admin-entered email-provider credentials (SendGrid) configurable from the
// admin Email settings UI. One row per provider. Mirrors ai_provider_keys.
// Idempotent.
const EMAIL_PROVIDER_KEYS = `
CREATE TABLE IF NOT EXISTS email_provider_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE,
  from_email text,
  key_ciphertext text NOT NULL,
  key_last4 text NOT NULL,
  created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
`;

// Task #666 — per-invite email delivery tracking driven by the SendGrid Event
// Webhook. Idempotent: guard the enum type creation and add each column only
// when missing so re-runs (and the dev push path) are safe.
const TASK_666_INVITE_DELIVERY_TRACKING = `
DO $$ BEGIN
  CREATE TYPE invite_delivery_status AS ENUM (
    'unknown', 'sent', 'delivered', 'deferred', 'bounced', 'dropped', 'spam'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;
ALTER TABLE roster_invites
  ADD COLUMN IF NOT EXISTS delivery_status invite_delivery_status NOT NULL DEFAULT 'unknown';
ALTER TABLE roster_invites ADD COLUMN IF NOT EXISTS delivery_event_at timestamp;
ALTER TABLE roster_invites ADD COLUMN IF NOT EXISTS delivery_reason text;
ALTER TABLE organization_invites
  ADD COLUMN IF NOT EXISTS delivery_status invite_delivery_status NOT NULL DEFAULT 'unknown';
ALTER TABLE organization_invites ADD COLUMN IF NOT EXISTS delivery_event_at timestamp;
ALTER TABLE organization_invites ADD COLUMN IF NOT EXISTS delivery_reason text;
`;

// Daily Admin Digest — recipient list of arbitrary operator email addresses
// managed by the platform admin. Idempotent.
const DAILY_ADMIN_DIGEST_RECIPIENTS = `
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
`;

// Daily Admin Digest — single-row global on/off switch for the cron. Absence of
// a row means ENABLED (on by default). Idempotent.
const DAILY_ADMIN_DIGEST_SETTINGS = `
CREATE TABLE IF NOT EXISTS daily_admin_digest_settings (
  id text PRIMARY KEY DEFAULT 'default',
  enabled boolean NOT NULL DEFAULT true,
  updated_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
`;

// Task #686 — Admin "permanently delete a deactivated account" action.
// Adds the `permanent_delete_user` value to the admin_action_type enum so
// the route can record the hard-delete in admin_activity_log. Idempotent.
const TASK_686_PERMANENT_DELETE_USER = `
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'admin_action_type' AND e.enumlabel = 'permanent_delete_user'
  ) THEN
    ALTER TYPE admin_action_type ADD VALUE 'permanent_delete_user';
  END IF;
END$migration$;
`;

const USER_PINNED_TEAMS = `
CREATE TABLE IF NOT EXISTS user_pinned_teams (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, team_id)
);
CREATE INDEX IF NOT EXISTS user_pinned_teams_user_id_idx ON user_pinned_teams(user_id);
`;

// Task #717 — Per-user pinned orgs (max 5, enforced in the route +
// OpenAPI maxItems). Mirrors user_pinned_teams so a viewer can float their
// most-used orgs to the top of the "Your Orgs and Teams" sidebar. Idempotent.
const USER_PINNED_ORGS = `
CREATE TABLE IF NOT EXISTS user_pinned_orgs (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);
CREATE INDEX IF NOT EXISTS user_pinned_orgs_user_id_idx ON user_pinned_orgs(user_id);
`;

// Competitions step 1 — generalize tournaments → competitions at the app
// level. SQL table names intentionally stay `tournaments`/`tournament_*`
// (physical renames risk drop+create data loss at publish time). All
// statements are additive + idempotent; backfills only fill NULLs so a
// re-run never clobbers newer values.
const COMPETITIONS_STEP1 = `
  ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'tournament';
  ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS auto_approve_claims boolean NOT NULL DEFAULT true;
  ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS logo_url text;
  ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS brand_color text;
  ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS banner_url text;
  ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS website_url text;
  -- One-time legacy backfill only: rows created before this feature shipped
  -- get owner = creator. Newer rows whose owner was deleted (FK SET NULL)
  -- must stay ownerless (platform-admin-operated), not silently revert to
  -- the creator on the next boot.
  UPDATE tournaments SET owner_user_id = created_by_id
    WHERE owner_user_id IS NULL AND created_at < '2026-07-09T00:00:00Z';

  ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS home_score_official integer;
  ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS away_score_official integer;
  ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scheduled';
  UPDATE tournament_matches
    SET home_score_official = home_score,
        away_score_official = away_score
    WHERE home_score_official IS NULL
      AND away_score_official IS NULL
      AND home_score IS NOT NULL
      AND away_score IS NOT NULL;

  ALTER TABLE articles ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES tournaments(id) ON DELETE SET NULL;
  ALTER TABLE articles ADD COLUMN IF NOT EXISTS competition_game_id uuid REFERENCES tournament_matches(id) ON DELETE SET NULL;
  ALTER TABLE articles ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
  CREATE INDEX IF NOT EXISTS articles_competition_id_idx ON articles(competition_id);

  CREATE TABLE IF NOT EXISTS game_score_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_game_id uuid NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    reported_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    home_score integer NOT NULL,
    away_score integer NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS game_score_reports_game_id_idx ON game_score_reports(competition_game_id);
  CREATE UNIQUE INDEX IF NOT EXISTS game_score_reports_unique_game_team ON game_score_reports(competition_game_id, team_id);

  ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS pending_team_id uuid REFERENCES teams(id) ON DELETE SET NULL;
  ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS pending_claimed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS pending_claimed_at timestamp;
`;

// hint: Logic changed on both sides. Requires understanding intent of each change.
// Task #833 — backfill roster auto-tags on already-published combined
// recaps. Exported so the test suite can exercise the exact SQL the
// marker-gated migration runs (the marker is already set in dev/test DBs
// by the time tests run). Inserts only missing rows: NOT EXISTS skips
// every user who already has a tag on the article (approved, pending,
// declined, or removed alike), so re-running never flips a status.
export const COMBINED_RECAP_TAG_BACKFILL_SQL = `
          INSERT INTO article_tags (article_id, user_id, tagger_user_id, status, source)
          SELECT
            a.id,
            re.user_id,
            a.author_id,
            (CASE WHEN u.require_tag_consent OR EXISTS (
              SELECT 1 FROM guardian_links gl
              JOIN users g ON g.id = gl.guardian_id
              WHERE gl.child_id = re.user_id
                AND gl.status = 'active'
                AND g.require_tag_consent
            ) THEN 'pending' ELSE 'approved' END)::tag_status,
            'auto'::tag_source
          FROM articles a
          JOIN roster_entries re
            ON re.team_id = a.team_id
           AND re.role = 'player'
           AND re.status = 'accepted'
          JOIN users u ON u.id = re.user_id
          WHERE a.recap_kind = 'combined'
            AND a.status = 'published'
            AND NOT EXISTS (
              SELECT 1 FROM article_tags t
              WHERE t.article_id = a.id AND t.user_id = re.user_id
            )
          ON CONFLICT DO NOTHING;
`;

// Legacy organizations that had already selected a plan when the Aug 20
// rollout shipped cannot receive their first annual charge before Nov 1.
// Trialing rows only: active/canceled subscriptions are deliberately untouched.
export const LEGACY_ORG_BILLING_FLOOR_SQL = `
UPDATE org_subscriptions s
SET billing_starts_at = '2026-11-01 00:00:00'::timestamp,
    updated_at = NOW()
FROM organizations o
WHERE o.id = s.organization_id
  AND o.created_at < '2026-08-20 00:00:00'::timestamp
  AND s.status = 'trialing'
  AND (
    s.billing_starts_at IS NULL
    OR s.billing_starts_at < '2026-11-01 00:00:00'::timestamp
  );
`;

// Task #794's rolling-date conversion remains part of every startup. It must
// exclude the legacy-floor population and non-trialing rows or it would undo
// and reapply Task #878 on every boot (and alter paid/canceled history).
export const ROLLING_90_DAY_BILLING_SQL = `
ALTER TABLE org_subscriptions
  ADD COLUMN IF NOT EXISTS trial_reminder_sent_at timestamp;
UPDATE org_subscriptions s
SET billing_starts_at = GREATEST(
      o.created_at + interval '90 days',
      NOW() + interval '3 days'
    ),
    updated_at = NOW()
FROM organizations o
WHERE o.id = s.organization_id
  AND o.created_at >= '2026-08-20 00:00:00'::timestamp
  AND s.status = 'trialing'
  AND s.billing_starts_at = '2026-11-01 00:00:00'::timestamp;
`;

// Task #895 — durable, shared manual-outreach state for every active
// organization team. The row is retained when a manager unchecks it so the
// shared checklist remains a real persistent record rather than browser state.
const TASK_895_ROSTER_OUTREACH = `
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
`;

// Shared team join links are bearer capabilities: protect their entropy and
// enforce one pending email-less player link per team.
const TASK_895_SECURE_ROSTER_JOIN_LINKS = `
DELETE FROM roster_invites duplicate
USING roster_invites canonical
WHERE duplicate.team_id = canonical.team_id
  AND duplicate.invited_email IS NULL
  AND duplicate.status = 'pending'
  AND duplicate.role = 'player'
  AND canonical.invited_email IS NULL
  AND canonical.status = 'pending'
  AND canonical.role = 'player'
  AND (
    duplicate.created_at > canonical.created_at
    OR (
      duplicate.created_at = canonical.created_at
      AND duplicate.id::text > canonical.id::text
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS roster_invites_pending_email_less_player_team_uniq
  ON roster_invites (team_id)
  WHERE invited_email IS NULL AND status = 'pending' AND role = 'player';
`;

// Task #906 — one hashed envelope token can cover several team-level coach
// invites. Child roster_invites retain their normal per-team status so a
// manager can withdraw one team without granting it during group acceptance.
const TASK_906_GROUPED_COACH_INVITES = `
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
`;

// hint: Logic changed on both sides. Requires understanding intent of each change.
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
  {
    name: "2026-06-26-broadcasts",
    sql: BROADCASTS,
  },
  {
    name: "2026-06-30-task-633-notification-preferences",
    sql: TASK_633_NOTIFICATION_PREFERENCES,
  },
  {
    name: "2026-06-30-email-provider-keys",
    sql: EMAIL_PROVIDER_KEYS,
  },
  {
    name: "2026-06-30-task-666-invite-delivery-tracking",
    sql: TASK_666_INVITE_DELIVERY_TRACKING,
  },
  {
    name: "2026-07-01-daily-admin-digest-recipients",
    sql: DAILY_ADMIN_DIGEST_RECIPIENTS,
  },
  {
    name: "2026-07-01-daily-admin-digest-settings",
    sql: DAILY_ADMIN_DIGEST_SETTINGS,
  },
  {
    name: "2026-07-01-task-681-org-outreach-facebook-added",
    sql: TASK_681_ORG_OUTREACH_FACEBOOK_ADDED,
  },
  {
    name: "2026-07-01-task-686-permanent-delete-user",
    sql: TASK_686_PERMANENT_DELETE_USER,
  },
  {
    name: "2026-07-02-user-pinned-teams",
    sql: USER_PINNED_TEAMS,
  },
  {
    name: "2026-07-03-task-717-user-pinned-orgs",
    sql: USER_PINNED_ORGS,
  },
  {
    name: "2026-07-09-competitions-step1",
    sql: COMPETITIONS_STEP1,
  },
  {
    name: "2026-07-10-competition-followers",
    sql: `
      CREATE TABLE IF NOT EXISTS competition_followers (
        competition_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamp DEFAULT now() NOT NULL,
        PRIMARY KEY (competition_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS competition_followers_user_id_idx
        ON competition_followers (user_id);
    `,
  },
  {
    name: "2026-07-09-competition-secondary-colors",
    sql: `
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS secondary_color text;
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tertiary_color text;
    `,
  },
  {
    name: "2026-07-10-task-723-competition-organizers",
    sql: `
      CREATE TABLE IF NOT EXISTS competition_organizers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL UNIQUE,
        name text NOT NULL,
        description text,
        owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        logo_url text,
        brand_color text,
        secondary_color text,
        tertiary_color text,
        banner_url text,
        website_url text,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS competition_organizers_owner_user_id_idx
        ON competition_organizers (owner_user_id);
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS organizer_id uuid
        REFERENCES competition_organizers(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS tournaments_organizer_id_idx
        ON tournaments (organizer_id);
    `,
  },
  {
    name: "2026-07-10-task-723-organizer-followers",
    sql: `
      CREATE TABLE IF NOT EXISTS organizer_followers (
        organizer_id uuid NOT NULL REFERENCES competition_organizers(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamp DEFAULT now() NOT NULL,
        PRIMARY KEY (organizer_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS organizer_followers_user_id_idx
        ON organizer_followers (user_id);
    `,
  },
  {
    // Task #733 — org brand colors for the org-page hero gradient +
    // team-page brand strip. Nullable hex strings, no backfill.
    name: "2026-07-11-task-733-org-brand-colors",
    sql: `
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_primary_color text;
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_secondary_color text;
    `,
  },
  {
    // Task #745 — hub/competition admin memberships + email-invite table.
    // organizer_admins grants hub-wide rights (all attached competitions,
    // incl. later-attached); competition_admins scopes to one competition.
    // Invites hash their token at rest (mirrors organization_invites).
    name: "2026-07-13-task-745-competition-admins",
    sql: `
      CREATE TABLE IF NOT EXISTS organizer_admins (
        organizer_id uuid NOT NULL REFERENCES competition_organizers(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        granted_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        PRIMARY KEY (organizer_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS organizer_admins_user_id_idx
        ON organizer_admins (user_id);
      CREATE TABLE IF NOT EXISTS competition_admins (
        competition_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        granted_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        PRIMARY KEY (competition_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS competition_admins_user_id_idx
        ON competition_admins (user_id);
      CREATE TABLE IF NOT EXISTS competition_admin_invites (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organizer_id uuid REFERENCES competition_organizers(id) ON DELETE CASCADE,
        competition_id uuid REFERENCES tournaments(id) ON DELETE CASCADE,
        invited_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
        invited_email text NOT NULL,
        token_hash text NOT NULL UNIQUE,
        status invite_status DEFAULT 'pending' NOT NULL,
        resolved_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        withdrawn_at timestamp,
        accepted_at timestamp,
        expires_at timestamp,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS competition_admin_invites_organizer_id_idx
        ON competition_admin_invites (organizer_id);
      CREATE INDEX IF NOT EXISTS competition_admin_invites_competition_id_idx
        ON competition_admin_invites (competition_id);
    `,
  },
  {
    // Task #746 — per-team hidden competition games. A team admin can hide
    // an imported tournament match from the public team page (scoped to the
    // team page only; the competition's own page is unaffected).
    name: "2026-07-13-task-746-team-hidden-competition-games",
    sql: `
      CREATE TABLE IF NOT EXISTS team_hidden_competition_games (
        team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        competition_game_id uuid NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
        hidden_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        PRIMARY KEY (team_id, competition_game_id)
      );
    `,
  },
  {
    // Competition-admin hide for participant slots — hidden slots are
    // omitted from the public Teams list on the competition page; operators
    // still see them (greyed) and can unhide. Schedule is unaffected.
    name: "2026-07-13-tournament-participants-hidden",
    sql: `
      ALTER TABLE tournament_participants
        ADD COLUMN IF NOT EXISTS hidden_at timestamp;
      ALTER TABLE tournament_participants
        ADD COLUMN IF NOT EXISTS hidden_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
    `,
  },
  {
    // Task #755 — multi-guardian support. Creates guardian_links and
    // backfills every existing users.parent_id into an ACTIVE PRIMARY link.
    // `users.parent_id` stays as a dual-written mirror of the primary
    // active guardian (the locked coppa.ts reads it), so the backfill must
    // run before any link-aware code path. Idempotent: the backfill only
    // inserts when no live link exists for the (child, guardian) pair.
    name: "2026-07-13-task-755-guardian-links",
    sql: `
      DO $migration$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'guardian_relationship') THEN
          CREATE TYPE guardian_relationship AS ENUM ('parent', 'legal_guardian');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'guardian_link_status') THEN
          CREATE TYPE guardian_link_status AS ENUM ('pending', 'active', 'revoked');
        END IF;
      END$migration$;

      ALTER TYPE consent_audit_event ADD VALUE IF NOT EXISTS 'guardian_link_invited';
      ALTER TYPE consent_audit_event ADD VALUE IF NOT EXISTS 'guardian_link_accepted';
      ALTER TYPE consent_audit_event ADD VALUE IF NOT EXISTS 'guardian_link_declined';
      ALTER TYPE consent_audit_event ADD VALUE IF NOT EXISTS 'guardian_link_removed';
      ALTER TYPE consent_audit_event ADD VALUE IF NOT EXISTS 'guardian_link_primary_transferred';

      CREATE TABLE IF NOT EXISTS guardian_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        child_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        guardian_id uuid REFERENCES users(id) ON DELETE CASCADE,
        invite_email text,
        relationship_type guardian_relationship DEFAULT 'parent' NOT NULL,
        is_primary boolean DEFAULT false NOT NULL,
        status guardian_link_status DEFAULT 'pending' NOT NULL,
        consent_granted_at timestamp,
        consent_method text,
        invited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS guardian_links_child_id_idx
        ON guardian_links (child_id);
      CREATE INDEX IF NOT EXISTS guardian_links_guardian_id_idx
        ON guardian_links (guardian_id);
      CREATE UNIQUE INDEX IF NOT EXISTS guardian_links_one_primary_active
        ON guardian_links (child_id)
        WHERE is_primary AND status = 'active';
      CREATE UNIQUE INDEX IF NOT EXISTS guardian_links_live_pair_uniq
        ON guardian_links (child_id, guardian_id)
        WHERE status <> 'revoked';

      -- Backfill: every existing parent_id becomes an active PRIMARY link.
      INSERT INTO guardian_links
        (child_id, guardian_id, invite_email, relationship_type, is_primary,
         status, consent_granted_at, consent_method)
      SELECT
        c.id,
        c.parent_id,
        lower(g.email),
        'parent',
        true,
        'active',
        COALESCE(c.guardian_confirmed_at, c.consent_finalized_at, now()),
        'legacy_parent_id_backfill'
      FROM users c
      JOIN users g ON g.id = c.parent_id
      WHERE c.parent_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM guardian_links gl
           WHERE gl.child_id = c.id
             AND gl.guardian_id = c.parent_id
             AND gl.status <> 'revoked'
        )
        AND NOT EXISTS (
          SELECT 1 FROM guardian_links gl2
           WHERE gl2.child_id = c.id
             AND gl2.is_primary
             AND gl2.status = 'active'
        );
    `,
  },
  {
    // Task #755 — belt-and-braces for the parent_id ↔ guardian_links
    // invariant. All converted code writes links first and mirrors
    // `users.parent_id` via syncParentIdMirror, but any remaining direct
    // writer (legacy scripts, test fixtures, future code) that sets
    // `parent_id` without a link would silently drop the child out of every
    // link-derived fan-out. This trigger mirrors such writes into an ACTIVE
    // guardian link (primary when the child has no active primary yet),
    // exactly like the one-time backfill above. No-ops when a live link for
    // the pair already exists, so the dual-writing app code never conflicts.
    name: "2026-07-13-task-755-parent-id-write-trigger",
    sql: `
      CREATE OR REPLACE FUNCTION sync_guardian_link_from_parent_id()
      RETURNS trigger AS $fn$
      BEGIN
        -- Legacy detach/reparent: a direct write that clears or changes
        -- parent_id revokes the OLD pair's link — but ONLY while that link
        -- is still the PRIMARY ACTIVE one. App-code flows (transfer-primary,
        -- remove-guardian) demote/revoke the link BEFORE mirroring
        -- parent_id, so this branch is a no-op for them and co-guardian
        -- links are never touched.
        IF TG_OP = 'UPDATE'
           AND OLD.parent_id IS NOT NULL
           AND NEW.parent_id IS DISTINCT FROM OLD.parent_id
        THEN
          UPDATE guardian_links
             SET status = 'revoked', is_primary = false, updated_at = now()
           WHERE child_id = NEW.id
             AND guardian_id = OLD.parent_id
             AND is_primary
             AND status = 'active';
        END IF;

        IF NEW.parent_id IS NOT NULL
           AND (TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id)
        THEN
          INSERT INTO guardian_links
            (child_id, guardian_id, relationship_type, is_primary,
             status, consent_granted_at, consent_method)
          SELECT
            NEW.id,
            NEW.parent_id,
            'parent',
            NOT EXISTS (
              SELECT 1 FROM guardian_links gl
               WHERE gl.child_id = NEW.id
                 AND gl.is_primary
                 AND gl.status = 'active'
            ),
            'active',
            COALESCE(NEW.guardian_confirmed_at, NEW.consent_finalized_at, now()),
            'legacy_parent_id_write'
          WHERE NOT EXISTS (
            SELECT 1 FROM guardian_links gl
             WHERE gl.child_id = NEW.id
               AND gl.guardian_id = NEW.parent_id
               AND gl.status <> 'revoked'
          );
        END IF;

        -- Legacy clear (parent_id -> NULL) while other ACTIVE co-guardian
        -- links remain: promote the oldest remaining active link to primary
        -- and mirror it back into users.parent_id so the invariant
        -- "parent_id mirrors the primary ACTIVE guardian" cannot drift.
        -- App-code flows never hit this: syncParentIdMirror only writes NULL
        -- when NO active links remain, so the promote SELECT finds nothing.
        -- The mirror UPDATE re-fires this trigger, but that pass takes the
        -- insert branch (live pair exists -> no-op) and skips this one
        -- (NEW.parent_id is no longer NULL), so it terminates.
        IF TG_OP = 'UPDATE'
           AND NEW.parent_id IS NULL
           AND OLD.parent_id IS NOT NULL
        THEN
          DECLARE
            promoted_guardian uuid;
            promoted_link uuid;
          BEGIN
            SELECT gl.guardian_id, gl.id
              INTO promoted_guardian, promoted_link
              FROM guardian_links gl
             WHERE gl.child_id = NEW.id
               AND gl.status = 'active'
               AND gl.guardian_id IS NOT NULL
             ORDER BY gl.is_primary DESC, gl.created_at
             LIMIT 1;
            IF promoted_link IS NOT NULL THEN
              UPDATE guardian_links
                 SET is_primary = true, updated_at = now()
               WHERE id = promoted_link
                 AND NOT is_primary
                 AND NOT EXISTS (
                   SELECT 1 FROM guardian_links gl2
                    WHERE gl2.child_id = NEW.id
                      AND gl2.status = 'active'
                      AND gl2.is_primary
                 );
              UPDATE users
                 SET parent_id = promoted_guardian
               WHERE id = NEW.id
                 AND parent_id IS NULL;
            END IF;
          END;
        END IF;
        RETURN NEW;
      END
      $fn$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS users_parent_id_guardian_link_sync ON users;
      CREATE TRIGGER users_parent_id_guardian_link_sync
        AFTER INSERT OR UPDATE OF parent_id ON users
        FOR EACH ROW
        EXECUTE FUNCTION sync_guardian_link_from_parent_id();
    `,
  },
  {
    // Free launch period extended: billing now starts Nov 1 2026 (was
    // Oct 1). BILLING_STARTS_AT in stripe-billing.ts/subscriptions.ts is
    // the source for NEW rows; this idempotently moves rows that were
    // stamped with the old date. Rows with a Stripe subscription would
    // also need their Stripe trial_end moved via the API — as of this
    // migration none exist; if any appear before it runs in prod, handle
    // them via a one-off reconcile.
    name: "2026-07-15-billing-start-nov-1",
    sql: `
      UPDATE org_subscriptions
      SET billing_starts_at = '2026-11-01T00:00:00Z', updated_at = NOW()
      WHERE billing_starts_at = '2026-10-01T00:00:00Z';
    `,
  },
  {
    // Task #761 — deleting a recap (soft delete via articles.hidden_at) now
    // also clears the schedule game's game_recap_id in the same transaction.
    // This backfills games whose linked recap was deleted BEFORE that fix,
    // so the schedule stops referencing a dead post. recap_reminder_sent_at
    // is stamped so the reminder sweep doesn't re-nudge staff about games
    // whose recap they deliberately deleted.
    name: "2026-07-17-task-761-clear-deleted-recap-links",
    sql: `
      UPDATE schedule_events se
      SET game_recap_id = NULL,
          recap_reminder_sent_at = COALESCE(se.recap_reminder_sent_at, NOW()),
          updated_at = NOW()
      FROM articles a
      WHERE se.game_recap_id = a.id
        AND a.hidden_at IS NOT NULL;
    `,
  },
  {
    // Task #765 — inline game edit & cancel in the organizer console.
    // `status` itself already exists (COMPETITIONS_STEP1, default
    // 'scheduled'); this adds the optional operator-entered reason shown
    // with postponed/canceled games.
    name: "2026-07-17-task-765-match-status-reason",
    sql: `
      ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS status_reason text;
    `,
  },
  {
    // Competition claim links — admin screen mirroring the org claim-links
    // tab: ownerless competitions carry a secret plaintext claim token plus
    // operator outreach bookkeeping timestamps.
    name: "2026-07-18-competition-claim-links",
    sql: `
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS claim_token text;
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS outreach_messaged_at timestamp;
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS outreach_facebook_added_at timestamp;
      CREATE UNIQUE INDEX IF NOT EXISTS tournaments_claim_token_idx
        ON tournaments (claim_token) WHERE claim_token IS NOT NULL;
    `,
  },
  {
    // Task #794 — rolling 90-day free period. Billing now starts 90 days
    // after each org's creation instead of the fixed Nov 1 2026 date.
    // Re-stamps existing rows from organizations.created_at (floored at
    // NOW() + 3 days so nothing lands in the past), and adds the
    // trial_reminder_sent_at stamp for the 14-days-before-charge reminder.
    // Rows with a live Stripe subscription also need their Stripe trial_end
    // moved via the API — run scripts/sync-stripe-trial-ends for those.
    name: "2026-07-21-task-794-rolling-90-day-free-period",
    sql: ROLLING_90_DAY_BILLING_SQL,
  },
  {
    // Task #800 — recap tags now auto-approve by default; per-tag review
    // is an explicit guardian opt-in from the Family dashboard.
    //   1. Adds `tag_consent_set_explicitly` — stamped true whenever a
    //      toggle endpoint deliberately writes `require_tag_consent`.
    //   2. Flips `require_tag_consent` off for accounts where it was only
    //      set by the legacy signup/COPPA auto-default (no explicit
    //      choice recorded). Guardians who opted in via the toggle keep
    //      their setting (flag stamped by the same-deploy code before any
    //      subsequent boot re-runs this).
    //   3. Approves recap (article) tags stuck `pending` for users whose
    //      effective gate is now off — i.e. the tag would be inserted as
    //      `approved` today: the user doesn't require consent AND no
    //      active guardian does. Declined tags are untouched; highlight
    //      tags are untouched (they are pending-by-design).
    // Idempotent: step 2's WHERE only matches non-explicit rows and step 3
    // only matches rows that current insert logic would approve anyway.
    name: "2026-07-26-task-800-auto-approve-recap-tags",
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS tag_consent_set_explicitly boolean NOT NULL DEFAULT false;

      UPDATE users
         SET require_tag_consent = false
       WHERE require_tag_consent = true
         AND tag_consent_set_explicitly = false
         AND (
           is_minor = true
           OR parent_id IS NOT NULL
           OR EXISTS (
             SELECT 1 FROM guardian_links gl
              WHERE gl.child_id = users.id AND gl.status = 'active'
           )
         );

      UPDATE article_tags at
         SET status = 'approved', updated_at = NOW()
       WHERE at.status = 'pending'
         AND EXISTS (
           SELECT 1 FROM users u
            WHERE u.id = at.user_id
              AND u.require_tag_consent = false
         )
         AND NOT EXISTS (
           SELECT 1
             FROM guardian_links gl
             JOIN users g ON g.id = gl.guardian_id
            WHERE gl.child_id = at.user_id
              AND gl.status = 'active'
              AND g.require_tag_consent = true
         );
    `,
  },
  {
    // Task #801 — org-level "Require recap approval" toggle. Default FALSE:
    // coach recaps now publish immediately unless the org opts back into the
    // review-queue workflow. Existing pending_approval rows are untouched
    // (they stay approvable from the admin queue).
    name: "2026-07-26-task-801-org-require-recap-approval",
    sql: `
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS require_recap_approval boolean NOT NULL DEFAULT false;
    `,
  },
  {
    // Task #808 — draft coach emails a platform admin stages per team on an
    // unclaimed org. Nothing is sent from this table; the post-claim owner
    // confirmation converts rows into real team invites and deletes them.
    name: "2026-07-28-task-808-staged-coach-invites",
    sql: `
      CREATE TABLE IF NOT EXISTS staged_coach_invites (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        team_id         uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        email           text NOT NULL,
        created_by_id   uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at      timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS staged_coach_invites_team_email_uniq
        ON staged_coach_invites (team_id, email);
      CREATE INDEX IF NOT EXISTS staged_coach_invites_org_idx
        ON staged_coach_invites (organization_id);
    `,
  },
  {
    // Task #819 — one-time cleanup: platform admins (users.role='admin') who
    // created orgs/teams for hand-off were historically auto-listed as org
    // owner, org follower, and team coach. Remove those legacy rows so
    // handed-off pages only show real staff. Removing an admin 'owner' row
    // intentionally returns the org to UNCLAIMED (no 'owner' row) so real
    // staff can claim it; platform admins lose no capability (permissions
    // bypass). Allowlist of genuinely admin-operated org names reviewed
    // 2026-07-28: empty — no such orgs exist. Guarded by a marker row so the
    // deletes run exactly ONCE (migrations re-run every boot, and future
    // legitimate admin memberships must not be silently deleted). Mirrors
    // scripts/src/cleanup-platform-admin-handoff.ts (dev dry-run tool) —
    // keep the criteria and allowlist in sync.
    name: "2026-07-28-task-819-remove-platform-admin-handoff-listings",
    sql: `
      CREATE TABLE IF NOT EXISTS one_time_migration_markers (
        name       text PRIMARY KEY,
        applied_at timestamp NOT NULL DEFAULT now()
      );
      DO $migration$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM one_time_migration_markers
          WHERE name = '2026-07-28-task-819-remove-platform-admin-handoff-listings'
        ) THEN
          DELETE FROM organization_admins oa
          USING users u, organizations o
          WHERE oa.user_id = u.id AND u.role = 'admin'
            AND o.id = oa.organization_id AND o.created_by_id = oa.user_id;

          DELETE FROM organization_followers f
          USING users u, organizations o
          WHERE f.user_id = u.id AND u.role = 'admin'
            AND o.id = f.organization_id AND o.created_by_id = f.user_id;

          DELETE FROM roster_entries re
          USING users u, teams t
          WHERE re.user_id = u.id AND u.role = 'admin'
            AND t.id = re.team_id
            AND (
              t.created_by_id = re.user_id
              OR EXISTS (
                SELECT 1 FROM organizations o
                WHERE o.id = t.organization_id
                  AND o.created_by_id = re.user_id
              )
            );

          INSERT INTO one_time_migration_markers (name)
          VALUES ('2026-07-28-task-819-remove-platform-admin-handoff-listings');
        END IF;
      END$migration$;
    `,
  },
  {
    // Follow-up to task #819: production has hand-off orgs/teams created
    // BEFORE created_by_id was recorded (both NULL — e.g. "FC BERNA -
    // LEGACY"), which the creator-matching cleanup above cannot catch. A
    // platform admin listed as roster staff on a team whose org is
    // UNCLAIMED (no owner row) is a hand-off artifact, not a real
    // membership — platform admins retain manage powers via the
    // permissions bypass, so nothing is lost. Marker-gated one-shot, same
    // rationale as above.
    name: "2026-07-28-task-819b-remove-admin-roster-on-unclaimed-orgs",
    sql: `
      CREATE TABLE IF NOT EXISTS one_time_migration_markers (
        name       text PRIMARY KEY,
        applied_at timestamp NOT NULL DEFAULT now()
      );
      DO $migration$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM one_time_migration_markers
          WHERE name = '2026-07-28-task-819b-remove-admin-roster-on-unclaimed-orgs'
        ) THEN
          DELETE FROM roster_entries re
          USING users u, teams t, organizations o
          WHERE re.user_id = u.id AND u.role = 'admin'
            AND t.id = re.team_id
            AND o.id = t.organization_id
            AND NOT EXISTS (
              SELECT 1 FROM organization_admins oa
              WHERE oa.organization_id = o.id AND oa.role = 'owner'
            );

          INSERT INTO one_time_migration_markers (name)
          VALUES ('2026-07-28-task-819b-remove-admin-roster-on-unclaimed-orgs');
        END IF;
      END$migration$;
    `,
  },
  {
    // Task #818 — organizer promo code that auto-fills outreach messages.
    // Hub-level code with an optional per-competition override (competition
    // falls back to its hub's code when NULL). Free text; issued by platform
    // admins out of band.
    name: "2026-07-28-task-818-organizer-promo-code",
    sql: `
      ALTER TABLE competition_organizers
        ADD COLUMN IF NOT EXISTS promo_code text;
      ALTER TABLE tournaments
        ADD COLUMN IF NOT EXISTS promo_code text;
    `,
  },
  {
    // Task #833 — combined recaps historically skipped the roster auto-tag
    // fan-out (it was gated on gameDate, which combined recaps never set),
    // so already-published combined recaps never surface on players'
    // profile pages. One-shot backfill: insert missing `auto` tags for
    // every accepted rostered player on published combined recaps,
    // respecting consent (pending when the player OR any active guardian
    // requires tag consent). Existing rows — including declined ones —
    // are never touched (NOT EXISTS + ON CONFLICT), and no notifications
    // are sent (SQL-only path, mirrors "notify only on publish moments").
    // Marker-gated so future declines/removals aren't re-inserted on boot.
    name: "2026-07-30-task-833-backfill-combined-recap-roster-tags",
    sql: `
      CREATE TABLE IF NOT EXISTS one_time_migration_markers (
        name       text PRIMARY KEY,
        applied_at timestamp NOT NULL DEFAULT now()
      );
      DO $migration$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM one_time_migration_markers
          WHERE name = '2026-07-30-task-833-backfill-combined-recap-roster-tags'
        ) THEN
          ${COMBINED_RECAP_TAG_BACKFILL_SQL}

          INSERT INTO one_time_migration_markers (name)
          VALUES ('2026-07-30-task-833-backfill-combined-recap-roster-tags');
        END IF;
      END$migration$;
    `,
  },
  {
    // Admin quick setup — staged promo code for hand-off orgs. Surfaced on
    // the claim page and auto-applied on the subscribe page.
    name: "2026-07-30-org-pending-promo-code",
    sql: `
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS pending_promo_code_id uuid
          REFERENCES promo_codes(id) ON DELETE SET NULL;
    `,
  },
  {
    // Task #852 — organizer-defined competition brackets used to sort
    // recaps (labels only; no standings/seeding). Auto-seeded from the
    // schedule import's division/bracket column; articles get a nullable
    // bracket reference set by the coach in the composer or re-assigned
    // by the organizer. Idempotent.
    name: "2026-08-14-task-852-competition-brackets",
    sql: `
      CREATE TABLE IF NOT EXISTS competition_brackets (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        label         text NOT NULL,
        label_key     text NOT NULL,
        gender        text,
        age_group     text,
        sort_order    integer NOT NULL DEFAULT 0,
        created_at    timestamp NOT NULL DEFAULT now(),
        updated_at    timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS competition_brackets_tournament_id_idx
        ON competition_brackets(tournament_id);
      CREATE UNIQUE INDEX IF NOT EXISTS competition_brackets_unique_label
        ON competition_brackets(tournament_id, label_key);

      ALTER TABLE articles
        ADD COLUMN IF NOT EXISTS bracket_id uuid
          REFERENCES competition_brackets(id) ON DELETE SET NULL;
    `,
  },
  {
    // Participant identity is (competition, name, gender). The same exact
    // name in multiple divisions/brackets is ONE participant slot per gender
    // — this fixes the duplicate-team-names-after-upload bug WITHOUT merging
    // real same-named boys/girls teams (seen in production: a club fielding
    // "Red 2012" in both a girls and a boys division). Merge duplicates
    // (keeping a claimed row over an unclaimed one, then the oldest),
    // repoint matches at the keeper, then swap the unique index. Idempotent:
    // after the first run there are no duplicates and the index statements
    // are IF-guarded. (Supersedes the short-lived name-only unique index.)
    name: "2026-08-14-participant-unique-per-name-gender",
    sql: `
      WITH ranked AS (
        SELECT id,
               first_value(id) OVER (
                 PARTITION BY tournament_id, name_key, LOWER(BTRIM(COALESCE(gender, '')))
                 ORDER BY (team_id IS NOT NULL) DESC,
                          (pending_team_id IS NOT NULL) DESC,
                          created_at ASC, id ASC
               ) AS keeper_id
        FROM tournament_participants
      ),
      dupes AS (SELECT id, keeper_id FROM ranked WHERE id <> keeper_id)
      UPDATE tournament_matches m
        SET home_participant_id = d.keeper_id
        FROM dupes d WHERE m.home_participant_id = d.id;

      WITH ranked AS (
        SELECT id,
               first_value(id) OVER (
                 PARTITION BY tournament_id, name_key, LOWER(BTRIM(COALESCE(gender, '')))
                 ORDER BY (team_id IS NOT NULL) DESC,
                          (pending_team_id IS NOT NULL) DESC,
                          created_at ASC, id ASC
               ) AS keeper_id
        FROM tournament_participants
      ),
      dupes AS (SELECT id, keeper_id FROM ranked WHERE id <> keeper_id)
      UPDATE tournament_matches m
        SET away_participant_id = d.keeper_id
        FROM dupes d WHERE m.away_participant_id = d.id;

      WITH ranked AS (
        SELECT id,
               first_value(id) OVER (
                 PARTITION BY tournament_id, name_key, LOWER(BTRIM(COALESCE(gender, '')))
                 ORDER BY (team_id IS NOT NULL) DESC,
                          (pending_team_id IS NOT NULL) DESC,
                          created_at ASC, id ASC
               ) AS keeper_id
        FROM tournament_participants
      )
      DELETE FROM tournament_participants p
        USING ranked r
        WHERE p.id = r.id AND r.id <> r.keeper_id;

      DROP INDEX IF EXISTS tournament_participants_unique_slot;
      DROP INDEX IF EXISTS tournament_participants_unique_name;
      CREATE UNIQUE INDEX IF NOT EXISTS tournament_participants_unique_name_gender
        ON tournament_participants (tournament_id, name_key, LOWER(BTRIM(COALESCE(gender, ''))));
    `,
  },
  {
    // Task #856 — plan tier staged by the platform operator when creating an
    // ownerless org (Quick setup / Org Links inline form). Pre-selected on
    // the new owner's subscribe page. Enum creation is guarded because
    // plan_tier may already exist from the org-subscriptions rollout.
    name: "2026-08-14-task-856-org-pending-plan",
    sql: `
      DO $$ BEGIN
        CREATE TYPE plan_tier AS ENUM ('starter', 'pro', 'elite');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS pending_plan plan_tier;
    `,
  },
  {
    // "In the News" — newspaper-article links a coach attaches to a team
    // page; extracted headline/source/image stored at add time so cards
    // never re-fetch the paper.
    name: "2026-08-16-team-news-links",
    sql: `
      CREATE TABLE IF NOT EXISTS team_news_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        added_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        url text NOT NULL,
        title text NOT NULL,
        source_name text,
        description text,
        image_url text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS team_news_links_team_id_idx
        ON team_news_links (team_id);
      CREATE UNIQUE INDEX IF NOT EXISTS team_news_links_team_url_unique
        ON team_news_links (team_id, url);
    `,
  },
  {
    // Task #860 — mark orgs created through the admin Quick setup flow
    // ("orgs I know"), so the Claim links tab can list them separately
    // above the bulk-imported orgs. Nullable, no backfill: pre-existing
    // orgs simply stay in the lower list.
    name: "2026-08-14-task-860-org-quick-setup-flag",
    sql: `
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS created_via_quick_setup_at timestamp;
    `,
  },
  {
    // Task #865 — team slots carry the sorting bracket they belong to
    // (id-based, like recaps), so bracket renames/reorders mirror onto the
    // Teams list without a re-upload. Backfill happens lazily in code
    // (linkParticipantsToBrackets) by matching division/bracket labels.
    name: "2026-08-17-task-865-participant-bracket-id",
    sql: `
      ALTER TABLE tournament_participants
        ADD COLUMN IF NOT EXISTS bracket_id uuid
          REFERENCES competition_brackets(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS tournament_participants_bracket_id_idx
        ON tournament_participants (bracket_id);
    `,
  },
  {
    // Task #865 — durable "brackets were seeded/managed" stamp so the lazy
    // console backfill never resurrects brackets after an organizer deletes
    // ALL of them (empty-by-intent vs never-seeded). Backfill: competitions
    // that already have brackets are clearly past their first seed.
    name: "2026-08-17-task-865-brackets-seeded-stamp",
    sql: `
      ALTER TABLE tournaments
        ADD COLUMN IF NOT EXISTS brackets_seeded_at timestamp;
      UPDATE tournaments t SET brackets_seeded_at = now()
        WHERE brackets_seeded_at IS NULL
          AND EXISTS (SELECT 1 FROM competition_brackets b WHERE b.tournament_id = t.id);
    `,
  },
  {
    // Task #867 — "In the News" posts become a real interaction target:
    // reactions/comments/shares rows may now reference team_news_links via
    // postKind 'news'. Enum add is idempotent; existing rows unaffected.
    name: "2026-08-17-task-867-post-kind-news",
    sql: `
      ALTER TYPE post_kind ADD VALUE IF NOT EXISTS 'news';
    `,
  },
  {
    // Task #878 — organizations that existed before this rollout keep their
    // rolling free period but cannot receive a first charge before Nov 1.
    // The guarded update is idempotent and leaves post-cutoff, active, and
    // canceled subscriptions untouched.
    name: "2026-08-20-task-878-legacy-org-billing-floor",
    sql: LEGACY_ORG_BILLING_FLOOR_SQL,
  },
  {
    name: "2026-08-21-task-895-roster-outreach",
    sql: TASK_895_ROSTER_OUTREACH,
  },
  {
    name: "2026-08-21-task-895-secure-roster-join-links",
    sql: TASK_895_SECURE_ROSTER_JOIN_LINKS,
  },
  {
    name: "2026-08-22-task-906-grouped-coach-invites",
    sql: TASK_906_GROUPED_COACH_INVITES,
  },
  {
    // Task #921 — preserve the local calendar date on news cards separately
    // from created_at, which remains the date the article was posted on Kinectem.
    name: "2026-08-23-task-921-news-game-date",
    sql: `
      ALTER TABLE team_news_links
        ADD COLUMN IF NOT EXISTS game_date date;
    `,
  },
  {
    // Task #929 — named lists platform operators create to group the
    // ownerless orgs they set up (e.g. one list per league/tournament) on
    // the Org Links admin screen. adminListId is set-null on delete so
    // removing a list never touches the orgs in it.
    name: "2026-08-26-task-929-org-admin-lists",
    sql: `
      CREATE TABLE IF NOT EXISTS org_admin_lists (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name         text NOT NULL,
        created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at   timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS org_admin_lists_name_idx
        ON org_admin_lists (lower(name));

      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS admin_list_id uuid
          REFERENCES org_admin_lists(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS organizations_admin_list_id_idx
        ON organizations (admin_list_id);
    `,
  },
  {
    // Task #931 — add "fan" as a selectable signup role: a normal,
    // baseline-permission account for supporters who just want to follow
    // along. Same enum-extension pattern as every other `user_role` /
    // `post_kind` addition in this file.
    name: "2026-08-26-task-931-fan-role",
    sql: `
      ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'fan';
    `,
  },
  {
    name: "2026-09-02-task-975-partner-landing-pages",
    sql: `
      CREATE TABLE IF NOT EXISTS partner_landing_pages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL,
        official_name text NOT NULL,
        association_label text NOT NULL,
        introduction text NOT NULL DEFAULT '',
        logo_url text,
        banner_url text,
        primary_color text NOT NULL DEFAULT '#155EEF',
        secondary_color text NOT NULL DEFAULT '#06B6D4',
        published boolean NOT NULL DEFAULT false,
        created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS partner_landing_pages_slug_idx
        ON partner_landing_pages (lower(slug));

      CREATE TABLE IF NOT EXISTS partner_import_operations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        partner_page_id uuid NOT NULL REFERENCES partner_landing_pages(id) ON DELETE CASCADE,
        idempotency_key text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS partner_import_retry_unique
        ON partner_import_operations (partner_page_id, idempotency_key);

      CREATE TABLE IF NOT EXISTS partner_organization_memberships (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        partner_page_id uuid NOT NULL REFERENCES partner_landing_pages(id) ON DELETE CASCADE,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        visible boolean NOT NULL DEFAULT true,
        source_column text,
        import_operation_id uuid REFERENCES partner_import_operations(id) ON DELETE SET NULL,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS partner_membership_page_org_idx
        ON partner_organization_memberships (partner_page_id, organization_id);
      CREATE INDEX IF NOT EXISTS partner_membership_page_idx
        ON partner_organization_memberships (partner_page_id);
      CREATE INDEX IF NOT EXISTS partner_membership_org_idx
        ON partner_organization_memberships (organization_id);

      ALTER TABLE organization_claim_requests
        ADD COLUMN IF NOT EXISTS submitted_organization_name text,
        ADD COLUMN IF NOT EXISTS requester_full_name text,
        ADD COLUMN IF NOT EXISTS requester_title text,
        ADD COLUMN IF NOT EXISTS source_partner_page_id uuid
          REFERENCES partner_landing_pages(id) ON DELETE SET NULL;

    `,
  },
  {
    name: "2026-09-02-task-979-partner-featured-competition",
    sql: `
      ALTER TABLE partner_landing_pages
        ADD COLUMN IF NOT EXISTS competition_id uuid
          REFERENCES tournaments(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS partner_landing_pages_competition_idx
        ON partner_landing_pages (competition_id);
    `,
  },
  {
    // Task #1008 — moderation removals use explicit audit labels while
    // retaining the existing admin_activity_log table.
    name: "2026-09-03-task-1008-moderation-audit",
    sql: `
      ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'moderation_remove';
      ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'follower';
      ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'roster_entry';
    `,
  },
  {
    // Practice plans are stored with articles so existing draft/publish
    // behavior remains available, while an explicit kind keeps them out of
    // all public article surfaces.
    name: "2026-09-04-practice-plans-private-article-kind",
    sql: `
      DO $migration$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'article_kind') THEN
          CREATE TYPE article_kind AS ENUM ('recap', 'practice_plan');
        END IF;
      END$migration$;
      ALTER TABLE articles
        ADD COLUMN IF NOT EXISTS article_kind article_kind NOT NULL DEFAULT 'recap';
      CREATE INDEX IF NOT EXISTS articles_practice_plan_team_idx
        ON articles (team_id, created_at DESC)
        WHERE article_kind = 'practice_plan';
    `,
  },
  {
    // A single internal plan may cover one or several scheduled practices.
    // DATE values preserve the coach's chosen calendar days without timezone
    // shifts.
    name: "2026-09-04-practice-plan-dates",
    sql: `
      ALTER TABLE articles
        ADD COLUMN IF NOT EXISTS practice_dates date[];
    `,
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
