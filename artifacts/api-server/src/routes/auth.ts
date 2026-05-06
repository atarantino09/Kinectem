import { Router, type IRouter } from "express";
import { db, users, passwordResets, apiKeys, parentalConsents } from "@workspace/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import {
  AGE_GATE_COOKIE,
  AGE_GATE_TTL_MS,
  CONSENT_NOTICE_TEXT,
  CONSENT_NOTICE_VERSION,
  FOLLOWUP_DELAY_MS,
  FOLLOWUP_TOKEN_TTL_MS,
  clientIp,
  hashConsentToken,
  isUnder13,
  logConsentEvent,
  signAgeGate,
  verifyAgeGate,
} from "../lib/coppa";
import {
  sendParentalConsentFinalizedEmail,
  sendParentalConsentFollowupEmail,
  sendParentalConsentNoticeEmail,
} from "../lib/email";
import {
  generateApiKey,
  ALLOWED_API_KEY_SCOPES,
  type ApiKeyScope,
} from "../lib/api-keys";
import { requireAuth } from "../middlewares/auth";
import {
  rateLimit,
  ipKey,
  emailKey,
  refreshTokenKey,
} from "../middlewares/rate-limit";
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
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from "../lib/tokens";
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

const ONE_MINUTE = 60 * 1000;
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

// /auth/refresh and the bearer-flow body of /auth/logout aren't an immediate
// brute-force target (refresh tokens are 256 bits of entropy), but leaving
// them unthrottled lets attackers cheaply spam the rotation logic, generate
// log noise, or amplify DoS. A generous per-IP burst (well above any normal
// mobile client's refresh cadence) plus a per-token bucket keeps a leaked
// token from being replayed from many IPs in parallel.
const refreshLimiter = rateLimit({
  name: "auth-refresh",
  windowMs: ONE_MINUTE,
  max: 30,
  keys: (req) => [ipKey(req), refreshTokenKey(req)],
  message:
    "Too many refresh attempts. Please wait a moment and try again.",
});

const logoutLimiter = rateLimit({
  name: "auth-logout",
  windowMs: ONE_MINUTE,
  max: 30,
  keys: (req) => [ipKey(req), refreshTokenKey(req)],
  message:
    "Too many logout attempts. Please wait a moment and try again.",
});

// Task #359 — block sign-in for under-13 accounts whose verifiable
// parental consent has been revoked (account_status = 'disabled') or has
// not been finalized yet (account_status = 'pending_guardian'). Returns
// `true` and writes the response when blocked.
function blockOnAccountStatus(
  res: import("express").Response,
  user: { accountStatus?: string | null; isMinor?: boolean | null; guardianConfirmTokenExpiresAt?: Date | null; guardianEmail?: string | null; guardianConfirmedAt?: Date | null },
): boolean {
  if (user.accountStatus === "disabled") {
    apiError(
      res,
      403,
      "This account has been disabled because a parent or guardian revoked consent. Contact privacy@kinectem.com if you believe this is a mistake.",
      { extras: { accountStatus: "disabled" } },
    );
    return true;
  }
  if (user.accountStatus === "pending_guardian" || (user.guardianEmail && !user.guardianConfirmedAt)) {
    const expired =
      !user.guardianConfirmTokenExpiresAt ||
      user.guardianConfirmTokenExpiresAt.getTime() < Date.now();
    apiError(
      res,
      403,
      "Your account is waiting on parent or guardian confirmation. Ask them to open the link sent to their email.",
      {
        extras: {
          pendingGuardianConfirmation: true,
          guardianConfirmExpired: expired,
        },
      },
    );
    return true;
  }
  return false;
}

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
    if (blockOnAccountStatus(res, user)) return;
    if (user.guardianEmail && !user.guardianConfirmedAt) {
      const expired =
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

// Task #359 — neutral age gate. Posts the visitor's date of birth ONCE
// before the rest of the signup form is visible. The server response
// carries only a boolean ("requiresParentalConsent"); the date itself
// is set as a short-lived signed cookie that /auth/signup verifies, so
// a forged client cookie cannot bypass the under-13 branch.
router.post(
  "/auth/age-check",
  asyncHandler(async (req, res) => {
    const dob = String(req.body?.dateOfBirth ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob))) {
      apiError(res, 400, "A valid date of birth is required.");
      return;
    }
    let under13 = isUnder13(dob);
    // Task #359 — sticky age gate: once a visitor has been classified
    // as under-13 in this session, retrying with an older DOB cannot
    // downgrade them to "13+". Forcing a fresh device/cookie is a
    // reset path documented for support; see /coppa-notice.
    const existing = verifyAgeGate(req.cookies?.[AGE_GATE_COOKIE]);
    if (existing?.isUnder13) under13 = true;
    const token = signAgeGate({ isUnder13: under13, iat: Date.now() });
    res.cookie(AGE_GATE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: AGE_GATE_TTL_MS,
      path: "/",
    });
    void logConsentEvent({
      event: under13 ? "age_gate_blocked" : "age_gate_attempt",
      actorIp: clientIp(req),
      details: under13 ? "under-13" : "13+",
    });
    res.json({ requiresParentalConsent: under13 });
  }),
);

