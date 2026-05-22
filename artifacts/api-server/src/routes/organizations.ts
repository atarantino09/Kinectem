import { Router, type IRouter, type Request, type Response } from "express";
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
  organizationInvites,
  articles,
  highlights,
  highlightTags,
  orgPosts,
  notifications,
  organizationJoinRequests,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import { sendGuardianConfirmationEmail, sendGuardianExpiredEmail, sendPasswordResetEmail } from "../lib/email";
import {
  canManageOrganization,
  canCreateRecap,
  canApproveTeamHighlight,
  computeArticleCanEditMap,
  computeArticleAuthorRoleMap,
  getOrgRole,
} from "../lib/permissions";
import {
  notifyAdminsOfTeamHighlight,
  notifyHighlightDecision,
} from "../lib/notifications";
import { notifyNewlyTaggedInHighlight } from "../lib/article-tagging";
import { maskedDisplayName } from "../lib/spec-helpers";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../lib/auth";
import {
  displayName,
  toOrganization,
  toMember,
  toTeam,
  articleToPost,
  articlePostId,
  highlightToPost,
  orgPostToPost,
  paginate,
  parsePostId,
  toJoinRequest,
  apiError,
  notFound,
  buildMinorNameContext,
  TRUSTED_MINOR_NAME_CONTEXT,
} from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostShareStats,
  shareStatsFor,
} from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap } from "../lib/article-tagging";
import { loadHighlightTagViews } from "../lib/highlight-tagging";
import { loadCurrentUserTags } from "../lib/current-user-tag";
import { normalizeWebsite } from "../lib/normalize-website";
import {
  blockMinorAction,
  gateFollowOfMinor,
  loadMinorLookup,
  notifyGuardianOfPendingItem,
} from "../lib/coppa";

const router: IRouter = Router();

class TransferRaceError extends Error {
  constructor(reason: "not-current-owner" | "target-missing") {
    super(`transfer-race:${reason}`);
    this.name = "TransferRaceError";
  }
}

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

// Task #230 — `state` must be one of these 2-letter US codes (50 states
// plus DC) and `zipCode` must match the standard 5 / ZIP+4 formats.
// The same constraints live in the OpenAPI spec; we re-validate here
// because the server doesn't currently auto-validate request bodies
// from the spec.
const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY",
]);
const US_ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

