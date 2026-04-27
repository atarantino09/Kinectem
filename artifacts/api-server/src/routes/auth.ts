import { Router, type IRouter } from "express";
import { db, users, passwordResets } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { logger } from "../lib/logger";
import { sendGuardianConfirmationEmail, sendPasswordResetEmail } from "../lib/email";
import { canCreateRecap, canManageOrganization, isTeamMember, canManageTeam } from "../lib/permissions";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../lib/auth";
import { toPrivateUser, splitName, apiError, safeAvatarUrl } from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostOwnerId,
  type PostStats,
  type StatsKind,
} from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap, TAG_NOTIF_THROTTLE_MS } from "../lib/article-tagging";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Auth (custom — not in spec)
// ---------------------------------------------------------------------------
const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const SignupBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1).optional().default(""),
  role: z.enum(["athlete", "coach", "admin", "parent"]),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  dateOfBirth: z.string().optional().nullable(),
  guardianEmail: z.string().email().optional().nullable(),
  guardianConsent: z.boolean().optional(),
  parentId: z.string().uuid().optional().nullable(),
});
const PasswordResetRequestBody = z.object({ email: z.string().email() });
const PasswordResetCompleteBody = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8),
});
const GuardianConfirmBody = z.object({
  token: z.string().min(10),
  guardianEmail: z.string().email(),
});
const GuardianResendBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
// Exported so /guardians routes (defined in routes/guardians.ts) can issue
// confirmation tokens with the same TTL used here at signup.
export const GUARDIAN_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

const loginLimiter = rateLimit({
  name: "auth-login",
  windowMs: FIFTEEN_MINUTES,
  max: 5,
  keys: (req) => [ipKey(req), emailKey(req)],
  skipSuccessfulRequests: true,
  message:
    "Too many login attempts. Please wait a few minutes before trying again.",
});

const signupLimiter = rateLimit({
  name: "auth-signup",
  windowMs: ONE_HOUR,
  max: 10,
  keys: (req) => [ipKey(req)],
  message:
    "Too many signup attempts from this network. Please wait a while before trying again.",
});

const passwordResetRequestLimiter = rateLimit({
  name: "auth-password-reset-request",
  windowMs: ONE_HOUR,
  max: 5,
  keys: (req) => [ipKey(req), emailKey(req)],
  message:
    "Too many password reset requests. Please wait before requesting another link.",
});

const passwordResetCompleteLimiter = rateLimit({
  name: "auth-password-reset-complete",
  windowMs: FIFTEEN_MINUTES,
  max: 10,
  keys: (req) => [ipKey(req)],
  skipSuccessfulRequests: true,
  message:
    "Too many password reset attempts. Please wait before trying again.",
});

router.post(
  "/auth/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = LoginBody.parse(req.body);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    const ok = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      apiError(res, 401, "Incorrect email or password.");
      return;
    }
    if (user.deletedAt) {
      res.status(403).json({ error: "This account has been deactivated." });
      return;
    }
    if (user.guardianEmail && !user.guardianConfirmedAt) {
      const expired =
        !user.guardianConfirmToken ||
        !user.guardianConfirmTokenExpiresAt ||
        user.guardianConfirmTokenExpiresAt.getTime() < Date.now();
      apiError(
        res,
        403,
        "Your account is waiting on guardian confirmation. Ask your parent or guardian to open the confirmation link sent to their email.",
        {
          extras: {
            pendingGuardianConfirmation: true,
            guardianConfirmExpired: expired,
            ...(expired ? { guardianConfirmUrl: null } : {}),
          },
        },
      );
      return;
    }
    const sess = await createSession(user.id);
    setSessionCookie(res, sess.id, sess.expiresAt);
    await db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));
    res.json(toPrivateUser(user));
  }),
);

router.post(
  "/auth/signup",
  signupLimiter,
  asyncHandler(async (req, res) => {
    const body = SignupBody.parse(req.body);
    const dob = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
    let guardianRequired = false;
    if (body.role === "athlete" && dob) {
      const ageYears = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
      guardianRequired = ageYears < 13;
    }
    if (guardianRequired && !body.guardianEmail) {
      apiError(res, 400, "Athletes under 13 must provide a parent or guardian email so we can confirm the account.");
      return;
    }
    if (
      guardianRequired &&
      body.guardianEmail &&
      body.guardianEmail.toLowerCase() === body.email.toLowerCase()
    ) {
      apiError(res, 400, "The guardian email must be different from the athlete's email address.");
      return;
    }
    if (guardianRequired && !body.guardianConsent) {
      apiError(res, 400, "Please confirm a parent or guardian has agreed to receive a confirmation email.");
      return;
    }

    const email = body.email.toLowerCase();
    const [exists] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (exists) {
      apiError(res, 409, "An account with that email already exists.");
      return;
    }

    const passwordHash = await hashPassword(body.password);
    const guardianToken = guardianRequired ? generateToken() : null;

    const [created] = await db
      .insert(users)
      .values({
        name: `${body.firstName} ${body.lastName}`.trim(),
        role: body.role,
        email,
        passwordHash,
        dateOfBirth: dob ?? undefined,
        parentId: body.parentId ?? undefined,
        guardianEmail: guardianRequired ? body.guardianEmail!.toLowerCase() : undefined,
        guardianConfirmToken: guardianToken ?? undefined,
        guardianConfirmTokenExpiresAt: guardianRequired
          ? new Date(Date.now() + GUARDIAN_TOKEN_TTL_MS)
          : undefined,
      })
      .returning();

    if (guardianRequired) {
      // Account is created but cannot sign in until the guardian confirms.
      try {
        await sendGuardianConfirmationEmail(
          body.guardianEmail!.toLowerCase(),
          created.name,
          guardianToken!,
        );
      } catch (err) {
        logger.error({ err }, "Failed to send guardian confirmation email");
      }
      res.status(201).json({
        ...toPrivateUser(created),
        pendingGuardianConfirmation: true,
      });
      return;
    }

    const sess = await createSession(created.id);
    setSessionCookie(res, sess.id, sess.expiresAt);
    res.status(201).json(toPrivateUser(created));
  }),
);

