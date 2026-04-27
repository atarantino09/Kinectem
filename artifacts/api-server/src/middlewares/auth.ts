import type { Request, Response, NextFunction } from "express";
import { db, sessions, users } from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { SESSION_COOKIE, type SessionUser, type SessionRow } from "../lib/auth";

// Attach session/user/realUser/isMasquerading on the Request based on the
// session cookie. Soft-deleted users are treated as anonymous. If the session
// is masquerading and the target user is gone, the masquerade is cleared.
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  try {
    const [row] = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (row) {
      if (row.user.deletedAt) return next();
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
    }
  } catch {
    /* ignore */
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