router.post(
  "/organizations",
  asyncHandler(async (req, res) => {
    // Task #487 — Surface the *reason* for any rejection in the server
    // logs so the next mobile bug report is debuggable from logs alone.
    // Uses `req.log` so each line carries the request id automatically.
    const reject = (
      status: number,
      field: string,
      message: string,
    ) => {
      req.log.warn(
        { event: "create_organization_rejected", status, field },
        `POST /organizations rejected: ${field} — ${message}`,
      );
      return apiError(res, status, message);
    };
    const me = req.sessionUser;
    if (!me) return reject(401, "session", "Not authenticated");
    const name = String(req.body?.name ?? "").trim();
    if (!name) return reject(400, "name", "name required");
    const city = String(req.body?.city ?? "").trim();
    if (!city) return reject(400, "city", "city required");
    const stateRaw = String(req.body?.state ?? "").trim().toUpperCase();
    if (!stateRaw) return reject(400, "state", "state required");
    if (!US_STATE_CODES.has(stateRaw)) {
      return reject(
        400,
        "state",
        "state must be a 2-letter US state code (e.g. NJ)",
      );
    }
    const zipCode = String(req.body?.zipCode ?? "").trim();
    if (!zipCode) return reject(400, "zipCode", "zipCode required");
    if (!US_ZIP_PATTERN.test(zipCode)) {
      return reject(
        400,
        "zipCode",
        "zipCode must be a US zip (5 digits or 5+4 like 12345-6789)",
      );
    }
    // Task #290 — accept bare domains like `example.com` and normalize
    // to `https://example.com` so the value is always a clickable URL.
    let websiteValue: string | undefined;
    if (req.body?.website != null && req.body.website !== "") {
      const websiteResult = normalizeWebsite(req.body.website);
      if (!websiteResult.ok) return reject(400, "website", websiteResult.error);
      websiteValue = websiteResult.value || undefined;
    }
    // Wrap the create flow so unexpected DB errors get logged with the
    // same structured shape as the validation rejections above. Without
    // this the request would 500 via the global error handler with no
    // route-specific context, making mobile bug reports hard to triage.
    try {
      const [org] = await db
        .insert(organizations)
        .values({
          name,
          description: req.body?.description ?? undefined,
          city,
          state: stateRaw,
          zipCode,
          website: websiteValue,
          logoUrl: req.body?.logoUrl ?? undefined,
          createdById: me.id,
        })
        .returning();
      // The creator becomes the org's sole owner. The role column was
      // added in task #208; before that the table held only admins and
      // "owner" was implicit (first row in the admins table).
      await db
        .insert(organizationAdmins)
        .values({ organizationId: org.id, userId: me.id, role: "owner" })
        .onConflictDoNothing();
      await db
        .insert(organizationFollowers)
        .values({ organizationId: org.id, userId: me.id })
        .onConflictDoNothing();
      return res
        .status(201)
        .json(toOrganization(org, { isMember: true, role: "owner", isFollowing: true }));
    } catch (err) {
      req.log.error(
        {
          event: "create_organization_failed",
          status: 500,
          field: "db",
          err,
        },
        "POST /organizations failed during insert",
      );
      throw err;
    }
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
        .select({ role: organizationAdmins.role })
        .from(organizationAdmins)
        .where(
          and(
            eq(organizationAdmins.organizationId, org.id),
            eq(organizationAdmins.userId, me.id),
          ),
        )
        .limit(1);
      if (admin) {
        role = admin.role;
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
    if (typeof body.website === "string") {
      // Task #290 — bare domains like `example.com` are accepted and
      // normalized to a full `https://…` URL. An explicit empty string
      // clears the field. Whitespace-only or other malformed input is
      // rejected so a typo can't silently wipe a stored URL.
      const websiteResult = normalizeWebsite(body.website);
      if (!websiteResult.ok) return apiError(res, 400, websiteResult.error);
      patch.website = websiteResult.value === "" ? null : websiteResult.value;
    } else if (body.website === null) {
      patch.website = null;
    }
    if (typeof body.city === "string") {
      const trimmedCity = body.city.trim();
      if (!trimmedCity) return apiError(res, 400, "city must not be empty");
      patch.city = trimmedCity;
    }
    // Task #237 — when callers send city/state/zipCode on edit, hold them
    // to the same rules as create: state must be a known 2-letter US code
    // and zipCode must look like 12345 or 12345-6789.
    if (typeof body.state === "string") {
      const stateRaw = body.state.trim().toUpperCase();
      if (!stateRaw) return apiError(res, 400, "state must not be empty");
      if (!US_STATE_CODES.has(stateRaw)) {
        return apiError(
          res,
          400,
          "state must be a 2-letter US state code (e.g. NJ)",
        );
      }
      patch.state = stateRaw;
    }
    if (typeof body.zipCode === "string") {
      const zipCode = body.zipCode.trim();
      if (!zipCode) return apiError(res, 400, "zipCode must not be empty");
      if (!US_ZIP_PATTERN.test(zipCode)) {
        return apiError(
          res,
          400,
          "zipCode must be a US zip (5 digits or 5+4 like 12345-6789)",
        );
      }
      patch.zipCode = zipCode;
    }
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
    // Returns every row in organization_admins with its real role (owner /
    // admin / member). Owners first, then admins, then members; within
    // each group the earliest joined are listed first.
    const memberRows = await db
      .select({
        u: users,
        role: organizationAdmins.role,
        joinedAt: organizationAdmins.createdAt,
      })
      .from(organizationAdmins)
      .innerJoin(users, eq(organizationAdmins.userId, users.id))
      .where(eq(organizationAdmins.organizationId, req.params.orgId))
      .orderBy(
        sql`(case ${organizationAdmins.role} when 'owner' then 0 when 'admin' then 1 else 2 end)`,
        asc(organizationAdmins.createdAt),
      );
    const data = memberRows.map((r) => toMember(r.u, r.role, r.joinedAt));
    res.json(paginate(data));
  }),
);

// ---------------------------------------------------------------------------
// Membership role + removal endpoints (task #208).
//
// All three are admin/owner-only on the server, regardless of whether the
// UI hides the buttons. The org always has exactly one row with role
// 'owner'; PATCH and DELETE refuse to disturb that invariant. Use
// /transfer-ownership instead.
// ---------------------------------------------------------------------------

router.patch(
  "/organizations/:orgId/members/:userId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const { orgId, userId } = req.params;
    if (!(await canManageOrganization(me.id, orgId))) {
      return apiError(res, 403, "Org admins only");
    }
    const newRole = req.body?.role;
    if (newRole !== "admin" && newRole !== "member") {
      return apiError(res, 400, "role must be 'admin' or 'member'");
    }
    const [target] = await db
      .select({ role: organizationAdmins.role })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, orgId),
          eq(organizationAdmins.userId, userId),
        ),
      )
      .limit(1);
    if (!target) return notFound(res);
    if (target.role === "owner") {
      return apiError(
        res,
        409,
        "The owner's role cannot be changed directly. Transfer ownership instead.",
      );
    }
    if (target.role === newRole) {
      const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!u) return notFound(res);
      return res.json(
        toMember(
          u,
          target.role,
          (await getMemberJoinedAt(orgId, userId)) ?? new Date(),
        ),
      );
    }
    const [updated] = await db
      .update(organizationAdmins)
      .set({ role: newRole })
      .where(
        and(
          eq(organizationAdmins.organizationId, orgId),
          eq(organizationAdmins.userId, userId),
        ),
      )
      .returning();
    if (!updated) return notFound(res);
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return notFound(res);
    res.json(toMember(u, updated.role, updated.createdAt));
  }),
);

router.delete(
  "/organizations/:orgId/members/:userId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const { orgId, userId } = req.params;
    if (!(await canManageOrganization(me.id, orgId))) {
      return apiError(res, 403, "Org admins only");
    }
    const [target] = await db
      .select({ role: organizationAdmins.role })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, orgId),
          eq(organizationAdmins.userId, userId),
        ),
      )
      .limit(1);
    if (!target) return notFound(res);
    if (target.role === "owner") {
      return apiError(
        res,
        409,
        "The owner cannot be removed. Transfer ownership first.",
      );
    }
    await db
      .delete(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, orgId),
          eq(organizationAdmins.userId, userId),
        ),
      );
    res.status(204).end();
  }),
);

