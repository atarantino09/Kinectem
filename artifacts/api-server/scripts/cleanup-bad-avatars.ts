/**
 * One-shot (and idempotent) cleanup that NULLs `users.avatar_url` rows whose
 * inline `data:` URL is either oversized or fails to decode as a real image.
 *
 * Why: `users.avatar_url` is fanned out across many list responses (feed,
 * posts, comments, mentions, message threads, search, ...). Some of the
 * existing rows in the demo seed contain (a) multi-megabyte data URLs that
 * cause a perceptible "blank then pop" because the browser has to decode
 * the URL on every mount, and (b) at least one row whose PNG IHDR parses
 * cleanly but whose IDAT zlib stream fails to inflate — browsers handle
 * that inconsistently and some report `naturalWidth > 0` for a corrupt
 * image, causing Radix's Avatar primitive to render an `<img>` that paints
 * nothing (a literal blank circle).
 *
 * The egress guard (`safeAvatarUrl`) catches the oversized case at
 * serialization time, but it cannot detect the corrupt-but-tiny case.
 * This script handles both at the source by NULLing the offending pointer
 * on `users.avatar_url`. The corresponding row in the `assets` table is
 * left intact — it may still be referenced from posts, messages, etc.
 *
 * Idempotent: rows that have already been NULLed (or that were never set)
 * are simply skipped. Safe to run on every post-merge.
 */
import { inflateSync } from "node:zlib";
import { eq, isNotNull, like, and } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { MAX_AVATAR_DATA_URL_LENGTH } from "../src/lib/spec-helpers";

interface CleanupReport {
  inspected: number;
  cleared: number;
  oversize: number;
  corrupt: number;
  unparseable: number;
  kept: number;
  errors: Array<{ userId: string; reason: string }>;
}

function decodeBase64Payload(dataUrl: string): { mime: string; bytes: Buffer } | null {
  // Format: data:<mime>;base64,<payload>
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    return { mime: m[1].toLowerCase(), bytes: Buffer.from(m[2], "base64") };
  } catch {
    return null;
  }
}

/**
 * Verifies that the PNG IDAT zlib stream actually inflates. Many "broken
 * avatar" rows have a valid IHDR (so naturalWidth/Height look fine) but
 * a corrupt IDAT that browsers render as nothing.
 */
function isValidPng(buf: Buffer): boolean {
  if (buf.length < 24) return false;
  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) return false;
  // Walk chunks, collect IDAT bytes
  let offset = 8;
  const idatChunks: Buffer[] = [];
  let sawIend = false;
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) return false; // truncated
    if (type === "IDAT") idatChunks.push(buf.subarray(dataStart, dataEnd));
    if (type === "IEND") {
      sawIend = true;
      break;
    }
    offset = dataEnd + 4; // skip CRC
  }
  if (!sawIend) return false;
  if (idatChunks.length === 0) return false;
  try {
    const out = inflateSync(Buffer.concat(idatChunks));
    return out.length > 0;
  } catch {
    return false;
  }
}

function isValidJpeg(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  // SOI: FF D8, EOI: FF D9
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return false;
  if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) return false;
  return true;
}

function isValidWebpOrGif(buf: Buffer): boolean {
  // Best-effort: just confirm we have a non-trivial payload. We don't
  // try to validate WebP/GIF structurally — the symptom we're hunting is
  // PNG-specific (corrupt IDAT). Anything decodable that isn't PNG/JPEG
  // is left alone unless it busts the size cap.
  return buf.length > 16;
}

/**
 * Decides whether a stored `data:` avatar URL should be cleared.
 * Returns `null` to keep, or a string reason to clear.
 */
export function classifyAvatar(raw: string): null | { kind: "oversize" | "unparseable" | "corrupt"; reason: string } {
  if (raw.length > MAX_AVATAR_DATA_URL_LENGTH) {
    return { kind: "oversize", reason: `length=${raw.length}` };
  }
  const decoded = decodeBase64Payload(raw);
  if (!decoded) {
    return { kind: "unparseable", reason: "not a recognizable data: URL" };
  }
  const { mime, bytes } = decoded;
  if (mime.includes("png")) {
    if (!isValidPng(bytes)) return { kind: "corrupt", reason: "PNG IHDR/IDAT did not decode" };
  } else if (mime.includes("jpeg") || mime.includes("jpg")) {
    if (!isValidJpeg(bytes)) return { kind: "corrupt", reason: "JPEG SOI/EOI markers missing" };
  } else if (mime.includes("webp") || mime.includes("gif") || mime.includes("svg")) {
    if (!isValidWebpOrGif(bytes)) return { kind: "corrupt", reason: `${mime} payload too small` };
  } else {
    // Unknown MIME — refuse to ship it as an avatar.
    return { kind: "unparseable", reason: `unsupported mime: ${mime}` };
  }
  return null;
}

export async function cleanupBadAvatars({ dryRun = false }: { dryRun?: boolean } = {}): Promise<CleanupReport> {
  const report: CleanupReport = {
    inspected: 0,
    cleared: 0,
    oversize: 0,
    corrupt: 0,
    unparseable: 0,
    kept: 0,
    errors: [],
  };
  const rows = await db
    .select({ id: users.id, avatarUrl: users.avatarUrl })
    .from(users)
    .where(and(isNotNull(users.avatarUrl), like(users.avatarUrl, "data:%")));
  for (const row of rows) {
    if (!row.avatarUrl) continue;
    report.inspected++;
    let verdict: ReturnType<typeof classifyAvatar>;
    try {
      verdict = classifyAvatar(row.avatarUrl);
    } catch (err) {
      report.errors.push({ userId: row.id, reason: (err as Error).message });
      continue;
    }
    if (verdict === null) {
      report.kept++;
      continue;
    }
    report[verdict.kind]++;
    if (!dryRun) {
      await db.update(users).set({ avatarUrl: null }).where(eq(users.id, row.id));
    }
    report.cleared++;
  }
  return report;
}

const isMain = (() => {
  try {
    // Running directly via `tsx scripts/cleanup-bad-avatars.ts`
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  cleanupBadAvatars({ dryRun })
    .then((report) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
