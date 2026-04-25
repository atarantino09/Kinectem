import type { Request, Response, NextFunction } from "express";
import { db, sessions, users } from "@workspace/db";
import { eq, gt, and, isNull } from "drizzle-orm";

export const SESSION_COOKIE = "kinectem_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export type SessionUser = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionUser?: SessionUser;
      realUser?: SessionUser;
      sessionRow?: SessionRow;
      isMasquerading?: boolean;
    }
  }
}

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
      // Ignore sessions whose owning user is soft-deleted.
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
          // Target gone — fall back to real user, clear masquerade.
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

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [s] = await db.insert(sessions).values({ userId, expiresAt }).returning();
  return { id: s.id, expiresAt: s.expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, token));
}

function isSecureRequest(res: Response): boolean {
  const req = res.req as Request | undefined;
  if (!req) return false;
  if (req.secure) return true;
  const xfProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(xfProto) ? xfProto[0] : xfProto;
  if (typeof proto === "string" && proto.split(",")[0].trim() === "https") return true;
  return false;
}

export function setSessionCookie(res: Response, sessionId: string, expiresAt: Date) {
  const secure = isSecureRequest(res);
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  const secure = isSecureRequest(res);
  res.clearCookie(SESSION_COOKIE, {
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure,
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.sessionUser) {
    res.status(401).json({ error: "Not authenticated" });
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
  // Allow stopping a masquerade even while masquerading — that's the whole
  // point. All other admin endpoints require the real admin to NOT be
  // currently viewing as another user.
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
