import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, foundingSignups, organizations, organizationAdmins, teams, users } from "@workspace/db";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { asyncHandler } from "../lib/async-handler";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { apiError } from "../lib/spec-helpers";
import { WRITTEN_IN_ORG_NAMES } from "../data/written-in-orgs";

const router: IRouter = Router();

const ONE_HOUR = 60 * 60 * 1000;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function adminPassword(): string | null {
  const pw = process.env.FOUNDING_ADMIN_PASSWORD;
  return pw && pw.length > 0 ? pw : null;
}

function tokenSecret(): string | null {
  const s = process.env.SESSION_SECRET;
  return s && s.length > 0 ? s : null;
}

// The feature is only usable when BOTH the password and a signing secret are
// present. We never fall back to a hardcoded secret — a missing SESSION_SECRET
// would otherwise let anyone forge a valid bearer token.
function isConfigured(): boolean {
  return adminPassword() !== null && tokenSecret() !== null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function signToken(expMs: number, secret: string): string {
  const mac = createHmac("sha256", secret).update(String(expMs)).digest("hex");
  return `${expMs}.${mac}`;
}

function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const secret = tokenSecret();
  if (!secret) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const expPart = token.slice(0, dot);
  const expMs = Number(expPart);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const expected = signToken(expMs, secret);
  return safeEqual(token, expected);
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return undefined;
  return value.trim();
}

function requireFoundingAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isConfigured()) {
    apiError(res, 503, "Founding 100 admin is not configured.", {
      code: "NOT_CONFIGURED",
    });
    return;
  }
  if (!verifyToken(bearerToken(req))) {
    apiError(res, 401, "Sign in to manage Founding 100 signups.", {
      code: "UNAUTHORIZED",
    });
    return;
  }
  next();
}

// Per-IP throttle on the password endpoint to deter brute force.
const loginLimiter = rateLimit({
  name: "founding-admin-login",
  windowMs: ONE_HOUR,
  max: 20,
  keys: (req) => [ipKey(req)],
  message: "Too many sign-in attempts. Please wait a while before trying again.",
});

const SessionBody = z.object({
  password: z.string().min(1, "Password is required"),
});

router.post(
  "/founding-admin/session",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const pw = adminPassword();
    const secret = tokenSecret();
    if (!pw || !secret) {
      apiError(res, 503, "Founding 100 admin is not configured.", {
        code: "NOT_CONFIGURED",
      });
      return;
    }
    const parsed = SessionBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, "Password is required.", { code: "VALIDATION_FAILED" });
      return;
    }
    if (!safeEqual(parsed.data.password, pw)) {
      apiError(res, 401, "Incorrect password.", { code: "INVALID_PASSWORD" });
      return;
    }
    const expMs = Date.now() + TOKEN_TTL_MS;
    res.json({ token: signToken(expMs, secret), expiresAt: new Date(expMs).toISOString() });
  }),
);

function serialize(r: typeof foundingSignups.$inferSelect) {
  return {
    id: r.id,
    orgName: r.orgName,
    adminName: r.adminName,
    adminEmail: r.adminEmail,
    roleTitle: r.roleTitle,
    estimatedTeams: r.estimatedTeams,
    estimatedPlayers: r.estimatedPlayers,
    sport: r.sport,
    submittedAt: r.submittedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

router.get(
  "/founding-admin/signups",
  requireFoundingAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(foundingSignups)
      .orderBy(desc(foundingSignups.submittedAt));
    const data = rows.map(serialize);
    res.json({ data, totalCount: data.length });
  }),
);

