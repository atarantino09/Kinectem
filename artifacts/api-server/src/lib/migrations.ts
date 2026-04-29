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
