import { Router, type IRouter } from "express";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { LoginBody, SignupBody } from "../lib/schemas";
import { toUser } from "../lib/serializers";
import { createSession, destroySession, setSessionCookie, clearSessionCookie, SESSION_COOKIE } from "../lib/auth";

const router: IRouter = Router();

router.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const body = LoginBody.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.id, body.userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const sess = await createSession(user.id);
    setSessionCookie(res, sess.id, sess.expiresAt);
    res.json(toUser(user));
  }),
);

router.post(
  "/auth/signup",
  asyncHandler(async (req, res) => {
    const body = SignupBody.parse(req.body);

    // Parent gate: under-13 must have a parentId
    if (body.dateOfBirth) {
      const ageYears = (Date.now() - new Date(body.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000);
      if (ageYears < 13 && !body.parentId) {
        res.status(400).json({ error: "Players under 13 require a parent or guardian account to be linked." });
        return;
      }
    }

    if (body.email) {
      const [existing] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
      if (existing) {
        res.status(409).json({ error: "Email already in use" });
        return;
      }
    }

    const [created] = await db
      .insert(users)
      .values({
        name: body.name,
        role: body.role,
        email: body.email ?? undefined,
        sport: body.sport ?? undefined,
        position: body.position ?? undefined,
        grade: body.grade ?? undefined,
        location: body.location ?? undefined,
        dateOfBirth: body.dateOfBirth ?? undefined,
        parentId: body.parentId ?? undefined,
      })
      .returning();

    const sess = await createSession(created.id);
    setSessionCookie(res, sess.id, sess.expiresAt);
    res.status(201).json(toUser(created));
  }),
);

router.post(
  "/auth/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await destroySession(token);
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

export default router;