const UpdateBody = z.object({
  orgName: z.string().trim().min(1, "Organization name is required").max(200),
  adminName: z.string().trim().min(1, "Name is required").max(200),
  adminEmail: z.string().trim().email("Please enter a valid email address").max(320),
  roleTitle: z.string().trim().min(1, "Role / title is required").max(200),
  estimatedTeams: z.number().int().min(0).max(100000),
  estimatedPlayers: z.number().int().min(0).max(1000000),
  sport: z
    .string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

router.patch(
  "/founding-admin/signups/:id",
  requireFoundingAdmin,
  asyncHandler(async (req, res) => {
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      apiError(res, 400, first?.message ?? "Invalid details.", {
        code: "VALIDATION_FAILED",
        extras: { fields: parsed.error.flatten().fieldErrors },
      });
      return;
    }
    const body = parsed.data;
    const [row] = await db
      .update(foundingSignups)
      .set({
        orgName: body.orgName,
        adminName: body.adminName,
        adminEmail: body.adminEmail.toLowerCase(),
        roleTitle: body.roleTitle,
        estimatedTeams: body.estimatedTeams,
        estimatedPlayers: body.estimatedPlayers,
        sport: body.sport,
        updatedAt: new Date(),
      })
      .where(eq(foundingSignups.id, String(req.params.id)))
      .returning();
    if (!row) {
      apiError(res, 404, "Signup not found.", { code: "NOT_FOUND" });
      return;
    }
    res.json(serialize(row));
  }),
);

router.delete(
  "/founding-admin/signups/:id",
  requireFoundingAdmin,
  asyncHandler(async (req, res) => {
    const [row] = await db
      .delete(foundingSignups)
      .where(eq(foundingSignups.id, String(req.params.id)))
      .returning();
    if (!row) {
      apiError(res, 404, "Signup not found.", { code: "NOT_FOUND" });
      return;
    }
    res.json({ ok: true, id: row.id });
  }),
);

// One-time, idempotent seeding of the operator "written-in" org pages from
// inside the deployment. Publishing syncs schema only (no rows), so a freshly
// published environment has no org pages and no per-environment claim tokens
// (tokens are minted per env — a dev CSV will not work live). This authed
// action recreates the org pages (name + a fresh secret claim token), backfills
// a token for any ownerless org still missing one, and returns the claim-links
// CSV for off-site distribution. It mirrors the
// bulk-import-organizations -> backfill-org-claim-links -> export-org-claim-links
// script chain, but runs against the live DB the deployed server is bound to.
const seedLimiter = rateLimit({
  name: "founding-admin-seed-orgs",
  windowMs: ONE_HOUR,
  max: 12,
  keys: (req) => [ipKey(req)],
  message: "Too many seed attempts. Please wait a while before trying again.",
});

function generateClaimToken(): string {
  return randomBytes(32).toString("base64url");
}

function csvCell(v: string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.post(
  "/founding-admin/seed-orgs",
  requireFoundingAdmin,
  seedLimiter,
  asyncHandler(async (_req, res) => {
    const ownerExists = sql`EXISTS (
      SELECT 1 FROM ${organizationAdmins}
      WHERE ${organizationAdmins.organizationId} = ${organizations.id}
        AND ${organizationAdmins.role} = 'owner'
    )`;

    const result = await db.transaction(async (tx) => {
      // Serialize concurrent seed runs. There is no DB-level unique index on
      // org name, so the read-then-insert below would race two overlapping
      // calls into duplicate pages. A transaction-scoped advisory lock makes
      // it race-safe (same pattern as the team-cap enforcement in teams.ts).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('founding-admin:seed-orgs'))`);

      // 1. Create any written-in org pages that don't already exist
      //    (case-insensitive name match), each with a fresh claim token.
      const existing = await tx.select({ name: organizations.name }).from(organizations);
      const have = new Set(existing.map((r) => r.name.trim().toLowerCase()));
      const seen = new Set<string>();
      const toCreate: { name: string; claimToken: string }[] = [];
      let considered = 0;
      for (const raw of WRITTEN_IN_ORG_NAMES) {
        const name = raw.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        considered++;
        if (have.has(key)) continue;
        toCreate.push({ name, claimToken: generateClaimToken() });
      }
      if (toCreate.length > 0) {
        await tx.insert(organizations).values(toCreate);
      }

      // 2. Backfill a claim token for any ownerless org still missing one.
      const ownerlessNoToken = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(isNull(organizations.claimToken), sql`NOT ${ownerExists}`));
      for (const o of ownerlessNoToken) {
        await tx
          .update(organizations)
          .set({ claimToken: generateClaimToken() })
          .where(eq(organizations.id, o.id));
      }

      // 3. List every ownerless org that now has a token -> claim-links CSV.
      const linkRows = await tx
        .select({
          id: organizations.id,
          name: organizations.name,
          city: organizations.city,
          state: organizations.state,
          claimToken: organizations.claimToken,
        })
        .from(organizations)
        .where(and(isNotNull(organizations.claimToken), sql`NOT ${ownerExists}`))
        .orderBy(asc(organizations.name));

      return {
        created: toCreate.length,
        skipped: considered - toCreate.length,
        tokensBackfilled: ownerlessNoToken.length,
        linkRows,
      };
    });

    const base = (process.env.APP_BASE_URL ?? "https://kinectem.com").replace(/\/+$/, "");
    const claimUrl = (token: string) => `${base}/app/claim/${token}`;
    const header = ["org_name", "city", "state", "claim_link", "org_id"];
    const lines = [header.join(",")];
    for (const r of result.linkRows) {
      lines.push(
        [r.name, r.city ?? "", r.state ?? "", claimUrl(r.claimToken!), r.id]
          .map(csvCell)
          .join(","),
      );
    }
    const csv = lines.join("\n") + "\n";

    res.json({
      ok: true,
      created: result.created,
      skipped: result.skipped,
      tokensBackfilled: result.tokensBackfilled,
      totalLinks: result.linkRows.length,
      base,
      csv,
    });
  }),
);

// One-time, idempotent "make this email the sole platform admin" action from
// inside the deployment. Publishing syncs schema only (no rows), so a freshly
// published environment does not carry over the operator's dev admin account —
// the live DB only has organic signups. This authed action promotes an existing
// live account to admin (role = "admin", the platform-admin marker) and demotes
// every OTHER admin to "athlete", so exactly one admin remains. The target must
// already exist (sign up on the live site first); we never create accounts here.
const setAdminLimiter = rateLimit({
  name: "founding-admin-set-sole-admin",
  windowMs: ONE_HOUR,
  max: 12,
  keys: (req) => [ipKey(req)],
  message: "Too many attempts. Please wait a while before trying again.",
});

const SoleAdminBody = z.object({
  email: z.string().trim().email("Please enter a valid email address").max(320),
});

router.post(
  "/founding-admin/set-sole-admin",
  requireFoundingAdmin,
  setAdminLimiter,
  asyncHandler(async (req, res) => {
    const parsed = SoleAdminBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.errors[0]?.message ?? "A valid email is required.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    const email = parsed.data.email.toLowerCase();

    const result = await db.transaction(async (tx) => {
      // Serialize concurrent runs so two overlapping calls can't leave the
      // admin set in an inconsistent state (same advisory-lock pattern as the
      // seed-orgs route and the team-cap enforcement in teams.ts).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('founding-admin:set-sole-admin'))`);

      const [target] = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);

      if (!target) {
        return { notFound: true as const };
      }

      // Promote the target first, then demote every other admin. Excluding the
      // target by id keeps the operation correct whether or not it was already
      // an admin.
      await tx.update(users).set({ role: "admin" }).where(eq(users.id, target.id));
      const demoted = await tx
        .update(users)
        .set({ role: "athlete" })
        .where(and(eq(users.role, "admin"), sql`${users.id} <> ${target.id}`))
        .returning({ email: users.email });

      return {
        notFound: false as const,
        adminEmail: target.email,
        demoted: demoted.map((d) => d.email),
      };
    });

    if (result.notFound) {
      apiError(res, 404, "No live account with that email yet. Sign up on the live site with it first, then try again.", {
        code: "USER_NOT_FOUND",
      });
      return;
    }

    req.log.info(
      { adminEmail: result.adminEmail, demotedCount: result.demoted.length },
      "founding-admin set sole admin",
    );

    res.json({
      ok: true,
      adminEmail: result.adminEmail,
      demoted: result.demoted,
      demotedCount: result.demoted.length,
    });
  }),
);

