import { Router, type IRouter } from "express";
import { db, foundingSignups } from "@workspace/db";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { requireAdmin } from "../lib/auth";
import { apiError } from "../lib/spec-helpers";

const router: IRouter = Router();

const ONE_HOUR = 60 * 60 * 1000;

// Task #543 — Reuses the same per-IP signup limiter pattern from
// /auth/signup so the public marketing form can't be abused.
const foundingSignupLimiter = rateLimit({
  name: "founding-signup",
  windowMs: ONE_HOUR,
  max: 10,
  keys: (req) => [ipKey(req)],
  message:
    "Too many signup attempts from this network. Please wait a while before trying again.",
});

const FoundingSignupBody = z.object({
  orgName: z.string().trim().min(1, "Organization name is required").max(200),
  adminName: z.string().trim().min(1, "Your name is required").max(200),
  adminEmail: z.string().trim().email("Please enter a valid email address").max(320),
  roleTitle: z.string().trim().min(1, "Role / title is required").max(200),
  estimatedTeams: z
    .number({ invalid_type_error: "Number of teams is required" })
    .int("Number of teams must be a whole number")
    .min(1, "Number of teams must be at least 1")
    .max(100000),
  estimatedPlayers: z
    .number({ invalid_type_error: "Number of players is required" })
    .int("Number of players must be a whole number")
    .min(1, "Number of players must be at least 1")
    .max(1000000),
  sport: z
    .string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

router.post(
  "/founding-signups",
  foundingSignupLimiter,
  asyncHandler(async (req, res) => {
    const parsed = FoundingSignupBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      apiError(res, 400, first?.message ?? "Invalid signup details.", {
        code: "VALIDATION_FAILED",
        extras: { fields: parsed.error.flatten().fieldErrors },
      });
      return;
    }
    const body = parsed.data;
    const email = body.adminEmail.toLowerCase();

    const [row] = await db
      .insert(foundingSignups)
      .values({
        orgName: body.orgName,
        adminName: body.adminName,
        adminEmail: email,
        roleTitle: body.roleTitle,
        estimatedTeams: body.estimatedTeams,
        estimatedPlayers: body.estimatedPlayers,
        sport: body.sport,
      })
      .onConflictDoUpdate({
        target: foundingSignups.adminEmail,
        set: {
          orgName: body.orgName,
          adminName: body.adminName,
          roleTitle: body.roleTitle,
          estimatedTeams: body.estimatedTeams,
          estimatedPlayers: body.estimatedPlayers,
          sport: body.sport,
          updatedAt: new Date(),
        },
      })
      .returning();

    res.status(201).json({ ok: true, id: row.id });
  }),
);

// Admin-only listing. Registered with an absolute path so it doesn't
// have to live inside admin.ts. The per-route requireAdmin guard is
// the same middleware admin.ts uses at router scope.
router.get(
  "/admin/founding-signups",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(foundingSignups)
      .orderBy(desc(foundingSignups.submittedAt));
    const data = rows.map((r) => ({
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
    }));
    res.json({
      data,
      pagination: {
        nextCursor: null,
        hasMore: false,
        totalCount: data.length,
      },
    });
  }),
);

export default router;
