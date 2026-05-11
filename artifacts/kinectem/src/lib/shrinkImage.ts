// Client-side image downscaler used by every upload flow in the app.
// Goal: stop the user (and their viewers) from paying the bandwidth cost of
// raw 12 MP phone photos when a 1024 px JPEG is more than enough.
//
// Behaviour:
//   - Animated GIFs are returned untouched so they keep their animation.
//   - Files at or below SHRINK_SKIP_BYTES are returned untouched (already small).
//   - Larger images are drawn onto a canvas at most MAX_DIMENSION on the
//     longest side and re-encoded as JPEG at OUTPUT_QUALITY.
//   - If the re-encoded file isn't actually smaller than the original, we
//     return the original (re-encoding a small PNG can grow the file).
//   - Any failure (broken image, OOM, no canvas support) falls back to the
//     original file rather than blocking the upload.
//
// The 5 MB upper bound that the rest of the app uses as a sanity cap is
// re-exported here so individual call sites can apply it consistently.

export const SHRINK_MAX_DIMENSION = 1024;
export const SHRINK_OUTPUT_QUALITY = 0.85;
export const SHRINK_SKIP_BYTES = 200 * 1024;
export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
// Server's express.json limit is 25mb. Base64-encoded data URLs add
// ~33% overhead, so cap the *encoded* string well below that to leave
// room for the rest of the JSON body and any header bloat.
export const DATA_URL_MAX_LENGTH = 20 * 1024 * 1024;

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

export async function shrinkImage(file: File): Promise<File> {
  if (isUnsupportedHeicImage(file)) {
    throw new UnsupportedImageFormatError();
  }
  if (file.type === "image/gif") return file;
  if (file.size <= SHRINK_SKIP_BYTES) return file;
  if (typeof document === "undefined") return file;

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
    const scale = Math.min(1, SHRINK_MAX_DIMENSION / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(source, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", SHRINK_OUTPUT_QUALITY),
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

// Convenience for call sites that store images as base64 data URLs (logos,
// post photos stored straight on the row). Shrinks first, then encodes.
export async function shrinkImageToDataUrl(file: File): Promise<string> {
  const prepared = await shrinkImage(file);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(prepared);
  });
}