router.post(
  "/organizations/:orgId/members/:userId/transfer-ownership",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const { orgId, userId } = req.params;
    if (me.id === userId) {
      return apiError(res, 400, "Cannot transfer ownership to yourself");
    }
    const myRole = await getOrgRole(me.id, orgId);
    if (myRole !== "owner") {
      return apiError(res, 403, "Only the current owner can transfer ownership");
    }
    const [target] = await db
      .select({ role: organizationAdmins.role, joinedAt: organizationAdmins.createdAt })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, orgId),
          eq(organizationAdmins.userId, userId),
        ),
      )
      .limit(1);
    if (!target) {
      return apiError(res, 404, "Target user is not a member of this organization");
    }
    // Promote the new owner and demote the current one in a single
    // transaction so the org is never temporarily ownerless or has two
    // owners. Each statement is conditional on the role we expect to
    // see (defence in depth against concurrent transfer requests from
    // the same owner across two tabs / two requests). The partial
    // unique index `organization_admins_one_owner_per_org` is the DB-
    // level safety net: a racing transaction that tries to create a
    // second owner row will fail with a unique-constraint violation
    // and roll back, so the invariant "exactly one owner per org"
    // holds even under concurrency.
    try {
      await db.transaction(async (tx) => {
        const demoted = await tx
          .update(organizationAdmins)
          .set({ role: "admin" })
          .where(
            and(
              eq(organizationAdmins.organizationId, orgId),
              eq(organizationAdmins.userId, me.id),
              eq(organizationAdmins.role, "owner"),
            ),
          )
          .returning({ userId: organizationAdmins.userId });
        if (demoted.length !== 1) {
          // Another request already transferred ownership away from us.
          throw new TransferRaceError("not-current-owner");
        }
        const promoted = await tx
          .update(organizationAdmins)
          .set({ role: "owner" })
          .where(
            and(
              eq(organizationAdmins.organizationId, orgId),
              eq(organizationAdmins.userId, userId),
            ),
          )
          .returning({ userId: organizationAdmins.userId });
        if (promoted.length !== 1) {
          // Target row vanished mid-transaction — bail out to keep the
          // org from being left without an owner.
          throw new TransferRaceError("target-missing");
        }
      });
    } catch (err) {
      if (err instanceof TransferRaceError) {
        return apiError(res, 409, "Ownership transfer raced with another request — refresh and retry");
      }
      // Unique-violation from organization_admins_one_owner_per_org
      // (race produced two owners) — surface as 409 too.
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: string }).code === "23505"
      ) {
        return apiError(res, 409, "Ownership transfer raced with another request — refresh and retry");
      }
      throw err;
    }
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return notFound(res);
    res.json(toMember(u, "owner", target.joinedAt));
  }),
);

async function getMemberJoinedAt(
  organizationId: string,
  userId: string,
): Promise<Date | null> {
  const [r] = await db
    .select({ createdAt: organizationAdmins.createdAt })
    .from(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.organizationId, organizationId),
        eq(organizationAdmins.userId, userId),
      ),
    )
    .limit(1);
  return r?.createdAt ?? null;
}

router.get(
  "/organizations/:orgId/teams",
  asyncHandler(async (req, res) => {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, req.params.orgId))
      .limit(1);
    if (!org) return notFound(res);
    // Task #472 — the public/main org-teams list never includes
    // archived teams, regardless of viewer. Org owners and admins see
    // archived teams in the dedicated `/organizations/:orgId/teams/archived`
    // endpoint that powers the "Archived teams" section on the
    // Organization page.
    const teamRows = await db
      .select()
      .from(teams)
      .where(
        and(eq(teams.organizationId, org.id), isNull(teams.archivedAt)),
      );
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

// Task #472 — Archived teams for the org. Owner/admin only; everyone
// else gets 403. Used by the "Archived teams" section on the
// Organization page so org managers can find and unarchive a team
// without the platform-admin tools.
router.get(
  "/organizations/:orgId/teams/archived",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, req.params.orgId))
      .limit(1);
    if (!org) return notFound(res);
    if (!(await canManageOrganization(me.id, org.id))) {
      return apiError(res, 403, "Org owner or admin only");
    }
    const teamRows = await db
      .select()
      .from(teams)
      .where(
        and(eq(teams.organizationId, org.id), isNotNull(teams.archivedAt)),
      )
      .orderBy(desc(teams.archivedAt));
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

// Task #452 — "Waiting for approval" section on the team page.
// Authors with recap-creation rights on this team (org owner/admin,
// team coach, or accepted roster member with `position = "author"`)
// can list the team's currently-pending recaps so they can find and
// edit their own submissions before an org admin approves them.
// Anyone else gets 403; pending recaps never leak into the public
// /teams/:teamId/posts feed (which filters on status="published").
router.get(
  "/teams/:teamId/posts/pending",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) return notFound(res);
    const allowed = await canCreateRecap(me.id, team);
    if (!allowed)
      return apiError(res, 403, "Only authors can view pending recaps");
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, team.organizationId))
      .limit(1);
    if (!org) return notFound(res);
    const rows = await db
      .select({ a: articles, team: teams, org: organizations, author: users })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(
        and(
          eq(articles.status, "pending_approval"),
          eq(articles.teamId, teamId),
          isNull(articles.hiddenAt),
        ),
      )
      .orderBy(desc(articles.createdAt))
      .limit(50);
    const [canEditMap, authorRoleMap] = await Promise.all([
      computeArticleCanEditMap(
        me.id,
        rows.map((r) => ({
          articleId: r.a.id,
          authorId: r.a.authorId,
          orgId: r.org.id,
        })),
      ),
      computeArticleAuthorRoleMap(
        rows.map((r) => ({
          articleId: r.a.id,
          authorId: r.a.authorId,
          teamId: r.team.id,
          orgId: r.org.id,
        })),
      ),
    ]);
    // Mask minor authors for stranger viewers, mirroring the public
    // team-feed behavior. Authors viewing their own pending submission
    // remain unmasked via the self-bypass in buildMinorNameContext.
    const minorIds = rows
      .map((r) => r.author?.id)
      .filter((x): x is string => !!x);
    const minorCtx = await buildMinorNameContext(
      { id: me.id, role: req.realUser?.role ?? null },
      minorIds,
    );
    const data = rows.map((r) =>
      articleToPost(r.a, {
        team: r.team,
        org: r.org,
        author: r.author,
        canEdit: canEditMap.get(r.a.id) ?? false,
        authorRole: authorRoleMap.get(r.a.id) ?? null,
        minorNameCtx: minorCtx,
      }),
    );
    res.json(paginate(data));
  }),
);

