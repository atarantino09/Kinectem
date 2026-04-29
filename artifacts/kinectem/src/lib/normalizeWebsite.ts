// Task #290 — people naturally type a website like `example.com` or
// `www.example.com` without bothering with `http://`. The form should
// accept those, normalize to a full `https://…` URL before sending it
// to the API, and still reject things that clearly aren't a website.
//
// Returns either the normalized URL (empty string when the input was
// blank) or a short error message suitable for showing in the form.

const PROTOCOL_PATTERN = /^[a-z][a-z0-9+.\-]*:\/\//i;

export type NormalizeWebsiteResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function normalizeWebsite(raw: string): NormalizeWebsiteResult {
  if (raw === "") return { ok: true, value: "" };
  const trimmed = raw.trim();
  // Whitespace-only input is almost certainly a typo, not an intentional
  // "clear the field" gesture — treat it as invalid.
  if (!trimmed) {
    return { ok: false, error: "Enter a valid website (e.g. example.com)" };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, error: "Website can't contain spaces" };
  }
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    if (PROTOCOL_PATTERN.test(candidate)) {
      return { ok: false, error: "Website must start with http:// or https://" };
    }
    candidate = `https://${candidate}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "Enter a valid website (e.g. example.com)" };
  }
  // A bare hostname like `localhost` is technically a valid URL, but for
  // an org website we want something with a real top-level domain.
  if (!parsed.hostname.includes(".") || parsed.hostname.endsWith(".")) {
    return { ok: false, error: "Enter a valid website (e.g. example.com)" };
  }
  return { ok: true, value: candidate };
}
