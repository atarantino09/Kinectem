import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, foundingSignups, organizations, organizationAdmins } from "@workspace/db";
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

export default router;
