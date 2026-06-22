import { logger } from "./logger";

// Code review S8 / S9 — boot-time, non-fatal audit of the secrets that protect
// session tokens and at-rest AI-key encryption. We deliberately never log a
// secret value (only its length) and never crash the process: a too-short
// secret that already works keeps working, but operators get a loud warning to
// rotate to a stronger one. Raising the hard floor at token-signing time would
// 500 every login on an existing deployment, which we explicitly avoid.

const RECOMMENDED_SECRET_LEN = 32;

export function auditSecretStrength(): void {
  const isProd = process.env.NODE_ENV === "production";

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    logger.warn(
      "SESSION_SECRET is not set — token auth and AI-key encryption will fail until it is configured.",
    );
  } else if (sessionSecret.length < RECOMMENDED_SECRET_LEN) {
    logger.warn(
      {
        length: sessionSecret.length,
        recommended: RECOMMENDED_SECRET_LEN,
        production: isProd,
      },
      "SESSION_SECRET is shorter than recommended; rotate to a >=32-char high-entropy value used for HMAC token signing.",
    );
  }

  const aiKey = process.env.AI_KEYS_ENCRYPTION_KEY;
  if (!aiKey || aiKey.length < RECOMMENDED_SECRET_LEN) {
    logger.warn(
      {
        configured: Boolean(aiKey),
        recommended: RECOMMENDED_SECRET_LEN,
        production: isProd,
      },
      "AI_KEYS_ENCRYPTION_KEY is not set (or is short); AI provider keys fall back to SESSION_SECRET-derived encryption. Set a dedicated >=32-char key so rotating SESSION_SECRET cannot brick saved AI keys.",
    );
  }
}
