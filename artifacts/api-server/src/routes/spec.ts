import express, { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  users,
  organizations,
  organizationAdmins,
  organizationFollowers,
  organizationFollowOptouts,
  userFollowers,
  teamFollowers,
  teams,
  rosterEntries,
  rosterInvites,
  articles,
  articleAuthors,
  articleTags,
  highlights,
  highlightTags,
  orgPosts,
  notifications,
  postReactions,
  postComments,
  conversations,
  conversationParticipants,
  messages,
  messageAssets,
  assets,
  organizationJoinRequests,
  passwordResets,
  contentReports,
} from "@workspace/db";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { logger } from "../lib/logger";
import {
  sendGuardianConfirmationEmail,
  sendGuardianExpiredEmail,
  sendPasswordResetEmail,
} from "../lib/email";
import {
  canCreateRecap,
  canManageOrganization,
  isTeamMember,
  canManageTeam,
} from "../lib/permissions";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
  requireAuth,
} from "../lib/auth";
import {
  toPublicUser,
  toPrivateUser,
  displayName,
  toOrganization,
  toMember,
  toTeam,
  toTeamMember,
  toInvite,
  toNotification,
  articleToPost,
  highlightToPost,
  orgPostToPost,
  paginate,
  emptyPagination,
  splitName,
  parsePostId,
  articlePostId,
  highlightPostId,
  toComment,
  toConversation,
  toMessage,
  toAssetResponse,
  toJoinRequest,
  apiError,
  ErrorCodes,
} from "../lib/spec-helpers";

// ---------------------------------------------------------------------------
// Post stats loader (reactions + comments aggregated for a set of posts)
// ---------------------------------------------------------------------------

interface PostStats {
  reactionCount: number;
  hasReacted: boolean;
  commentCount: number;
  recentReactorName: string | null;
}

type StatsKind = "article" | "highlight" | "org_post";

function statsKey(kind: StatsKind, refId: string): string {
  return `${kind}:${refId}`;
}

async function loadPostStats(
  meId: string | null,
  items: Array<{ kind: StatsKind; refId: string }>,
): Promise<Map<string, PostStats>> {
  const map = new Map<string, PostStats>();
  if (items.length === 0) return map;
  for (const it of items) {
    map.set(statsKey(it.kind, it.refId), {
      reactionCount: 0,
      hasReacted: false,
      commentCount: 0,
      recentReactorName: null,
    });
  }
  const articleIds = items.filter((i) => i.kind === "article").map((i) => i.refId);
  const highlightIds = items.filter((i) => i.kind === "highlight").map((i) => i.refId);
  const orgPostIds = items.filter((i) => i.kind === "org_post").map((i) => i.refId);

  const tasks: Promise<unknown>[] = [];

  // Reaction counts + hasReacted for current user
  if (articleIds.length > 0) {
    tasks.push(
      (async () => {
        const rows = await db
          .select({
            postRefId: postReactions.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(postReactions)
          .where(and(eq(postReactions.postKind, "article"), inArray(postReactions.postRefId, articleIds)))
          .groupBy(postReactions.postRefId);
        for (const r of rows) {
          const k = statsKey("article", r.postRefId);
          const s = map.get(k);
          if (s) s.reactionCount = Number(r.count);
        }
        if (meId) {
          const my = await db
            .select({ postRefId: postReactions.postRefId })
            .from(postReactions)
            .where(
              and(
                eq(postReactions.postKind, "article"),
                eq(postReactions.userId, meId),
                inArray(postReactions.postRefId, articleIds),
              ),
            );
          for (const r of my) {
            const s = map.get(statsKey("article", r.postRefId));
            if (s) s.hasReacted = true;
          }
        }
        const recent = await db
          .select({
            postRefId: postReactions.postRefId,
            createdAt: postReactions.createdAt,
            name: users.name,
          })
          .from(postReactions)
          .innerJoin(users, eq(postReactions.userId, users.id))
          .where(and(eq(postReactions.postKind, "article"), inArray(postReactions.postRefId, articleIds)))
          .orderBy(desc(postReactions.createdAt));
        for (const r of recent) {
          const s = map.get(statsKey("article", r.postRefId));
          if (s && !s.recentReactorName) s.recentReactorName = r.name;
        }
        const cmts = await db
          .select({
            postRefId: postComments.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(postComments)
          .where(
            and(
              eq(postComments.postKind, "article"),
              isNull(postComments.deletedAt),
              inArray(postComments.postRefId, articleIds),
            ),
          )
          .groupBy(postComments.postRefId);
        for (const c of cmts) {
          const s = map.get(statsKey("article", c.postRefId));
          if (s) s.commentCount = Number(c.count);
        }
      })(),
    );
  }
  if (highlightIds.length > 0) {
    tasks.push(
      (async () => {
        const rows = await db
          .select({
            postRefId: postReactions.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(postReactions)
          .where(and(eq(postReactions.postKind, "highlight"), inArray(postReactions.postRefId, highlightIds)))
          .groupBy(postReactions.postRefId);
        for (const r of rows) {
          const s = map.get(statsKey("highlight", r.postRefId));
          if (s) s.reactionCount = Number(r.count);
        }
        if (meId) {
          const my = await db
            .select({ postRefId: postReactions.postRefId })
            .from(postReactions)
            .where(
              and(
                eq(postReactions.postKind, "highlight"),
                eq(postReactions.userId, meId),
                inArray(postReactions.postRefId, highlightIds),
              ),
            );
          for (const r of my) {
            const s = map.get(statsKey("highlight", r.postRefId));
            if (s) s.hasReacted = true;
          }
        }
        const recent = await db
          .select({
            postRefId: postReactions.postRefId,
            createdAt: postReactions.createdAt,
            name: users.name,
          })
          .from(postReactions)
          .innerJoin(users, eq(postReactions.userId, users.id))
          .where(and(eq(postReactions.postKind, "highlight"), inArray(postReactions.postRefId, highlightIds)))
          .orderBy(desc(postReactions.createdAt));
        for (const r of recent) {
          const s = map.get(statsKey("highlight", r.postRefId));
          if (s && !s.recentReactorName) s.recentReactorName = r.name;
        }
        const cmts = await db
          .select({
            postRefId: postComments.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(postComments)
          .where(
            and(
              eq(postComments.postKind, "highlight"),
              isNull(postComments.deletedAt),
              inArray(postComments.postRefId, highlightIds),
            ),
          )
          .groupBy(postComments.postRefId);
        for (const c of cmts) {
          const s = map.get(statsKey("highlight", c.postRefId));
          if (s) s.commentCount = Number(c.count);
        }
      })(),
    );
  }
  if (orgPostIds.length > 0) {
    tasks.push(
      (async () => {
        const rows = await db
          .select({
            postRefId: postReactions.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(postReactions)
          .where(and(eq(postReactions.postKind, "org_post"), inArray(postReactions.postRefId, orgPostIds)))
          .groupBy(postReactions.postRefId);
        for (const r of rows) {
          const s = map.get(statsKey("org_post", r.postRefId));
          if (s) s.reactionCount = Number(r.count);
        }
        if (meId) {
          const my = await db
            .select({ postRefId: postReactions.postRefId })
            .from(postReactions)
            .where(
              and(
                eq(postReactions.postKind, "org_post"),
                eq(postReactions.userId, meId),
                inArray(postReactions.postRefId, orgPostIds),
              ),
            );
          for (const r of my) {
            const s = map.get(statsKey("org_post", r.postRefId));
            if (s) s.hasReacted = true;
          }
        }
        const recent = await db
          .select({
            postRefId: postReactions.postRefId,
            createdAt: postReactions.createdAt,
            name: users.name,
          })
          .from(postReactions)
          .innerJoin(users, eq(postReactions.userId, users.id))
          .where(and(eq(postReactions.postKind, "org_post"), inArray(postReactions.postRefId, orgPostIds)))
          .orderBy(desc(postReactions.createdAt));
        for (const r of recent) {
          const s = map.get(statsKey("org_post", r.postRefId));
          if (s && !s.recentReactorName) s.recentReactorName = r.name;
        }
        const cmts = await db
          .select({
            postRefId: postComments.postRefId,
            count: sql<number>`count(*)::int`,
          })
          .from(postComments)
          .where(
            and(
              eq(postComments.postKind, "org_post"),
              isNull(postComments.deletedAt),
              inArray(postComments.postRefId, orgPostIds),
            ),
          )
          .groupBy(postComments.postRefId);
        for (const c of cmts) {
          const s = map.get(statsKey("org_post", c.postRefId));
          if (s) s.commentCount = Number(c.count);
        }
      })(),
    );
  }
  await Promise.all(tasks);
  return map;
}

function statsFor(
  map: Map<string, PostStats>,
  kind: StatsKind,
  refId: string,
): PostStats {
  return (
    map.get(statsKey(kind, refId)) ?? {
      reactionCount: 0,
      hasReacted: false,
      commentCount: 0,
      recentReactorName: null,
    }
  );
}

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Auto-follow the parent organization when a user joins one of its team
// rosters. Tolerant of failures (e.g. unique constraint races).
async function ensureOrgFollowedForTeam(userId: string, teamId: string): Promise<void> {
  try {
    const [team] = await db
      .select({ orgId: teams.organizationId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) return;
    // Respect a prior manual unfollow: if the user has explicitly opted out,
    // we do not silently re-follow them when they join a team in this org.
    const [optout] = await db
      .select()
      .from(organizationFollowOptouts)
      .where(
        and(
          eq(organizationFollowOptouts.organizationId, team.orgId),
          eq(organizationFollowOptouts.userId, userId),
        ),
      )
      .limit(1);
    if (optout) return;
    await db
      .insert(organizationFollowers)
      .values({ organizationId: team.orgId, userId })
      .onConflictDoNothing();
  } catch (err) {
    logger.warn({ err, userId, teamId }, "ensureOrgFollowedForTeam failed");
  }
}

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
const GUARDIAN_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
          avatarUrl: u.avatarUrl ?? null,
          sport: u.sport ?? null,
          position: u.position ?? null,
        };
      }),
    );
  }),
);

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

router.get(
  "/users/me",
  asyncHandler(async (req, res) => {
    const u = req.sessionUser;
    if (!u) return apiError(res, 401, "Not authenticated");
    if (u.role === "parent") {
      try {
        await notifyExpiredGuardianConfirmations(u.id);
      } catch (err) {
        logger.error(
          { err },
          "Failed to create guardian-expired notifications",
        );
      }
    }
    res.json(toPrivateUser(u));
  }),
);

router.get(
  "/users/me/settings",
  asyncHandler(async (_req, res) => {
    res.json({ share_to_facebook_default: false });
  }),
);

router.patch(
  "/users/me/settings",
  asyncHandler(async (req, res) => {
    res.json({ share_to_facebook_default: !!req.body?.share_to_facebook_default });
  }),
);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const q = typeof req.query["q"] === "string" ? req.query["q"] : "";
    const roleFilter =
      typeof req.query["role"] === "string" ? req.query["role"] : "";
    let rows = q
      ? await db
          .select()
          .from(users)
          .where(
            and(
              isNull(users.deletedAt),
              or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)),
            ),
          )
          .limit(40)
      : await db.select().from(users).where(isNull(users.deletedAt)).limit(40);
    if (roleFilter) rows = rows.filter((u) => u.role === roleFilter);
    res.json({
      data: rows.slice(0, 20).map((u) => {
        const { firstName, lastName } = splitName(u.name);
        return {
          id: u.id,
          entityType: "user",
          displayName: u.name,
          firstName,
          lastName,
          role: u.role,
          email: u.email ?? null,
          avatarUrl: u.avatarUrl ?? null,
          nickname: null,
        };
      }),
      pagination: emptyPagination(),
    });
  }),
);

router.get(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const [u] = await db.select().from(users).where(eq(users.id, req.params.userId)).limit(1);
    if (!u) return notFound(res);
    if (u.deletedAt && req.realUser?.role !== "admin") return notFound(res);
    const me = req.sessionUser;
    const isOwnProfile = me?.id === u.id;

    // Linked accounts (parent ↔ child) are sensitive on a youth-sports
    // product, but with different rules for the two halves:
    //
    //   • `parents` (who is *my* guardian) is private. Only the user
    //     themself, the linked parent/child, or an org admin who shares
    //     a team with the profile user can see it.
    //   • `children` of a parent profile are intentionally public to
    //     any logged-in user — visiting a parent's profile and seeing
    //     "Family: Samira, Riley, Cameron" with avatars is the navigation
    //     hook that lets coaches and other parents reach the kids'
    //     pages. Each child link is just `id + name + avatar`, the same
    //     fields the children already expose via search and team
    //     rosters, so there is no new data leak. Privacy on the child's
    //     own profile (DOB, email, COPPA flags) is unchanged.
    let canSeeParents = isOwnProfile;
    if (!canSeeParents && me) {
      if (me.parentId === u.id || u.parentId === me.id) {
        canSeeParents = true;
      } else {
        // Org admin of any org that owns a team the profile user is on.
        const sharedAdmin = await db
          .select({ id: organizationAdmins.organizationId })
          .from(organizationAdmins)
          .innerJoin(teams, eq(teams.organizationId, organizationAdmins.organizationId))
          .innerJoin(rosterEntries, eq(rosterEntries.teamId, teams.id))
          .where(
            and(
              eq(organizationAdmins.userId, me.id),
              eq(rosterEntries.userId, u.id),
            ),
          )
          .limit(1);
        if (sharedAdmin.length > 0) canSeeParents = true;
      }
    }
    const canSeeChildren = !!me; // any logged-in viewer sees the family card

    let linkedAccounts: { parents: unknown[]; children: unknown[] } | undefined;
    if (canSeeParents || canSeeChildren) {
      // IMPORTANT: filter soft-deleted accounts out of the family card.
      // The route already 404s on a deleted profile owner, but the
      // linked-account queries used to ignore `deletedAt` — which would
      // leak a deleted child's id/name/avatar through any non-deleted
      // parent's profile. Both halves now respect `deletedAt`.
      const parentRows =
        canSeeParents && u.parentId
          ? await db
              .select()
              .from(users)
              .where(and(eq(users.id, u.parentId), isNull(users.deletedAt)))
              .limit(1)
          : [];
      const childRows = canSeeChildren
        ? await db
            .select()
            .from(users)
            .where(and(eq(users.parentId, u.id), isNull(users.deletedAt)))
        : [];
      const toLinked = (row: typeof users.$inferSelect) => {
        const { firstName, lastName } = splitName(row.name);
        return {
          id: row.id,
          firstName,
          lastName,
          role: row.role,
          avatarUrl: row.avatarUrl ?? null,
        };
      };
      // Only emit the section when there is something to render so the
      // frontend's "no Family card" path stays clean for users with no
      // linked accounts.
      if (parentRows.length > 0 || childRows.length > 0) {
        linkedAccounts = {
          parents: parentRows.map(toLinked),
          children: childRows.map(toLinked),
        };
      }
    }

    let isFollowing = false;
    if (me && !isOwnProfile) {
      const [f] = await db
        .select()
        .from(userFollowers)
        .where(
          and(
            eq(userFollowers.followingUserId, u.id),
            eq(userFollowers.followerUserId, me.id),
          ),
        )
        .limit(1);
      isFollowing = !!f;
    }
    const [{ followerCount }] = await db
      .select({ followerCount: sql<number>`count(*)::int` })
      .from(userFollowers)
      .where(eq(userFollowers.followingUserId, u.id));
    const [{ followingCount }] = await db
      .select({ followingCount: sql<number>`count(*)::int` })
      .from(userFollowers)
      .where(eq(userFollowers.followerUserId, u.id));
    // A linked parent of the target user gets the same private fields the
    // user would see for themselves (email, role, parentId) so the parent
    // can edit the child's profile from `/family` and `/users/<childId>`.
    // Strangers still get the public-only view. The `isOwnProfile` flag on
    // the response stays `false` for the parent so the frontend doesn't
    // mistake them for the user themselves and render self-only UI.
    const isLinkedParentViewer =
      !!me && !!u.parentId && u.parentId === me.id;
    const base =
      isOwnProfile || isLinkedParentViewer
        ? toPrivateUser(u, {
            followerCount,
            followingCount,
            isOwnProfile,
            isFollowing,
          })
        : toPublicUser(u, {
            isOwnProfile: false,
            isFollowing,
            followerCount,
            followingCount,
          });
    res.json({ ...base, linkedAccounts });
  }),
);

