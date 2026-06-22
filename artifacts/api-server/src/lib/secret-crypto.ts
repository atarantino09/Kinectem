import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

import { logger } from "./logger";

// Symmetric encryption for secrets we must store at rest and later read
// back in plaintext (unlike passwords / tokens, which are one-way hashed).
// Currently used for admin-entered AI provider API keys.
//
// Key derivation: prefer a dedicated AI_KEYS_ENCRYPTION_KEY env var; fall
// back to SESSION_SECRET so dev works out of the box. The derivation salt
// is fixed so the same env value always yields the same key.
//
// Code review S9 — production should set a dedicated AI_KEYS_ENCRYPTION_KEY
// so that rotating SESSION_SECRET (a routine security action) does not brick
// already-encrypted AI keys. We keep the fallback to stay non-breaking but
// warn once when it is used. Rotating the source secret invalidates existing
// ciphertext — the admin simply re-enters the API key (low-volume, admin-only
// data), so no automated re-encryption is required.

const ALGO = "aes-256-gcm";
const SALT = "kinectem-ai-keys-v1";

let warnedFallback = false;

function getKey(): Buffer {
  const explicit = process.env.AI_KEYS_ENCRYPTION_KEY;
  if (explicit && explicit.length >= 16) {
    return scryptSync(explicit, SALT, 32);
  }
  const fallback = process.env.SESSION_SECRET;
  if (!fallback) {
    throw new Error(
      "Cannot encrypt secrets: set AI_KEYS_ENCRYPTION_KEY or SESSION_SECRET.",
    );
  }
  if (!warnedFallback) {
    warnedFallback = true;
    logger.warn(
      "AI-key encryption is using the SESSION_SECRET fallback; set a dedicated AI_KEYS_ENCRYPTION_KEY (>=32 chars). Rotating SESSION_SECRET will invalidate already-encrypted AI keys (admins must re-enter them).",
    );
  }
  return scryptSync(fallback, SALT, 32);
}

// Returns a self-describing "iv.tag.ciphertext" string (each part base64).
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("Malformed ciphertext.");
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