router.post(
  "/auth/signup",
  signupLimiter,
  asyncHandler(async (req, res) => {
    const body = SignupBody.parse(req.body);
    const dob = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
    // Server-side age gate is mandatory for athlete signup. The signed
    // `kinectem_age_gate` cookie (set by /auth/age-check) is the only
    // trusted age claim; non-athlete roles are exempt.
    const ageGate = verifyAgeGate(req.cookies?.[AGE_GATE_COOKIE]);
    if (body.role === "athlete") {
      if (!ageGate) {
        apiError(
          res,
          400,
          "Please confirm your date of birth before creating an account.",
          { code: "AGE_GATE_REQUIRED" },
        );
        return;
      }
      if (!dob) {
        apiError(
          res,
          400,
          "Athlete accounts require a date of birth.",
          { code: "DOB_REQUIRED" },
        );
        return;
      }
    }
    // Cookie is canonical: if it says under-13, that wins over a
    // client-supplied DOB that claims adult.
    let guardianRequired = false;
    if (body.role === "athlete") {
      if (ageGate?.isUnder13) {
        guardianRequired = true;
      } else if (dob) {
        const ageYears =
          (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
        guardianRequired = ageYears < 13;
      }
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
    // Strict data-minimization allowlist for under-13 signups.
    if (guardianRequired) {
      const allowed = new Set([
        "firstName",
        "lastName",
        "role",
        "email",
        "password",
        "dateOfBirth",
        "guardianEmail",
        "guardianConsent",
      ]);
      const raw = (req.body ?? {}) as Record<string, unknown>;
      const extra = Object.keys(raw).filter(
        (k) => !allowed.has(k) && raw[k] !== undefined && raw[k] !== null,
      );
      if (extra.length > 0) {
        apiError(
          res,
          400,
          `Under-13 signup only accepts the minimum required fields. Remove: ${extra.join(", ")}.`,
          { code: "MINOR_BLOCKED", extras: { minorBlocked: true, fields: extra } },
        );
        return;
      }
    }

    const email = body.email.toLowerCase();
    const [exists] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (exists) {
      apiError(res, 409, "An account with that email already exists.");
      return;
    }

    const passwordHash = await hashPassword(body.password);
    // Task #359 — under-13 athletes get a fresh "email plus" consent
    // ceremony token instead of the single-step legacy guardian-confirm
    // token. We still populate the legacy column so any existing UI that
    // reads `guardianConfirmedAt` keeps working as a "consent finalized"
    // signal, but the canonical record lives in `parental_consents`.
    const firstToken = guardianRequired ? generateToken() : null;
    const guardianEmail = guardianRequired
      ? body.guardianEmail!.toLowerCase()
      : null;

    const [created] = await db
      .insert(users)
      .values({
        name: `${body.firstName} ${body.lastName}`.trim(),
        role: body.role,
        email,
        passwordHash,
        dateOfBirth: dob ?? undefined,
        // For minors we never accept a client-supplied parent link —
        // the parent ↔ child relationship is established only when the
        // guardian completes the email-plus consent ceremony.
        parentId: guardianRequired ? undefined : (body.parentId ?? undefined),
        guardianEmail: guardianEmail ?? undefined,
        // Legacy single-step token — unused by the new flow but kept
        // populated for older clients reading these columns directly.
        // Task #32 — store only the SHA-256 hash; the raw token lives
        // exclusively inside the email we send the parent.
        guardianConfirmTokenHash: firstToken ? hashToken(firstToken) : undefined,
        guardianConfirmTokenExpiresAt: guardianRequired
          ? new Date(Date.now() + GUARDIAN_TOKEN_TTL_MS)
          : undefined,
        // Task #359 snapshot.
        isMinor: guardianRequired,
        accountStatus: guardianRequired ? "pending_guardian" : "active",
        // Task #367 — minor profiles are private-by-default. The
        // followers tier means only the user, their linked guardian,
        // platform admins, an org admin sharing a team with the
        // minor, or a guardian-approved follower can resolve the
        // profile. Adults keep the legacy `public` default.
        profileVisibility: guardianRequired ? "followers" : undefined,
        // COPPA defaults: under-13 accounts must approve every tag the
        // first time, so we flip `requireTagConsent` on at creation. An
        // adult account keeps the legacy default (off) and can opt in
        // from settings.
        requireTagConsent: guardianRequired ? true : undefined,
      })
      .returning();

    if (guardianRequired) {
      const [consent] = await db
        .insert(parentalConsents)
        .values({
          childUserId: created.id,
          guardianEmail: guardianEmail!,
          state: "pending_notice",
          noticeVersion: CONSENT_NOTICE_VERSION,
          noticeText: CONSENT_NOTICE_TEXT,
          firstTokenHash: hashConsentToken(firstToken!),
          firstTokenExpiresAt: new Date(Date.now() + GUARDIAN_TOKEN_TTL_MS),
        })
        .returning();
      try {
        await sendParentalConsentNoticeEmail(
          guardianEmail!,
          created.name,
          firstToken!,
        );
      } catch (err) {
        logger.error({ err }, "Failed to send parental-consent notice email");
      }
      void logConsentEvent({
        event: "child_signup",
        childUserId: created.id,
        consentId: consent.id,
        actorEmail: guardianEmail,
        actorIp: clientIp(req),
      });
      void logConsentEvent({
        event: "guardian_email_sent",
        childUserId: created.id,
        consentId: consent.id,
        actorEmail: guardianEmail,
        details: "notice",
      });
      // Clear the age-gate cookie so the visitor's browser doesn't
      // carry an "under 13" flag past signup.
      res.clearCookie(AGE_GATE_COOKIE, { path: "/" });
      res.status(201).json({
        ...toPrivateUser(created),
        pendingGuardianConfirmation: true,
      });
      return;
    }

    res.clearCookie(AGE_GATE_COOKIE, { path: "/" });
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
      .where(eq(users.guardianConfirmTokenHash, hashToken(body.token)))
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
        guardianConfirmTokenHash: null,
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
        guardianConfirmTokenHash: hashToken(newToken),
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

// ---------------------------------------------------------------------------
// Bearer-token auth (task #355) — used by the mobile app and any other
// non-browser client. The cookie flow above is unchanged.
// ---------------------------------------------------------------------------
const TokenIssueBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Optional human label so a future "active sessions" UI can tell
  // devices apart. Free-form, capped to keep noisy clients honest.
  deviceLabel: z.string().max(120).optional(),
});

const TokenRefreshBody = z.object({
  refreshToken: z.string().min(1),
});

function tokenResponse(args: {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}) {
  return {
    tokenType: "Bearer" as const,
    accessToken: args.accessToken,
    expiresIn: Math.max(
      0,
      Math.floor((args.accessExpiresAt.getTime() - Date.now()) / 1000),
    ),
    accessTokenExpiresAt: args.accessExpiresAt.toISOString(),
    refreshToken: args.refreshToken,
    refreshTokenExpiresAt: args.refreshExpiresAt.toISOString(),
  };
}

router.post(
  "/auth/token",
  // Reuse the existing per-IP+email login limiter so brute-force protection
  // is the same on the cookie and bearer paths.
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = TokenIssueBody.parse(req.body);
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
      apiError(res, 403, "This account has been deactivated.");
      return;
    }
    if (blockOnAccountStatus(res, user)) return;
    const access = signAccessToken(user.id);
    const refresh = await issueRefreshToken(user.id, body.deviceLabel ?? null);
    await db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));
    res.json({
      ...tokenResponse({
        accessToken: access.token,
        accessExpiresAt: access.expiresAt,
        refreshToken: refresh.token,
        refreshExpiresAt: refresh.expiresAt,
      }),
      user: toPrivateUser(user),
    });
  }),
);

