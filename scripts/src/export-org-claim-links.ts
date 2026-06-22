// Task #610 — Export secret claim-invite links for ownerless org pages to CSV.
//
// Lists every ownerless (no `organization_admins` owner row) org alongside its
// full shareable `/claim/<token>` link, so the operator can distribute links
// off-site (mail merge, etc). Orgs that already have an owner are omitted —
// their link is dead.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run export-org-claim-links
//   pnpm --filter @workspace/scripts run export-org-claim-links -- --out=links.csv
//   pnpm --filter @workspace/scripts run export-org-claim-links -- --stdout
//
// The claim link base defaults to $APP_BASE_URL (falling back to
// https://kinectem.replit.app), and the app lives under `/app/`, so links look
// like `<base>/app/claim/<token>`. Override the base with --base=<url>.
//
// Defaults to writing `org-claim-links-<YYYY-MM-DD>.csv` in the current working
// directory. This export is read-only — it does NOT mint missing tokens; run
// `backfill-org-claim-links` first if some ownerless orgs lack a token.

import { writeFileSync } from "node:fs";
import { db, organizations, organizationAdmins } from "@workspace/db";
import { and, asc, isNotNull, sql } from "drizzle-orm";

function parseArgs(argv: string[]): {
  out: string | null;
  toStdout: boolean;
  base: string | null;
} {
  let out: string | null = null;
  let toStdout = false;
  let base: string | null = null;
  for (const arg of argv) {
    if (arg === "--stdout") toStdout = true;
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else if (arg.startsWith("--base=")) base = arg.slice("--base=".length);
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && i + 1 < argv.length) out = argv[i + 1] ?? null;
    if (argv[i] === "--base" && i + 1 < argv.length) base = argv[i + 1] ?? null;
  }
  return { out, toStdout, base };
}

function csvCell(v: string | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const { out, toStdout, base } = parseArgs(process.argv.slice(2));
  const rawBase = base ?? process.env.APP_BASE_URL ?? "https://kinectem.replit.app";
  const trimmed = rawBase.replace(/\/+$/, "");
  const claimUrl = (token: string) => `${trimmed}/app/claim/${token}`;

  // Ownerless orgs that already have a token.
  const ownerExists = sql`EXISTS (
    SELECT 1 FROM ${organizationAdmins}
    WHERE ${organizationAdmins.organizationId} = ${organizations.id}
      AND ${organizationAdmins.role} = 'owner'
  )`;
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      city: organizations.city,
      state: organizations.state,
      claimToken: organizations.claimToken,
    })
    .from(organizations)
    .where(and(isNotNull(organizations.claimToken), sql`NOT ${ownerExists}`))
    .orderBy(asc(organizations.name));

  const header = ["org_name", "city", "state", "claim_link", "org_id"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.name, r.city ?? "", r.state ?? "", claimUrl(r.claimToken!), r.id]
        .map(csvCell)
        .join(","),
    );
  }
  const csv = lines.join("\n") + "\n";

  if (toStdout) {
    process.stdout.write(csv);
    console.error(`Exported ${rows.length} org claim link(s) to stdout.`);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const path = out ?? `org-claim-links-${stamp}.csv`;
  writeFileSync(path, csv, "utf8");
  console.log(`Exported ${rows.length} org claim link(s) to ${path}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