router.patch(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.params.userId))
      .limit(1);
    if (!existing) return notFound(res);
    const isAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
    // Soft-deleted users are hidden from non-admins — same rule GET uses.
    // Without this, a linked parent of a soft-deleted child could still
    // mutate the row.
    if (existing.deletedAt && !isAdmin) return notFound(res);
    // A linked parent (existing.parentId === me.id) may edit their own
    // child's profile fields. Masqueraded sessions don't get this power —
    // it's a real-account-only check, the same rule the admin branch uses.
    const isLinkedParent =
      !!existing.parentId &&
      existing.parentId === me.id &&
      !req.isMasquerading;
    if (existing.id !== me.id && !isAdmin && !isLinkedParent) {
      return apiError(res, 403, "Forbidden");
    }
    const body = req.body ?? {};
    const updates: Partial<typeof users.$inferInsert> = {};
    if (body.firstName || body.lastName) {
      const cur = splitName(existing.name);
      updates.name = `${body.firstName ?? cur.firstName} ${body.lastName ?? cur.lastName}`.trim();
    }
    if (body.bio !== undefined) updates.bio = body.bio;
    if (body.avatarUrl !== undefined) {
      if (body.avatarUrl !== null && typeof body.avatarUrl !== "string") {
        return apiError(res, 400, "avatarUrl must be a string or null");
      }
      // Assets are stored as `data:<mime>;base64,<...>` URLs in this codebase,
      // so the avatar URL can be as long as ceil(ASSET_MAX_BYTES / 3) * 4 plus
      // a small prefix for `data:<mime>;base64,`. Tied to the asset upload
      // cap so the two stay in sync if that limit ever changes.
      const MAX_AVATAR_URL_LENGTH = Math.ceil(ASSET_MAX_BYTES / 3) * 4 + 64;
      if (
        typeof body.avatarUrl === "string" &&
        body.avatarUrl.length > MAX_AVATAR_URL_LENGTH
      ) {
        return apiError(res, 400, "avatarUrl is too long");
      }
      if (typeof body.avatarUrl === "string") {
        // Avatar URLs must come from a confirmed asset that the caller (not
        // the target user, since admins may edit anyone) owns. This prevents
        // direct API callers from pointing at arbitrary external URLs that
        // bypass the upload + confirm flow.
        const [ownedAsset] = await db
          .select()
          .from(assets)
          .where(
            and(
              eq(assets.url, body.avatarUrl),
              eq(assets.ownerId, me.id),
              eq(assets.status, "confirmed"),
            ),
          )
          .limit(1);
        if (!ownedAsset) {
          return apiError(
            res,
            400,
            "avatarUrl must reference a confirmed asset you uploaded",
          );
        }
      }
      updates.avatarUrl = body.avatarUrl;
    }
    const [updated] = Object.keys(updates).length
      ? await db.update(users).set(updates).where(eq(users.id, existing.id)).returning()
      : [existing];
    // Keep the response's `isOwnProfile` flag honest: when a parent or
    // admin patches someone else's profile, the response shouldn't claim
    // it belongs to the caller. Matches the GET /users/:userId behavior.
    res.json(toPrivateUser(updated, { isOwnProfile: existing.id === me.id }));
  }),
);

router.get(
  "/users/:userId/posts",
  asyncHandler(async (req, res) => {
    // Posts authored by user or where user is tagged. Simple: tagged.
    const [u] = await db.select().from(users).where(eq(users.id, req.params.userId)).limit(1);
    if (!u) return notFound(res);

    const isAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
    const userPostsConds = [
      eq(articles.authorId, u.id),
      eq(articles.status, "published"),
    ];
    if (!isAdmin) userPostsConds.push(isNull(articles.hiddenAt));
    const arts = await db
      .select({
        a: articles,
        team: teams,
        org: organizations,
        author: users,
      })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(and(...userPostsConds))
      .orderBy(desc(articles.createdAt))
      .limit(20);

    const posts = arts.map((row) =>
      articleToPost(row.a, { team: row.team, org: row.org, author: row.author }),
    );
    res.json(paginate(posts));
  }),
);

router.get(
  "/users/:userId/organizations",
  asyncHandler(async (req, res) => {
    const orgRows = await db
      .selectDistinct({ org: organizations })
      .from(rosterEntries)
      .innerJoin(teams, eq(rosterEntries.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(eq(rosterEntries.userId, req.params.userId));
    const adminRows = await db
      .select({ org: organizations })
      .from(organizationAdmins)
      .innerJoin(organizations, eq(organizationAdmins.organizationId, organizations.id))
      .where(eq(organizationAdmins.userId, req.params.userId));
    const followRows = await db
      .select({ org: organizations })
      .from(organizationFollowers)
      .innerJoin(
        organizations,
        eq(organizationFollowers.organizationId, organizations.id),
      )
      .where(eq(organizationFollowers.userId, req.params.userId));
    const followedIds = new Set(followRows.map((r) => r.org.id));
    const adminOrgIds = new Set(adminRows.map((r) => r.org.id));
    const seen = new Set<string>();
    const all = [...orgRows, ...adminRows, ...followRows].filter((r) => {
      if (seen.has(r.org.id)) return false;
      seen.add(r.org.id);
      return true;
    });
    const data = all.map((r) => {
      const isAdmin = adminOrgIds.has(r.org.id);
      const isOwner = r.org.createdById === req.params.userId;
      const role: "owner" | "admin" | "member" = isOwner
        ? "owner"
        : isAdmin
          ? "admin"
          : "member";
      return toOrganization(r.org, {
        isMember: true,
        role,
        isFollowing: followedIds.has(r.org.id),
      });
    });
    res.json(paginate(data));
  }),
);

router.get(
  "/users/:userId/teams",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    const targetId = req.params.userId;
    // A profile's pending invites should only be visible to people who
    // can actually act on them: the user themselves, their real
    // (non-masquerading) parent, or a real admin. Everyone else only
    // sees teams they have actually joined.
    const isSelf = me?.id === targetId;
    const isRealAdmin =
      !!me && req.realUser?.role === "admin" && !req.isMasquerading;
    let isParent = false;
    if (!isSelf && !isRealAdmin && me && !req.isMasquerading) {
      const [child] = await db
        .select({ parentId: users.parentId })
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      isParent = !!child && child.parentId === me.id;
    }
    const showPending = isSelf || isRealAdmin || isParent;
    const rows = await db
      .select({ r: rosterEntries, t: teams, org: organizations })
      .from(rosterEntries)
      .innerJoin(teams, eq(rosterEntries.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(
        showPending
          ? eq(rosterEntries.userId, targetId)
          : and(
              eq(rosterEntries.userId, targetId),
              eq(rosterEntries.status, "accepted"),
            ),
      );
    const data = rows.map((r) => ({
      id: r.r.id,
      teamId: r.t.id,
      teamName: r.t.name,
      teamSlug: r.t.name.toLowerCase().replace(/\s+/g, "-"),
      teamAvatarUrl: r.t.logoUrl ?? null,
      organization: { id: r.org.id, name: r.org.name, slug: r.org.name.toLowerCase().replace(/\s+/g, "-") },
      role: r.r.role === "coach" ? "admin" : ("member" as const),
      position: r.r.role === "player" ? "player" : "coach",
      status: r.r.status === "accepted" ? "active" : "pending",
      seasonId: r.t.id,
      seasonName: r.t.season ?? null,
      joinedAt: r.r.createdAt.toISOString(),
    }));
    res.json(paginate(data));
  }),
);

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

router.get(
  "/organizations",
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(organizations).limit(50);
    const data = rows.map((o) => toOrganization(o));
    res.json(paginate(data));
  }),
);

router.post(
  "/organizations",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const name = String(req.body?.name ?? "").trim();
    if (!name) return apiError(res, 400, "name required");
    const [org] = await db
      .insert(organizations)
      .values({
        name,
        description: req.body?.description ?? undefined,
        city: req.body?.city ?? undefined,
        state: req.body?.state ?? undefined,
        website: req.body?.website ?? undefined,
        logoUrl: req.body?.logoUrl ?? undefined,
        createdById: me.id,
      })
      .returning();
    await db
      .insert(organizationAdmins)
      .values({ organizationId: org.id, userId: me.id })
      .onConflictDoNothing();
    await db
      .insert(organizationFollowers)
      .values({ organizationId: org.id, userId: me.id })
      .onConflictDoNothing();
    res
      .status(201)
      .json(toOrganization(org, { isMember: true, role: "owner", isFollowing: true }));
  }),
);

router.get(
  "/organizations/:orgId",
  asyncHandler(async (req, res) => {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, req.params.orgId))
      .limit(1);
    if (!org) return notFound(res);
    const me = req.sessionUser;
    let role: "owner" | "admin" | "member" | null = null;
    let isMember = false;
    let isFollowing = false;
    if (me) {
      const [admin] = await db
        .select()
        .from(organizationAdmins)
        .where(
          and(
            eq(organizationAdmins.organizationId, org.id),
            eq(organizationAdmins.userId, me.id),
          ),
        )
        .limit(1);
      if (admin) {
        role = org.createdById === me.id ? "owner" : "admin";
        isMember = true;
      }
      const [follow] = await db
        .select()
        .from(organizationFollowers)
        .where(
          and(
            eq(organizationFollowers.organizationId, org.id),
            eq(organizationFollowers.userId, me.id),
          ),
        )
        .limit(1);
      isFollowing = !!follow;
    }
    const [{ followerCount }] = await db
      .select({ followerCount: sql<number>`count(*)::int` })
      .from(organizationFollowers)
      .where(eq(organizationFollowers.organizationId, org.id));
    res.json(toOrganization(org, { isMember, role, isFollowing, followerCount }));
  }),
);

router.patch(
  "/organizations/:orgId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [existing] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, req.params.orgId))
      .limit(1);
    if (!existing) return notFound(res);
    if (!(await canManageOrganization(me.id, req.params.orgId))) {
      return apiError(res, 403, "Forbidden");
    }
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.website === "string") patch.website = body.website;
    if (typeof body.city === "string") patch.city = body.city;
    if (typeof body.state === "string") patch.state = body.state;
    if (typeof body.logoUrl === "string") {
      patch.logoUrl = body.logoUrl === "" ? null : body.logoUrl;
    } else if (body.logoUrl === null) {
      patch.logoUrl = null;
    }
    if (Object.keys(patch).length === 0) {
      return res.json(toOrganization(existing));
    }
    const [updated] = await db
      .update(organizations)
      .set(patch)
      .where(eq(organizations.id, req.params.orgId))
      .returning();
    if (!updated) return notFound(res);
    res.json(toOrganization(updated));
  }),
);

router.get(
  "/organizations/:orgId/members",
  asyncHandler(async (req, res) => {
    const adminRows = await db
      .select({ u: users, joinedAt: organizationAdmins.createdAt })
      .from(organizationAdmins)
      .innerJoin(users, eq(organizationAdmins.userId, users.id))
      .where(eq(organizationAdmins.organizationId, req.params.orgId));
    const data = adminRows.map((r, i) =>
      toMember(r.u, i === 0 ? "owner" : "admin", r.joinedAt),
    );
    res.json(paginate(data));
  }),
);

router.get(
  "/organizations/:orgId/teams",
  asyncHandler(async (req, res) => {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, req.params.orgId))
      .limit(1);
    if (!org) return notFound(res);
    const teamRows = await db
      .select()
      .from(teams)
      .where(eq(teams.organizationId, org.id));
    const data = await Promise.all(
      teamRows.map(async (t) => {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(rosterEntries)
          .where(eq(rosterEntries.teamId, t.id));
        return toTeam(t, org, { memberCount: count });
      }),
    );
    res.json(paginate(data));
  }),
);

router.get(
  "/teams/:teamId/posts",
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({ a: articles, team: teams, org: organizations, author: users })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(and(eq(articles.status, "published"), eq(articles.teamId, req.params.teamId)))
      .orderBy(desc(articles.createdAt))
      .limit(20);
    const articleData = rows.map((r) =>
      articleToPost(r.a, { team: r.team, org: r.org, author: r.author }),
    );
    const hRows = await db
      .select({ h: highlights, team: teams, org: organizations, author: users })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(highlights.uploaderId, users.id))
      .where(eq(highlights.teamId, req.params.teamId))
      .orderBy(desc(highlights.createdAt))
      .limit(20);
    const highlightData = hRows.map((r) =>
      highlightToPost(r.h, { team: r.team, org: r.org, author: r.author }),
    );
    const merged = [...articleData, ...highlightData].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
    res.json(paginate(merged.slice(0, 20)));
  }),
);

router.get(
  "/organizations/:orgId/posts",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    const orgId = req.params.orgId;
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return notFound(res);

    const [articleRows, orgPostRows] = await Promise.all([
      db
        .select({ a: articles, team: teams, org: organizations, author: users })
        .from(articles)
        .innerJoin(teams, eq(articles.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .leftJoin(users, eq(articles.authorId, users.id))
        .where(and(eq(articles.status, "published"), eq(organizations.id, orgId)))
        .orderBy(desc(articles.createdAt))
        .limit(20),
      db
        .select({ p: orgPosts, author: users })
        .from(orgPosts)
        .leftJoin(users, eq(orgPosts.authorId, users.id))
        .where(and(eq(orgPosts.organizationId, orgId), eq(orgPosts.status, "published")))
        .orderBy(desc(orgPosts.createdAt))
        .limit(20),
    ]);

    const stats = await loadPostStats(me?.id ?? null, [
      ...articleRows.map((r) => ({ kind: "article" as const, refId: r.a.id })),
      ...orgPostRows.map((r) => ({ kind: "org_post" as const, refId: r.p.id })),
    ]);

    const data = [
      ...articleRows.map((r) =>
        articleToPost(r.a, {
          team: r.team,
          org: r.org,
          author: r.author,
          ...statsFor(stats, "article", r.a.id),
        }),
      ),
      ...orgPostRows.map((r) =>
        orgPostToPost(r.p, {
          org,
          author: r.author,
          ...statsFor(stats, "org_post", r.p.id),
        }),
      ),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json(paginate(data));
  }),
);

router.post(
  "/organizations/:orgId/posts",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const orgId = req.params.orgId;
    if (!(await canManageOrganization(me.id, orgId))) {
      return apiError(res, 403, "Org admins only");
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return notFound(res);
    const body = req.body ?? {};
    const title = String(body.title ?? "").trim();
    if (!title) return apiError(res, 400, "title required");
    if (title.length > 200) return apiError(res, 400, "title too long");
    const bodyText = typeof body.body === "string" ? body.body : "";
    if (bodyText.length > 50000) return apiError(res, 400, "body too long");
    const photoUrls: string[] = Array.isArray(body.photoUrls)
      ? body.photoUrls.filter((u: unknown) => typeof u === "string").slice(0, 10)
      : [];
    const videoUrl: string | null =
      typeof body.videoUrl === "string" && body.videoUrl.trim() ? body.videoUrl.trim() : null;
    const [p] = await db
      .insert(orgPosts)
      .values({
        organizationId: orgId,
        authorId: me.id,
        title,
        body: bodyText,
        coverImageUrl: photoUrls[0] ?? null,
        videoUrl,
        photoUrls: photoUrls.length > 0 ? photoUrls : null,
        status: "published",
        publishedAt: new Date(),
      })
      .returning();
    res.status(201).json(orgPostToPost(p, { org, author: me }));
  }),
);

