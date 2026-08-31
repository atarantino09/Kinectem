// Code review S13 — verify uploaded bytes actually match the client-declared
// MIME type for the formats we can reliably fingerprint, so a caller can't
// smuggle (e.g.) HTML behind an `image/png` content-type. Album media uses the
// same fingerprints plus an explicit browser-compatible allowlist.

export const ALBUM_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const ALBUM_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);

export const ALBUM_ALLOWED_MIMES = new Set([
  ...ALBUM_IMAGE_MIMES,
  ...ALBUM_VIDEO_MIMES,
]);

const SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  {
    mime: "image/jpeg",
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/png",
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: "image/gif",
    test: (b) => b.length >= 6 && /^GIF8[79]a$/.test(b.toString("ascii", 0, 6)),
  },
  {
    mime: "image/webp",
    test: (b) =>
      b.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
  {
    mime: "video/mp4",
    test: (b) => isIsoBmffWithBrand(b, MP4_BRANDS),
  },
  {
    mime: "video/quicktime",
    test: (b) => isIsoBmffWithBrand(b, new Set(["qt  "])),
  },
];

const VERIFIABLE = new Set(SIGNATURES.map((s) => s.mime));

export function normalizeMime(declaredMime: string): string {
  const base = declaredMime.split(";")[0].trim().toLowerCase();
  // `image/jpg` is a common (non-canonical) alias for `image/jpeg`.
  return base === "image/jpg" ? "image/jpeg" : base;
}

const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "iso8",
  "mp41",
  "mp42",
  "mp71",
  "avc1",
  "av01",
  "dash",
  "M4V ",
  "MSNV",
]);

function isIsoBmffWithBrand(buf: Buffer, brands: Set<string>): boolean {
  // ISO Base Media File Format starts with a 4-byte size followed by "ftyp".
  // The major brand is at 8..12 and compatible brands follow at 16..20.
  if (buf.length < 16 || buf.toString("ascii", 4, 8) !== "ftyp") return false;
  if (brands.has(buf.toString("ascii", 8, 12))) return true;
  for (let offset = 16; offset + 4 <= buf.length; offset += 4) {
    if (brands.has(buf.toString("ascii", offset, offset + 4))) return true;
  }
  return false;
}

// Returns the canonical MIME detected from the leading bytes, or null when
// the signature is not one we fingerprint.
export function detectMime(buf: Buffer): string | null {
  for (const sig of SIGNATURES) {
    if (sig.test(buf)) return sig.mime;
  }
  return null;
}

// Returns true only when the declared MIME is one we can fingerprint AND the
// bytes do NOT match it. Unknown/unverifiable declared types return false (we
// cannot prove a mismatch, so we do not block them here).
export function isDeclaredTypeMismatch(
  buf: Buffer,
  declaredMime: string,
): boolean {
  const declared = normalizeMime(declaredMime);
  if (!VERIFIABLE.has(declared)) return false;
  return detectMime(buf) !== declared;
}

export function isAlbumMimeSupported(declaredMime: string): boolean {
  return ALBUM_ALLOWED_MIMES.has(normalizeMime(declaredMime));
}

// Assets in this application are stored as data URLs. Returning null for
// anything else deliberately makes album attachment fail closed instead of
// trusting a URL or a filename extension.
export function decodeAssetDataUrl(url: string | null): Buffer | null {
  if (!url) return null;
  const match = /^data:[^;,]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (!match) return null;
  try {
    return Buffer.from(match[1].replace(/\s/g, ""), "base64");
  } catch {
    return null;
  }
}
