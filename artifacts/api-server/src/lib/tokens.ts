import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, refreshTokens } from "@workspace/db";
import * as passwords from "./passwords";

const { hashToken } = passwords;

// Drizzle's transaction callback hands back a tx object that exposes the
// same query-builder surface as the top-level `db`. We type the helper
// below as accepting either, so callers can compose the insert into a
// larger transaction without losing atomicity.
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Task #355 — Bearer-token auth for non-browser clients (mobile app today,
// third-party developer apps later). Cookie sessions are unchanged; this
// is a parallel mechanism wired into the same `loadSession` middleware.
//
// Access tokens are short-lived HMAC-signed envelopes (no DB round-trip
// to verify). Refresh tokens are long-lived random secrets stored hashed
// at rest and rotated on every use — reusing a consumed refresh token is
// rejected, which is the standard mitigation for stolen-token replay.

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 8) {
    throw new Error(
      "SESSION_SECRET must be set (>=8 chars) to issue or verify access tokens",
    );
  }
  return Buffer.from(s, "utf8");
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export type AccessTokenPayload = {
  sub: string; // user id
  iat: number; // issued-at, seconds since epoch
  exp: number; // expires-at, seconds since epoch
};

// Internal helper exposed for tests so they can construct an already-expired
// token without waiting 15 minutes. Production code should never call this
// with a custom expiresAt — use signAccessToken() instead.
export function signAccessTokenForTests(
  userId: string,
  expiresAt: Date,
): { token: string; expiresAt: Date } {
  const iat = Math.floor(Date.now() / 1000);
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const payload: AccessTokenPayload = { sub: userId, iat, exp };
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64urlEncode(
    createHmac("sha256", getSecret()).update(body).digest(),
  );
  return { token: `${body}.${sig}`, expiresAt };
}

export function signAccessToken(userId: string): { token: string; expiresAt: Date } {
  return signAccessTokenForTests(
    userId,
    new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expectedSig: Buffer;
  try {
    expectedSig = createHmac("sha256", getSecret()).update(body).digest();
  } catch {
    return null;
  }
  let providedSig: Buffer;
  try {
    providedSig = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(providedSig, expectedSig)) return null;
  let payload: AccessTokenPayload;
  try {
    const parsed = JSON.parse(b64urlDecode(body).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    payload = parsed as AccessTokenPayload;
  } catch {
    return null;
  }
  if (
    typeof payload.sub !== "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.iat !== "number"
  ) {
    return null;
  }
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

// Inserts a fresh refresh-token row. When called with a transaction
// handle, the insert is part of that transaction — used by
// rotateRefreshToken() to revoke + re-issue atomically.
async function issueRefreshTokenWith(
  conn: DbOrTx,
  userId: string,
  deviceLabel?: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = passwords.generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await conn.insert(refreshTokens).values({
    userId,
    tokenHash,
    deviceLabel: deviceLabel ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function issueRefreshToken(
  userId: string,
  deviceLabel?: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  return issueRefreshTokenWith(db, userId, deviceLabel);
}

// Atomically rotate a refresh token: locks the presented row, marks it
// revoked, AND inserts the replacement — all in the same transaction.
// If the insert fails (e.g. a constraint violation or transient DB error)
// the revocation is rolled back, leaving the presented token still
// usable. Reusing a consumed refresh token returns null so the caller
// can respond 401.
export async function rotateRefreshToken(presentedToken: string): Promise<{
  userId: string;
  refreshToken: string;
  refreshExpiresAt: Date;
} | null> {
  const tokenHash = hashToken(presentedToken);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .for("update")
      .limit(1);
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    const now = new Date();
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now, lastUsedAt: now })
      .where(eq(refreshTokens.id, row.id));
    const issued = await issueRefreshTokenWith(
      tx,
      row.userId,
      row.deviceLabel ?? null,
    );
    return {
      userId: row.userId,
      refreshToken: issued.token,
      refreshExpiresAt: issued.expiresAt,
    };
  });
}

export async function revokeRefreshToken(presentedToken: string): Promise<void> {
  const tokenHash = hashToken(presentedToken);
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, tokenHash));
}

// Pulls "Bearer <token>" from an Authorization header. Returns null when
// the header is missing or doesn't match the scheme.
export function extractBearerToken(
  authorizationHeader: string | string[] | undefined,
): string | null {
  if (!authorizationHeader) return null;
  const raw = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^Bearer\s+/i.test(trimmed)) return null;
  const token = trimmed.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 ? token : null;
}
