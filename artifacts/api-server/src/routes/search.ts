import { Router, type IRouter } from "express";
import { db, users, organizations, teams } from "@workspace/db";
import { and, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { filterOutMinors } from "../lib/coppa";
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
import {
  buildMinorNameContext,
  displayNameForViewer,
  emptyPagination,
  safeAvatarUrl,
} from "../lib/spec-helpers";
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
    const [userRowsRaw, orgRows, teamRows] = await Promise.all([
      // Task #676 — deactivated/frozen and soft-deleted accounts must not
      // surface in cross-entity search for non-admin viewers. Admins keep
      // their existing visibility (they don't hit this endpoint for that).
      db
        .select()
        .from(users)
        .where(
          and(
            or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)),
            eq(users.accountStatus, "active"),
            isNull(users.deletedAt),
          ),
        )
        .limit(20),
      db.select().from(organizations).where(ilike(organizations.name, `%${q}%`)).limit(10),
      // Task #472 — archived teams must not surface in cross-entity search.
      db
        .select()
        .from(teams)
        .where(and(ilike(teams.name, `%${q}%`), isNull(teams.archivedAt)))
        .limit(10),
    ]);
    // Task #359 — minor accounts must not be discoverable via cross-
    // entity search. We filter post-query so the (possibly indexed)
    // ilike + name match still uses its existing plan.
    const viewerId = req.sessionUser?.id ?? null;
    const userRows = filterOutMinors(userRowsRaw, viewerId).slice(0, 10);
    // Task #414 — minors that survive the visibility filter (self,
    // linked guardian, shared-team viewer) may still need their last
    // name masked unless the viewer is privileged for that specific
    // minor. We build a viewer-aware context over the surviving rows
    // and route each render through `displayNameForViewer`.
    const searchMinorCtx = await buildMinorNameContext(
      { id: viewerId, role: req.realUser?.role ?? null },
      userRows.map((u) => u.id),
    );
    // Task #592 — batch the team→organization name lookup. Previously
    // each team result fired its own `SELECT ... FROM organizations`
    // (an N+1); now we fetch every referenced org in one query.
    const teamOrgIds = Array.from(
      new Set(
        teamRows
          .map((t) => t.organizationId)
          .filter((id): id is string => id != null),
      ),
    );
    const orgRowsForTeams = teamOrgIds.length
      ? await db.select().from(organizations).where(inArray(organizations.id, teamOrgIds))
      : [];
    const orgById = new Map(orgRowsForTeams.map((o) => [o.id, o]));
    res.json({
      users: {
        data: userRows.map((u) => ({
          id: u.id,
          entityType: "user",
          displayName: displayNameForViewer(u, searchMinorCtx),
          avatarUrl: safeAvatarUrl(u.avatarUrl),
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
        // Task #592 — batch the team→org name lookup into a single
        // query keyed by org id instead of one query per team row.
        data: teamRows.map((t) => {
          const org = t.organizationId
            ? orgById.get(t.organizationId) ?? null
            : null;
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
        pagination: emptyPagination(),
      },
    });
  }),
);

export default router;
