// Export the current written-in organization names to a single-column CSV.
//
// This regenerates the `organizations.csv` that `bulk-import-organizations`
// (and therefore the `seed-production-orgs` job) reads. Run it in the
// DEVELOPMENT workspace right before publishing so the seed list reflects every
// org you have added since the last export — the prod seed job runs in a
// separate environment and cannot read the dev DB directly, so this CSV is how
// the list travels dev -> prod.
//
// "Written-in" = operator-seeded org pages, identified by a non-null
// `claim_token` (same definition the admin growth dashboard uses). Organic
// orgs (null `claim_token`) are excluded.
//
// Read-only against the database. Run from the repo root:
//   pnpm --filter @workspace/scripts run export-org-names            # writes organizations.csv at repo root
//   pnpm --filter @workspace/scripts run export-org-names -- --out=names.csv
//   pnpm --filter @workspace/scripts run export-org-names -- --stdout

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { db, organizations } from "@workspace/db";
import { asc, isNotNull } from "drizzle-orm";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv: string[]): { out: string | null; toStdout: boolean } {
  let out: string | null = null;
  let toStdout = false;
  for (const arg of argv) {
    if (arg === "--stdout") toStdout = true;
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && i + 1 < argv.length) out = argv[i + 1] ?? null;
  }
  return { out, toStdout };
}

function csvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

async function main() {
  const { out, toStdout } = parseArgs(process.argv.slice(2));

  const rows = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(isNotNull(organizations.claimToken))
    .orderBy(asc(organizations.name));

  // Single column of names, no header (matches the format bulk-import expects;
  // a header row would also be detected and skipped, but we keep it clean).
  const csv = rows.map((r) => csvCell(r.name)).join("\n") + "\n";

  if (toStdout) {
    process.stdout.write(csv);
    console.error(`Exported ${rows.length} written-in org name(s) to stdout.`);
    return;
  }

  const path = out ?? join(REPO_ROOT, "organizations.csv");
  writeFileSync(path, csv, "utf8");
  console.log(`Exported ${rows.length} written-in org name(s) to ${path}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
