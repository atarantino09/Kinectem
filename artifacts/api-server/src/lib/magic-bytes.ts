// Code review S13 — verify uploaded bytes actually match the client-declared
// MIME type for the formats we can reliably fingerprint, so a caller can't
// smuggle (e.g.) HTML behind an `image/png` content-type. We only police
// types we have a signature for; anything else passes through unverified
// (the upstream allow-lists — e.g. minors are restricted to JPEG/PNG — still
// apply).

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
    test: (b) => b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp",
  },
];

const VERIFIABLE = new Set(SIGNATURES.map((s) => s.mime));

function normalizeMime(declaredMime: string): string {
  const base = declaredMime.split(";")[0].trim().toLowerCase();
  // `image/jpg` is a common (non-canonical) alias for `image/jpeg`.
  return base === "image/jpg" ? "image/jpeg" : base;
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