router.post(
  "/auth/password-reset/request",
  passwordResetRequestLimiter,
  asyncHandler(async (req, res) => {
    const body = PasswordResetRequestBody.parse(req.body);
    const email = body.email.toLowerCase();
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    // Always respond 200 to avoid leaking which emails exist.
    if (!user) {
      res.json({ ok: true, message: "If that email exists, a reset link has been sent." });
      return;
    }
    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
    await db.insert(passwordResets).values({ userId: user.id, tokenHash, expiresAt });
    try {
      await sendPasswordResetEmail(email, token);
    } catch (err) {
      logger.error({ err }, "Failed to send password reset email");
    }
    res.json({
      ok: true,
      message: "If that email exists, a reset link has been sent.",
    });
  }),
);

router.post(
  "/auth/password-reset/complete",
  passwordResetCompleteLimiter,
  asyncHandler(async (req, res) => {
    const body = PasswordResetCompleteBody.parse(req.body);
    const tokenHash = hashToken(body.token);
    const [reset] = await db
      .select()
      .from(passwordResets)
      .where(eq(passwordResets.tokenHash, tokenHash))
      .limit(1);
    if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now()) {
      apiError(res, 400, "This reset link is invalid or has expired.");
      return;
    }
    const passwordHash = await hashPassword(body.newPassword);
    await db.update(users).set({ passwordHash }).where(eq(users.id, reset.userId));
    await db
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(eq(passwordResets.id, reset.id));
    res.json({ ok: true });
  }),
);

router.post(
  "/auth/guardian-confirm",
  asyncHandler(async (req, res) => {
    const body = GuardianConfirmBody.parse(req.body);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.guardianConfirmToken, body.token))
      .limit(1);
    if (!user) {
      apiError(res, 400, "This confirmation link is invalid or has already been used.");
      return;
    }
    if (
      !user.guardianConfirmTokenExpiresAt ||
      user.guardianConfirmTokenExpiresAt.getTime() < Date.now()
    ) {
      apiError(res, 400, "This confirmation link has expired. Ask the athlete to sign in and request a new link.", { extras: { expired: true } });
      return;
    }
    const submittedEmail = body.guardianEmail.trim().toLowerCase();
    if (!user.guardianEmail || submittedEmail !== user.guardianEmail.toLowerCase()) {
      apiError(res, 403, "The email you entered doesn't match the guardian email on file for this account.");
      return;
    }
    // If a real user account exists for the guardian's email, link it via parentId
    // so we have a record of who confirmed.
    const [guardianUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, submittedEmail))
      .limit(1);
    await db
      .update(users)
      .set({
        guardianConfirmedAt: new Date(),
        guardianConfirmToken: null,
        guardianConfirmTokenExpiresAt: null,
        guardianConfirmedByUserId: guardianUser?.id ?? null,
        parentId: user.parentId ?? guardianUser?.id ?? null,
      })
      .where(eq(users.id, user.id));
    res.json({ ok: true, athleteName: user.name, guardianEmail: user.guardianEmail });
  }),
);

router.post(
  "/auth/guardian-resend",
  asyncHandler(async (req, res) => {
    const body = GuardianResendBody.parse(req.body);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    const ok = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      apiError(res, 401, "Incorrect email or password.");
      return;
    }
    if (!user.guardianEmail || user.guardianConfirmedAt) {
      apiError(res, 400, "This account does not need a guardian confirmation link.");
      return;
    }
    const newToken = generateToken();
    await db
      .update(users)
      .set({
        guardianConfirmToken: newToken,
        guardianConfirmTokenExpiresAt: new Date(Date.now() + GUARDIAN_TOKEN_TTL_MS),
        // Resending the link starts a new expiry cycle, so reset the
        // expired-email tracker. If the new token also expires, the parent
        // should get a fresh email.
        guardianExpiredEmailSentAt: null,
      })
      .where(eq(users.id, user.id));

    try {
      await sendGuardianConfirmationEmail(
        user.guardianEmail,
        user.name,
        newToken,
      );
    } catch (err) {
      logger.error({ err }, "Failed to send guardian confirmation email");
    }

    res.json({
      ok: true,
      guardianEmail: user.guardianEmail,
    });
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

router.get(
  "/auth/users",
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(users.role, users.name)
      .limit(100);
    res.json(
      rows.map((u) => {
        const { firstName, lastName } = splitName(u.name);
        return {
          id: u.id,
          firstName,
          lastName,
          role: u.role,
          email: u.email ?? null,
          avatarUrl: safeAvatarUrl(u.avatarUrl),
          sport: u.sport ?? null,
          position: u.position ?? null,
        };
      }),
    );
  }),
);

export default router;
