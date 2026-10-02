export const HISTORICAL_CLIPPING_PREFIX = "/api/v1/historical-clippings/";

/** Recognize private clipping routes even in absolute URLs or encoded paths. */
export function isHistoricalClippingUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.startsWith("data:")) return false;
  try {
    let path = new URL(value, "https://internal.invalid").pathname;
    for (let i = 0; i < 3; i++) {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    }
    return path.toLowerCase().includes(HISTORICAL_CLIPPING_PREFIX);
  } catch {
    return value.includes(HISTORICAL_CLIPPING_PREFIX);
  }
}