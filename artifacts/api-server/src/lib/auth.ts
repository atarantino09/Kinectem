import type { Request, Response } from "express";
import { db, sessions, users } from "@workspace/db";
import { eq } from "drizzle-orm";

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

// Re-export auth middlewares from their new home in middlewares/auth.ts so
// callers that historically imported them from lib/auth.ts keep working.
export { loadSession, requireAuth, requireAdmin } from "../middlewares/auth";