router.post(
  "/auth/refresh",
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const body = TokenRefreshBody.parse(req.body);
    const rotated = await rotateRefreshToken(body.refreshToken);
    if (!rotated) {
      apiError(res, 401, "Refresh token is invalid, expired, or already used.");
      return;
    }
    // Confirm the user still exists and isn't soft-deleted before issuing
    // a fresh access token. Cheap belt-and-suspenders check; the rotation
    // already succeeded so we don't unwind it on failure here.
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, rotated.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user) {
      apiError(res, 401, "Refresh token is invalid, expired, or already used.");
      return;
    }
    // Task #359 — refresh must respect the same account-status gates as
    // /auth/login and /auth/token. A revoked or unfinalized account
    // cannot mint a new access token even if it still holds a valid
    // refresh token.
    if (blockOnAccountStatus(res, user)) return;
    const access = signAccessToken(rotated.userId);
    res.json(
      tokenResponse({
        accessToken: access.token,
        accessExpiresAt: access.expiresAt,
        refreshToken: rotated.refreshToken,
        refreshExpiresAt: rotated.refreshExpiresAt,
      }),
    );
  }),
);

router.post(
  "/auth/logout",
  logoutLimiter,
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await destroySession(token);
    clearSessionCookie(res);
    // Bearer clients pass `{ refreshToken }` in the body so we can revoke
    // it server-side. Cookie-only callers omit the body and continue to
    // get the same 204 they always have.
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as { refreshToken?: unknown })
        : undefined;
    const refreshTokenStr =
      body && typeof body.refreshToken === "string" ? body.refreshToken : null;
    if (refreshTokenStr) {
      await revokeRefreshToken(refreshTokenStr);
    }
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// API keys (task #358) — long-lived credentials for third-party developer
// integrations. Created by an authenticated user; presented as
// `Authorization: Bearer <key>` (the `kk_` prefix tells loadSession to
// look the key up in the api_keys table). The plaintext token is shown
// to the caller exactly once at create time and never persisted server-
// side; only the sha256 hash is stored.
// ---------------------------------------------------------------------------
const ApiKeyCreateBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  scopes: z
    .array(z.enum(ALLOWED_API_KEY_SCOPES as unknown as [ApiKeyScope, ...ApiKeyScope[]]))
    .max(ALLOWED_API_KEY_SCOPES.length)
    .optional(),
});

