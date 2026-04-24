type RateLimitErrorShape = {
  status?: number;
  message?: string;
  data?: { error?: string; retryAfter?: number } | null;
  body?: { error?: string; retryAfter?: number } | null;
  headers?: Headers;
};

function readRetryAfterSeconds(err: RateLimitErrorShape): number | null {
  const dataRetry = err.data?.retryAfter ?? err.body?.retryAfter;
  if (typeof dataRetry === "number" && Number.isFinite(dataRetry) && dataRetry > 0) {
    return Math.ceil(dataRetry);
  }
  const headerVal = err.headers?.get?.("retry-after") ?? err.headers?.get?.("Retry-After");
  if (headerVal) {
    const asNumber = Number(headerVal);
    if (Number.isFinite(asNumber) && asNumber > 0) return Math.ceil(asNumber);
    const asDate = Date.parse(headerVal);
    if (!Number.isNaN(asDate)) {
      const diff = Math.ceil((asDate - Date.now()) / 1000);
      if (diff > 0) return diff;
    }
  }
  return null;
}

function formatWait(seconds: number): string {
  if (seconds < 60) {
    return seconds === 1 ? "1 second" : `${seconds} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * If the error is an HTTP 429 (rate limit), returns a friendly
 * "too many attempts, please wait N minutes" message using the
 * server's Retry-After / retryAfter value. Otherwise returns null.
 */
export function rateLimitMessage(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as RateLimitErrorShape;
  if (e.status !== 429) return null;
  const seconds = readRetryAfterSeconds(e);
  if (seconds == null) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  return `Too many attempts. Please wait ${formatWait(seconds)} and try again.`;
}