// Org join requests
router.get(
  "/organizations/:orgId/join-requests",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const isAdmin = await canManageOrganization(me.id, req.params.orgId);
    if (!isAdmin) return apiError(res, 403, "Org admins only");
    const status = (req.query.status as string | undefined) ?? "pending";
    const validStatuses = ["pending", "approved", "declined", "withdrawn"] as const;
    type JRStatus = (typeof validStatuses)[number];
    const filterStatus: JRStatus = (validStatuses as readonly string[]).includes(status)
      ? (status as JRStatus)
      : "pending";
    const rows = await db
      .select({ r: organizationJoinRequests, u: users })
      .from(organizationJoinRequests)
      .leftJoin(users, eq(organizationJoinRequests.userId, users.id))
      .where(
        and(
          eq(organizationJoinRequests.organizationId, req.params.orgId),
          eq(organizationJoinRequests.status, filterStatus),
        ),
      )
      .orderBy(desc(organizationJoinRequests.createdAt));
    res.json(paginate(rows.map((r) => toJoinRequest(r.r, r.u))));
  }),
);

router.post(
  "/organizations/:orgId/join-requests",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [existing] = await db
      .select()
      .from(organizationJoinRequests)
      .where(
        and(
          eq(organizationJoinRequests.organizationId, req.params.orgId),
          eq(organizationJoinRequests.userId, me.id),
          eq(organizationJoinRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (existing) return res.status(200).json(toJoinRequest(existing, me));
    const [r] = await db
      .insert(organizationJoinRequests)
      .values({ organizationId: req.params.orgId, userId: me.id, status: "pending" })
      .returning();
    res.status(201).json(toJoinRequest(r, me));
  }),
);

async function decideJoinRequest(
  req: Request,
  res: Response,
  decision: "approved" | "declined",
) {
  const me = req.sessionUser;
  if (!me) return apiError(res, 401, "Not authenticated");
  const isAdmin = await canManageOrganization(me.id, req.params.orgId);
  if (!isAdmin) return apiError(res, 403, "Org admins only");
  const [r] = await db
    .select()
    .from(organizationJoinRequests)
    .where(eq(organizationJoinRequests.id, req.params.requestId))
    .limit(1);
  if (!r || r.organizationId !== req.params.orgId) return notFound(res);
  if (r.status !== "pending") return apiError(res, 409, `Request already ${r.status}`);
  const [updated] = await db
    .update(organizationJoinRequests)
    .set({
      status: decision,
      decidedById: me.id,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(organizationJoinRequests.id, r.id))
    .returning();
  if (decision === "approved") {
    const role: "admin" | "member" =
      req.body?.role === "admin" ? "admin" : "member";
    if (role === "admin") {
      await db
        .insert(organizationAdmins)
        .values({ organizationId: r.organizationId, userId: r.userId })
        .onConflictDoNothing();
    } else {
      await db
        .insert(organizationFollowers)
        .values({ organizationId: r.organizationId, userId: r.userId })
        .onConflictDoNothing();
    }
  }
  const [u] = await db.select().from(users).where(eq(users.id, r.userId)).limit(1);
  res.json(toJoinRequest(updated, u ?? null));
}

router.post(
  "/organizations/:orgId/join-requests/:requestId/approve",
  asyncHandler((req, res) => decideJoinRequest(req, res, "approved")),
);
router.post(
  "/organizations/:orgId/join-requests/:requestId/decline",
  asyncHandler((req, res) => decideJoinRequest(req, res, "declined")),
);
router.delete(
  "/organizations/:orgId/join-requests/:requestId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [r] = await db
      .select()
      .from(organizationJoinRequests)
      .where(eq(organizationJoinRequests.id, req.params.requestId))
      .limit(1);
    if (!r || r.organizationId !== req.params.orgId) return notFound(res);
    if (r.userId !== me.id)
      return apiError(res, 403, "Only the requester can withdraw");
    if (r.status !== "pending")
      return apiError(res, 409, `Request already ${r.status}`);
    const [updated] = await db
      .update(organizationJoinRequests)
      .set({ status: "withdrawn", decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(organizationJoinRequests.id, r.id))
      .returning();
    res.json(toJoinRequest(updated, me));
  }),
);

router.get(
  "/organizations/:orgId/post-approvals",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const isAdmin = await canManageOrganization(me.id, req.params.orgId);
    if (!isAdmin) return apiError(res, 403, "Org admins only");
    const rows = await db
      .select({ a: articles, team: teams, org: organizations, author: users })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(
        and(
          eq(articles.status, "pending_approval"),
          eq(organizations.id, req.params.orgId),
        ),
      )
      .orderBy(desc(articles.createdAt));
    res.json(
      paginate(
        rows.map((r) => {
          const post = articleToPost(r.a, {
            team: r.team,
            org: r.org,
            author: r.author,
          });
          return {
            id: post.id,
            orgId: r.org.id,
            postId: post.id,
            submittedBy: r.author?.id ?? null,
            status: "pending" as const,
            decidedBy: null,
            decidedAt: null,
            post,
            createdAt: r.a.createdAt.toISOString(),
            updatedAt: r.a.updatedAt.toISOString(),
          };
        }),
      ),
    );
  }),
);

async function transitionApproval(
  req: Request,
  res: Response,
  next: "published" | "draft",
) {
  const me = req.sessionUser;
  if (!me) return apiError(res, 401, "Not authenticated");
  const isAdmin = await canManageOrganization(me.id, req.params.orgId);
  if (!isAdmin) return apiError(res, 403, "Org admins only");
  const parsed = parsePostId(req.params.id);
  if (!parsed || parsed.kind !== "article") return notFound(res);
  const [a] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, parsed.id))
    .limit(1);
  if (!a || a.status !== "pending_approval") return notFound(res);
  // Confirm the article belongs to a team in this org.
  const [t] = await db.select().from(teams).where(eq(teams.id, a.teamId)).limit(1);
  if (!t || t.organizationId !== req.params.orgId) return notFound(res);
  await db
    .update(articles)
    .set({
      status: next,
      publishedAt: next === "published" ? new Date() : null,
    })
    .where(eq(articles.id, a.id));
  res.json({ status: next === "published" ? "approved" : "declined" });
}

router.post(
  "/organizations/:orgId/post-approvals/:id/approve",
  asyncHandler((req, res) => transitionApproval(req, res, "published")),
);
router.post(
  "/organizations/:orgId/post-approvals/:id/decline",
  asyncHandler((req, res) => transitionApproval(req, res, "draft")),
);
router.post(
  "/organizations/:orgId/follow",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    // Explicit follow clears any prior opt-out so future auto-follows work.
    await db
      .delete(organizationFollowOptouts)
      .where(
        and(
          eq(organizationFollowOptouts.organizationId, req.params.orgId),
          eq(organizationFollowOptouts.userId, me.id),
        ),
      );
    await db
      .insert(organizationFollowers)
      .values({ organizationId: req.params.orgId, userId: me.id })
      .onConflictDoNothing();
    res.json({
      followerId: me.id,
      orgId: req.params.orgId,
      createdAt: new Date().toISOString(),
    });
  }),
);
router.delete(
  "/organizations/:orgId/follow",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    await db
      .delete(organizationFollowers)
      .where(
        and(
          eq(organizationFollowers.organizationId, req.params.orgId),
          eq(organizationFollowers.userId, me.id),
        ),
      );
    // Record an opt-out so auto-follow flows do not silently re-follow.
    await db
      .insert(organizationFollowOptouts)
      .values({ organizationId: req.params.orgId, userId: me.id })
      .onConflictDoNothing();
    res.status(204).end();
  }),
);

router.post(
  "/users/:userId/follow",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (me.id === req.params.userId) {
      return apiError(res, 400, "Cannot follow yourself");
    }
    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, req.params.userId))
      .limit(1);
    if (!target) return notFound(res);
    await db
      .insert(userFollowers)
      .values({ followingUserId: req.params.userId, followerUserId: me.id })
      .onConflictDoNothing();
    res.status(201).json({
      followerId: me.id,
      followingUserId: req.params.userId,
      createdAt: new Date().toISOString(),
    });
  }),
);

router.delete(
  "/users/:userId/follow",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    await db
      .delete(userFollowers)
      .where(
        and(
          eq(userFollowers.followingUserId, req.params.userId),
          eq(userFollowers.followerUserId, me.id),
        ),
      );
    res.status(204).end();
  }),
);

router.post(
  "/teams/:teamId/follow",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [target] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, req.params.teamId))
      .limit(1);
    if (!target) return notFound(res);
    await db
      .insert(teamFollowers)
      .values({ teamId: req.params.teamId, userId: me.id })
      .onConflictDoNothing();
    res.status(201).json({
      followerId: me.id,
      teamId: req.params.teamId,
      createdAt: new Date().toISOString(),
    });
  }),
);

router.delete(
  "/teams/:teamId/follow",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    await db
      .delete(teamFollowers)
      .where(
        and(
          eq(teamFollowers.teamId, req.params.teamId),
          eq(teamFollowers.userId, me.id),
        ),
      );
    res.status(204).end();
  }),
);
router.get("/organizations/:orgId/privacy", (_req, res) =>
  res.json({ orgId: _req.params.orgId, settings: {} }),
);

// ---------------------------------------------------------------------------
// Follower / following list endpoints
// ---------------------------------------------------------------------------

function parseFollowLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function decodeFollowCursor(raw: unknown): { createdAt: Date; id: string } | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const idx = decoded.indexOf("|");
    if (idx < 0) return null;
    const ts = decoded.slice(0, idx);
    const id = decoded.slice(idx + 1);
    const d = new Date(ts);
    if (Number.isNaN(d.getTime()) || !id) return null;
    return { createdAt: d, id };
  } catch {
    return null;
  }
}

function encodeFollowCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64");
}

async function listOrgFollowers(req: Request, res: Response) {
  const limit = parseFollowLimit(req.query["limit"]);
  const cursor = decodeFollowCursor(req.query["cursor"]);
  const conds = [eq(organizationFollowers.organizationId, req.params.orgId)];
  if (cursor) {
    conds.push(
      sql`(${organizationFollowers.createdAt}, ${organizationFollowers.userId}) < (${cursor.createdAt.toISOString()}, ${cursor.id})`,
    );
  }
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      avatarUrl: users.avatarUrl,
      followedAt: organizationFollowers.createdAt,
    })
    .from(organizationFollowers)
    .innerJoin(users, eq(users.id, organizationFollowers.userId))
    .where(and(...conds))
    .orderBy(desc(organizationFollowers.createdAt), desc(organizationFollowers.userId))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && page.length > 0
      ? encodeFollowCursor(page[page.length - 1].followedAt, page[page.length - 1].id)
      : null;
  res.json({
    data: page.map((r) => ({
      id: r.id,
      displayName: displayName({ name: r.name }),
      avatarUrl: r.avatarUrl ?? null,
      followedAt: r.followedAt.toISOString(),
    })),
    pagination: { nextCursor, hasMore, totalCount: 0 },
  });
}

router.get("/organizations/:orgId/followers", asyncHandler(listOrgFollowers));

router.get(
  "/teams/:teamId/followers",
  asyncHandler(async (req, res) => {
    const limit = parseFollowLimit(req.query["limit"]);
    const cursor = decodeFollowCursor(req.query["cursor"]);
    const conds = [eq(teamFollowers.teamId, req.params.teamId)];
    if (cursor) {
      conds.push(
        sql`(${teamFollowers.createdAt}, ${teamFollowers.userId}) < (${cursor.createdAt.toISOString()}, ${cursor.id})`,
      );
    }
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        followedAt: teamFollowers.createdAt,
      })
      .from(teamFollowers)
      .innerJoin(users, eq(users.id, teamFollowers.userId))
      .where(and(...conds))
      .orderBy(desc(teamFollowers.createdAt), desc(teamFollowers.userId))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && page.length > 0
        ? encodeFollowCursor(page[page.length - 1].followedAt, page[page.length - 1].id)
        : null;
    res.json({
      data: page.map((r) => ({
        id: r.id,
        displayName: displayName({ name: r.name }),
        avatarUrl: r.avatarUrl ?? null,
        followedAt: r.followedAt.toISOString(),
      })),
      pagination: { nextCursor, hasMore, totalCount: 0 },
    });
  }),
);

router.get(
  "/users/:userId/followers",
  asyncHandler(async (req, res) => {
    const limit = parseFollowLimit(req.query["limit"]);
    const cursor = decodeFollowCursor(req.query["cursor"]);
    const userId =
      req.params.userId === "me" ? req.sessionUser?.id : req.params.userId;
    if (!userId) return apiError(res, 401, "Not authenticated");
    const conds = [eq(userFollowers.followingUserId, userId)];
    if (cursor) {
      conds.push(
        sql`(${userFollowers.createdAt}, ${userFollowers.followerUserId}) < (${cursor.createdAt.toISOString()}, ${cursor.id})`,
      );
    }
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        followedAt: userFollowers.createdAt,
      })
      .from(userFollowers)
      .innerJoin(users, eq(users.id, userFollowers.followerUserId))
      .where(and(...conds))
      .orderBy(desc(userFollowers.createdAt), desc(userFollowers.followerUserId))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && page.length > 0
        ? encodeFollowCursor(page[page.length - 1].followedAt, page[page.length - 1].id)
        : null;
    res.json({
      data: page.map((r) => ({
        id: r.id,
        displayName: displayName({ name: r.name }),
        avatarUrl: r.avatarUrl ?? null,
        followedAt: r.followedAt.toISOString(),
      })),
      pagination: { nextCursor, hasMore, totalCount: 0 },
    });
  }),
);

