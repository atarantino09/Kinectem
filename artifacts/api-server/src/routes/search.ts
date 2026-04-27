import { Router, type IRouter } from "express";
import { db, users, organizations, teams } from "@workspace/db";
import { eq, ilike, or } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import { sendGuardianConfirmationEmail, sendGuardianExpiredEmail, sendPasswordResetEmail } from "../lib/email";
import { canCreateRecap, canManageOrganization, isTeamMember, canManageTeam } from "../lib/permissions";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../lib/auth";
import { emptyPagination, safeAvatarUrl } from "../lib/spec-helpers";
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
          avatarUrl: safeAvatarUrl(u.avatarUrl),
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

export default router;