const apiKeyCreateLimiter = rateLimit({
  name: "auth-api-key-create",
  windowMs: ONE_HOUR,
  max: 20,
  keys: (req) => [
    `user:${req.sessionUser?.id ?? "anon"}`,
    ipKey(req),
  ],
  message:
    "Too many API key create attempts. Please wait a while before trying again.",
});

type ApiKeyRow = typeof apiKeys.$inferSelect;

function toApiKey(row: ApiKeyRow) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes ?? [],
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

router.post(
  "/auth/api-keys",
  requireAuth,
  apiKeyCreateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = ApiKeyCreateBody.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      apiError(res, 400, issue?.message ?? "Invalid request body.", {
        code: "BAD_REQUEST",
      });
      return;
    }
    const body = parsed.data;
    const userId = req.sessionUser!.id;
    // Cap per-user active keys so a runaway script can't fill the table.
    // Revoked keys don't count toward the cap.
    const existing = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
    if (existing.length >= 25) {
      apiError(
        res,
        409,
        "You have reached the maximum number of active API keys (25). Revoke an old key before creating a new one.",
        { code: "CONFLICT" },
      );
      return;
    }

    const generated = generateApiKey();
    const [created] = await db
      .insert(apiKeys)
      .values({
        userId,
        name: body.name,
        tokenHash: generated.tokenHash,
        prefix: generated.prefix,
        scopes: body.scopes ?? [],
      })
      .returning();
    res.status(201).json({
      ...toApiKey(created),
      // The plaintext key is returned exactly once and never again.
      // Surface it prominently so the client can show its "copy now"
      // affordance.
      token: generated.plaintext,
    });
  }),
);

router.get(
  "/auth/api-keys",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.sessionUser!.id;
    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(asc(apiKeys.revokedAt), asc(apiKeys.createdAt));
    res.json({ data: rows.map(toApiKey) });
  }),
);

router.delete(
  "/auth/api-keys/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.sessionUser!.id;
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) {
      apiError(res, 400, "Invalid API key id.");
      return;
    }
    const [row] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id.data), eq(apiKeys.userId, userId)))
      .limit(1);
    if (!row) {
      apiError(res, 404, "API key not found.");
      return;
    }
    if (!row.revokedAt) {
      await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(eq(apiKeys.id, row.id));
    }
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