router.get(
  "/users/:userId/following",
  asyncHandler(async (req, res) => {
    const limit = parseFollowLimit(req.query["limit"]);
    const cursor = decodeFollowCursor(req.query["cursor"]);
    const userId =
      req.params.userId === "me" ? req.sessionUser?.id : req.params.userId;
    if (!userId) return apiError(res, 401, "Not authenticated");
    // Combine followed users + followed organizations, sort by createdAt desc.
    const userConds = [eq(userFollowers.followerUserId, userId)];
    const userRows = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        followedAt: userFollowers.createdAt,
      })
      .from(userFollowers)
      .innerJoin(users, eq(users.id, userFollowers.followingUserId))
      .where(and(...userConds))
      .orderBy(desc(userFollowers.createdAt));
    const orgConds = [eq(organizationFollowers.userId, req.params.userId)];
    const orgRows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        avatarUrl: organizations.logoUrl,
        followedAt: organizationFollowers.createdAt,
      })
      .from(organizationFollowers)
      .innerJoin(organizations, eq(organizations.id, organizationFollowers.organizationId))
      .where(and(...orgConds))
      .orderBy(desc(organizationFollowers.createdAt));
    const combined = [
      ...userRows.map((r) => ({
        id: r.id,
        displayName: displayName({ name: r.name }),
        avatarUrl: r.avatarUrl ?? null,
        entityType: "user" as const,
        followedAt: r.followedAt,
      })),
      ...orgRows.map((r) => ({
        id: r.id,
        displayName: r.name,
        avatarUrl: r.avatarUrl ?? null,
        entityType: "organization" as const,
        followedAt: r.followedAt,
      })),
    ].sort((a, b) => {
      const diff = b.followedAt.getTime() - a.followedAt.getTime();
      if (diff !== 0) return diff;
      return b.id.localeCompare(a.id);
    });
    let startIdx = 0;
    if (cursor) {
      startIdx = combined.findIndex(
        (it) =>
          it.followedAt.getTime() < cursor.createdAt.getTime() ||
          (it.followedAt.getTime() === cursor.createdAt.getTime() && it.id < cursor.id),
      );
      if (startIdx < 0) startIdx = combined.length;
    }
    const slice = combined.slice(startIdx, startIdx + limit + 1);
    const hasMore = slice.length > limit;
    const page = hasMore ? slice.slice(0, limit) : slice;
    const nextCursor =
      hasMore && page.length > 0
        ? encodeFollowCursor(page[page.length - 1].followedAt, page[page.length - 1].id)
        : null;
    res.json({
      data: page.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        entityType: r.entityType,
        followedAt: r.followedAt.toISOString(),
      })),
      pagination: { nextCursor, hasMore, totalCount: 0 },
    });
  }),
);

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

router.post(
  "/organizations/:orgId/teams",
  asyncHandler(async (req, res) => {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, req.params.orgId))
      .limit(1);
    if (!org) return notFound(res);
    const name = String(req.body?.name ?? "").trim();
    if (!name) return apiError(res, 400, "name required");
    const [team] = await db
      .insert(teams)
      .values({
        organizationId: org.id,
        name,
        sport: req.body?.sport ?? undefined,
        level: req.body?.level ?? undefined,
        season: req.body?.season?.name ?? undefined,
      })
      .returning();
    res.status(201).json(toTeam(team, org, { memberCount: 0 }));
  }),
);

router.get(
  "/teams/:teamId",
  asyncHandler(async (req, res) => {
    const [t] = await db.select().from(teams).where(eq(teams.id, req.params.teamId)).limit(1);
    if (!t) return notFound(res);
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, t.organizationId))
      .limit(1);
    if (!org) return notFound(res);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterEntries)
      .where(eq(rosterEntries.teamId, t.id));
    const me = req.sessionUser;
    const [{ followerCount }] = await db
      .select({ followerCount: sql<number>`count(*)::int` })
      .from(teamFollowers)
      .where(eq(teamFollowers.teamId, t.id));
    let isFollowing = false;
    if (me) {
      const [f] = await db
        .select()
        .from(teamFollowers)
        .where(
          and(eq(teamFollowers.teamId, t.id), eq(teamFollowers.userId, me.id)),
        )
        .limit(1);
      isFollowing = !!f;
    }
    res.json(toTeam(t, org, { memberCount: count, followerCount, isFollowing }));
  }),
);

router.patch(
  "/teams/:teamId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "unauthorized");
    const [existing] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, req.params.teamId))
      .limit(1);
    if (!existing) return notFound(res);
    const [adminRow] = await db
      .select()
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, existing.organizationId),
          eq(organizationAdmins.userId, me.id),
        ),
      )
      .limit(1);
    if (!adminRow) return apiError(res, 403, "forbidden");
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.sport === "string") patch.sport = body.sport;
    if (typeof body.level === "string") patch.level = body.level;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.logoUrl === "string") patch.logoUrl = body.logoUrl;
    if (typeof body.bannerUrl === "string") patch.bannerUrl = body.bannerUrl;
    if (Object.keys(patch).length === 0) {
      return apiError(res, 400, "no updatable fields");
    }
    const [t] = await db
      .update(teams)
      .set(patch)
      .where(eq(teams.id, req.params.teamId))
      .returning();
    if (!t) return notFound(res);
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, t.organizationId))
      .limit(1);
    if (!org) return notFound(res);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterEntries)
      .where(eq(rosterEntries.teamId, t.id));
    res.json(toTeam(t, org, { memberCount: count }));
  }),
);

router.get(
  "/teams/:teamId/members",
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({ r: rosterEntries, u: users })
      .from(rosterEntries)
      .innerJoin(users, eq(rosterEntries.userId, users.id))
      .where(eq(rosterEntries.teamId, req.params.teamId));
    const parentIds = Array.from(
      new Set(
        rows
          .map((r) => r.u.parentId)
          .filter((x): x is string => typeof x === "string"),
      ),
    );
    const parentRows = parentIds.length
      ? await db.select().from(users).where(inArray(users.id, parentIds))
      : [];
    const parentMap = new Map(parentRows.map((p) => [p.id, p]));
    const me = req.sessionUser;
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, req.params.teamId))
      .limit(1);
    let canSeeParentEmail = false;
    if (me && team) {
      canSeeParentEmail =
        (await canManageOrganization(me.id, team.organizationId)) ||
        (await isTeamMember(me.id, team.id));
    }
    const data = rows.map((r) => {
      const base = toTeamMember(r.r, r.u);
      const parent = r.u.parentId ? parentMap.get(r.u.parentId) : null;
      return {
        ...base,
        parents: parent
          ? [
              {
                id: parent.id,
                displayName: parent.name || "Parent",
                email: canSeeParentEmail ? (parent.email ?? null) : null,
                avatarUrl: parent.avatarUrl ?? null,
              },
            ]
          : [],
      };
    });
    res.json(paginate(data));
  }),
);

router.get(
  "/teams/:teamId/invites",
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({ i: rosterInvites, u: users })
      .from(rosterInvites)
      .leftJoin(users, eq(rosterInvites.invitedById, users.id))
      .where(eq(rosterInvites.teamId, req.params.teamId));
    const data = rows.map((r) => toInvite(r.i, r.u));
    res.json(paginate(data));
  }),
);

// Add a known Kinectem user directly to the roster (in pending state by default).
router.post(
  "/teams/:teamId/members",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    const userId = String(req.body?.userId ?? "");
    if (!userId) return apiError(res, 400, "userId required");
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    if (!(await canManageTeam(me.id, t)))
      return apiError(res, 403, "Team coaches or org admins only");
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return notFound(res);
    const positionRaw = String(req.body?.position ?? "player");
    const dbRole: "player" | "coach" =
      positionRaw === "coach" || positionRaw === "assistant_coach" ? "coach" : "player";
    const [existing] = await db
      .select()
      .from(rosterEntries)
      .where(and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.userId, userId)))
      .limit(1);
    let entry = existing;
    if (!entry) {
      [entry] = await db
        .insert(rosterEntries)
        .values({
          teamId,
          userId,
          role: dbRole,
          status: "pending",
          position: positionRaw === "coach" ? null : positionRaw,
        })
        .returning();
      await ensureOrgFollowedForTeam(userId, teamId);
      await db.insert(notifications).values({
        userId,
        kind: "roster_invite",
        message: `${displayName(me)} added you to ${t.name}. Tap to accept or decline.`,
        link: `/teams/${teamId}`,
      });
      // Fan out to the linked guardian, if any. A parent managing an
      // under-13 athlete needs to see the invite in their own bell and
      // be able to accept on the child's behalf from /family.
      if (u.parentId) {
        const childFirstName =
          (u.name?.trim().split(/\s+/)[0] ?? "").length > 0
            ? u.name!.trim().split(/\s+/)[0]
            : "your child";
        await db.insert(notifications).values({
          userId: u.parentId,
          kind: "roster_invite_for_child",
          message: `${displayName(me)} invited ${childFirstName} to join ${t.name}.`,
          link: `/family?childId=${u.id}&entryId=${entry.id}&teamId=${teamId}`,
        });
      }
    }
    res.status(201).json(toTeamMember(entry, u));
  }),
);

router.delete(
  "/teams/:teamId/members/:memberId",
  asyncHandler(async (req, res) => {
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.id, req.params.memberId),
          eq(rosterEntries.teamId, req.params.teamId),
        ),
      );
    res.status(204).end();
  }),
);

// A roster spot can be acted on by either the entry's user themselves
// (real, non-masquerading session) or the entry user's linked guardian
// acting from a real (non-masquerading) parent session. This lets a
// parent accept/decline a child's roster spot from /family or the
// notifications bell on the child's behalf, without giving admins or
// strangers the same power even if they impersonate.
async function rosterEntryActor(
  req: Request,
  entryUserId: string,
): Promise<{ allowed: boolean; actor: typeof users.$inferSelect | null }> {
  const me = req.sessionUser;
  if (!me) return { allowed: false, actor: null };
  if (entryUserId === me.id && !req.isMasquerading) {
    const [self] = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
    return { allowed: true, actor: self ?? null };
  }
  if (req.isMasquerading) return { allowed: false, actor: null };
  const [child] = await db
    .select({ parentId: users.parentId })
    .from(users)
    .where(eq(users.id, entryUserId))
    .limit(1);
  if (child && child.parentId === me.id) {
    const [target] = await db.select().from(users).where(eq(users.id, entryUserId)).limit(1);
    return { allowed: true, actor: target ?? null };
  }
  return { allowed: false, actor: null };
}

router.post(
  "/teams/:teamId/members/:memberId/accept",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [entry] = await db
      .select()
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.id, req.params.memberId),
          eq(rosterEntries.teamId, req.params.teamId),
        ),
      )
      .limit(1);
    if (!entry) return notFound(res);
    const { allowed, actor } = await rosterEntryActor(req, entry.userId);
    if (!allowed || !actor) return apiError(res, 403, "Forbidden");
    const [updated] = await db
      .update(rosterEntries)
      .set({ status: "accepted" })
      .where(eq(rosterEntries.id, entry.id))
      .returning();
    res.json(toTeamMember(updated, actor));
  }),
);

router.post(
  "/teams/:teamId/members/:memberId/decline",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [entry] = await db
      .select()
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.id, req.params.memberId),
          eq(rosterEntries.teamId, req.params.teamId),
        ),
      )
      .limit(1);
    if (!entry) return notFound(res);
    const { allowed } = await rosterEntryActor(req, entry.userId);
    if (!allowed) return apiError(res, 403, "Forbidden");
    await db.delete(rosterEntries).where(eq(rosterEntries.id, entry.id));
    res.status(204).end();
  }),
);

// Email invite — creates a pending rosterInvite with a token.
router.post(
  "/teams/:teamId/invites",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    if (!(await canManageTeam(me.id, t)))
      return apiError(res, 403, "Team coaches or org admins only");
    const email = String(req.body?.email ?? "").trim();
    if (!email) return apiError(res, 400, "email required");
    const positionRaw = String(req.body?.position ?? "player");
    const dbRole: "player" | "coach" =
      positionRaw === "coach" || positionRaw === "assistant_coach" ? "coach" : "player";
    const token = `inv-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    const [invite] = await db
      .insert(rosterInvites)
      .values({
        token,
        teamId,
        invitedEmail: email,
        invitedName: req.body?.name ?? null,
        role: dbRole,
        position: positionRaw === "coach" ? null : positionRaw,
        invitedById: me.id,
      })
      .returning();
    res.status(201).json(toInvite(invite, me));
  }),
);

// Token-based invite lookup + acceptance for the email-link flow.
router.get(
  "/invites/:token",
  asyncHandler(async (req, res) => {
    const [row] = await db
      .select({ i: rosterInvites, t: teams, org: organizations })
      .from(rosterInvites)
      .innerJoin(teams, eq(rosterInvites.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(eq(rosterInvites.token, req.params.token))
      .limit(1);
    if (!row) return notFound(res);
    res.json({
      invite: toInvite(row.i, null),
      team: { id: row.t.id, name: row.t.name },
      organization: { id: row.org.id, name: row.org.name },
    });
  }),
);

router.post(
  "/invites/:token/accept",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [invite] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.token, req.params.token))
      .limit(1);
    if (!invite) return notFound(res);
    if (invite.status !== "pending")
      return apiError(res, 409, "Invite no longer pending");

    // Player invites are addressed to the parent / guardian. The accepting
    // user does NOT become a player; instead they're prompted to add their
    // child(ren) as players on the roster.
    const isPlayerInvite = invite.position === "player";
    if (isPlayerInvite) {
      // Email-targeted player invites are single-use (mark accepted).
      // Email-less shareable links stay pending so multiple guardians can
      // use the same link to add their kids.
      if (invite.invitedEmail) {
        await db
          .update(rosterInvites)
          .set({ status: "accepted" })
          .where(eq(rosterInvites.id, invite.id));
      }
      return res.status(200).json({
        requiresChildSetup: true,
        teamId: invite.teamId,
        inviteId: invite.id,
      });
    }

    const [entry] = await db
      .insert(rosterEntries)
      .values({
        teamId: invite.teamId,
        userId: me.id,
        role: invite.role,
        status: "accepted",
        position: invite.position,
      })
      .returning();
    await ensureOrgFollowedForTeam(me.id, invite.teamId);
    await db
      .update(rosterInvites)
      .set({ status: "accepted" })
      .where(eq(rosterInvites.id, invite.id));
    res.status(201).json(toTeamMember(entry, me));
  }),
);

// After a parent accepts a player invite, they add 1+ children as players.
router.post(
  "/invites/:token/children",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [invite] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.token, req.params.token))
      .limit(1);
    if (!invite) return notFound(res);
    if (invite.position !== "player") {
      return apiError(res, 400, "Only player invites support adding children");
    }
    const firstName = String(req.body?.firstName ?? "").trim();
    const lastName = String(req.body?.lastName ?? "").trim();
    if (!firstName || !lastName) {
      return apiError(res, 400, "firstName and lastName required");
    }
    const [child] = await db
      .insert(users)
      .values({
        name: `${firstName} ${lastName}`,
        role: "athlete",
        email: null,
        parentId: me.id,
        requireTagConsent: true,
      })
      .returning();
    const [entry] = await db
      .insert(rosterEntries)
      .values({
        teamId: invite.teamId,
        userId: child.id,
        role: "player",
        status: "accepted",
        position: "player",
      })
      .returning();
    await ensureOrgFollowedForTeam(me.id, invite.teamId);
    res.status(201).json({
      child: {
        id: child.id,
        firstName,
        lastName,
        avatarUrl: child.avatarUrl ?? null,
      },
      member: toTeamMember(entry, child),
    });
  }),
);

// User search — returns up to 25 users matching name or email.
router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return res.json(paginate([]));
    const like = `%${q}%`;
    const rows = await db
      .select()
      .from(users)
      .where(or(ilike(users.name, like), ilike(users.email, like)))
      .limit(25);
    res.json(paginate(rows.map((u) => toPublicUser(u))));
  }),
);

router.post(
  "/teams/:teamId/join-link",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    // Only org admins of the owning organization can mint join links.
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) return notFound(res);
    const [adminRow] = await db
      .select()
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, team.organizationId),
          eq(organizationAdmins.userId, me.id),
        ),
      )
      .limit(1);
    if (!adminRow) return apiError(res, 403, "Not a team admin");
    // Reuse a pending email-less player invite for this team if one exists,
    // so admins always share a stable parent-onboarding link.
    const [existing] = await db
      .select()
      .from(rosterInvites)
      .where(
        and(
          eq(rosterInvites.teamId, teamId),
          eq(rosterInvites.status, "pending"),
          isNull(rosterInvites.invitedEmail),
        ),
      )
      .limit(1);
    let token = existing?.token;
    let createdAt = existing?.createdAt ?? new Date();
    if (!existing) {
      const newToken = `join-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      const [row] = await db
        .insert(rosterInvites)
        .values({
          token: newToken,
          teamId,
          invitedEmail: null,
          invitedName: null,
          role: "player",
          position: "player",
          invitedById: me?.id ?? null,
        })
        .returning();
      token = row.token;
      createdAt = row.createdAt;
    }
    res.json({
      token,
      teamId,
      expiresAt: null,
      createdAt: createdAt.toISOString(),
    });
  }),
);

