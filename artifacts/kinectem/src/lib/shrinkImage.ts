// Client-side image downscaler used by every upload flow in the app.
// Goal: stop the user (and their viewers) from paying the bandwidth cost of
// raw 12 MP phone photos when a ~1600 px JPEG is more than enough.
//
// Behaviour:
//   - Animated GIFs are returned untouched so they keep their animation.
//   - Files at or below SHRINK_SKIP_BYTES are returned untouched (already small).
//   - Larger images are stepped down to at most MAX_DIMENSION on the longest
//     side (high-quality halving, see resizeStepped) and re-encoded as JPEG
//     at OUTPUT_QUALITY.
//   - If the re-encoded file isn't actually smaller than the original, we
//     return the original (re-encoding a small PNG can grow the file).
//   - Any failure (broken image, OOM, no canvas support) falls back to the
//     original file rather than blocking the upload.
//
// The 5 MB upper bound that the rest of the app uses as a sanity cap is
// re-exported here so individual call sites can apply it consistently.

export const SHRINK_MAX_DIMENSION = 1600;
export const SHRINK_OUTPUT_QUALITY = 0.9;
export const SHRINK_SKIP_BYTES = 200 * 1024;
export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
// Task #563 — team hero banner renders ~1440px+ wide on desktop, so the
// default budget upscales and looks grainy. Banners get a higher budget;
// everything else (avatars, post photos, message attachments, org logos,
// game-photo-album) keeps the 1600 / 0.9 default.
export const BANNER_SHRINK_MAX_DIMENSION = 2048;
export const BANNER_SHRINK_OUTPUT_QUALITY = 0.92;

export type ShrinkOptions = {
  maxDimension?: number;
  quality?: number;
};
// The image-bearing PATCH routes (team, org, user) use a dedicated 21 MB
// express.json parser server-side (see api-server/src/app.ts), and the server
// rejects inline data: URLs over MAX_IMAGE_DATA_URL_LENGTH (20 MB, kept in
// lockstep with this constant). Cap the *encoded* string here so the client
// shrinks/errors before sending rather than getting a server-side 413.
export const DATA_URL_MAX_LENGTH = 20 * 1024 * 1024;

// Profile avatars go through the 3-step asset pipeline and are
// stored server-side as inline `data:` URLs, then shipped inline on every
// user-bearing response. At egress the API drops any inline avatar whose
// data-URL string is longer than MAX_AVATAR_DATA_URL_LENGTH (512 KB) to null,
// so the browser silently falls back to the initials circle. Kept in lockstep
// with `MAX_AVATAR_DATA_URL_LENGTH` in api-server/src/lib/spec-helpers.ts.
// We shrink avatars client-side so the *encoded* data URL always fits under
// this cap, so a saved photo never silently disappears into initials.
export const AVATAR_DISPLAY_MAX_DATA_URL_LENGTH = 512 * 1024;

// Avatars are square-cropped and rendered small (largest on-screen use is a
// few hundred CSS px), so a 512 px longest edge is already retina-crisp. We
// step down dimension then quality until the encoded data URL fits the cap.
const AVATAR_FIT_DIMENSIONS = [512, 384, 256, 192, 128];
const AVATAR_FIT_QUALITIES = [0.85, 0.75, 0.65];

// The server stores an uploaded asset as `data:${mime};base64,${base64}`
// (see api-server/src/routes/assets.ts). Base64 encodes 3 bytes as 4 chars,
// so we can predict the exact stored data-URL length from a File's byte size
// and decide client-side whether it will survive the egress cap.
export function dataUrlLengthForBytes(byteLength: number, mimeType: string): number {
  const prefix = `data:${mimeType || "application/octet-stream"};base64,`;
  return prefix.length + 4 * Math.ceil(byteLength / 3);
}