// Task #559 — Staff queue for team-scoped highlights uploaded by
// players/parents that are awaiting approval. Restricted to staff
// approvers (org admin/owner of the parent org, accepted-roster
// coach, manager, or "author"). Anyone else gets 403. The public
// `/teams/:teamId/posts` feed already filters pending highlights
// out so this endpoint is the only place they surface.
router.get(
  "/teams/:teamId/highlights/pending",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) return notFound(res);
    const allowed = await canApproveTeamHighlight(me.id, team);
    if (!allowed)
      return apiError(res, 403, "Only team staff can view pending highlights");
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, team.organizationId))
      .limit(1);
    if (!org) return notFound(res);
    const rows = await db
      .select({ h: highlights, team: teams, org: organizations, uploader: users })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(highlights.uploaderId, users.id))
      .where(
        and(
          eq(highlights.teamId, teamId),
          eq(highlights.approvalStatus, "pending"),
          isNull(highlights.hiddenAt),
        ),
      )
      .orderBy(desc(highlights.createdAt))
      .limit(50);
    // Viewer is a staff approver — mask any tagged minor's last name
    // only when the staff member isn't privileged for that minor.
    const minorCtx = await buildMinorNameContext(
      { id: me.id, role: req.realUser?.role ?? null },
      rows.map((r) => r.uploader?.id).filter((x): x is string => !!x),
    );
    const tagViews = await loadHighlightTagViews(
      me.id,
      rows.map((r) => ({ id: r.h.id, uploaderId: r.h.uploaderId })),
      minorCtx,
    );
    const data = rows.map((r) =>
      highlightToPost(r.h, {
        team: r.team,
        org: r.org,
        author: r.uploader,
        canEdit: false,
        canDelete: false,
        taggedUsers: tagViews.get(r.h.id) ?? [],
        minorNameCtx: minorCtx,
      }),
    );
    res.json(paginate(data));
  }),
);

async function transitionHighlightApproval(
  req: Request,
  res: Response,
  next: "approved" | "declined",
) {
  const me = req.sessionUser;
  if (!me) return apiError(res, 401, "Not authenticated");
  const teamId = req.params.teamId;
  const highlightId = req.params.highlightId;
  // Task #559 — optional staff-supplied note surfaced in the
  // uploader's decline notification. Approve calls ignore it. Trim
  // and cap to 280 chars defensively in addition to the OpenAPI
  // validator's maxLength.
  const rawReason =
    next === "declined" && typeof req.body?.reason === "string"
      ? req.body.reason.trim().slice(0, 280)
      : "";
  const declineReason = rawReason.length > 0 ? rawReason : null;
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) return notFound(res);
  const allowed = await canApproveTeamHighlight(me.id, team);
  if (!allowed)
    return apiError(res, 403, "Only team staff can decide pending highlights");
  // Conditional update — only transitions a row that is still
  // `pending`. Concurrent approve+decline collapses to one winner so
  // we don't double-notify the uploader.
  const updated = await db
    .update(highlights)
    .set({
      approvalStatus: next,
      approvedAt: next === "approved" ? new Date() : null,
      approvedByUserId: me.id,
    })
    .where(
      and(
        eq(highlights.id, highlightId),
        eq(highlights.teamId, teamId),
        eq(highlights.approvalStatus, "pending"),
        // Task #559 review — admin-hidden highlights must not be
        // revivable via the approval path. If a staff member sees a
        // pending row that was since soft-hidden, the conditional
        // update no-ops and the endpoint returns 404.
        isNull(highlights.hiddenAt),
      ),
    )
    .returning();
  if (updated.length === 0) return notFound(res);
  const [h] = updated;
  if (h.uploaderId) {
    await notifyHighlightDecision({
      uploaderId: h.uploaderId,
      highlightId: h.id,
      highlightTitle: h.title,
      decidedBy: me.id,
      decision: next,
      reason: declineReason,
    });
  }
  // Task #559 — on approval, run the publish-time fan-out that was
  // intentionally deferred at upload time:
  //   1. notify org admins/owners that a new highlight is live (the
  //      same notification staff uploads fire from POST /posts).
  //   2. notify the players whose tags were inserted while the
  //      highlight was pending — we held those bell rows back so the
  //      link wouldn't 404. Tag rows themselves are unchanged
  //      (status stays "pending" until the tagged player approves).
  if (next === "approved") {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, team.organizationId))
      .limit(1);
    const [uploader] = h.uploaderId
      ? await db
          .select()
          .from(users)
          .where(eq(users.id, h.uploaderId))
          .limit(1)
      : [null];
    const isUploaderAdmin = h.uploaderId
      ? await canManageOrganization(h.uploaderId, team.organizationId)
      : false;
    if (org && uploader && !isUploaderAdmin) {
      await notifyAdminsOfTeamHighlight({
        organizationId: org.id,
        teamName: team.name,
        highlightId: h.id,
        highlightTitle: h.title,
        actorUserId: uploader.id,
        actorDisplayName: uploader.isMinor
          ? maskedDisplayName(uploader)
          : displayName(uploader),
      });
    }
    const pendingTagRows = await db
      .select({ userId: highlightTags.userId, status: highlightTags.status })
      .from(highlightTags)
      .where(eq(highlightTags.highlightId, h.id));
    if (pendingTagRows.length > 0) {
      await notifyNewlyTaggedInHighlight({
        tags: pendingTagRows.map((t) => ({
          userId: t.userId,
          status: t.status as "pending" | "approved",
        })),
        highlightId: h.id,
        highlightTitle: h.title,
        actorUserId: h.uploaderId ?? null,
      });
    }
  }
  res.json({ status: next });
}

router.post(
  "/teams/:teamId/highlights/:highlightId/approve",
  asyncHandler((req, res) => transitionHighlightApproval(req, res, "approved")),
);
router.post(
  "/teams/:teamId/highlights/:highlightId/decline",
  asyncHandler((req, res) => transitionHighlightApproval(req, res, "declined")),
);

