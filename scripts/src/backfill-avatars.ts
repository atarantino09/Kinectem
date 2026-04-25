/**
 * One-time backfill: re-encode oversized profile avatars stored in the
 * `users` table.
 *
 * Background: avatars are stored as `data:<mime>;base64,<...>` URLs directly
 * on `users.avatar_url`. Newer uploads are already shrunk client-side
 * (see EditProfileDialog.tsx — max 1024 px / JPEG q=0.85), but rows that
 * predate that change can still hold multi-megabyte payloads. Those rows
 * are re-sent on every page that renders the avatar, so this script brings
 * them down to the same target.
 *
 * Behavior:
 *   - Only touches rows whose avatar_url is a `data:image/...` URL whose
 *     stored payload (the data-URL string itself, which is what the DB and
 *     every API response carries) exceeds the target cap. Anything already
 *     small, anything not a data URL (e.g. plain http URLs), and animated
 *     GIFs are skipped.
 *   - Re-encodes to JPEG, max 1024 px on the longest side, starting at
 *     quality 85 and stepping the quality down until the resulting data
 *     URL fits under the cap (or hits the minimum acceptable quality).
 *   - Updates users.avatar_url in place. If a matching row exists in the
 *     `assets` table (same url + same owner), its url and file_size are
 *     updated too so the two stay in sync.
 *   - After running, re-queries the DB and asserts no non-GIF avatar still
 *     exceeds the cap, so the operator can confirm the postcondition.
 *
 * Run with:   pnpm --filter @workspace/scripts run backfill-avatars
 *             (add `--dry-run` to preview without writing)
 */
import sharp from "sharp";
import { eq, and } from "drizzle-orm";
import { db, pool, users, assets } from "@workspace/db";

const MAX_DIMENSION = 1024;
const QUALITY_LADDER = [85, 75, 65, 55, 45]; // last value is the floor
const TARGET_DATA_URL_BYTES = 300 * 1024;
const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9+.\-]+);base64,(.+)$/;

interface ParsedDataUrl {
  mime: string;
  buffer: Buffer;
}

function parseDataUrl(value: string): ParsedDataUrl | null {
  const m = DATA_URL_RE.exec(value);
  if (!m) return null;
  try {
    return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], "base64") };
  } catch {
    return null;
  }
}

async function isAnimated(buffer: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(buffer, { animated: true }).metadata();
    return (meta.pages ?? 1) > 1;
  } catch {
    return false;
  }
}

function bytesToDataUrl(mime: string, buffer: Buffer): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

interface ShrinkResult {
  buffer: Buffer;
  dataUrl: string;
  quality: number;
}

/**
 * Re-encode the image at progressively lower JPEG quality until the
 * resulting data URL fits under TARGET_DATA_URL_BYTES. Returns the
 * smallest version produced (the last quality in the ladder) when no
 * setting fits, so callers can decide what to do.
 */