router.get(
  "/teams/:teamId/seasons",
  asyncHandler(async (req, res) => {
    const [t] = await db.select().from(teams).where(eq(teams.id, req.params.teamId)).limit(1);
    if (!t) return notFound(res);
    res.json(
      paginate([
        {
          id: t.id,
          name: t.season ?? "Current Season",
          startDate: null,
          endDate: null,
          status: "active" as const,
          createdAt: t.createdAt.toISOString(),
        },
      ]),
    );
  }),
);

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

router.get(
  "/feed",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");

    const [followedOrgRows, followedTeamRows, followedUserRows] = await Promise.all([
      db
        .select({ id: organizationFollowers.organizationId })
        .from(organizationFollowers)
        .where(eq(organizationFollowers.userId, me.id)),
      db
        .select({ id: teamFollowers.teamId })
        .from(teamFollowers)
        .where(eq(teamFollowers.userId, me.id)),
      db
        .select({ id: userFollowers.followingUserId })
        .from(userFollowers)
        .where(eq(userFollowers.followerUserId, me.id)),
    ]);
    const followedOrgIds = followedOrgRows.map((r) => r.id);
    const followedTeamIds = followedTeamRows.map((r) => r.id);
    const followedUserIds = followedUserRows.map((r) => r.id);

    if (
      followedOrgIds.length === 0 &&
      followedTeamIds.length === 0 &&
      followedUserIds.length === 0
    ) {
      // User follows nothing: only show their own posts.
      const ownArts = await db
        .select({ a: articles, team: teams, org: organizations, author: users })
        .from(articles)
        .innerJoin(teams, eq(articles.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .leftJoin(users, eq(articles.authorId, users.id))
        .where(
          and(
            eq(articles.status, "published"),
            eq(articles.authorId, me.id),
            isNull(articles.hiddenAt),
          ),
        )
        .orderBy(desc(articles.createdAt))
        .limit(10);
      const ownHls = await db
        .select({ h: highlights, team: teams, org: organizations, uploader: users })
        .from(highlights)
        .innerJoin(teams, eq(highlights.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .leftJoin(users, eq(highlights.uploaderId, users.id))
        .where(and(eq(highlights.uploaderId, me.id), isNull(highlights.hiddenAt)))
        .orderBy(desc(highlights.createdAt))
        .limit(10);
      const stats = await loadPostStats(me.id, [
        ...ownArts.map((r) => ({ kind: "article" as const, refId: r.a.id })),
        ...ownHls.map((r) => ({ kind: "highlight" as const, refId: r.h.id })),
      ]);
      const items = [
        ...ownArts.map((r) =>
          articleToPost(r.a, {
            team: r.team,
            org: r.org,
            author: r.author,
            ...statsFor(stats, "article", r.a.id),
          }),
        ),
        ...ownHls.map((r) =>
          highlightToPost(r.h, {
            team: r.team,
            org: r.org,
            author: r.uploader,
            ...statsFor(stats, "highlight", r.h.id),
          }),
        ),
      ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return res.json(paginate(items));
    }

    // Articles whose tagged users include any followed user.
    const articleIdsByTaggedUser = followedUserIds.length
      ? (
          await db
            .selectDistinct({ id: articleTags.articleId })
            .from(articleTags)
            .where(inArray(articleTags.userId, followedUserIds))
        ).map((r) => r.id)
      : [];
    const highlightIdsByTaggedUser = followedUserIds.length
      ? (
          await db
            .selectDistinct({ id: highlightTags.highlightId })
            .from(highlightTags)
            .where(inArray(highlightTags.userId, followedUserIds))
        ).map((r) => r.id)
      : [];

    const articleConds = [eq(articles.authorId, me.id)];
    if (followedTeamIds.length)
      articleConds.push(inArray(articles.teamId, followedTeamIds));
    if (followedOrgIds.length)
      articleConds.push(inArray(teams.organizationId, followedOrgIds));
    if (followedUserIds.length)
      articleConds.push(inArray(articles.authorId, followedUserIds));
    if (articleIdsByTaggedUser.length)
      articleConds.push(inArray(articles.id, articleIdsByTaggedUser));

    const arts = await db
      .select({ a: articles, team: teams, org: organizations, author: users })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(
        and(
          eq(articles.status, "published"),
          isNull(articles.hiddenAt),
          or(...articleConds),
        ),
      )
      .orderBy(desc(articles.createdAt))
      .limit(20);

    const highlightConds = [eq(highlights.uploaderId, me.id)];
    if (followedTeamIds.length)
      highlightConds.push(inArray(highlights.teamId, followedTeamIds));
    if (followedOrgIds.length)
      highlightConds.push(inArray(teams.organizationId, followedOrgIds));
    if (followedUserIds.length)
      highlightConds.push(inArray(highlights.uploaderId, followedUserIds));
    if (highlightIdsByTaggedUser.length)
      highlightConds.push(inArray(highlights.id, highlightIdsByTaggedUser));

    const hls = await db
      .select({ h: highlights, team: teams, org: organizations, uploader: users })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(highlights.uploaderId, users.id))
      .where(and(isNull(highlights.hiddenAt), or(...highlightConds)))
      .orderBy(desc(highlights.createdAt))
      .limit(20);

    // Org-level announcements from followed organizations.
    const orgPostRows = followedOrgIds.length
      ? await db
          .select({ p: orgPosts, org: organizations, author: users })
          .from(orgPosts)
          .innerJoin(organizations, eq(orgPosts.organizationId, organizations.id))
          .leftJoin(users, eq(orgPosts.authorId, users.id))
          .where(
            and(
              eq(orgPosts.status, "published"),
              isNull(orgPosts.hiddenAt),
              inArray(orgPosts.organizationId, followedOrgIds),
            ),
          )
          .orderBy(desc(orgPosts.createdAt))
          .limit(20)
      : [];

    const stats = await loadPostStats(me?.id ?? null, [
      ...arts.map((r) => ({ kind: "article" as const, refId: r.a.id })),
      ...hls.map((r) => ({ kind: "highlight" as const, refId: r.h.id })),
      ...orgPostRows.map((r) => ({ kind: "org_post" as const, refId: r.p.id })),
    ]);
    const items = [
      ...arts.map((r) =>
        articleToPost(r.a, {
          team: r.team,
          org: r.org,
          author: r.author,
          ...statsFor(stats, "article", r.a.id),
        }),
      ),
      ...hls.map((r) =>
        highlightToPost(r.h, {
          team: r.team,
          org: r.org,
          author: r.uploader,
          ...statsFor(stats, "highlight", r.h.id),
        }),
      ),
      ...orgPostRows.map((r) =>
        orgPostToPost(r.p, {
          org: r.org,
          author: r.author,
          ...statsFor(stats, "org_post", r.p.id),
        }),
      ),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json(paginate(items));
  }),
);

router.get(
  "/follow-suggestions",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");

    const SUGGESTION_LIMIT = 5;

    const [
      followedOrgRows,
      adminOrgRows,
      followedTeamRows,
      memberTeamRows,
      followedUserRows,
    ] = await Promise.all([
      db
        .select({ id: organizationFollowers.organizationId })
        .from(organizationFollowers)
        .where(eq(organizationFollowers.userId, me.id)),
      db
        .select({ id: organizationAdmins.organizationId })
        .from(organizationAdmins)
        .where(eq(organizationAdmins.userId, me.id)),
      db
        .select({ id: teamFollowers.teamId })
        .from(teamFollowers)
        .where(eq(teamFollowers.userId, me.id)),
      db
        .select({ id: rosterEntries.teamId })
        .from(rosterEntries)
        .where(eq(rosterEntries.userId, me.id)),
      db
        .select({ id: userFollowers.followingUserId })
        .from(userFollowers)
        .where(eq(userFollowers.followerUserId, me.id)),
    ]);

    const excludedOrgIds = new Set<string>([
      ...followedOrgRows.map((r) => r.id),
      ...adminOrgRows.map((r) => r.id),
    ]);
    const excludedTeamIds = new Set<string>([
      ...followedTeamRows.map((r) => r.id),
      ...memberTeamRows.map((r) => r.id),
    ]);
    const excludedUserIds = new Set<string>([
      ...followedUserRows.map((r) => r.id),
      me.id,
    ]);

    const orgRows = await db
      .select({
        org: organizations,
        followerCount: sql<number>`count(${organizationFollowers.userId})::int`,
      })
      .from(organizations)
      .leftJoin(
        organizationFollowers,
        eq(organizationFollowers.organizationId, organizations.id),
      )
      .groupBy(organizations.id)
      .orderBy(
        desc(sql<number>`count(${organizationFollowers.userId})`),
        desc(organizations.createdAt),
      )
      .limit(SUGGESTION_LIMIT + excludedOrgIds.size);
    const orgSuggestions = orgRows
      .filter((r) => !excludedOrgIds.has(r.org.id))
      .slice(0, SUGGESTION_LIMIT)
      .map((r) => toOrganization(r.org, { isMember: false, isFollowing: false }));

    const teamRows = await db
      .select({
        team: teams,
        org: organizations,
        followerCount: sql<number>`count(${teamFollowers.userId})::int`,
      })
      .from(teams)
      .innerJoin(organizations, eq(organizations.id, teams.organizationId))
      .leftJoin(teamFollowers, eq(teamFollowers.teamId, teams.id))
      .groupBy(teams.id, organizations.id)
      .orderBy(
        desc(sql<number>`count(${teamFollowers.userId})`),
        desc(teams.createdAt),
      )
      .limit(SUGGESTION_LIMIT + excludedTeamIds.size);
    const teamSuggestions = teamRows
      .filter((r) => !excludedTeamIds.has(r.team.id))
      .slice(0, SUGGESTION_LIMIT)
      .map((r) =>
        toTeam(r.team, r.org, {
          followerCount: r.followerCount,
          isFollowing: false,
        }),
      );

    const userRows = await db
      .select({
        user: users,
        followerCount: sql<number>`count(${userFollowers.followerUserId})::int`,
      })
      .from(users)
      .leftJoin(
        userFollowers,
        eq(userFollowers.followingUserId, users.id),
      )
      .where(ne(users.id, me.id))
      .groupBy(users.id)
      .orderBy(
        desc(sql<number>`count(${userFollowers.followerUserId})`),
        desc(users.createdAt),
      )
      .limit(SUGGESTION_LIMIT + excludedUserIds.size);
    const userSuggestions = userRows
      .filter((r) => !excludedUserIds.has(r.user.id))
      .slice(0, SUGGESTION_LIMIT)
      .map((r) => toPublicUser(r.user, { isOwnProfile: false, isFollowing: false }));

    res.json({
      organizations: orgSuggestions,
      teams: teamSuggestions,
      users: userSuggestions,
    });
  }),
);

router.get(
  "/posts/:postId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    const isAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    if (parsed.kind === "article") {
      const [row] = await db
        .select({ a: articles, team: teams, org: organizations, author: users })
        .from(articles)
        .innerJoin(teams, eq(articles.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .leftJoin(users, eq(articles.authorId, users.id))
        .where(eq(articles.id, parsed.id))
        .limit(1);
      if (!row) return notFound(res);
      if (row.a.hiddenAt && !isAdmin) return notFound(res);
      if (row.a.status !== "published") {
        const isAuthor = !!me && row.a.authorId === me.id;
        const isOrgAdmin = !!me && (await canManageOrganization(me.id, row.org.id));
        if (!isAuthor && !isOrgAdmin) return notFound(res);
      }
      const stats = await loadPostStats(me?.id ?? null, [
        { kind: "article", refId: row.a.id },
      ]);
      res.json(
        articleToPost(row.a, {
          team: row.team,
          org: row.org,
          author: row.author,
          ...statsFor(stats, "article", row.a.id),
        }),
      );
      return;
    }
    if (parsed.kind === "org_post") {
      const [row] = await db
        .select({ p: orgPosts, org: organizations, author: users })
        .from(orgPosts)
        .innerJoin(organizations, eq(orgPosts.organizationId, organizations.id))
        .leftJoin(users, eq(orgPosts.authorId, users.id))
        .where(eq(orgPosts.id, parsed.id))
        .limit(1);
      if (!row) return notFound(res);
      if (row.p.hiddenAt && !isAdmin) return notFound(res);
      if (row.p.status !== "published") {
        const isAuthor = !!me && row.p.authorId === me.id;
        const isOrgAdmin = !!me && (await canManageOrganization(me.id, row.org.id));
        if (!isAuthor && !isOrgAdmin) return notFound(res);
      }
      const stats = await loadPostStats(me?.id ?? null, [
        { kind: "org_post", refId: row.p.id },
      ]);
      res.json(
        orgPostToPost(row.p, {
          org: row.org,
          author: row.author,
          ...statsFor(stats, "org_post", row.p.id),
        }),
      );
      return;
    }
    const [row] = await db
      .select({ h: highlights, team: teams, org: organizations, uploader: users })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(highlights.uploaderId, users.id))
      .where(eq(highlights.id, parsed.id))
      .limit(1);
    if (!row) return notFound(res);
    if (row.h.hiddenAt && !isAdmin) return notFound(res);
    const stats = await loadPostStats(me?.id ?? null, [
      { kind: "highlight", refId: row.h.id },
    ]);
    res.json(
      highlightToPost(row.h, {
        team: row.team,
        org: row.org,
        author: row.uploader,
        ...statsFor(stats, "highlight", row.h.id),
      }),
    );
  }),
);

router.get(
  "/posts/:postId/comments",
  asyncHandler(async (req, res) => {
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    const isAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
    const conds = [
      eq(postComments.postKind, parsed.kind),
      eq(postComments.postRefId, parsed.id),
      isNull(postComments.deletedAt),
    ];
    if (!isAdmin) conds.push(isNull(postComments.hiddenAt));
    const rows = await db
      .select({ c: postComments, author: users })
      .from(postComments)
      .leftJoin(users, eq(postComments.authorId, users.id))
      .where(and(...conds))
      .orderBy(asc(postComments.createdAt));
    res.json(paginate(rows.map((r) => toComment(r.c, r.author))));
  }),
);

router.post(
  "/posts/:postId/comments",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    const body = String(req.body?.body ?? "").trim();
    if (!body) return apiError(res, 400, "Comment body is required");
    const [c] = await db
      .insert(postComments)
      .values({
        postKind: parsed.kind,
        postRefId: parsed.id,
        authorId: me.id,
        body,
      })
      .returning();
    res.status(201).json(toComment(c, me));
  }),
);

router.delete(
  "/posts/:postId/comments/:commentId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [c] = await db
      .select()
      .from(postComments)
      .where(eq(postComments.id, req.params.commentId))
      .limit(1);
    if (!c) return notFound(res);
    if (c.authorId !== me.id)
      return apiError(res, 403, "Only the author can delete this comment");
    await db
      .update(postComments)
      .set({ deletedAt: new Date() })
      .where(eq(postComments.id, c.id));
    res.status(204).end();
  }),
);

