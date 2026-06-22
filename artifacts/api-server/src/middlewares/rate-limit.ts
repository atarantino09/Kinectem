import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, rateLimitBuckets } from "@workspace/db";
import { logger } from "../lib/logger";

// Hash every limiter key before it touches the database so raw IPs /
// emails / refresh tokens are never persisted at rest. (The in-memory
// predecessor only ever held these in process memory.)
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// Best-effort wipe of every bucket — used by the test harness between
// cases. Fails open: a transient DB error must never abort a test run or
// a request path.
export async function resetAllRateLimits(): Promise<void> {
  try {
    await db.delete(rateLimitBuckets);
  } catch (err) {
    logger.error({ err }, "Failed to reset rate-limit buckets");
  }
}

export type RateLimitOptions = {
  name: string;
  windowMs: number;
  max: number;
  keys: (req: Request) => Array<string | null | undefined>;
  skipSuccessfulRequests?: boolean;
  message?: string;
};

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const message =
    opts.message ?? "Too many requests. Please try again later.";
  return (req, res, next) => {
    void enforce();

    async function enforce(): Promise<void> {
      try {
        const rawKeys = opts
          .keys(req)
          .filter((k): k is string => Boolean(k));
        if (rawKeys.length === 0) {
          next();
          return;
        }
        const hashed = rawKeys.map(hashKey);
        const now = Date.now();

        // Pre-check the current (unexpired) windows and reject *without*
        // incrementing if any key is already at/over the limit — mirrors
        // the previous in-memory check-before-increment behavior.
        const existing = await db
          .select({
            count: rateLimitBuckets.count,
            resetAt: rateLimitBuckets.resetAt,
          })
          .from(rateLimitBuckets)
          .where(
            and(
              eq(rateLimitBuckets.name, opts.name),
              inArray(rateLimitBuckets.keyHash, hashed),
            ),
          );

        for (const row of existing) {
          if (row.resetAt.getTime() > now && row.count >= opts.max) {
            const retryAfter = Math.max(
              1,
              Math.ceil((row.resetAt.getTime() - now) / 1000),
            );
            res.setHeader("Retry-After", String(retryAfter));
            res.status(429).json({ error: message, retryAfter });
            return;
          }
        }

        // Atomically increment each key, resetting any window whose
        // reset_at has elapsed. One round trip per key.
        for (const keyHash of hashed) {
          await db.execute(sql`
            INSERT INTO rate_limit_buckets (name, key_hash, count, reset_at)
            VALUES (
              ${opts.name},
              ${keyHash},
              1,
              now() + ${opts.windowMs} * interval '1 millisecond'
            )
            ON CONFLICT (name, key_hash) DO UPDATE SET
              count = CASE
                WHEN rate_limit_buckets.reset_at <= now() THEN 1
                ELSE rate_limit_buckets.count + 1
              END,
              reset_at = CASE
                WHEN rate_limit_buckets.reset_at <= now()
                  THEN now() + ${opts.windowMs} * interval '1 millisecond'
                ELSE rate_limit_buckets.reset_at
              END
          `);
        }

        if (opts.skipSuccessfulRequests) {
          res.on("finish", () => {
            if (res.statusCode < 400) {
              void db
                .update(rateLimitBuckets)
                .set({ count: sql`GREATEST(${rateLimitBuckets.count} - 1, 0)` })
                .where(
                  and(
                    eq(rateLimitBuckets.name, opts.name),
                    inArray(rateLimitBuckets.keyHash, hashed),
                    sql`${rateLimitBuckets.resetAt} > now()`,
                  ),
                )
                .catch((err: unknown) =>
                  logger.error({ err }, "rate-limit decrement failed"),
                );
            }
          });
        }

        next();
      } catch (err) {
        // Fail open: abuse protection degrades on a DB hiccup, but
        // legitimate auth/signup traffic is never blocked by it.
        logger.error(
          { err, limiter: opts.name },
          "Rate limiter error; failing open",
        );
        next();
      }
    }
  };
}

export function ipKey(req: Request): string {
  return `ip:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
}

export function emailKey(req: Request): string | null {
  const raw = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof raw !== "string" || raw.length === 0) return null;
  return `email:${raw.toLowerCase()}`;
}

// Bucket repeated attempts against the same refresh token without putting
// the raw secret into the rate-limit store. A short hash prefix is enough
// to keep separate tokens in separate buckets.
export function refreshTokenKey(req: Request): string | null {
  const raw = (req.body as { refreshToken?: unknown } | undefined)
    ?.refreshToken;
  if (typeof raw !== "string" || raw.length === 0) return null;
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `rt:${digest}`;
}
