// Task #610 — Backfill secret claim tokens for ownerless org pages.
//
// Ensures every ownerless (no `organization_admins` owner row) org has a
// `claim_token` so it has a working `/claim/<token>` invite link. Idempotent:
// orgs that already have a token are left untouched, and orgs that already have
// an owner are never given a token (their link would be dead).
//
// The admin "Claim links" screen self-heals tokens on read, so this script is
// mainly for distributing links off-site (e.g. before running
// `export-org-claim-links`) without first opening the admin UI.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run backfill-org-claim-links

import { randomBytes } from "node:crypto";
import { db, organizations, organizationAdmins } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

function generateClaimToken(): string {
  return randomBytes(32).toString("base64url");
}

async function main() {
  // Ownerless orgs that still lack a token.
  const ownerExists = sql`EXISTS (
    SELECT 1 FROM ${organizationAdmins}
    WHERE ${organizationAdmins.organizationId} = ${organizations.id}
      AND ${organizationAdmins.role} = 'owner'
  )`;
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(isNull(organizations.claimToken), sql`NOT ${ownerExists}`));

  let updated = 0;
  for (const r of rows) {
    if (!DRY_RUN) {
      await db
        .update(organizations)
        .set({ claimToken: generateClaimToken() })
        .where(eq(organizations.id, r.id));
    }
    updated += 1;
  }

  console.log(
    DRY_RUN
      ? `Backfill DRY RUN: ${updated} ownerless org(s) would be given a claim token (no writes performed).`
      : `Backfill complete: ${updated} ownerless org(s) given a claim token.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
