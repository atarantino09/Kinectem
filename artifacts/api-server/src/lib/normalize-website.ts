// Task #290 — direct API callers (mobile app, third-party integrators)
// may send a website like `example.com` without a protocol, just like
// people typing into the web form. Normalize defensively here so the
// stored value is always a clickable `https://…` URL, and reject input
// that clearly isn't a website.

const PROTOCOL_PATTERN = /^[a-z][a-z0-9+.\-]*:\/\//i;

export type NormalizeWebsiteResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function normalizeWebsite(raw: unknown): NormalizeWebsiteResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "website must be a string" };
  }
  if (raw === "") return { ok: true, value: "" };
  const trimmed = raw.trim();
  // Whitespace-only input is treated as invalid rather than as a clear,
  // so callers don't accidentally wipe a stored URL with a typo.
  if (!trimmed) {
    return {
      ok: false,
      error: "website must be a valid URL (e.g. example.com)",
    };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, error: "website must not contain spaces" };
  }
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    if (PROTOCOL_PATTERN.test(candidate)) {
      return {
        ok: false,
        error: "website must start with http:// or https://",
      };
    }
    candidate = `https://${candidate}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      error: "website must be a valid URL (e.g. example.com)",
    };
  }
  if (!parsed.hostname.includes(".") || parsed.hostname.endsWith(".")) {
    return {
      ok: false,
      error: "website must be a valid URL (e.g. example.com)",
    };
  }
  return { ok: true, value: candidate };
}
