import type { Request, Response, NextFunction } from "express";
import { db, sessions, users, apiKeys } from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { SESSION_COOKIE, type SessionUser, type SessionRow } from "../lib/auth";
import { extractBearerToken, verifyAccessToken } from "../lib/tokens";
import { looksLikeApiKey } from "../lib/api-keys";
import { hashToken } from "../lib/passwords";

// Task #359 — central account-status gate. `disabled` (revoked
// consent) and `pending_guardian` (consent not yet finalized) accounts
// must not authenticate, regardless of how they present credentials
// (cookie session, bearer access token, or API key). Returning `false`
// here causes loadSession to drop the candidate user and the rest of
// the request runs anonymously, which the existing requireAuth chain
// then turns into a clean 401.
function isAccountStatusActive(u: { accountStatus?: string | null }): boolean {
  const s = u.accountStatus ?? "active";
  // Task #363 — `pending_revocation` is a guardian-initiated pause that
  // takes effect on the child's next request, parallel to `disabled`
  // and `pending_guardian` (Phase 1 pre-consent).
  return (
    s !== "disabled" &&
    s !== "pending_guardian" &&
    s !== "pending_revocation" &&
    // Task #367 — pending_deletion is the right-to-delete cooling-off
    // window. Account is locked the same way `disabled` is until the
    // operator hard-delete script removes the row.
    s !== "pending_deletion"
  );
}

// Attach session/user/realUser/isMasquerading on the Request based on the
// session cookie. If no cookie session is found, fall back to an
// `Authorization: Bearer <access-token>` header (issued by `/auth/token`)
// so mobile and third-party clients get the same shape every protected
// route already expects. Soft-deleted users are treated as anonymous. If
// the session is masquerading and the target user is gone, the masquerade
// is cleared. Bearer auth has no masquerade and no DB session row.
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    try {
      const [row] = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())))
        .limit(1);
      if (row) {
        if (row.user.deletedAt) return next();
        // Task #359 — disabled / pending_guardian accounts cannot use
        // their cookie session even if it hasn't expired yet.
        if (!isAccountStatusActive(row.user)) return next();
        req.realUser = row.user;
        req.sessionRow = row.session;
        const masqueradeId = row.session.masqueradingAsUserId;
        if (masqueradeId && masqueradeId !== row.user.id) {
          const [target] = await db
            .select()
            .from(users)
            .where(and(eq(users.id, masqueradeId), isNull(users.deletedAt)))
            .limit(1);
          if (target) {
            req.sessionUser = target;
            req.isMasquerading = true;
          } else {
            await db
              .update(sessions)
              .set({ masqueradingAsUserId: null })
              .where(eq(sessions.id, row.session.id));
            req.sessionUser = row.user;
          }
        } else {
          req.sessionUser = row.user;
        }
        return next();
      }
    } catch {
      /* fall through to bearer */
    }
  }

  // Bearer fallback for non-browser clients. Only consulted when no cookie
  // session is attached (so a mis-signed Authorization header on a website
  // request never overrides a valid cookie login).
  const bearer = extractBearerToken(req.headers["authorization"]);
  if (bearer) {
    if (looksLikeApiKey(bearer)) {
      // Task #358 — Long-lived developer API key. Distinguished from
      // signed access tokens by the `kk_` prefix; looked up by hash in
      // the `api_keys` table. Revoked keys are treated as anonymous.
      try {
        const tokenHash = hashToken(bearer);
        const [row] = await db
          .select({ key: apiKeys, user: users })
          .from(apiKeys)
          .innerJoin(users, eq(apiKeys.userId, users.id))
          .where(and(eq(apiKeys.tokenHash, tokenHash), isNull(apiKeys.revokedAt)))
          .limit(1);
        if (row && !row.user.deletedAt && isAccountStatusActive(row.user)) {
          req.realUser = row.user;
          req.sessionUser = row.user;
          // Best-effort lastUsedAt update; we don't await so a stalled
          // write never delays the request. The next read after this
          // request will see the new value.
          db
            .update(apiKeys)
            .set({ lastUsedAt: new Date() })
            .where(eq(apiKeys.id, row.key.id))
            .catch(() => {
              /* ignore */
            });
        }
      } catch {
        /* ignore */
      }
    } else {
      const payload = verifyAccessToken(bearer);
      if (payload) {
        try {
          const [user] = await db
            .select()
            .from(users)
            .where(and(eq(users.id, payload.sub), isNull(users.deletedAt)))
            .limit(1);
          if (user && isAccountStatusActive(user)) {
            req.realUser = user;
            req.sessionUser = user;
            // No sessionRow / no masquerade for bearer auth — masquerade is
            // an admin browser tool, not a token-grant primitive.
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.sessionUser) {
    res
      .status(401)
      .json({ error: "Not authenticated", code: "AUTH_REQUIRED" });
    return;
  }
  next();
}

// Admin endpoints require:
// - The real session owner to be an admin
// - No active masquerade (admins cannot reach /admin/* while viewing as another user)
// - The admin themselves to not be soft-deleted
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const real = req.realUser;
  if (!real) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (real.role !== "admin" || real.deletedAt) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  // Allow stopping a masquerade even while masquerading.
  const path = req.path || "";
  const isMasqueradeStop = path === "/masquerade/stop";
  if (req.isMasquerading && !isMasqueradeStop) {
    res.status(403).json({
      error: "Exit masquerade before using admin tools.",
    });
    return;
  }
  next();
}

export type { SessionUser, SessionRow };
