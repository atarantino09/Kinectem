// Task #367 — COPPA Phase 3 right-to-delete operator script.
//
// Hard-deletes user rows whose `account_status = 'pending_deletion'` and
// whose `deletion_requested_at` is older than the configured cooling-off
// window (default 30 days; overridable via COPPA_DELETION_GRACE_DAYS).
// Cascades through every FK (every minor-touching table is declared with
// ON DELETE CASCADE in `lib/db/src/schema/index.ts`). Writes a
// `guardian_data_deleted` audit row for each purge before the user row
// is removed, so the consent_audit_log preserves a record that we
// honored the request.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run coppa:delete            # dry run
//   pnpm --filter @workspace/scripts run coppa:delete -- --apply # destructive
//
// The script is intentionally separate from the API server: hard
// deletion of a child account is a high-risk operation that an
// operator opts into manually after reviewing the candidate list.

import { db, users, consentAuditLog } from "@workspace/db";
import { and, eq, isNotNull, lte } from "drizzle-orm";

const GRACE_DAYS = Number(process.env.COPPA_DELETION_GRACE_DAYS ?? "30");
const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      requestedAt: users.deletionRequestedAt,
    })
    .from(users)
    .where(
      and(
        eq(users.accountStatus, "pending_deletion"),
        isNotNull(users.deletionRequestedAt),
        lte(users.deletionRequestedAt, cutoff),
      ),
    );

  if (candidates.length === 0) {
    console.log(
      `No accounts past the ${GRACE_DAYS}-day cooling-off window. Nothing to do.`,
    );
    return;
  }

  console.log(
    `${APPLY ? "DELETING" : "Would delete"} ${candidates.length} account(s) past the ${GRACE_DAYS}-day window:`,
  );
  for (const c of candidates) {
    console.log(
      ` - ${c.id}  email=${c.email ?? "(none)"}  name=${c.name}  requestedAt=${c.requestedAt?.toISOString() ?? "?"}`,
    );
  }

  if (!APPLY) {
    console.log(
      "\nDry-run only. Re-run with `--apply` to actually purge these rows.",
    );
    return;
  }

  for (const c of candidates) {
    try {
      await db.insert(consentAuditLog).values({
        event: "guardian_data_deleted",
        childUserId: c.id,
        actorEmail: "operator-script",
        details: `hard_delete after ${GRACE_DAYS}d grace`,
      });
      await db.delete(users).where(eq(users.id, c.id));
      console.log(`  deleted ${c.id}`);
    } catch (err) {
      console.error(`  FAILED ${c.id}:`, err);
    }
  }
  console.log("Done.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("coppa-hard-delete failed:", err);
    process.exit(1);
  },
);
