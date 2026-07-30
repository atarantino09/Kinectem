// Extract dominant brand colors from an uploaded logo image.
//
// The pixel-crunching core (`pickBrandColorsFromPixels`) is a pure function
// over RGBA bytes so it can be unit-tested in jsdom (which has no real
// canvas); `extractBrandColorsFromDataUrl` is the thin browser wrapper that
// decodes + downsamples the image onto a canvas first.

export type BrandColors = { primary: string; secondary: string | null };

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/**
 * Pick the two most prominent, visually distinct colors from RGBA pixel
 * data. Transparent and near-white pixels are ignored (logo backgrounds),
 * and low-saturation light grays are down-weighted so a colorful mark beats
 * its neutral surroundings.
 */
export function pickBrandColorsFromPixels(
  data: Uint8ClampedArray | number[],
): BrandColors | null {
  // Quantize to 4 bits/channel and tally, keeping per-bucket channel sums so
  // the reported color is the bucket average (not the coarse bucket corner).
  const buckets = new Map<
    number,
    { count: number; r: number; g: number; b: number }
  >();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Skip near-white (typical logo background / anti-aliased fringe).
    if (r > 235 && g > 235 && b > 235) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    // Weight saturated pixels up so a small colorful mark outranks large
    // neutral areas; keep neutrals in play (black/gray logos are real).
    const weight = 1 + (sat > 0.25 ? 3 : 0);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += weight;
      bucket.r += r * weight;
      bucket.g += g * weight;
      bucket.b += b * weight;
    } else {
      buckets.set(key, { count: weight, r: r * weight, g: g * weight, b: b * weight });
    }
  }
  const ranked = [...buckets.values()]
    .sort((x, y) => y.count - x.count)
    .map((bkt) => ({
      count: bkt.count,
      r: bkt.r / bkt.count,
      g: bkt.g / bkt.count,
      b: bkt.b / bkt.count,
    }));
  if (ranked.length === 0) return null;

  const first = ranked[0];
  const primary = toHex(first.r, first.g, first.b);
  // Secondary: next-most-common color far enough from the primary to read
  // as a distinct brand color (not an anti-aliasing shade of the same one).
  const dist = (p: { r: number; g: number; b: number }) =>
    Math.hypot(p.r - first.r, p.g - first.g, p.b - first.b);
  const second = ranked.slice(1).find((p) => dist(p) > 90) ?? null;
  return {
    primary,
    secondary: second ? toHex(second.r, second.g, second.b) : null,
  };
}

/** Decode an image data-URL and extract its dominant brand colors. */
export async function extractBrandColorsFromDataUrl(
  dataUrl: string,
): Promise<BrandColors | null> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUrl;
  });
  const size = 64; // downsample — plenty for dominant-color work
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, size / Math.max(img.width, img.height, 1));
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return pickBrandColorsFromPixels(data);
}
