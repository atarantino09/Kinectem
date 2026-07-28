// Task #819 — Remove platform admins still listed as org owners / followers /
// team staff on orgs & teams they created for HAND-OFF.
//
// Historically, a platform admin (users.role = 'admin') who created an org or
// team was auto-inserted as org owner, org follower, and team coach. The
// hand-off model no longer does this (admins keep full manage powers via the
// permissions bypass), but rows created before that change still show the
// operator as "owner" / "Admin coach" on handed-off pages. This script removes
// those rows:
//
//   - organization_admins   rows for platform admins on orgs THEY created
//   - organization_followers rows for platform admins on orgs THEY created
//   - roster_entries        rows for platform admins on teams they created or
//                           on teams inside orgs they created
//
// Removing a platform-admin 'owner' row intentionally returns the org to
// UNCLAIMED (unclaimed = no organization_admins row with role 'owner') so the
// real org staff can claim it via the existing claim flows.
//
// Safety:
//   - DRY-RUN BY DEFAULT. Pass --apply to actually delete.
//   - ALLOWLIST below (lowercased org names) skips orgs a platform admin
//     genuinely operates (e.g. demo/seed orgs). Review before running.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run cleanup-platform-admin-handoff            # dry run
//   pnpm --filter @workspace/scripts run cleanup-platform-admin-handoff -- --apply # delete
//
// Idempotent: re-runs after --apply find nothing and delete nothing.
//
// NOTE: the same cleanup ships as a one-time, marker-gated startup migration
// ("2026-07-28-task-819-remove-platform-admin-handoff-listings" in
// artifacts/api-server/src/lib/migrations.ts) so it runs exactly once in
// production at next publish — the agent/operator cannot execute this script
// inside the prod environment. Keep the ALLOWLIST here and there in sync.

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

// Lowercased organization names to SKIP (orgs a platform admin genuinely
// operates, e.g. demo/seed orgs). Reviewed 2026-07-28: no dev or prod org that
// a platform admin legitimately staffs — the two dev orgs with admin listings
// (Parkersburg High School, Parsippany Soccer Club) are real hand-off pages.
const ALLOWLIST: string[] = [];

function allowlistClause(orgAlias: string): string {
  if (ALLOWLIST.length === 0) return "";
  const list = ALLOWLIST.map((n) => `'${n.replace(/'/g, "''")}'`).join(", ");
  return ` AND lower(${orgAlias}.name) NOT IN (${list})`;
}

// Targets: rows belonging to platform-admin users on orgs they created…
const ORG_ADMINS_WHERE = `
  oa.user_id = u.id AND u.role = 'admin'
  AND o.id = oa.organization_id AND o.created_by_id = oa.user_id${allowlistClause("o")}`;

const ORG_FOLLOWERS_WHERE = `
  f.user_id = u.id AND u.role = 'admin'
  AND o.id = f.organization_id AND o.created_by_id = f.user_id${allowlistClause("o")}`;

// …and roster rows on teams they created, or teams inside orgs they created.
const ROSTER_WHERE = `
  re.user_id = u.id AND u.role = 'admin'
  AND t.id = re.team_id
  AND (
    t.created_by_id = re.user_id
    OR EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = t.organization_id
        AND o.created_by_id = re.user_id${allowlistClause("o")}
    )
  )`;

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (deleting rows)" : "DRY RUN (pass --apply to delete)"}`);
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/\/.*$/, "");
  console.log(`Database host: ${host || "(unknown)"}`);

  const owners = await db.execute(sql.raw(`
    SELECT o.name AS org, u.email, oa.role
    FROM organization_admins oa, users u, organizations o
    WHERE ${ORG_ADMINS_WHERE}
    ORDER BY o.name`));
  const followers = await db.execute(sql.raw(`
    SELECT o.name AS org, u.email
    FROM organization_followers f, users u, organizations o
    WHERE ${ORG_FOLLOWERS_WHERE}
    ORDER BY o.name`));
  const roster = await db.execute(sql.raw(`
    SELECT t.name AS team, u.email, re.role, re.status
    FROM roster_entries re, users u, teams t
    WHERE ${ROSTER_WHERE}
    ORDER BY t.name`));

  console.log(`\norganization_admins to remove: ${owners.rows.length}`);
  for (const r of owners.rows) console.log(`  - ${r.org}: ${r.email} (${r.role})`);
  console.log(`organization_followers to remove: ${followers.rows.length}`);
  for (const r of followers.rows) console.log(`  - ${r.org}: ${r.email}`);
  console.log(`roster_entries to remove: ${roster.rows.length}`);
  for (const r of roster.rows) console.log(`  - ${r.team}: ${r.email} (${r.role}, ${r.status})`);

  if (!APPLY) {
    console.log("\nDry run complete — nothing deleted.");
    return;
  }

  const d1 = await db.execute(sql.raw(
    `DELETE FROM organization_admins oa USING users u, organizations o WHERE ${ORG_ADMINS_WHERE}`));
  const d2 = await db.execute(sql.raw(
    `DELETE FROM organization_followers f USING users u, organizations o WHERE ${ORG_FOLLOWERS_WHERE}`));
  const d3 = await db.execute(sql.raw(
    `DELETE FROM roster_entries re USING users u, teams t WHERE ${ROSTER_WHERE}`));
  console.log(
    `\nDeleted: ${d1.rowCount} organization_admins, ${d2.rowCount} organization_followers, ${d3.rowCount} roster_entries.`);
  console.log("Affected orgs with no remaining 'owner' row are now UNCLAIMED (claimable by real staff).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
