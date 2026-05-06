// Task #359 — strip JPEG/PNG metadata from minor uploads.
//
// We avoid pulling in `sharp` (native, slow install) or even a pure-JS
// image library — every byte of metadata we need to remove (EXIF,
// XMP, IPTC, PNG textual chunks, ICC profiles) lives in well-known
// segments that we can walk with two pointers. Pixel data is left
// completely untouched.

const JPEG_SOI = 0xffd8;

// JPEG markers (the byte after 0xFF) that contain ONLY metadata. We drop
// these segments entirely. APP0 (JFIF) is kept because it carries the
// pixel-density flags some viewers use; everything else (EXIF in APP1,
// XMP in APP1, Photoshop/IPTC in APP13, ICC in APP2, comments in COM)
// is removed.
const DROP_MARKERS = new Set<number>([
  0xe1, // APP1 (EXIF / XMP)
  0xe2, // APP2 (ICC)
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec,
  0xed, // APP13 (Photoshop / IPTC)
  0xee, 0xef,
  0xfe, // COM
]);

function stripJpeg(buf: Buffer): Buffer {
  if (buf.length < 4) return buf;
  if (buf.readUInt16BE(0) !== JPEG_SOI) return buf;
  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) break;
    let m = buf[i + 1];
    // Padding bytes (0xFF run).
    while (m === 0xff && i + 1 < buf.length) {
      i += 1;
      m = buf[i + 1];
    }
    // SOS (start of scan) — pixel data follows; copy the rest verbatim.
    if (m === 0xda) {
      out.push(buf.subarray(i));
      return Buffer.concat(out);
    }
    // Standalone markers without a length payload.
    if (m === 0xd0 || m === 0xd1 || m === 0xd2 || m === 0xd3 || m === 0xd4 ||
        m === 0xd5 || m === 0xd6 || m === 0xd7 || m === 0xd8 || m === 0xd9 ||
        m === 0x01) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) break;
    const segLen = buf.readUInt16BE(i + 2);
    if (segLen < 2 || i + 2 + segLen > buf.length) break;
    if (!DROP_MARKERS.has(m)) {
      out.push(buf.subarray(i, i + 2 + segLen));
    }
    i += 2 + segLen;
  }
  return Buffer.concat(out);
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_KEEP_TYPES = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "sRGB", "cHRM", "pHYs",
  "bKGD", "sBIT", "hIST", "iCCP",
]);

function stripPng(buf: Buffer): Buffer {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return buf;
  const out: Buffer[] = [PNG_SIG];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString("ascii");
    const total = 12 + len;
    if (i + total > buf.length) break;
    if (PNG_KEEP_TYPES.has(type)) {
      out.push(buf.subarray(i, i + total));
    }
    // tEXt, zTXt, iTXt, eXIf, tIME — silently dropped.
    i += total;
    if (type === "IEND") break;
  }
  return Buffer.concat(out);
}

export interface StripResult {
  buffer: Buffer;
  // Bytes removed from the original. 0 means nothing changed.
  bytesRemoved: number;
  // True iff the file was a recognised image kind we know how to strip.
  recognised: boolean;
}

/**
 * Strip metadata from JPEG / PNG uploads. Other content types pass
 * through unchanged with `recognised: false` so the caller can decide
 * to reject them outright (we do, for minor uploads).
 */
export function stripMetadataForMinor(
  buf: Buffer,
  mimeType: string,
): StripResult {
  const m = (mimeType || "").toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") {
    const out = stripJpeg(buf);
    return { buffer: out, bytesRemoved: buf.length - out.length, recognised: true };
  }
  if (m === "image/png") {
    const out = stripPng(buf);
    return { buffer: out, bytesRemoved: buf.length - out.length, recognised: true };
  }
  return { buffer: buf, bytesRemoved: 0, recognised: false };
}

export const ALLOWED_MINOR_UPLOAD_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
]);