async function shrink(buffer: Buffer): Promise<ShrinkResult> {
  let smallest: ShrinkResult | null = null;
  for (const quality of QUALITY_LADDER) {
    const out = await sharp(buffer)
      .rotate() // honor EXIF orientation before resizing
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    const dataUrl = bytesToDataUrl("image/jpeg", out);
    if (!smallest || out.length < smallest.buffer.length) {
      smallest = { buffer: out, dataUrl, quality };
    }
    if (Buffer.byteLength(dataUrl, "utf8") <= TARGET_DATA_URL_BYTES) {
      return { buffer: out, dataUrl, quality };
    }
  }
  // Nothing in the ladder fit — return the smallest variant we produced.
  return smallest!;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Backfilling oversized avatars${dryRun ? " (dry run)" : ""}…`);
  console.log(
    `  cap: ${fmtBytes(TARGET_DATA_URL_BYTES)} of stored data-URL payload`,
  );

  const rows = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(users);

  let scanned = 0;
  let candidates = 0;
  let shrunk = 0;
  let stillOver = 0;
  let skippedSmall = 0;
  let skippedNonData = 0;
  let skippedGif = 0;
  let failed = 0;
  let storedBytesSavedTotal = 0;

  for (const row of rows) {
    scanned += 1;
    if (!row.avatarUrl) continue;

    const parsed = parseDataUrl(row.avatarUrl);
    if (!parsed) {
      skippedNonData += 1;
      continue;
    }

    const originalStoredBytes = Buffer.byteLength(row.avatarUrl, "utf8");
    if (originalStoredBytes <= TARGET_DATA_URL_BYTES) {
      skippedSmall += 1;
      continue;
    }

    candidates += 1;

    if (parsed.mime === "image/gif" && (await isAnimated(parsed.buffer))) {
      skippedGif += 1;
      console.log(
        `  • ${row.id} (${row.name}): animated GIF, leaving as-is (${fmtBytes(
          originalStoredBytes,
        )} stored)`,
      );
      continue;
    }

    let result: ShrinkResult;
    try {
      result = await shrink(parsed.buffer);
    } catch (err) {
      failed += 1;
      console.warn(
        `  ! ${row.id} (${row.name}): failed to re-encode (${(err as Error).message})`,
      );
      continue;
    }

    const newStoredBytes = Buffer.byteLength(result.dataUrl, "utf8");

    if (newStoredBytes >= originalStoredBytes) {
      // Refuse to make rows larger. Treat as a failure so it's visible.
      failed += 1;
      console.warn(
        `  ! ${row.id} (${row.name}): re-encode wasn't smaller (${fmtBytes(
          originalStoredBytes,
        )} → ${fmtBytes(newStoredBytes)} stored), leaving as-is`,
      );
      continue;
    }

    const fitsCap = newStoredBytes <= TARGET_DATA_URL_BYTES;
    if (!fitsCap) stillOver += 1;
    shrunk += 1;
    storedBytesSavedTotal += originalStoredBytes - newStoredBytes;

    console.log(
      `  ${fitsCap ? "✓" : "~"} ${row.id} (${row.name}): ${fmtBytes(
        originalStoredBytes,
      )} → ${fmtBytes(newStoredBytes)} stored @ q=${result.quality}` +
        (fitsCap ? "" : " (still over cap, but smallest possible)"),
    );

    if (dryRun) continue;

    await db
      .update(users)
      .set({ avatarUrl: result.dataUrl })
      .where(eq(users.id, row.id));

    // Keep any matching asset row in sync so the two views of the same
    // avatar can't drift apart. Match by both URL and owner since that's
    // what /users PATCH validates against.
    await db
      .update(assets)
      .set({
        url: result.dataUrl,
        fileSize: result.buffer.length,
        fileType: "image/jpeg",
      })
      .where(and(eq(assets.url, row.avatarUrl), eq(assets.ownerId, row.id)));
  }

  console.log("");
  console.log("Summary");
  console.log(`  Users scanned:                ${scanned}`);
  console.log(`  Skipped (not a data URL):     ${skippedNonData}`);
  console.log(`  Skipped (already small):      ${skippedSmall}`);
  console.log(`  Oversized candidates:         ${candidates}`);
  console.log(`    Skipped (animated GIF):     ${skippedGif}`);
  console.log(`    Failed to re-encode:        ${failed}`);
  console.log(`    Re-encoded:                 ${shrunk}`);
  console.log(`    ...still above cap:         ${stillOver}`);
  console.log(`  Total stored bytes saved:     ${fmtBytes(storedBytesSavedTotal)}`);
  if (dryRun) {
    console.log("\nDry run — no rows were updated.");
  }

  // Postcondition check: re-query and report any non-GIF avatars still
  // above the cap. The task says "no avatar in the DB exceeds ~300 KB
  // (ignoring GIFs)" — make that visible to the operator.
  const recheck = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(users);
  let postOverCap = 0;
  let maxStored = 0;
  let maxRow: { id: string; name: string; bytes: number } | null = null;
  for (const r of recheck) {
    if (!r.avatarUrl || !r.avatarUrl.startsWith("data:")) continue;
    const stored = Buffer.byteLength(r.avatarUrl, "utf8");
    if (stored > maxStored) {
      maxStored = stored;
      maxRow = { id: r.id, name: r.name, bytes: stored };
    }
    if (stored <= TARGET_DATA_URL_BYTES) continue;
    const parsed = parseDataUrl(r.avatarUrl);
    if (parsed && parsed.mime === "image/gif" && (await isAnimated(parsed.buffer))) {
      continue; // GIFs are intentionally exempt
    }
    postOverCap += 1;
  }
  console.log("");
  console.log("Postcondition check");
  console.log(`  Largest non-null data-URL avatar after run: ${
    maxRow ? `${fmtBytes(maxStored)} (${maxRow.name}, ${maxRow.id})` : "—"
  }`);
  console.log(
    `  Non-GIF avatars still above ${fmtBytes(TARGET_DATA_URL_BYTES)}: ${postOverCap}`,
  );
  if (postOverCap > 0 && !dryRun) {
    console.warn(
      "  ! Postcondition NOT met. Investigate the rows flagged above.",
    );
    process.exitCode = 2;
  }
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
