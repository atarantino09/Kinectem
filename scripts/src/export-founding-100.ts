// Task #543 — Export the Founding 100 signups table to CSV.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run export-founding-100
//   pnpm --filter @workspace/scripts run export-founding-100 -- --out=signups.csv
//
// Defaults to writing `founding-100-<YYYY-MM-DD>.csv` in the current
// working directory. Use `--stdout` to stream CSV to stdout instead.

import { writeFileSync } from "node:fs";
import { db, foundingSignups } from "@workspace/db";
import { desc } from "drizzle-orm";

function parseArgs(argv: string[]): { out: string | null; toStdout: boolean } {
  let out: string | null = null;
  let toStdout = false;
  for (const arg of argv) {
    if (arg === "--stdout") toStdout = true;
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else if (arg === "--out") {
      // handled by next iteration in pairs form
    }
  }
  // Support "--out path" pair form too.
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && i + 1 < argv.length) {
      out = argv[i + 1] ?? null;
    }
  }
  return { out, toStdout };
}

function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const { out, toStdout } = parseArgs(process.argv.slice(2));

  const rows = await db
    .select()
    .from(foundingSignups)
    .orderBy(desc(foundingSignups.submittedAt));

  const header = [
    "submitted_at",
    "org_name",
    "admin_name",
    "admin_email",
    "role_title",
    "estimated_teams",
    "estimated_players",
    "sport",
    "updated_at",
    "id",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.submittedAt.toISOString(),
        r.orgName,
        r.adminName,
        r.adminEmail,
        r.roleTitle,
        r.estimatedTeams,
        r.estimatedPlayers,
        r.sport ?? "",
        r.updatedAt.toISOString(),
        r.id,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const csv = lines.join("\n") + "\n";

  if (toStdout) {
    process.stdout.write(csv);
    console.error(`Exported ${rows.length} founding-100 signup(s) to stdout.`);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const path = out ?? `founding-100-${stamp}.csv`;
  writeFileSync(path, csv, "utf8");
  console.log(`Exported ${rows.length} founding-100 signup(s) to ${path}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
