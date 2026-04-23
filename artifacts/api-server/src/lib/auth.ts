import type { Request, Response, NextFunction } from "express";
import { db, sessions, users } from "@workspace/db";
import { eq, gt, and } from "drizzle-orm";

export const SESSION_COOKIE = "kinectem_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export type SessionUser = typeof users.$inferSelect;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionUser?: SessionUser;
    }
  }
}

export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  try {
    const [row] = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (row) req.sessionUser = row.user;
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
    // When the request is HTTPS (e.g. running behind the Replit proxy),
    // use SameSite=None + Secure so the cookie is sent from the workspace
    // canvas iframe (which is a third-party context). On plain HTTP dev,
    // fall back to Lax (browsers reject SameSite=None without Secure).
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
