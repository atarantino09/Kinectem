// Pull a user-facing message out of an unknown thrown value. The API
// always responds with `{ error, code, ...extras }` on failure (see
// `apiError` in the server), but we also handle a few legacy/edge cases:
//   - `ApiError` from `customFetch` (status + parsed `data`)
//   - Plain `Error` instances with a useful `.message`
//   - String error responses (rare, but possible from upstream proxies)
//
// Returns `null` when nothing usable is found, so callers can fall back
// to their own generic copy.
export function apiErrorMessage(err: unknown): string | null {
  if (!err) return null;

  if (typeof err === "string") {
    const trimmed = err.trim();
    return trimmed === "" ? null : trimmed;
  }

  if (typeof err !== "object") return null;

  const e = err as {
    status?: number;
    data?: unknown;
    body?: unknown;
    message?: string;
  };

  for (const candidate of [e.data, e.body]) {
    if (!candidate) continue;
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (typeof candidate === "object") {
      const c = candidate as Record<string, unknown>;
      const fromError = typeof c.error === "string" ? c.error.trim() : "";
      if (fromError) return fromError;
      const fromMessage = typeof c.message === "string" ? c.message.trim() : "";
      if (fromMessage) return fromMessage;
    }
  }

  if (typeof e.message === "string") {
    const trimmed = e.message.trim();
    // ApiError prefixes its message with `HTTP <status> <statusText>:` and
    // parrots whatever the body said. That's fine as a last resort, but
    // strip the noisy prefix so the toast reads naturally.
    const stripped = trimmed.replace(/^HTTP\s+\d+\s+[^:]*:\s*/i, "").trim();
    if (stripped) return stripped;
  }

  return null;
}