// Thrown when an image can't be made small enough to survive the avatar
// display cap (in practice unreachable for real photos — a 128 px JPEG is a
// few KB — but surfaced as a clear message instead of a silent drop).
export class AvatarTooLargeError extends Error {
  readonly name = "AvatarTooLargeError";
  constructor(
    message = "That photo is too large to use as a profile picture. Try a different image.",
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// A game recap (and posts generally) can carry SEVERAL photos
// inline as base64 `data:` URLs in one request body. `DATA_URL_MAX_LENGTH`
// caps each image; this caps the COMBINED size of all attached photos so a
// multi-photo recap stays within the server's dedicated 25 MB posts body
// parser. Kept in lockstep with `MAX_POST_IMAGES_TOTAL_LENGTH` in
// api-server/src/lib/spec-helpers.ts. Composers enforce this before sending so
// the user gets a clear "too large" message rather than a server-side 413.
export const POST_IMAGES_TOTAL_MAX_LENGTH = 24 * 1024 * 1024;

// HEIC / HEIF photos straight off an iPhone aren't decodable by
// non-Safari browsers (Chrome, Firefox, Android WebView), and even
// Safari's `createImageBitmap` support is patchy. Detect by MIME type
// AND extension so we can give the user a clear "use JPG/PNG" message
// instead of a silent failure deeper in the canvas pipeline.
export function isUnsupportedHeicImage(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  if (type === "image/heic-sequence" || type === "image/heif-sequence") return true;
  // Some pickers (especially older Android share sheets) hand us the
  // file with an empty `type` — fall back to the extension.
  const name = (file.name || "").toLowerCase();
  if (/\.(heic|heif)$/.test(name)) return true;
  return false;
}

export class UnsupportedImageFormatError extends Error {
  readonly name = "UnsupportedImageFormatError";
  constructor(message = "This photo format isn't supported. Try a JPG or PNG.") {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type DrawableImage = ImageBitmap | HTMLImageElement;

async function loadImage(
  file: File,
): Promise<{
  source: DrawableImage;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read image"));
      i.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

// High-quality downscale. A single big canvas reduction (e.g. 4032px phone
// photo straight to 1600px) uses the browser's box filter and comes out
// soft/aliased even with smoothing on. Repeatedly halving toward the target
// keeps each step a <=2x reduction, which preserves far more detail, then a
// final exact-size pass lands on the target dimensions. imageSmoothingQuality
// "high" (default is "low") is set on every step.
export function resizeStepped(
  source: DrawableImage | HTMLCanvasElement,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  srcX = 0,
  srcY = 0,
): HTMLCanvasElement | null {
  let curW = srcW;
  let curH = srcH;
  // Only the first draw reads from the (possibly offset) source rect; once
  // we've drawn into an intermediate canvas the offset is always 0,0.
  let curX = srcX;
  let curY = srcY;
  let curCanvas: HTMLCanvasElement | null = null;

  const drawTo = (
    w: number,
    h: number,
    src: DrawableImage | HTMLCanvasElement,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): HTMLCanvasElement | null => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d");
    if (!cx) return null;
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = "high";
    cx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    return c;
  };

  while (curW > targetW * 2 || curH > targetH * 2) {
    const nw = Math.max(targetW, Math.round(curW / 2));
    const nh = Math.max(targetH, Math.round(curH / 2));
    const next = drawTo(nw, nh, curCanvas ?? source, curX, curY, curW, curH);
    if (!next) return null;
    curCanvas = next;
    curW = nw;
    curH = nh;
    curX = 0;
    curY = 0;
  }

  if (curW === targetW && curH === targetH && curCanvas) return curCanvas;
  return drawTo(targetW, targetH, curCanvas ?? source, curX, curY, curW, curH);
}

export async function shrinkImage(
  file: File,
  options?: ShrinkOptions,
): Promise<File> {
  if (isUnsupportedHeicImage(file)) {
    throw new UnsupportedImageFormatError();
  }
  if (file.type === "image/gif") return file;
  if (file.size <= SHRINK_SKIP_BYTES) return file;
  if (typeof document === "undefined") return file;

  const maxDimension = options?.maxDimension ?? SHRINK_MAX_DIMENSION;
  const quality = options?.quality ?? SHRINK_OUTPUT_QUALITY;

  let loaded: Awaited<ReturnType<typeof loadImage>>;
  try {
    loaded = await loadImage(file);
  } catch {
    // Decoder refused this file (exotic format, RAW, etc). Preserve
    // the historical "return original" fallback so existing call
    // sites that don't try/catch keep working — server-side type
    // checks / size limits reject anything truly unusable. Call sites
    // that need a hard error should pre-check via `isUnsupportedHeicImage`
    // (HEIC/HEIF on non-Safari is the common mobile failure mode).
    return file;
  }

  try {
    const { source, width, height } = loaded;
    if (!width || !height) return file;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = resizeStepped(source, width, height, targetW, targetH);
    if (!canvas) return file;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    loaded.cleanup();
  }
}

// Task #695 — shrink an image so its stored `data:` URL is guaranteed to fit
// under `maxDataUrlLength` (the avatar display cap by default). Unlike
// `shrinkImage` (a single best-effort downscale with a generous budget), this
// steps dimension and quality down until the encoded size fits, so the
// uploaded avatar is never dropped to the initials fallback at egress. Throws
// `AvatarTooLargeError` if even the smallest attempt won't fit, or
// `UnsupportedImageFormatError` for HEIC/HEIF.
export async function shrinkImageToFit(
  file: File,
  maxDataUrlLength: number = AVATAR_DISPLAY_MAX_DATA_URL_LENGTH,
): Promise<File> {
  if (isUnsupportedHeicImage(file)) {
    throw new UnsupportedImageFormatError();
  }
  // Animated GIFs can't be re-encoded to JPEG without losing animation, so we
  // can only keep them if they already fit; otherwise there's no safe shrink.
  if (file.type === "image/gif") {
    if (dataUrlLengthForBytes(file.size, file.type) <= maxDataUrlLength) return file;
    throw new AvatarTooLargeError(
      "That animated GIF is too large for a profile photo. Try a JPG or PNG.",
    );
  }
  if (typeof document === "undefined") return file;

  let loaded: Awaited<ReturnType<typeof loadImage>>;
  try {
    loaded = await loadImage(file);
  } catch {
    // Decoder refused this file — we can't re-encode it. Keep it only if the
    // original already fits, otherwise surface a clear error.
    if (
      dataUrlLengthForBytes(file.size, file.type || "application/octet-stream") <=
      maxDataUrlLength
    ) {
      return file;
    }
    throw new AvatarTooLargeError();
  }

  try {
    const { source, width, height } = loaded;
    if (!width || !height) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    for (const dim of AVATAR_FIT_DIMENSIONS) {
      const scale = Math.min(1, dim / Math.max(width, height));
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));
      const canvas = resizeStepped(source, width, height, targetW, targetH);
      if (!canvas) continue;
      for (const quality of AVATAR_FIT_QUALITIES) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (!blob) continue;
        if (dataUrlLengthForBytes(blob.size, "image/jpeg") <= maxDataUrlLength) {
          return new File([blob], `${baseName}.jpg`, {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
        }
      }
    }
    // Every attempt (down to 128 px @ 0.65) still exceeded the cap. This is
    // effectively unreachable for a real photo, but fail loudly rather than
    // upload something the server will drop to initials.
    throw new AvatarTooLargeError();
  } finally {
    loaded.cleanup();
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

// Convenience for call sites that store images as base64 data URLs (logos,
// post photos stored straight on the row). Shrinks first, then encodes.
//
// Task #563 — accepts a per-call shrink budget so the team-banner upload
// path can opt into a larger 2048px / quality 0.92 encode. If the encoded
// data URL would exceed `DATA_URL_MAX_LENGTH` (the express.json safety
// cap), we re-encode at the default 1024px / 0.85 budget rather than
// failing the upload.
export async function shrinkImageToDataUrl(
  file: File,
  options?: ShrinkOptions,
): Promise<string> {
  const prepared = await shrinkImage(file, options);
  const dataUrl = await fileToDataUrl(prepared);
  if (dataUrl.length <= DATA_URL_MAX_LENGTH) return dataUrl;
  // Oversized — fall back to the default budget (unless caller was
  // already on it, in which case there's nothing more to shrink).
  const usingDefaults =
    (options?.maxDimension ?? SHRINK_MAX_DIMENSION) === SHRINK_MAX_DIMENSION &&
    (options?.quality ?? SHRINK_OUTPUT_QUALITY) === SHRINK_OUTPUT_QUALITY;
  if (usingDefaults) return dataUrl;
  const fallback = await shrinkImage(file);
  return await fileToDataUrl(fallback);
}