// One-time, destructive "remove every organization and team" action from inside
// the deployment. Publishing syncs schema only and the agent has read-only prod
// access, so a clean-slate reset has to run from this authed operator page. Every
// FK referencing organizations/teams is CASCADE or SET NULL, so deleting the orgs
// cascades their teams and all dependent content (roster, articles, highlights,
// schedule, followers, invites, org posts, broadcasts, subscriptions). Requires a
// typed "DELETE" confirmation; gated + rate-limited + advisory-locked like the
// other operator actions. Users are intentionally left untouched.
const resetLimiter = rateLimit({
  name: "founding-admin-reset-orgs-teams",
  windowMs: ONE_HOUR,
  max: 12,
  keys: (req) => [ipKey(req)],
  message: "Too many attempts. Please wait a while before trying again.",
});

const ResetOrgsTeamsBody = z.object({
  confirm: z.string(),
});

router.post(
  "/founding-admin/reset-orgs-teams",
  requireFoundingAdmin,
  resetLimiter,
  asyncHandler(async (req, res) => {
    const parsed = ResetOrgsTeamsBody.safeParse(req.body);
    if (
      !parsed.success ||
      parsed.data.confirm.trim().replace(/\s+/g, " ").toUpperCase() !== "DELETE ALL ORGS AND TEAMS"
    ) {
      apiError(res, 400, 'Type "DELETE ALL ORGS AND TEAMS" to confirm.', {
        code: "CONFIRMATION_REQUIRED",
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Serialize concurrent runs (same advisory-lock pattern as the other
      // operator actions). Delete teams first, then orgs; deleting the orgs
      // would cascade the teams anyway, but doing teams explicitly also clears
      // any team that isn't attached to an org.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('founding-admin:reset-orgs-teams'))`);
      const delTeams = await tx.delete(teams).returning({ id: teams.id });
      const delOrgs = await tx.delete(organizations).returning({ id: organizations.id });
      return { teams: delTeams.length, orgs: delOrgs.length };
    });

    req.log.info(
      { deletedOrganizations: result.orgs, deletedTeams: result.teams },
      "founding-admin reset orgs/teams",
    );

    res.json({
      ok: true,
      deletedOrganizations: result.orgs,
      deletedTeams: result.teams,
    });
  }),
);

export default router;