router.get(
  "/teams/:teamId/posts",
  asyncHandler(async (req, res) => {
    // Task #190 — Team-page post cards must surface real share state
    // (shareCount + hasShared) for both articles and highlights so the
    // UI matches the home feed and post-detail views. Without this
    // wiring the share button on every team-page card would render as
    // "0 / not shared" until the user navigates away.
    const me = req.sessionUser;
    const rows = await db
      .select({ a: articles, team: teams, org: organizations, author: users })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(
        and(
          eq(articles.status, "published"),
          eq(articles.teamId, req.params.teamId),
          // Soft-deleted recaps must not be served to the team page —
          // matches the home/profile feed behavior so a deleted
          // article disappears for everyone (author, teammates,
          // anonymous viewers) instead of lingering as a "ghost".
          isNull(articles.hiddenAt),
        ),
      )
      .orderBy(desc(articles.createdAt))
      .limit(20);
    const hRows = await db
      .select({ h: highlights, team: teams, org: organizations, author: users })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(highlights.uploaderId, users.id))
      // Task #559 — pending highlights (player/parent uploads
      // awaiting staff approval) never surface on the public
      // team-page feed. Staff approvers view them via the separate
      // /teams/:teamId/highlights/pending endpoint.
      .where(
        and(
          eq(highlights.teamId, req.params.teamId),
          isNull(highlights.hiddenAt),
          eq(highlights.approvalStatus, "approved"),
        ),
      )
      .orderBy(desc(highlights.createdAt))
      .limit(20);

    const [shareStats, canEditMap, authorRoleMap, highlightTagViews, currentUserTags] =
      await Promise.all([
        loadPostShareStats(me?.id ?? null, [
          ...rows.map((r) => ({ kind: "article" as const, refId: r.a.id })),
          ...hRows.map((r) => ({ kind: "highlight" as const, refId: r.h.id })),
        ]),
        computeArticleCanEditMap(
          me?.id ?? null,
          rows.map((r) => ({
            articleId: r.a.id,
            authorId: r.a.authorId,
            orgId: r.org.id,
          })),
        ),
        computeArticleAuthorRoleMap(
          rows.map((r) => ({
            articleId: r.a.id,
            authorId: r.a.authorId,
            teamId: r.team.id,
            orgId: r.org.id,
          })),
        ),
        // Task #414 — first call is used only to mine the set of
        // minor tagged-user ids needed to build the masking ctx
        // below. The result is immediately discarded in favor of
        // `maskedHighlightTagViews`. Pass TRUSTED here so the result
        // contains real ids/names even though no user ever sees it.
        loadHighlightTagViews(
          me?.id ?? null,
          hRows.map((r) => ({ id: r.h.id, uploaderId: r.h.uploaderId })),
          TRUSTED_MINOR_NAME_CONTEXT,
        ),
        loadCurrentUserTags(me?.id ?? null, {
          articleIds: rows.map((r) => r.a.id),
          highlightIds: hRows.map((r) => r.h.id),
        }),
      ]);

    // Task #414 — Mask minor authors / uploaders / tag chips on the
    // team-page post cards for stranger viewers, while keeping full
    // names for the minor themselves, their linked guardian, platform
    // admins, and shared-team viewers.
    const teamPostsMinorIds = [
      ...rows.map((r) => r.author?.id).filter((x): x is string => !!x),
      ...hRows.map((r) => r.author?.id).filter((x): x is string => !!x),
      ...Array.from(highlightTagViews.values()).flatMap((views) =>
        views.map((v) => v.id),
      ),
    ];
    const teamPostsMinorCtx = await buildMinorNameContext(
      { id: me?.id ?? null, role: req.realUser?.role ?? null },
      teamPostsMinorIds,
    );
    // Refresh tag views with masking applied for stranger viewers.
    const maskedHighlightTagViews = await loadHighlightTagViews(
      me?.id ?? null,
      hRows.map((r) => ({ id: r.h.id, uploaderId: r.h.uploaderId })),
      teamPostsMinorCtx,
    );

    const articleData = rows.map((r) =>
      articleToPost(r.a, {
        team: r.team,
        org: r.org,
        author: r.author,
        canEdit: canEditMap.get(r.a.id) ?? false,
        authorRole: authorRoleMap.get(r.a.id) ?? null,
        ...shareStatsFor(shareStats, "article", r.a.id),
        currentUserTag:
          currentUserTags.articleTagByArticleId.get(r.a.id) ?? null,
        minorNameCtx: teamPostsMinorCtx,
      }),
    );
    const highlightData = hRows.map((r) => {
      const isUploader = !!me && r.h.uploaderId === me.id;
      return highlightToPost(r.h, {
        team: r.team,
        org: r.org,
        author: r.author,
        canEdit: isUploader,
        canDelete: isUploader,
        ...shareStatsFor(shareStats, "highlight", r.h.id),
        taggedUsers: maskedHighlightTagViews.get(r.h.id) ?? [],
        currentUserTag:
          currentUserTags.highlightTagByHighlightId.get(r.h.id) ?? null,
        minorNameCtx: teamPostsMinorCtx,
      });
    });
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
        .where(
          and(
            eq(orgPosts.organizationId, orgId),
            eq(orgPosts.status, "published"),
            isNull(orgPosts.hiddenAt),
          ),
        )
        .orderBy(desc(orgPosts.createdAt))
        .limit(20),
    ]);

    const [stats, shareStats, canEditMap, authorRoleMap, currentUserTags] = await Promise.all([
      loadPostStats(me?.id ?? null, [
        ...articleRows.map((r) => ({ kind: "article" as const, refId: r.a.id })),
        ...orgPostRows.map((r) => ({ kind: "org_post" as const, refId: r.p.id })),
      ]),
      // Task #190 — Articles surface share state on org-page cards too
      // (org_post is non-shareable, so it stays at the default 0/false).
      loadPostShareStats(
        me?.id ?? null,
        articleRows.map((r) => ({ kind: "article" as const, refId: r.a.id })),
      ),
      computeArticleCanEditMap(
        me?.id ?? null,
        articleRows.map((r) => ({
          articleId: r.a.id,
          authorId: r.a.authorId,
          orgId: r.org.id,
        })),
      ),
      computeArticleAuthorRoleMap(
        articleRows.map((r) => ({
          articleId: r.a.id,
          authorId: r.a.authorId,
          teamId: r.team.id,
          orgId: r.org.id,
        })),
      ),
      loadCurrentUserTags(me?.id ?? null, {
        articleIds: articleRows.map((r) => r.a.id),
        highlightIds: [],
      }),
    ]);

    const isViewerOrgAdmin = me
      ? await canManageOrganization(me.id, org.id)
      : false;

    // Task #414 — Mask minor authors on org-page post cards (articles
    // + org_post) for stranger viewers; full names for self / linked
    // guardian / admin / shared-team.
    const orgPostsMinorIds = [
      ...articleRows.map((r) => r.author?.id).filter((x): x is string => !!x),
      ...orgPostRows.map((r) => r.author?.id).filter((x): x is string => !!x),
    ];
    const orgPostsMinorCtx = await buildMinorNameContext(
      { id: me?.id ?? null, role: req.realUser?.role ?? null },
      orgPostsMinorIds,
    );

    const data = [
      ...articleRows.map((r) =>
        articleToPost(r.a, {
          team: r.team,
          org: r.org,
          author: r.author,
          canEdit: canEditMap.get(r.a.id) ?? false,
          authorRole: authorRoleMap.get(r.a.id) ?? null,
          ...statsFor(stats, "article", r.a.id),
          ...shareStatsFor(shareStats, "article", r.a.id),
          currentUserTag:
            currentUserTags.articleTagByArticleId.get(r.a.id) ?? null,
          minorNameCtx: orgPostsMinorCtx,
        }),
      ),
      ...orgPostRows.map((r) => {
        const isAuthor = !!me && r.p.authorId === me.id;
        return orgPostToPost(r.p, {
          org,
          author: r.author,
          canEdit: isAuthor || isViewerOrgAdmin,
          canDelete: isAuthor,
          ...statsFor(stats, "org_post", r.p.id),
          minorNameCtx: orgPostsMinorCtx,
        });
      }),
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
    // Task #414 — write-time POST echo: viewer = author = me. Bypass.
    res.status(201).json(
      orgPostToPost(p, { org, author: me, minorNameCtx: TRUSTED_MINOR_NAME_CONTEXT }),
    );
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
    // Task #414 — admin viewing the join-request queue may see minor
    // requesters whose name should be masked unless the admin is
    // privileged for that specific minor (linked guardian or shared
    // accepted-roster team). Build a viewer-aware ctx.
    const joinReqMinorCtx = await buildMinorNameContext(
      { id: me.id, role: req.realUser?.role ?? null },
      rows.map((r) => r.u?.id).filter((x): x is string => !!x),
    );
    res.json(
      paginate(rows.map((r) => toJoinRequest(r.r, r.u, joinReqMinorCtx))),
    );
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
    // Task #414 — write-time echo for the requester acting on their
    // own join request. Viewer = subject = me. Bypass.
    if (existing)
      return res
        .status(200)
        .json(toJoinRequest(existing, me, TRUSTED_MINOR_NAME_CONTEXT));
    const [r] = await db
      .insert(organizationJoinRequests)
      .values({ organizationId: req.params.orgId, userId: me.id, status: "pending" })
      .returning();
    res.status(201).json(toJoinRequest(r, me, TRUSTED_MINOR_NAME_CONTEXT));
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
    const rawRole = req.body?.role;
    if (rawRole !== undefined && rawRole !== "admin" && rawRole !== "member") {
      return apiError(res, 400, "role must be 'admin' or 'member'");
    }
    const role: "admin" | "member" = rawRole === "admin" ? "admin" : "member";
    // Both members and admins live in organization_admins now (the table
    // name is historical). Members get the same row with role 'member';
    // permission helpers gate writes by checking role in ('owner','admin').
    await db
      .insert(organizationAdmins)
      .values({ organizationId: r.organizationId, userId: r.userId, role })
      .onConflictDoNothing();
    // New members also follow the org so it shows up in their feed.
    await db
      .insert(organizationFollowers)
      .values({ organizationId: r.organizationId, userId: r.userId })
      .onConflictDoNothing();
  }
  const [u] = await db.select().from(users).where(eq(users.id, r.userId)).limit(1);
  // Task #414 — admin decision echo. Viewer is the deciding org admin
  // and may not be privileged for a minor requester; build a real ctx.
  const decideMinorCtx = await buildMinorNameContext(
    { id: me.id, role: req.realUser?.role ?? null },
    u ? [u.id] : [],
  );
  res.json(toJoinRequest(updated, u ?? null, decideMinorCtx));
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
    // Task #414 — withdraw echo: viewer = subject = me. Bypass.
    res.json(toJoinRequest(updated, me, TRUSTED_MINOR_NAME_CONTEXT));
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
    const approvalAuthorRoleMap = await computeArticleAuthorRoleMap(
      rows.map((r) => ({
        articleId: r.a.id,
        authorId: r.a.authorId,
        teamId: r.team.id,
        orgId: r.org.id,
      })),
    );
    // Task #414 — admin approval queue. Viewer is the org admin; mask
    // minor recap authors unless the admin is privileged (admin role
    // already short-circuits via bypass; non-admin org owners need the
    // shared-team check).
    const approvalMinorCtx = await buildMinorNameContext(
      { id: me.id, role: req.realUser?.role ?? null },
      rows.map((r) => r.author?.id).filter((x): x is string => !!x),
    );
    res.json(
      paginate(
        rows.map((r) => {
          const post = articleToPost(r.a, {
            team: r.team,
            org: r.org,
            author: r.author,
            authorRole: approvalAuthorRoleMap.get(r.a.id) ?? null,
            minorNameCtx: approvalMinorCtx,
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
  // When an admin approves a recap, run the auto-tag fan-out so every
  // accepted player on the team's roster gets tagged. The publish path
  // (drafts.ts) only runs the fan-out for status="published" transitions,
  // so a recap that was created as pending_approval — or one whose
  // gameDate was added/changed via PATCH while pending — would otherwise
  // never get its roster tagged. Fan-out is idempotent (article_tags has
  // ON CONFLICT DO NOTHING on (article_id, user_id)) so it's safe to run
  // here even if the publish path already ran it. (task #242)
  if (next === "published" && a.gameDate) {
    const taggerUserId = a.authorId ?? me.id;
    const newlyTagged = await applyArticleTagFanout({
      articleId: a.id,
      teamId: a.teamId,
      taggerUserId,
      explicitUserIds: [],
      gameDate: a.gameDate,
    });
    if (newlyTagged.length > 0) {
      await notifyNewlyTaggedInRecap({
        userIds: newlyTagged,
        articleId: a.id,
        articleTitle: a.title,
        actorUserId: taggerUserId,
      });
    }
  }
  // Task #458 — notify the recap author of the admin's decision so they
  // don't have to refresh the team page to discover their pending recap
  // disappeared. Skip when the author is the admin acting on themselves
  // (they already know), and skip when there's no author on file.
  if (a.authorId && a.authorId !== me.id) {
    const title = a.title?.trim() ? a.title.trim() : "your recap";
    const prefixedId = articlePostId(a.id);
    if (next === "published") {
      await db.insert(notifications).values({
        userId: a.authorId,
        kind: "recap_approved",
        message: `Your recap "${title}" was approved.`,
        link: `/posts/${prefixedId}`,
        actorUserId: me.id,
      });
    } else {
      await db.insert(notifications).values({
        userId: a.authorId,
        kind: "recap_declined",
        message: `Your recap "${title}" was declined.`,
        link: `/posts/new?editId=${prefixedId}`,
        actorUserId: me.id,
      });
    }
  }
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
    // Task #359 — minors cannot create public follow edges to orgs.
    if (blockMinorAction(res, me, "follow_organization")) return;
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
    // Task #359 — minors cannot follow, and minors are not followable
    // by strangers. The minor's linked guardian is allowed through, since
    // follow + family dashboard are how parents oversee the account.
    if (blockMinorAction(res, me, "follow_user")) return;
    const target = await loadMinorLookup(req.params.userId);
    if (!target) return notFound(res);
    // Task #363 — COPPA Phase 2. Phase 1 hard-blocked stranger follows
    // of minors; Phase 2 lets them through as `pending` so the linked
    // guardian can approve from the family dashboard. Adult targets
    // and the guardian's own follow-edge stay `approved` (the existing
    // default).
    let status = gateFollowOfMinor(target, me.id);
    // Task #520 — Adult-only "private account" toggle. If the COPPA
    // gate already returned `pending` (i.e. stranger-follows-minor),
    // leave it pending and let the guardian queue handle it. Otherwise
    // demote the brand-new edge to `pending` when the target adult has
    // `requires_follow_approval = true` so they can approve it from
    // /follow-requests. We only demote when no row already exists
    // (`onConflictDoNothing` returns 0 rows on conflict), so existing
    // followers are never retroactively kicked back to pending.
    let privateAccountGated = false;
    if (status === "approved") {
      const [targetRow] = await db
        .select({
          isMinor: users.isMinor,
          requiresFollowApproval: users.requiresFollowApproval,
        })
        .from(users)
        .where(eq(users.id, req.params.userId))
        .limit(1);
      if (
        targetRow &&
        !targetRow.isMinor &&
        targetRow.requiresFollowApproval
      ) {
        status = "pending";
        privateAccountGated = true;
      }
    }
    const inserted = await db
      .insert(userFollowers)
      .values({
        followingUserId: req.params.userId,
        followerUserId: me.id,
        moderationStatus: status,
      })
      .onConflictDoNothing()
      .returning({ followerUserId: userFollowers.followerUserId });
    if (inserted.length > 0) {
      if (status === "approved") {
        // Bell-notify the followed user when the follow lands live.
        // Pending follows do NOT bell-notify the minor — they ring
        // the guardian instead.
        await db.insert(notifications).values({
          userId: req.params.userId,
          kind: "follow",
          message: `${displayName(me)} started following you`,
          link: `/users/${me.id}`,
          actorUserId: me.id,
        });
      } else if (privateAccountGated) {
        // Task #520 — Ring the followed adult directly when their
        // private-account toggle landed this request in the pending
        // queue. Distinct kind so the bell deep-links to the new
        // /follow-requests inbox instead of the guardian dashboard.
        await db.insert(notifications).values({
          userId: req.params.userId,
          kind: "follow_request",
          message: `${displayName(me)} requested to follow you`,
          link: `/follow-requests`,
          actorUserId: me.id,
        });
      } else if (target.parentId) {
        await notifyGuardianOfPendingItem({
          guardianUserId: target.parentId,
          childUserId: target.id,
          kind: "follow",
          message: `${displayName(me)} wants to follow your child`,
        });
      }
    }
    res.status(201).json({
      followerId: me.id,
      followingUserId: req.params.userId,
      createdAt: new Date().toISOString(),
      moderationStatus: status,
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
    // Task #359 — minors cannot create public team-follow edges.
    if (blockMinorAction(res, me, "follow_team")) return;
    const [target] = await db
      .select({ id: teams.id, archivedAt: teams.archivedAt })
      .from(teams)
      .where(eq(teams.id, req.params.teamId))
      .limit(1);
    if (!target) return notFound(res);
    // Task #472 — block new follow edges on archived teams. Existing
    // follows are intentionally left untouched so the unarchive path
    // restores the team's previous follower set without a backfill.
    if (target.archivedAt)
      return apiError(res, 409, "Team is archived", { code: "team_archived" });
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
// ---------------------------------------------------------------------------
// Org setup checklist (Task #548).
//
// `GET /organizations/:orgId/setup-status` returns per-step completion
// booleans derived from real org state plus the calling user's
// dismissal flag. `POST /…/setup-checklist/dismiss` and
// `DELETE /…/setup-checklist/dismiss` flip the persisted
// `organization_admins.dismissed_setup_at` column for the caller.
// All three endpoints are owner/admin-gated. The status query uses
// count-only subqueries so it stays a single cheap round-trip.
// ---------------------------------------------------------------------------

async function computeOrgSetupStatus(orgId: string, userId: string) {
  const [orgRow] = await db
    .select({ logoUrl: organizations.logoUrl })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!orgRow) return null;

  const [membership] = await db
    .select({ dismissedSetupAt: organizationAdmins.dismissedSetupAt })
    .from(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.organizationId, orgId),
        eq(organizationAdmins.userId, userId),
      ),
    )
    .limit(1);

  const [counts] = await db
    .select({
      teamCount: sql<number>`(
        select count(*)::int from ${teams}
        where ${teams.organizationId} = ${orgId}
          and ${teams.archivedAt} is null
      )`,
      memberCount: sql<number>`(
        select count(*)::int from ${organizationAdmins}
        where ${organizationAdmins.organizationId} = ${orgId}
      )`,
      adminCount: sql<number>`(
        select count(*)::int from ${organizationAdmins}
        where ${organizationAdmins.organizationId} = ${orgId}
          and ${organizationAdmins.role} in ('owner','admin')
      )`,
      pendingOrgInviteCount: sql<number>`(
        select count(*)::int from ${organizationInvites}
        where ${organizationInvites.organizationId} = ${orgId}
          and ${organizationInvites.status} = 'pending'
      )`,
      rosterCount: sql<number>`(
        select count(*)::int from ${rosterEntries}
        inner join ${teams} on ${teams.id} = ${rosterEntries.teamId}
        where ${teams.organizationId} = ${orgId}
          and ${teams.archivedAt} is null
      )`,
      guardianLinkCount: sql<number>`(
        select count(*)::int from ${rosterEntries}
        inner join ${teams} on ${teams.id} = ${rosterEntries.teamId}
        inner join ${users} on ${users.id} = ${rosterEntries.userId}
        where ${teams.organizationId} = ${orgId}
          and ${teams.archivedAt} is null
          and ${users.parentId} is not null
      )`,
      pendingRosterInviteCount: sql<number>`(
        select count(*)::int from ${rosterInvites}
        inner join ${teams} on ${teams.id} = ${rosterInvites.teamId}
        where ${teams.organizationId} = ${orgId}
          and ${teams.archivedAt} is null
          and ${rosterInvites.status} = 'pending'
      )`,
    })
    .from(sql`(select 1) as _one`);

  const steps = {
    logoSet: orgRow.logoUrl != null && orgRow.logoUrl !== "",
    hasTeam: (counts?.teamCount ?? 0) >= 1,
    hasStaffOrInvite:
      (counts?.memberCount ?? 0) >= 2 ||
      (counts?.pendingOrgInviteCount ?? 0) >= 1,
    hasCoAdmin: (counts?.adminCount ?? 0) >= 2,
    hasRosterEntry: (counts?.rosterCount ?? 0) >= 1,
    hasGuardianLinkOrInvite:
      (counts?.guardianLinkCount ?? 0) >= 1 ||
      (counts?.pendingRosterInviteCount ?? 0) >= 1,
  };
  const stepValues = Object.values(steps);
  const completedCount = stepValues.filter(Boolean).length;
  const totalSteps = stepValues.length;
  return {
    orgId,
    steps,
    completedCount,
    totalSteps,
    allComplete: completedCount === totalSteps,
    dismissedAt: membership?.dismissedSetupAt
      ? membership.dismissedSetupAt.toISOString()
      : null,
  };
}

router.get(
  "/organizations/:orgId/setup-status",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (!(await canManageOrganization(me.id, req.params.orgId))) {
      return apiError(res, 403, "Forbidden");
    }
    const status = await computeOrgSetupStatus(req.params.orgId, me.id);
    if (!status) return notFound(res);
    res.json(status);
  }),
);

router.post(
  "/organizations/:orgId/setup-checklist/dismiss",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (!(await canManageOrganization(me.id, req.params.orgId))) {
      return apiError(res, 403, "Forbidden");
    }
    await db
      .update(organizationAdmins)
      .set({ dismissedSetupAt: new Date() })
      .where(
        and(
          eq(organizationAdmins.organizationId, req.params.orgId),
          eq(organizationAdmins.userId, me.id),
        ),
      );
    const status = await computeOrgSetupStatus(req.params.orgId, me.id);
    if (!status) return notFound(res);
    res.json(status);
  }),
);

router.delete(
  "/organizations/:orgId/setup-checklist/dismiss",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (!(await canManageOrganization(me.id, req.params.orgId))) {
      return apiError(res, 403, "Forbidden");
    }
    await db
      .update(organizationAdmins)
      .set({ dismissedSetupAt: null })
      .where(
        and(
          eq(organizationAdmins.organizationId, req.params.orgId),
          eq(organizationAdmins.userId, me.id),
        ),
      );
    const status = await computeOrgSetupStatus(req.params.orgId, me.id);
    if (!status) return notFound(res);
    res.json(status);
  }),
);

router.get("/organizations/:orgId/privacy", (_req, res) =>
  res.json({ orgId: _req.params.orgId, settings: {} }),
);

export default router;