router.post(
  "/posts/:postId/reactions",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    await db
      .insert(postReactions)
      .values({
        postKind: parsed.kind,
        postRefId: parsed.id,
        userId: me.id,
        reactionType: "like",
      })
      .onConflictDoNothing();
    res.status(204).end();
  }),
);

router.delete(
  "/posts/:postId/reactions",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    await db
      .delete(postReactions)
      .where(
        and(
          eq(postReactions.postKind, parsed.kind),
          eq(postReactions.postRefId, parsed.id),
          eq(postReactions.userId, me.id),
        ),
      );
    res.status(204).end();
  }),
);

router.get(
  "/posts/:postId/tags",
  asyncHandler(async (req, res) => {
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    if (parsed.kind === "article") {
      const rows = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.articleId, parsed.id))
        .orderBy(desc(articleTags.createdAt));
      res.json({
        tags: rows.map((t) => ({
          id: t.id,
          postId: articlePostId(parsed.id),
          taggedEntityType: "user" as const,
          taggedEntityId: t.userId,
          direction: "lateral" as const,
          status: t.status,
          approverId: t.userId,
          createdBy: t.taggerUserId ?? null,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        })),
      });
      return;
    }
    const rows = await db
      .select()
      .from(highlightTags)
      .where(eq(highlightTags.highlightId, parsed.id))
      .orderBy(desc(highlightTags.createdAt));
    res.json({
      tags: rows.map((t) => ({
        id: t.id,
        postId: highlightPostId(parsed.id),
        taggedEntityType: "user" as const,
        taggedEntityId: t.userId,
        direction: "lateral" as const,
        status: t.status,
        approverId: t.userId,
        createdBy: t.taggerUserId ?? null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  }),
);

router.post(
  "/posts",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const body = req.body ?? {};
    // Spec uses organizationId; we pick first team in that org as a default context.
    let teamId: string | undefined = body.context?.id ?? body.teamId;
    if (!teamId && body.organizationId) {
      const [firstTeam] = await db
        .select()
        .from(teams)
        .where(eq(teams.organizationId, body.organizationId))
        .limit(1);
      teamId = firstTeam?.id;
    }
    if (!teamId) {
      const [anyTeam] = await db.select().from(teams).limit(1);
      teamId = anyTeam?.id;
    }
    if (!teamId) return apiError(res, 400, "no team context available");
    if (body.postType === "long") {
      const isDraft = body.status === "draft";
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
      const [org] = team
        ? await db.select().from(organizations).where(eq(organizations.id, team.organizationId)).limit(1)
        : [null];
      if (!team || !org) return notFound(res);
      const allowed = await canCreateRecap(me.id, team);
      if (!allowed)
        return apiError(res, 403, "Only admins, coaches, and authors can create game recaps");
      const isAdmin = await canManageOrganization(me.id, team.organizationId);
      const status: "draft" | "pending_approval" | "published" = isDraft
        ? "draft"
        : isAdmin
          ? "published"
          : "pending_approval";
      const photoUrls: string[] = Array.isArray(body.photoUrls)
        ? body.photoUrls.filter((u: unknown) => typeof u === "string")
        : [];
      const [a] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: me.id,
          title: body.title ?? "Untitled",
          summary: body.description ?? undefined,
          body: body.body ?? "",
          coverImageUrl: body.coverImageUrl ?? photoUrls[0] ?? null,
          videoUrl: body.videoUrl ?? null,
          photoUrls: photoUrls.length > 0 ? photoUrls : null,
          status,
          publishedAt: status === "published" ? new Date() : null,
        })
        .returning();
      res.status(201).json({
        ...articleToPost(a, { team, org, author: me }),
        approvalStatus: status,
        requiresApproval: status === "pending_approval",
      });
      return;
    }
    const [h] = await db
      .insert(highlights)
      .values({
        teamId,
        uploaderId: me.id,
        title: body.title ?? "Untitled",
        description: body.description ?? undefined,
        videoUrl: body.assets?.[0]?.url ?? "",
      })
      .returning();
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    const [org] = team
      ? await db.select().from(organizations).where(eq(organizations.id, team.organizationId)).limit(1)
      : [null];
    if (!team || !org) return notFound(res);
    res.status(201).json(highlightToPost(h, { team, org, author: me }));
  }),
);

// ---------------------------------------------------------------------------
// Drafts & co-authors
// ---------------------------------------------------------------------------

router.get(
  "/drafts",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json(paginate([]));
    const owned = await db
      .select({ a: articles, team: teams, org: organizations, author: users })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(and(eq(articles.status, "draft"), eq(articles.authorId, me.id)))
      .orderBy(desc(articles.createdAt));
    const coRows = await db
      .select({ a: articles, team: teams, org: organizations, author: users })
      .from(articleAuthors)
      .innerJoin(articles, eq(articleAuthors.articleId, articles.id))
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(and(eq(articles.status, "draft"), eq(articleAuthors.userId, me.id)));
    const seen = new Set<string>();
    const all = [...owned, ...coRows].filter((r) => {
      if (seen.has(r.a.id)) return false;
      seen.add(r.a.id);
      return true;
    });
    const data = all.map((r) =>
      articleToPost(r.a, { team: r.team, org: r.org, author: r.author }),
    );
    res.json(paginate(data));
  }),
);

router.patch(
  "/posts/:postId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed || parsed.kind !== "article") return notFound(res);
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, parsed.id))
      .limit(1);
    if (!a) return notFound(res);
    const isAuthor = a.authorId === me.id;
    const [coAuthor] = isAuthor
      ? [null]
      : await db
          .select()
          .from(articleAuthors)
          .where(
            and(
              eq(articleAuthors.articleId, a.id),
              eq(articleAuthors.userId, me.id),
            ),
          )
          .limit(1);
    if (!isAuthor && !coAuthor)
      return apiError(res, 403, "Not an author");
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (typeof body.title === "string") updates["title"] = body.title;
    if (typeof body.description === "string") updates["summary"] = body.description;
    if (typeof body.body === "string") updates["body"] = body.body;
    if (typeof body.coverImageUrl === "string" || body.coverImageUrl === null)
      updates["coverImageUrl"] = body.coverImageUrl;
    if (typeof body.videoUrl === "string" || body.videoUrl === null)
      updates["videoUrl"] = body.videoUrl;
    if (Array.isArray(body.photoUrls)) {
      const arr = body.photoUrls.filter((u: unknown) => typeof u === "string");
      updates["photoUrls"] = arr.length > 0 ? arr : null;
      if (!("coverImageUrl" in updates)) updates["coverImageUrl"] = arr[0] ?? null;
    }
    if (Object.keys(updates).length === 0)
      return apiError(res, 400, "no changes");
    const [updated] = await db
      .update(articles)
      .set(updates)
      .where(eq(articles.id, a.id))
      .returning();
    const [team] = await db.select().from(teams).where(eq(teams.id, updated.teamId)).limit(1);
    const [org] = team
      ? await db.select().from(organizations).where(eq(organizations.id, team.organizationId)).limit(1)
      : [null];
    const [author] = updated.authorId
      ? await db.select().from(users).where(eq(users.id, updated.authorId)).limit(1)
      : [null];
    if (!team || !org) return notFound(res);
    res.json(articleToPost(updated, { team, org, author }));
  }),
);

router.post(
  "/posts/:postId/publish",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed || parsed.kind !== "article") return notFound(res);
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, parsed.id))
      .limit(1);
    if (!a) return notFound(res);
    const [coAuthor] = a.authorId === me.id
      ? [null]
      : await db
          .select()
          .from(articleAuthors)
          .where(
            and(
              eq(articleAuthors.articleId, a.id),
              eq(articleAuthors.userId, me.id),
            ),
          )
          .limit(1);
    if (a.authorId !== me.id && !coAuthor)
      return apiError(res, 403, "Only the author can publish");
    const [teamRow] = await db.select().from(teams).where(eq(teams.id, a.teamId)).limit(1);
    if (!teamRow) return notFound(res);
    const isAdmin = await canManageOrganization(me.id, teamRow.organizationId);
    const newStatus = isAdmin ? "published" : "pending_approval";
    const [updated] = await db
      .update(articles)
      .set({
        status: newStatus,
        publishedAt: newStatus === "published" ? new Date() : null,
      })
      .where(eq(articles.id, a.id))
      .returning();
    const [team] = await db.select().from(teams).where(eq(teams.id, updated.teamId)).limit(1);
    const [org] = team
      ? await db.select().from(organizations).where(eq(organizations.id, team.organizationId)).limit(1)
      : [null];
    if (!team || !org) return notFound(res);
    res.json(articleToPost(updated, { team, org, author: me }));
  }),
);

router.get(
  "/posts/:postId/co-authors",
  asyncHandler(async (req, res) => {
    const parsed = parsePostId(req.params.postId);
    if (!parsed || parsed.kind !== "article") return notFound(res);
    const rows = await db
      .select({ u: users })
      .from(articleAuthors)
      .innerJoin(users, eq(articleAuthors.userId, users.id))
      .where(eq(articleAuthors.articleId, parsed.id));
    res.json({
      data: rows.map((r) => ({
        id: r.u.id,
        firstName: r.u.firstName,
        lastName: r.u.lastName,
        avatarUrl: r.u.avatarUrl,
      })),
    });
  }),
);

router.post(
  "/posts/:postId/co-authors",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed || parsed.kind !== "article") return notFound(res);
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, parsed.id))
      .limit(1);
    if (!a) return notFound(res);
    if (a.authorId !== me.id)
      return apiError(res, 403, "Only the author can add co-authors");
    const userId = String(req.body?.userId ?? "");
    if (!userId) return apiError(res, 400, "userId required");
    await db
      .insert(articleAuthors)
      .values({ articleId: a.id, userId })
      .onConflictDoNothing();
    await db.insert(notifications).values({
      userId,
      kind: "mention",
      message: `${me.firstName} ${me.lastName} added you as a co-author on "${a.title ?? "Untitled"}"`,
      link: `/posts/${a.id}`,
    });
    res.status(201).json({ ok: true });
  }),
);

router.delete(
  "/posts/:postId/co-authors/:userId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed || parsed.kind !== "article") return notFound(res);
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, parsed.id))
      .limit(1);
    if (!a) return notFound(res);
    if (a.authorId !== me.id && me.id !== req.params.userId)
      return apiError(res, 403, "Forbidden");
    await db
      .delete(articleAuthors)
      .where(
        and(
          eq(articleAuthors.articleId, a.id),
          eq(articleAuthors.userId, req.params.userId),
        ),
      );
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

router.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json(paginate([]));
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, me.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    res.json(paginate(rows.map(toNotification)));
  }),
);

router.get(
  "/notifications/unread-count",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json({ unreadCount: 0 });
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, me.id), eq(notifications.read, false)));
    res.json({ unreadCount: count });
  }),
);

router.post(
  "/notifications/:notificationId/read",
  asyncHandler(async (req, res) => {
    await db
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, req.params.notificationId));
    res.status(204).end();
  }),
);

router.post(
  "/notifications/read-all",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json({ markedCount: 0 });
    const result = await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.userId, me.id), eq(notifications.read, false)))
      .returning({ id: notifications.id });
    res.json({ markedCount: result.length });
  }),
);

router.get(
  "/notifications/email-preference",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [row] = await db
      .select({ optOut: users.guardianExpiredEmailOptOut })
      .from(users)
      .where(eq(users.id, me.id))
      .limit(1);
    res.json({ emailOptOut: !!row?.optOut });
  }),
);

const updateEmailPreference = asyncHandler(async (req, res) => {
  const me = req.sessionUser;
  if (!me) return apiError(res, 401, "Not authenticated");
  if (typeof req.body?.emailOptOut !== "boolean") {
    return apiError(res, 400, "emailOptOut must be a boolean");
  }
  const optOut = req.body.emailOptOut;
  await db
    .update(users)
    .set({ guardianExpiredEmailOptOut: optOut })
    .where(eq(users.id, me.id));
  res.json({ emailOptOut: optOut });
});

router.patch("/notifications/email-preference", updateEmailPreference);
router.put("/notifications/email-preference", updateEmailPreference);

// ---------------------------------------------------------------------------
// Conversations / Messages (stubs)
// ---------------------------------------------------------------------------

async function getOtherParticipant(conversationId: string, meId: string) {
  const parts = await db
    .select()
    .from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversationId));
  const others = parts.filter(
    (p) => !(p.participantType === "user" && p.participantId === meId),
  );
  const other = others[0] ?? parts[0];
  if (!other) return null;
  if (other.participantType === "user") {
    const [u] = await db.select().from(users).where(eq(users.id, other.participantId)).limit(1);
    if (!u) return null;
    return {
      id: u.id,
      type: "user" as const,
      displayName: displayName(u),
      avatarUrl: u.avatarUrl ?? null,
    };
  }
  const [o] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, other.participantId))
    .limit(1);
  if (!o) return null;
  return {
    id: o.id,
    type: "organization" as const,
    displayName: o.name,
    avatarUrl: o.logoUrl ?? null,
  };
}

async function loadAssetsForMessages(
  messageIds: string[],
): Promise<Map<string, (typeof assets.$inferSelect)[]>> {
  const map = new Map<string, (typeof assets.$inferSelect)[]>();
  if (messageIds.length === 0) return map;
  const rows = await db
    .select({ ma: messageAssets, a: assets })
    .from(messageAssets)
    .innerJoin(assets, eq(messageAssets.assetId, assets.id))
    .where(inArray(messageAssets.messageId, messageIds))
    .orderBy(asc(messageAssets.displayOrder));
  for (const r of rows) {
    const list = map.get(r.ma.messageId) ?? [];
    list.push(r.a);
    map.set(r.ma.messageId, list);
  }
  return map;
}

async function loadConversationView(conv: { id: string; type: string; createdAt: Date; updatedAt: Date }, meId: string) {
  const participant = await getOtherParticipant(conv.id, meId);
  if (!participant) return null;
  const [last] = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  let lastSenderName: string | null = null;
  if (last?.senderUserId) {
    const [u] = await db.select().from(users).where(eq(users.id, last.senderUserId)).limit(1);
    lastSenderName = u ? displayName(u) : null;
  }
  let lastHasAttachments = false;
  if (last) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messageAssets)
      .where(eq(messageAssets.messageId, last.id));
    lastHasAttachments = Number(count) > 0;
  }
  const [myPart] = await db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conv.id),
        eq(conversationParticipants.participantType, "user"),
        eq(conversationParticipants.participantId, meId),
      ),
    )
    .limit(1);
  let unread = 0;
  if (myPart) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conv.id),
          isNull(messages.deletedAt),
          ne(messages.senderUserId, meId),
          myPart.lastReadAt
            ? gt(messages.createdAt, myPart.lastReadAt)
            : sql`true`,
        ),
      );
    unread = Number(count);
  }
  return toConversation(
    { id: conv.id, type: conv.type as "direct" | "user_to_org" | "org_to_org", createdAt: conv.createdAt, updatedAt: conv.updatedAt },
    participant,
    last ?? null,
    lastSenderName,
    unread,
    lastHasAttachments,
  );
}

