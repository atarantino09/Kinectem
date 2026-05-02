import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";

type Bucket = { count: number; resetAt: number };

const stores = new Map<string, Map<string, Bucket>>();

function getStore(name: string): Map<string, Bucket> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

export function resetAllRateLimits(): void {
  for (const store of stores.values()) store.clear();
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
    const store = getStore(opts.name);
    const now = Date.now();
    const keys = opts.keys(req).filter((k): k is string => Boolean(k));
    if (keys.length === 0) {
      next();
      return;
    }

    for (const key of keys) {
      const bucket = store.get(key);
      if (bucket && bucket.resetAt <= now) {
        store.delete(key);
      }
    }

    for (const key of keys) {
      const bucket = store.get(key);
      if (bucket && bucket.count >= opts.max) {
        const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        res.setHeader("Retry-After", String(retryAfter));
        res.status(429).json({ error: message, retryAfter });
        return;
      }
    }

    const tracked: string[] = [];
    for (const key of keys) {
      let bucket = store.get(key);
      if (!bucket) {
        bucket = { count: 0, resetAt: now + opts.windowMs };
        store.set(key, bucket);
      }
      bucket.count += 1;
      tracked.push(key);
    }

    if (opts.skipSuccessfulRequests) {
      res.on("finish", () => {
        if (res.statusCode < 400) {
          for (const key of tracked) {
            const bucket = store.get(key);
            if (bucket && bucket.count > 0) bucket.count -= 1;
          }
        }
      });
    }

    next();
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
// the raw secret into the in-memory rate-limit map. A short hash prefix is
// enough to keep separate tokens in separate buckets.
export function refreshTokenKey(req: Request): string | null {
  const raw = (req.body as { refreshToken?: unknown } | undefined)
    ?.refreshToken;
  if (typeof raw !== "string" || raw.length === 0) return null;
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `rt:${digest}`;
}
