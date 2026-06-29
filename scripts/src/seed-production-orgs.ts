// Seed the written-in organization pages into a fresh PRODUCTION database.
//
// Publishing only syncs the SCHEMA, not row data, so the operator-seeded
// org pages that live in the development DB do not exist in production after
// the first publish. This job recreates them in whatever environment it runs
// in (point it at production by running it as a Replit Scheduled/one-off
// Deployment so DATABASE_URL resolves to the production DB), then prints the
// shareable `/claim/<token>` links so the orgs can be invited.
//
// It is a thin, dry-run-by-default orchestrator over three existing scripts:
//   1. bulk-import-organizations  — create any missing org pages (idempotent,
//      mints a fresh claim token per new org)
//   2. backfill-org-claim-links   — ensure every ownerless org has a token
//   3. export-org-claim-links     — print the `<base>/app/claim/<token>`
//      links to stdout (only in --apply; in a dry run the links would reflect
//      the pre-seed state and are therefore skipped)
//
// PRODUCTION claim tokens are minted fresh here — they are NOT the dev tokens.
// Always export the links from the production run; dev links will not work.
//
// Usage (from the repo root):
//   pnpm --filter @workspace/scripts run seed-production-orgs            # dry run
//   pnpm --filter @workspace/scripts run seed-production-orgs -- --apply # writes
//
// Flags:
//   --apply           perform writes (default is a no-write preview)
//   --in=<path>       org-name CSV (default: organizations.csv at repo root)
//   --base=<url>      claim-link base (default: $APP_BASE_URL else
//                     https://kinectem.com); links are <base>/app/claim/<token>
//   --out=<path>      write the claim-link CSV to a file instead of stdout

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv: string[]): {
  apply: boolean;
  in: string | null;
  base: string | null;
  out: string | null;
} {
  let apply = false;
  let inPath: string | null = null;
  let base: string | null = null;
  let out: string | null = null;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--in=")) inPath = arg.slice("--in=".length);
    else if (arg.startsWith("--base=")) base = arg.slice("--base=".length);
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
  }
  return { apply, in: inPath, base, out };
}

function maskedDbHost(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "(DATABASE_URL not set)";
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

// Run one of the sibling scripts via pnpm so it resolves tsx + the workspace
// the same way it would when invoked on its own. Inherits stdio so each
// step's output (and the exported claim links) flows to this job's logs.
function runStep(label: string, script: string, args: string[]): void {
  console.log(`\n=== ${label} ===`);
  execFileSync(
    "pnpm",
    ["--filter", "@workspace/scripts", "run", script, "--", ...args],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
}

function main(): void {
  const { apply, in: inArg, base: baseArg, out } = parseArgs(
    process.argv.slice(2),
  );

  const csv = inArg ?? join(REPO_ROOT, "organizations.csv");
  const base = baseArg ?? process.env.APP_BASE_URL ?? "https://kinectem.com";

  if (!existsSync(csv)) {
    console.error(
      `Could not find the org-name CSV at "${csv}". Pass --in=<path> to point at it.`,
    );
    process.exit(1);
  }

  console.log("Kinectem production org seed");
  console.log(`  mode:      ${apply ? "APPLY (writes enabled)" : "DRY RUN (no writes)"}`);
  console.log(`  database:  ${maskedDbHost()}`);
  console.log(`  csv:       ${csv}`);
  console.log(`  link base: ${base}`);

  const dryFlag = apply ? [] : ["--dry-run"];

  runStep(
    "Step 1/3 — import org pages",
    "bulk-import-organizations",
    [`--in=${csv}`, ...dryFlag],
  );

  runStep(
    "Step 2/3 — backfill claim tokens",
    "backfill-org-claim-links",
    [...dryFlag],
  );

  if (apply) {
    runStep(
      "Step 3/3 — export claim links",
      "export-org-claim-links",
      out ? [`--out=${out}`, `--base=${base}`] : ["--stdout", `--base=${base}`],
    );
    console.log(
      out
        ? `\nDone. Claim links written to ${out}.`
        : "\nDone. Claim links printed above (production tokens).",
    );
  } else {
    console.log(
      "\nDry run complete — no rows written. Re-run with --apply to seed, then claim links will be exported.",
    );
  }
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error("seed-production-orgs failed:", err);
  process.exit(1);
}