router.get(
  "/conversations",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json(paginate([]));
    const myParts = await db
      .select({ conv: conversations })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
      .where(
        and(
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
          isNull(conversationParticipants.leftAt),
        ),
      )
      .orderBy(desc(conversations.updatedAt));
    const items = (
      await Promise.all(myParts.map((r) => loadConversationView(r.conv, me.id)))
    ).filter((c): c is NonNullable<typeof c> => c !== null);
    res.json(paginate(items));
  }),
);

router.get(
  "/conversations/unread-count",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json({ unreadCount: 0 });
    const myParts = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
          isNull(conversationParticipants.leftAt),
        ),
      );
    let total = 0;
    for (const p of myParts) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, p.conversationId),
            isNull(messages.deletedAt),
            ne(messages.senderUserId, me.id),
            p.lastReadAt ? gt(messages.createdAt, p.lastReadAt) : sql`true`,
          ),
        );
      total += Number(count);
    }
    res.json({ unreadCount: total });
  }),
);

router.post(
  "/conversations",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const recipientId: string | undefined = req.body?.recipientId;
    const recipientType: "user" | "organization" =
      req.body?.recipientType === "organization" ? "organization" : "user";
    if (!recipientId) return apiError(res, 400, "recipientId is required");
    if (recipientType === "user" && recipientId === me.id)
      return apiError(res, 400, "Cannot start a conversation with yourself");

    // Look for an existing direct conversation
    const meParts = await db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
        ),
      );
    let conv: typeof conversations.$inferSelect | undefined;
    let isNew = false;
    if (meParts.length > 0) {
      const existing = await db
        .select({ conv: conversations, part: conversationParticipants })
        .from(conversationParticipants)
        .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
        .where(
          and(
            inArray(
              conversationParticipants.conversationId,
              meParts.map((p) => p.conversationId),
            ),
            eq(conversationParticipants.participantType, recipientType),
            eq(conversationParticipants.participantId, recipientId),
          ),
        )
        .limit(1);
      if (existing.length > 0) conv = existing[0].conv;
    }

    if (!conv) {
      const convType: "direct" | "user_to_org" | "org_to_org" =
        recipientType === "organization" ? "user_to_org" : "direct";
      const [created] = await db.insert(conversations).values({ type: convType }).returning();
      conv = created;
      isNew = true;
      await db.insert(conversationParticipants).values([
        { conversationId: conv.id, participantType: "user", participantId: me.id },
        { conversationId: conv.id, participantType: recipientType, participantId: recipientId },
      ]);
    }

    const firstBody = String(req.body?.message?.body ?? "").trim();
    const rawAssetIds = Array.isArray(req.body?.message?.assetIds)
      ? (req.body.message.assetIds as unknown[])
      : [];
    if (rawAssetIds.length > 10) {
      return apiError(res, 400, "A message can attach at most 10 assets");
    }
    const assetIds: string[] = [];
    for (const v of rawAssetIds) {
      if (typeof v === "string" && v.length > 0 && !assetIds.includes(v)) {
        assetIds.push(v);
      }
    }
    let validAssets: (typeof assets.$inferSelect)[] = [];
    if (assetIds.length > 0) {
      validAssets = await db
        .select()
        .from(assets)
        .where(and(inArray(assets.id, assetIds), eq(assets.ownerId, me.id)));
      if (validAssets.length !== assetIds.length) {
        return apiError(res, 400, "One or more assetIds are invalid or not owned by you");
      }
      const unconfirmed = validAssets.find((a) => a.status !== "confirmed");
      if (unconfirmed) {
        return apiError(res, 400, "All assets must be confirmed before attaching");
      }
    }

    if (firstBody || validAssets.length > 0) {
      const [created] = await db
        .insert(messages)
        .values({
          conversationId: conv.id,
          senderUserId: me.id,
          body: firstBody || null,
        })
        .returning();
      if (validAssets.length > 0) {
        const orderById = new Map(assetIds.map((id, i) => [id, i] as const));
        await db.insert(messageAssets).values(
          validAssets.map((a) => ({
            messageId: created.id,
            assetId: a.id,
            displayOrder: orderById.get(a.id) ?? 0,
          })),
        );
      }
      conv = (
        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, conv.id))
          .returning()
      )[0];
    }

    const view = await loadConversationView(conv, me.id);
    if (!view) return apiError(res, 500, "Failed to load conversation");
    res.status(isNew ? 201 : 200).json(view);
  }),
);

router.get(
  "/conversations/search/contacts",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const q = String(req.query.q ?? "").trim();
    if (q.length < 1) {
      return apiError(res, 400, "q is required");
    }
    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.floor(limitRaw)) : 20;
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(
        and(
          or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)),
          ne(users.id, me.id),
        ),
      )
      .orderBy(asc(users.name))
      .limit(limit);
    res.json({
      data: rows.map((u) => ({
        id: u.id,
        displayName: u.name,
        avatarUrl: u.avatarUrl ?? null,
      })),
    });
  }),
);

router.get(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, req.params.id))
      .limit(1);
    if (!conv) return notFound(res);
    const [iAmIn] = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conv.id),
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
        ),
      )
      .limit(1);
    if (!iAmIn) return apiError(res, 403, "Not a participant");
    const view = await loadConversationView(conv, me.id);
    if (!view) return notFound(res);
    res.json(view);
  }),
);

router.delete(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    await db
      .update(conversationParticipants)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(conversationParticipants.conversationId, req.params.id),
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
        ),
      );
    res.status(204).end();
  }),
);

router.get(
  "/conversations/:id/messages",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [iAmIn] = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, req.params.id),
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
        ),
      )
      .limit(1);
    if (!iAmIn) return apiError(res, 403, "Not a participant");
    const rows = await db
      .select({ m: messages, sender: users })
      .from(messages)
      .leftJoin(users, eq(messages.senderUserId, users.id))
      .where(eq(messages.conversationId, req.params.id))
      .orderBy(asc(messages.createdAt));
    const assetsByMessage = await loadAssetsForMessages(rows.map((r) => r.m.id));
    res.json(
      paginate(
        rows.map((r) =>
          toMessage(
            r.m,
            r.sender
              ? {
                  id: r.sender.id,
                  displayName: displayName(r.sender),
                  avatarUrl: r.sender.avatarUrl ?? null,
                }
              : null,
            assetsByMessage.get(r.m.id) ?? [],
          ),
        ),
      ),
    );
  }),
);

router.post(
  "/conversations/:id/messages",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [iAmIn] = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, req.params.id),
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
        ),
      )
      .limit(1);
    if (!iAmIn) return apiError(res, 403, "Not a participant");
    const body = String(req.body?.body ?? "").trim();
    const rawAssetIds = Array.isArray(req.body?.assetIds)
      ? (req.body.assetIds as unknown[])
      : [];
    if (rawAssetIds.length > 10) {
      return apiError(res, 400, "A message can attach at most 10 assets");
    }
    const assetIds: string[] = [];
    for (const v of rawAssetIds) {
      if (typeof v === "string" && v.length > 0 && !assetIds.includes(v)) {
        assetIds.push(v);
      }
    }
    if (!body && assetIds.length === 0) {
      return apiError(res, 400, "Message body or assetIds required");
    }
    let validAssets: (typeof assets.$inferSelect)[] = [];
    if (assetIds.length > 0) {
      validAssets = await db
        .select()
        .from(assets)
        .where(and(inArray(assets.id, assetIds), eq(assets.ownerId, me.id)));
      if (validAssets.length !== assetIds.length) {
        return apiError(res, 400, "One or more assetIds are invalid or not owned by you");
      }
      const unconfirmed = validAssets.find((a) => a.status !== "confirmed");
      if (unconfirmed) {
        return apiError(res, 400, "All assets must be confirmed before attaching");
      }
    }
    const [m] = await db
      .insert(messages)
      .values({
        conversationId: req.params.id,
        senderUserId: me.id,
        body: body || null,
      })
      .returning();
    if (validAssets.length > 0) {
      const orderById = new Map(assetIds.map((id, i) => [id, i] as const));
      await db.insert(messageAssets).values(
        validAssets.map((a) => ({
          messageId: m.id,
          assetId: a.id,
          displayOrder: orderById.get(a.id) ?? 0,
        })),
      );
    }
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, req.params.id));
    res.status(201).json(
      toMessage(
        m,
        {
          id: me.id,
          displayName: displayName(me),
          avatarUrl: me.avatarUrl ?? null,
        },
        validAssets,
      ),
    );
  }),
);

router.post(
  "/conversations/:id/read",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    await db
      .update(conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationParticipants.conversationId, req.params.id),
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
        ),
      );
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Assets (3-step upload: requestUpload → PUT data → confirmUpload)
// ---------------------------------------------------------------------------

const ASSET_UPLOAD_TTL_SECONDS = 3600;
const ASSET_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function publicBaseUrl(req: Request): string {
  const proto = req.protocol;
  const host = req.get("host");
  return `${proto}://${host}`;
}

router.post(
  "/assets/upload",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const fileName = String(req.body?.fileName ?? "").trim();
    const fileType = String(req.body?.fileType ?? "").trim();
    const fileSize = Number(req.body?.fileSize);
    if (!fileName || fileName.length > 255) {
      return apiError(res, 400, "fileName is required (max 255)");
    }
    if (!fileType) {
      return apiError(res, 400, "fileType is required");
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return apiError(res, 400, "fileSize must be a positive integer");
    }
    if (fileSize > ASSET_MAX_BYTES) {
      return apiError(res, 400, "fileSize exceeds the 10 MB limit");
    }
    const [created] = await db
      .insert(assets)
      .values({
        ownerId: me.id,
        fileName,
        fileType,
        fileSize,
        status: "pending",
      })
      .returning();
    const uploadUrl = `${publicBaseUrl(req)}/api/v1/assets/${created.id}/data`;
    res.status(201).json({
      assetId: created.id,
      uploadUrl,
      uploadHeaders: { "Content-Type": fileType },
      expiresIn: ASSET_UPLOAD_TTL_SECONDS,
    });
  }),
);

// Internal route used as the `uploadUrl` returned by /assets/upload. Accepts
// the raw binary body and stores it as a data URL on the asset row. This is
// not part of the public OpenAPI surface — clients only ever PUT to the URL
// they received from the upload-request response.
router.put(
  "/assets/:assetId/data",
  express.raw({ type: () => true, limit: `${ASSET_MAX_BYTES}b` }),
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [a] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, req.params.assetId))
      .limit(1);
    if (!a) return notFound(res);
    if (a.ownerId !== me.id) return apiError(res, 403, "Forbidden");
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || buf.length === 0) {
      return apiError(res, 400, "Request body is empty");
    }
    if (buf.length > ASSET_MAX_BYTES) {
      return apiError(res, 413, "Upload exceeds 10 MB");
    }
    const mime = a.fileType || "application/octet-stream";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    await db
      .update(assets)
      .set({ url: dataUrl, fileSize: buf.length })
      .where(eq(assets.id, a.id));
    res.status(204).end();
  }),
);

router.post(
  "/assets/:assetId/confirm",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [a] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, req.params.assetId))
      .limit(1);
    if (!a) return notFound(res);
    if (a.ownerId !== me.id) return apiError(res, 403, "Forbidden");
    if (!a.url) {
      return apiError(res, 422, "Upload has not been received yet");
    }
    const [updated] =
      a.status === "confirmed"
        ? [a]
        : await db
            .update(assets)
            .set({ status: "confirmed" })
            .where(eq(assets.id, a.id))
            .returning();
    res.status(200).json(toAssetResponse(updated));
  }),
);

router.get(
  "/assets/:assetId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [a] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, req.params.assetId))
      .limit(1);
    if (!a) return notFound(res);
    res.json(toAssetResponse(a));
  }),
);

