import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

// Symmetric encryption for secrets we must store at rest and later read
// back in plaintext (unlike passwords / tokens, which are one-way hashed).
// Currently used for admin-entered AI provider API keys.
//
// Key derivation: prefer a dedicated AI_KEYS_ENCRYPTION_KEY env var; fall
// back to SESSION_SECRET so dev works out of the box. The derivation salt
// is fixed so the same env value always yields the same key. Rotating the
// source secret invalidates existing ciphertext — the admin simply re-enters
// the API key, which is acceptable for this low-volume, admin-only data.

const ALGO = "aes-256-gcm";
const SALT = "kinectem-ai-keys-v1";

function getKey(): Buffer {
  const explicit = process.env.AI_KEYS_ENCRYPTION_KEY;
  const source =
    explicit && explicit.length >= 16 ? explicit : process.env.SESSION_SECRET;
  if (!source) {
    throw new Error(
      "Cannot encrypt secrets: set AI_KEYS_ENCRYPTION_KEY or SESSION_SECRET.",
    );
  }
  return scryptSync(source, SALT, 32);
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
