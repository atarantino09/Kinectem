import { randomBytes } from "node:crypto";
import { hashToken } from "./passwords";

// Task #358 — Self-serve long-lived API keys for third-party developer
// integrations. Plaintext keys are issued exactly once at create time and
// only the sha256 hash is persisted (matching the refresh-token / password-
// reset / guardian-token convention). Keys are presented as
// `Authorization: Bearer <key>` so they share the wire format already used
// by access tokens — the leading `kk_` prefix is what tells the bearer
// middleware to look the key up in the `api_keys` table instead of
// trying to verify a signed access-token envelope.

// Visible identifier baked into every key. Prefer a short, distinctive
// string — long enough to be obviously not-an-access-token (which start
// with a base64url payload), short enough that the displayed prefix is
// still useful as a human fingerprint.
export const API_KEY_PREFIX = "kk_";

// Number of leading characters of the plaintext key persisted in the
// `prefix` column so the dev portal can render a recognizable fingerprint
// (e.g. `kk_a1b2c3d4…`) on the listing page without ever holding the
// secret tail. Kept short on purpose — the prefix MUST NOT be enough to
// brute-force the rest of the key.
export const API_KEY_DISPLAY_PREFIX_LEN = 11;

// Number of random bytes (hex-encoded → 2× chars) appended after the
// prefix. 32 bytes / 256 bits is well above the threshold where brute
// force is interesting and matches the refresh-token entropy.
const API_KEY_RANDOM_BYTES = 32;

export type GeneratedApiKey = {
  /** The plaintext key. Returned to the caller exactly once. */
  plaintext: string;
  /** sha256 hash of the plaintext key, suitable for unique-indexed storage. */
  tokenHash: string;
  /** Short leading slice of the plaintext key for display in listings. */
  prefix: string;
};

/**
 * Generate a fresh API key. The returned `plaintext` is the only place
 * the secret will ever live — callers must surface it to the user
 * immediately and never persist it server-side.
 */
export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(API_KEY_RANDOM_BYTES).toString("hex");
  const plaintext = `${API_KEY_PREFIX}${random}`;
  return {
    plaintext,
    tokenHash: hashToken(plaintext),
    prefix: plaintext.slice(0, API_KEY_DISPLAY_PREFIX_LEN),
  };
}

/**
 * True when a presented bearer token looks like one of our API keys
 * (rather than an access-token envelope). Cheap structural check — the
 * authoritative validation still happens via the unique-indexed
 * `tokenHash` lookup in `api_keys`.
 */
export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}

// Allow-list for scope strings the create endpoint accepts. The current
// server treats every non-revoked key as full-access on the owner's
// behalf, but the strings are stored so a future scope-aware
// authorization layer has the labels it needs.
export const ALLOWED_API_KEY_SCOPES = ["read", "write"] as const;
export type ApiKeyScope = (typeof ALLOWED_API_KEY_SCOPES)[number];