router.delete(
  "/assets/:assetId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [a] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, req.params.assetId))
      .limit(1);
    if (!a) return notFound(res);
    if (a.ownerId !== me.id) return apiError(res, 403, "Forbidden");
    await db.delete(assets).where(eq(assets.id, a.id));
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Tags (pending) — stubs
// ---------------------------------------------------------------------------

router.get(
  "/tags/pending",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json(paginate([]));
    const aRows = await db
      .select()
      .from(articleTags)
      .where(and(eq(articleTags.userId, me.id), eq(articleTags.status, "pending")))
      .orderBy(desc(articleTags.createdAt));
    const hRows = await db
      .select()
      .from(highlightTags)
      .where(and(eq(highlightTags.userId, me.id), eq(highlightTags.status, "pending")))
      .orderBy(desc(highlightTags.createdAt));
    const data = [
      ...aRows.map((t) => ({
        id: t.id,
        postId: articlePostId(t.articleId),
        taggedEntityType: "user" as const,
        taggedEntityId: t.userId,
        direction: "lateral" as const,
        status: t.status,
        approverId: t.userId,
        createdBy: t.taggerUserId ?? null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      ...hRows.map((t) => ({
        id: t.id,
        postId: highlightPostId(t.highlightId),
        taggedEntityType: "user" as const,
        taggedEntityId: t.userId,
        direction: "lateral" as const,
        status: t.status,
        approverId: t.userId,
        createdBy: t.taggerUserId ?? null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json(paginate(data));
  }),
);

async function decidePendingTag(
  req: Request,
  res: Response,
  decision: "approved" | "declined",
) {
  const me = req.sessionUser;
  if (!me) return apiError(res, 401, "Not authenticated");
  const tagId = req.params.tagId;
  const [a] = await db.select().from(articleTags).where(eq(articleTags.id, tagId)).limit(1);
  if (a) {
    if (a.userId !== me.id)
      return apiError(res, 403, "Only the tagged user can decide this tag");
    const [updated] = await db
      .update(articleTags)
      .set({ status: decision, updatedAt: new Date() })
      .where(eq(articleTags.id, tagId))
      .returning();
    return res.json({
      id: updated.id,
      postId: articlePostId(updated.articleId),
      taggedEntityType: "user" as const,
      taggedEntityId: updated.userId,
      direction: "lateral" as const,
      status: updated.status,
      approverId: updated.userId,
      createdBy: updated.taggerUserId ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  }
  const [h] = await db.select().from(highlightTags).where(eq(highlightTags.id, tagId)).limit(1);
  if (!h) return notFound(res);
  if (h.userId !== me.id)
    return apiError(res, 403, "Only the tagged user can decide this tag");
  const [updated] = await db
    .update(highlightTags)
    .set({ status: decision, updatedAt: new Date() })
    .where(eq(highlightTags.id, tagId))
    .returning();
  res.json({
    id: updated.id,
    postId: highlightPostId(updated.highlightId),
    taggedEntityType: "user" as const,
    taggedEntityId: updated.userId,
    direction: "lateral" as const,
    status: updated.status,
    approverId: updated.userId,
    createdBy: updated.taggerUserId ?? null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
}

router.post(
  "/tags/:tagId/approve",
  asyncHandler((req, res) => decidePendingTag(req, res, "approved")),
);
router.post(
  "/tags/:tagId/decline",
  asyncHandler((req, res) => decidePendingTag(req, res, "declined")),
);

// ---------------------------------------------------------------------------
// Tag management (player-removable tags)
// ---------------------------------------------------------------------------

router.get(
  "/users/me/tags",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json({ data: [] });
    const aRows = await db
      .select({
        t: articleTags,
        a: articles,
        team: teams,
        org: organizations,
      })
      .from(articleTags)
      .innerJoin(articles, eq(articleTags.articleId, articles.id))
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(and(eq(articleTags.userId, me.id), eq(articleTags.status, "approved")))
      .orderBy(desc(articleTags.createdAt));
    const hRows = await db
      .select({
        t: highlightTags,
        h: highlights,
        team: teams,
        org: organizations,
      })
      .from(highlightTags)
      .innerJoin(highlights, eq(highlightTags.highlightId, highlights.id))
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(and(eq(highlightTags.userId, me.id), eq(highlightTags.status, "approved")))
      .orderBy(desc(highlightTags.createdAt));
    const data = [
      ...aRows.map((r) => ({
        id: r.t.id,
        kind: "article" as const,
        postId: articlePostId(r.a.id),
        title: r.a.title ?? "Untitled",
        teamName: r.team.name,
        orgName: r.org.name,
        createdAt: r.t.createdAt.toISOString(),
      })),
      ...hRows.map((r) => ({
        id: r.t.id,
        kind: "highlight" as const,
        postId: highlightPostId(r.h.id),
        title: r.h.title ?? "Highlight",
        teamName: r.team.name,
        orgName: r.org.name,
        createdAt: r.t.createdAt.toISOString(),
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ data });
  }),
);

router.delete(
  "/article-tags/:tagId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [t] = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.id, req.params.tagId))
      .limit(1);
    if (!t) return res.status(204).end();
    if (t.userId !== me.id)
      return apiError(res, 403, "Not your tag");
    await db.delete(articleTags).where(eq(articleTags.id, t.id));
    res.status(204).end();
  }),
);

router.delete(
  "/highlight-tags/:tagId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [t] = await db
      .select()
      .from(highlightTags)
      .where(eq(highlightTags.id, req.params.tagId))
      .limit(1);
    if (!t) return res.status(204).end();
    if (t.userId !== me.id)
      return apiError(res, 403, "Not your tag");
    await db.delete(highlightTags).where(eq(highlightTags.id, t.id));
    res.status(204).end();
  }),
);

router.delete("/tags/:tagId", (_req, res) => res.status(204).end());

router.patch(
  "/users/me/tag-consent",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const requireTagConsent = !!req.body?.requireTagConsent;
    const [updated] = await db
      .update(users)
      .set({ requireTagConsent })
      .where(eq(users.id, me.id))
      .returning();
    res.json({ requireTagConsent: updated.requireTagConsent });
  }),
);

// ---------------------------------------------------------------------------
// Parent / Guardian — children management
// ---------------------------------------------------------------------------

// Creates a notification on the parent's account for each linked child whose
// guardian-confirmation token has expired without being confirmed. Existing
// notifications for the same child are not duplicated.
async function notifyExpiredGuardianConfirmations(
  parentUserId: string,
): Promise<void> {
  const expiredChildren = await db
    .select({
      id: users.id,
      name: users.name,
      guardianEmail: users.guardianEmail,
      guardianExpiredEmailSentAt: users.guardianExpiredEmailSentAt,
    })
    .from(users)
    .where(
      and(
        eq(users.parentId, parentUserId),
        isNull(users.guardianConfirmedAt),
        sql`${users.guardianConfirmTokenExpiresAt} IS NOT NULL`,
        lt(users.guardianConfirmTokenExpiresAt, new Date()),
      ),
    );
  if (expiredChildren.length === 0) return;

  // In-app notifications retain their existing eligibility: only children
  // whose row carries a guardianEmail get the bell-menu entry. This keeps
  // the existing notification behavior unchanged.
  const notifiableChildren = expiredChildren.filter((c) => c.guardianEmail);
  if (notifiableChildren.length > 0) {
    const links = notifiableChildren.map((c) => `/guardian?childId=${c.id}`);
    const existing = await db
      .select({ link: notifications.link })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, parentUserId),
          eq(notifications.kind, "guardian_expired"),
          inArray(notifications.link, links),
        ),
      );
    const alreadyNotified = new Set(
      existing.map((n) => n.link).filter((l): l is string => !!l),
    );

    const toInsert = notifiableChildren
      .filter((c) => !alreadyNotified.has(`/guardian?childId=${c.id}`))
      .map((c) => {
        const [first] = c.name.split(" ");
        return {
          userId: parentUserId,
          kind: "guardian_expired",
          message: `${first ?? c.name}'s guardian confirmation link has expired. Send a new one so they don't lose access.`,
          link: `/guardian?childId=${c.id}`,
        };
      });
    if (toInsert.length > 0) {
      await db.insert(notifications).values(toInsert);
    }
  }

  // Email the parent at the same moment the in-app notification is created
  // so that parents who don't open the app still see the expiry. We dedupe
  // per child per expiry cycle: a fresh /auth/guardian-resend clears
  // guardianExpiredEmailSentAt so the next expiry sends a new email. When
  // the child row has no guardianEmail on file, fall back to the parent
  // account's own email so they are still reached. Parents who have opted
  // out of the expired-confirmation email (managed from the family settings
  // screen) skip the email entirely — the in-app notification above is
  // unaffected.
  const parentRow = await db
    .select({
      email: users.email,
      optOut: users.guardianExpiredEmailOptOut,
    })
    .from(users)
    .where(eq(users.id, parentUserId))
    .limit(1);
  const parentEmail = parentRow[0]?.email ?? null;
  const parentOptedOut = !!parentRow[0]?.optOut;

  if (parentOptedOut) return;

  for (const child of expiredChildren) {
    if (child.guardianExpiredEmailSentAt) continue;
    const to = child.guardianEmail ?? parentEmail;
    if (!to) continue;
    try {
      await sendGuardianExpiredEmail(to, child.name);
    } catch (err) {
      logger.error(
        { err, childId: child.id },
        "Failed to send guardian-expired email",
      );
      continue;
    }
    await db
      .update(users)
      .set({ guardianExpiredEmailSentAt: new Date() })
      .where(eq(users.id, child.id));
  }
}

router.get(
  "/users/me/children",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (me.role === "parent") {
      try {
        await notifyExpiredGuardianConfirmations(me.id);
      } catch (err) {
        logger.error(
          { err },
          "Failed to create guardian-expired notifications",
        );
      }
    }
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.parentId, me.id));
    res.json({
      data: rows.map((u) => {
        const [first, ...rest] = u.name.split(" ");
        let confirmationStatus: "none" | "confirmed" | "pending" | "expired" =
          "none";
        if (u.guardianEmail) {
          if (u.guardianConfirmedAt) {
            confirmationStatus = "confirmed";
          } else if (
            !u.guardianConfirmTokenExpiresAt ||
            u.guardianConfirmTokenExpiresAt.getTime() < Date.now()
          ) {
            confirmationStatus = "expired";
          } else {
            confirmationStatus = "pending";
          }
        }
        return {
          id: u.id,
          firstName: first ?? u.name,
          lastName: rest.join(" "),
          role: u.role,
          email: u.email ?? null,
          avatarUrl: u.avatarUrl ?? null,
          requireTagConsent: u.requireTagConsent,
          guardianEmail: u.guardianEmail ?? null,
          guardianConfirmedAt: u.guardianConfirmedAt
            ? u.guardianConfirmedAt.toISOString()
            : null,
          confirmationStatus,
          confirmedByMe:
            !!u.guardianConfirmedAt && u.guardianConfirmedByUserId === me.id,
        };
      }),
    });
  }),
);

router.post(
  "/users/me/children",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (me.role !== "parent") {
      return apiError(res, 403, "Only parent accounts can link children");
    }
    const childId = String(req.body?.childId ?? "").trim();
    if (!childId) return apiError(res, 400, "childId required");
    const [child] = await db
      .select()
      .from(users)
      .where(eq(users.id, childId))
      .limit(1);
    if (!child) return apiError(res, 404, "User not found");
    if (child.parentId && child.parentId !== me.id) {
      return apiError(res, 409, "Already linked to another guardian");
    }
    const [updated] = await db
      .update(users)
      .set({ parentId: me.id })
      .where(eq(users.id, childId))
      .returning();
    const [first, ...rest] = updated.name.split(" ");
    res.status(201).json({
      id: updated.id,
      firstName: first ?? updated.name,
      lastName: rest.join(" "),
      role: updated.role,
      email: updated.email ?? null,
      avatarUrl: updated.avatarUrl ?? null,
      requireTagConsent: updated.requireTagConsent,
    });
  }),
);

router.post(
  "/users/me/children/:childId/resend-guardian-confirm",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [child] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.params.childId))
      .limit(1);
    if (!child || child.parentId !== me.id) {
      return apiError(res, 404, "Child not found");
    }
    if (!child.guardianEmail) {
      return apiError(res, 400, "This account does not require guardian confirmation.");
    }
    if (child.guardianConfirmedAt) {
      return apiError(res, 400, "This account has already been confirmed.");
    }
    const newToken = generateToken();
    await db
      .update(users)
      .set({
        guardianConfirmToken: newToken,
        guardianConfirmTokenExpiresAt: new Date(
          Date.now() + GUARDIAN_TOKEN_TTL_MS,
        ),
      })
      .where(eq(users.id, child.id));
    // In production this URL would be emailed to child.guardianEmail.
    res.json({
      ok: true,
      guardianEmail: child.guardianEmail,
      guardianConfirmUrl: `/guardian-confirm/${newToken}`,
    });
  }),
);

router.patch(
  "/users/me/children/:childId/visibility",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [child] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.params.childId))
      .limit(1);
    if (!child || child.parentId !== me.id) {
      return apiError(res, 404, "Child not found");
    }
    const requireTagConsent = !!req.body?.requireTagConsent;
    const [updated] = await db
      .update(users)
      .set({ requireTagConsent })
      .where(eq(users.id, child.id))
      .returning();
    res.json({
      id: updated.id,
      requireTagConsent: updated.requireTagConsent,
    });
  }),
);

// ---------------------------------------------------------------------------
// Search (cross-entity)
// ---------------------------------------------------------------------------

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = (typeof req.query["q"] === "string" ? req.query["q"] : "").trim();
    if (!q) {
      return res.json({
        users: { data: [], pagination: emptyPagination() },
        organizations: { data: [], pagination: emptyPagination() },
        teams: { data: [], pagination: emptyPagination() },
      });
    }
    const [userRows, orgRows, teamRows] = await Promise.all([
      db
        .select()
        .from(users)
        .where(or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)))
        .limit(10),
      db.select().from(organizations).where(ilike(organizations.name, `%${q}%`)).limit(10),
      db.select().from(teams).where(ilike(teams.name, `%${q}%`)).limit(10),
    ]);
    res.json({
      users: {
        data: userRows.map((u) => ({
          id: u.id,
          entityType: "user",
          displayName: u.name,
          avatarUrl: u.avatarUrl ?? null,
          nickname: null,
        })),
        pagination: emptyPagination(),
      },
      organizations: {
        data: orgRows.map((o) => ({
          entityType: "organization" as const,
          id: o.id,
          name: o.name,
          slug: o.name.toLowerCase().replace(/\s+/g, "-"),
          avatarUrl: o.logoUrl ?? null,
        })),
        pagination: emptyPagination(),
      },
      teams: {
        data: await Promise.all(
          teamRows.map(async (t) => {
            const [org] = await db
              .select()
              .from(organizations)
              .where(eq(organizations.id, t.organizationId))
              .limit(1);
            return {
              entityType: "team" as const,
              id: t.id,
              name: t.name,
              slug: t.name.toLowerCase().replace(/\s+/g, "-"),
              avatarUrl: t.logoUrl ?? null,
              organizationName: org?.name ?? null,
              organizationSlug: org ? org.name.toLowerCase().replace(/\s+/g, "-") : null,
            };
          }),
        ),
        pagination: emptyPagination(),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// User-facing reports
// ---------------------------------------------------------------------------

const ReportBody = z.object({
  contentType: z.enum(["article", "highlight", "org_post", "comment"]),
  contentId: z.string().uuid(),
  reason: z.string().min(1).max(120),
  note: z.string().max(2000).optional(),
});

router.post(
  "/reports",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser!;
    const body = ReportBody.parse(req.body);

    // Verify the content exists.
    let exists = false;
    if (body.contentType === "article") {
      const [r] = await db.select({ id: articles.id }).from(articles).where(eq(articles.id, body.contentId)).limit(1);
      exists = !!r;
    } else if (body.contentType === "highlight") {
      const [r] = await db.select({ id: highlights.id }).from(highlights).where(eq(highlights.id, body.contentId)).limit(1);
      exists = !!r;
    } else if (body.contentType === "org_post") {
      const [r] = await db.select({ id: orgPosts.id }).from(orgPosts).where(eq(orgPosts.id, body.contentId)).limit(1);
      exists = !!r;
    } else {
      const [r] = await db.select({ id: postComments.id }).from(postComments).where(eq(postComments.id, body.contentId)).limit(1);
      exists = !!r;
    }
    if (!exists) return notFound(res);

    // Dedupe: do not create another open report from the same reporter on the
    // same content.
    const [dupe] = await db
      .select()
      .from(contentReports)
      .where(
        and(
          eq(contentReports.reporterUserId, me.id),
          eq(contentReports.contentType, body.contentType),
          eq(contentReports.contentId, body.contentId),
          eq(contentReports.status, "open"),
        ),
      )
      .limit(1);
    if (dupe) {
      res.status(200).json({
        id: dupe.id,
        status: dupe.status,
        alreadyReported: true,
      });
      return;
    }

    const [created] = await db
      .insert(contentReports)
      .values({
        reporterUserId: me.id,
        contentType: body.contentType,
        contentId: body.contentId,
        reason: body.reason,
        note: body.note ?? null,
      })
      .returning();
    res.status(201).json({ id: created.id, status: created.status, alreadyReported: false });
  }),
);

// Returns whether the current viewer already has an open report against the
// given content. Used by the report dialog to disable submission when the
// user has already reported the item.
router.get(
  "/reports/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser!;
    const contentType = String(req.query["contentType"] ?? "");
    const contentId = String(req.query["contentId"] ?? "");
    if (!["article", "highlight", "org_post", "comment"].includes(contentType)) {
      res.status(400).json({ error: "Invalid contentType" });
      return;
    }
    if (!/^[0-9a-f-]{36}$/i.test(contentId)) {
      res.status(400).json({ error: "Invalid contentId" });
      return;
    }
    const [row] = await db
      .select({
        id: contentReports.id,
        reason: contentReports.reason,
        note: contentReports.note,
        status: contentReports.status,
        createdAt: contentReports.createdAt,
      })
      .from(contentReports)
      .where(
        and(
          eq(contentReports.reporterUserId, me.id),
          eq(
            contentReports.contentType,
            contentType as "article" | "highlight" | "org_post" | "comment",
          ),
          eq(contentReports.contentId, contentId),
          eq(contentReports.status, "open"),
        ),
      )
      .limit(1);
    res.json({
      alreadyReported: !!row,
      report: row
        ? {
            id: row.id,
            reason: row.reason,
            note: row.note ?? null,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
          }
        : null,
    });
  }),
);

// ---------------------------------------------------------------------------
// Masquerade visibility for the current viewer (web client uses this to
// render the masquerade banner).
// ---------------------------------------------------------------------------

router.get(
  "/auth/whoami",
  asyncHandler((req, res) => {
    const session = req.sessionUser;
    const real = req.realUser;
    if (!real) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      isMasquerading: !!req.isMasquerading,
      realUser: {
        id: real.id,
        name: real.name,
        email: real.email,
        role: real.role,
      },
      viewingAs:
        req.isMasquerading && session
          ? {
              id: session.id,
              name: session.name,
              email: session.email,
              role: session.role,
            }
          : null,
    });
  }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notFound(res: Response) {
  return apiError(res, 404, "Not found");
}

// Suppress unused warning for requireAuth (kept for future use)
void requireAuth;

export default router;
