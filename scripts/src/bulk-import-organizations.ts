// Task #602 — Bulk-create unclaimed organization pages from a name list.
//
// Pre-creates organization pages from a spreadsheet that contains only
// org names, so each org already has a live page ready to be claimed
// when the team reaches out. Orgs are created "unclaimed": `name` is set,
// `createdById` is left null, and NO `organization_admins` rows are
// inserted.
//
// Save the spreadsheet as CSV first (a single column of names; a header
// row like "name"/"organization" is detected and skipped). Then run from
// the repo root:
//   pnpm --filter @workspace/scripts run bulk-import-organizations
//   pnpm --filter @workspace/scripts run bulk-import-organizations -- --in=orgs.csv
//
// Defaults to reading `organizations.csv` in the current working
// directory. Idempotent: existing orgs are matched case-insensitively by
// name and skipped, so re-running the script is safe.

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { db, organizations } from "@workspace/db";
import { sql } from "drizzle-orm";

// Task #610 — Mint a secret claim token for each newly created (ownerless)
// org so it has a shareable `/claim/<token>` invite link from the moment it
// is imported. URL-safe base64, matching the token shape used elsewhere.
function generateClaimToken(): string {
  return randomBytes(32).toString("base64url");
}

function parseArgs(argv: string[]): { in: string | null; dryRun: boolean } {
  let inPath: string | null = null;
  let dryRun = false;
  for (const arg of argv) {
    if (arg.startsWith("--in=")) inPath = arg.slice("--in=".length);
    else if (arg === "--dry-run") dryRun = true;
  }
  // Support "--in path" pair form too.
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in" && i + 1 < argv.length) {
      inPath = argv[i + 1] ?? null;
    }
  }
  return { in: inPath, dryRun };
}

// Minimal CSV-aware first-column parse: handles quoted cells (with
// embedded commas, escaped "" quotes, and newlines) without pulling in a
// CSV library, mirroring how export-founding-100.ts handles CSV by hand.
function parseFirstColumn(text: string): string[] {
  const rows: string[] = [];
  let field = "";
  let started = false; // whether the current row has consumed its first field
  let inQuotes = false;
  let rowHasContent = false;

  const pushRow = () => {
    if (!started) {
      // Field still pending for this row — commit it.
      if (!rowHasContent && field === "") return; // skip truly empty rows
    }
    rows.push(field);
    field = "";
    started = false;
    rowHasContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !started && field === "") {
      inQuotes = true;
      rowHasContent = true;
      continue;
    }
    if (ch === ",") {
      // End of first column — ignore the rest of the line.
      started = true;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushRow();
      continue;
    }
    if (!started) {
      field += ch;
      rowHasContent = true;
    }
    // else: we're past the first column on this row — skip chars.
  }
  // Trailing field / row with no newline at EOF.
  if (started || field !== "" || rowHasContent) {
    rows.push(field);
  }
  return rows;
}

const HEADER_NAMES = new Set([
  "name",
  "organization",
  "organization name",
  "org",
  "org name",
]);

async function main() {
  const { in: inArg, dryRun } = parseArgs(process.argv.slice(2));
  const path = inArg ?? "organizations.csv";

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(
      `Could not read "${path}". Save your spreadsheet as CSV (a single column of org names) and pass --in=<path> if it isn't named organizations.csv.`,
    );
    process.exit(1);
  }

  const cells = parseFirstColumn(raw);

  // Trim, drop blanks, drop a leading header row, then de-dupe
  // case-insensitively while preserving the first-seen casing.
  const names: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < cells.length; i++) {
    const name = cells[i].trim();
    if (!name) continue;
    if (i === 0 && HEADER_NAMES.has(name.toLowerCase())) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  let created = 0;
  let skipped = 0;
  for (const name of names) {
    // Idempotent guard: skip if an org with this name already exists
    // (case-insensitive). createdById stays null and no
    // organization_admins rows are written, so the org is "unclaimed".
    const existing = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(sql`lower(${organizations.name}) = ${name.toLowerCase()}`)
      .limit(1);
    if (existing.length > 0) {
      skipped += 1;
      continue;
    }
    if (!dryRun) {
      await db.insert(organizations).values({ name, claimToken: generateClaimToken() });
    }
    created += 1;
  }

  console.log(
    dryRun
      ? `Bulk import DRY RUN: ${names.length} unique name(s) considered, ${created} would be created, ${skipped} already exist (no writes performed).`
      : `Bulk import complete: ${names.length} unique name(s) considered, ${created} created, ${skipped} skipped (already existed).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
