import type { CorsOptions } from "cors";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// CORS allowlist + CSRF defense (code-review S1 / S2)
// ---------------------------------------------------------------------------
//
// The web app is served to the browser inside the Replit preview iframe and
// shares its origin with the API (path-based proxy routing), so the session
// cookie must stay `SameSite=None; Secure`. To stop that from being a CSRF /
// credential-exfiltration hole we:
//   1. Only reflect CORS credentials back to known origins (no `origin: true`,
//      which echoes any site and lets it read authenticated responses).
//   2. Reject cookie-authenticated mutating requests whose browser Origin /
//      Referer is neither same-origin nor on the allowlist.

const isProd = process.env.NODE_ENV === "production";

function buildAllowedOrigins(): Set<string> {
  const out = new Set<string>();
  const addHost = (host: string | undefined | null) => {
    if (!host) return;
    const h = host.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (h) out.add(`https://${h}`);
  };
  // REPLIT_DOMAINS is a comma-separated list of the deployment's public hosts.
  for (const d of (process.env.REPLIT_DOMAINS ?? "").split(",")) addHost(d);
  addHost(process.env.REPLIT_DEV_DOMAIN);
  const appBase = process.env.APP_BASE_URL;
  if (appBase) {
    try {
      out.add(new URL(appBase).origin);
    } catch {
      /* ignore malformed APP_BASE_URL */
    }
  }
  return out;
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

function isLocalhost(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Allow localhost (any port) outside production for local dev tooling.
  if (!isProd && isLocalhost(origin)) return true;
  return false;
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // No Origin header → same-origin navigation, curl, or server-to-server.
    if (!origin) return callback(null, true);
    if (isAllowedOrigin(origin)) return callback(null, true);
    // Disallowed: respond without CORS headers so the browser blocks the read.
    return callback(null, false);
  },
  credentials: true,
};

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function isSameHost(value: string, req: Request): boolean {
  try {
    const host = req.get("host");
    return Boolean(host) && new URL(value).host === host;
  } catch {
    return false;
  }
}

// CSRF guard. Only cookie-backed sessions (`req.sessionRow`) are vulnerable to
// CSRF; bearer/API-key clients send no cookie and are skipped. Browsers always
// attach an Origin (and/or Referer) header to state-changing requests, so we
// reject any whose Origin is neither same-origin nor allowlisted. Requests with
// no Origin/Referer (curl, tests, server-to-server) are not a browser CSRF
// vector and pass through.
export function csrfGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (!req.sessionRow) return next();
  const source = req.get("origin") ?? req.get("referer") ?? null;
  if (!source) return next();
  if (isAllowedOrigin(originOf(source)) || isSameHost(source, req)) {
    return next();
  }
  res
    .status(403)
    .json({ error: "Cross-site request blocked", code: "CSRF_BLOCKED" });
}
