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
  organizationClaimRequests,
  guardianLinks,
  stagedCoachInvites,
  coachInviteGroups,
  promoCodes,
  teamNewsLinks,
  organizationRosterOutreach,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import {
  getActiveGuardianIds,
  notifyAllGuardiansOfPendingItem,
} from "../lib/guardian-links";
import {
  sendGuardianConfirmationEmail,
  sendGuardianExpiredEmail,
  sendPasswordResetEmail,
  appBaseUrl,
  buildPostUrl,
  buildFollowEmail,
  buildFirstRecapMilestoneEmail,
  buildInviteAcceptUrl,
  sendMultiTeamStaffInviteEmail,
} from "../lib/email";
import { dispatchNotificationEmail } from "../lib/notification-email";
import {
  canManageOrganization,
  canManageTeam,
  canAuthorRecapAnywhere,
  canCreateRecap,
  canApproveTeamHighlight,
  computeArticleCanEditMap,
  computeArticleAuthorRoleMap,
  getOrgRole,
  isPlatformAdmin,
} from "../lib/permissions";
import {
  generateNewsletterText,
  AiNotConfiguredError,
  type NewsletterRecapInput,
} from "../lib/ai";
import {
  notifyAdminsOfTeamHighlight,
  notifyHighlightDecision,
  notifyTeamFollowersOfNewRecap,
  notifyTeamFollowersOfNewHighlight,
} from "../lib/notifications";
import { notifyNewlyTaggedInHighlight } from "../lib/article-tagging";
import { maskedDisplayName } from "../lib/spec-helpers";
import { loadCompetitionBrandMap } from "../lib/competition-brand";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../lib/auth";
import { requireAuth } from "../middlewares/auth";
import { fetchNewsMetadata, NewsFetchError } from "../lib/news-metadata";
import { normalizeNewsGameDate } from "../lib/news-game-date";
import {
  displayName,
  toOrganization,
  toMember,
  toTeam,
  articleToPost,
  articlePostId,
  highlightToPost,
  newsLinkToPost,
  orgPostToPost,
  paginate,
  parsePostLimit,
  decodePostCursor,
  pagePosts,
  parsePostId,
  toJoinRequest,
  apiError,
  notFound,
  buildMinorNameContext,
  TRUSTED_MINOR_NAME_CONTEXT,
  MAX_IMAGE_DATA_URL_LENGTH,
} from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostShareStats,
  shareStatsFor,
} from "../lib/post-stats";
import {
  applyArticleTagFanout,
  applyMentionTags,
  notifyNewlyTaggedInRecap,
} from "../lib/article-tagging";
import { loadHighlightTagViews } from "../lib/highlight-tagging";
import { loadCurrentUserTags } from "../lib/current-user-tag";
import { normalizeWebsite } from "../lib/normalize-website";
import { buildCoachInviteText } from "@workspace/invite-copy";
import { staffInviteRoleLabel } from "@workspace/invite-copy";
import {
  ensureOrgFollowedForTeam,
  ensureTeamFollowed,
  ensureTeamFollowedAsGuardian,
} from "../lib/team-follow";
import { getOrCreateTeamJoinLink } from "../lib/team-join-link";
import {
  blockMinorAction,
  gateFollowOfMinor,
  loadMinorLookup,
  notifyGuardianOfPendingItem,
} from "../lib/coppa";

const router: IRouter = Router();

// B1 — resolve roster member counts for many teams in one grouped query
// (was a per-team count query inside Promise.all → N+1). Returns a map of
// teamId → count; teams with no roster rows are simply absent from the map
// (callers default to 0).
async function memberCountByTeam(
  teamIds: string[],
): Promise<Map<string, number>> {
  if (teamIds.length === 0) return new Map();
  const rows = await db
    .select({
      teamId: rosterEntries.teamId,
      count: sql<number>`count(*)::int`,
    })
    .from(rosterEntries)
    .where(inArray(rosterEntries.teamId, teamIds))
    .groupBy(rosterEntries.teamId);
  return new Map(rows.map((r) => [r.teamId, r.count]));
}

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
    // Only surface claimed orgs in the public discover list. Bulk-imported
    // pages start ownerless (createdById null, no owner admin row); they are
    // reachable by their secret /claim/<token> link but should not appear in
    // the browsable Organizations list until someone claims them.
    const ownedOrgIds = db
      .select({ id: organizationAdmins.organizationId })
      .from(organizationAdmins)
      .where(eq(organizationAdmins.role, "owner"));
    const rows = await db
      .select()
      .from(organizations)
      .where(inArray(organizations.id, ownedOrgIds))
      .limit(50);
    // Session-aware flags so the client can group "yours" vs "discover":
    // membership/role from org admin rows, isFollowing from follower rows.
    const me = _req.sessionUser;
    let roleByOrg = new Map<string, "owner" | "admin" | "member">();
    let followedOrgIds = new Set<string>();
    if (me && rows.length > 0) {
      const orgIds = rows.map((o) => o.id);
      const [adminRows, followRows] = await Promise.all([
        db
          .select({
            organizationId: organizationAdmins.organizationId,
            role: organizationAdmins.role,
          })
          .from(organizationAdmins)
          .where(
            and(
              eq(organizationAdmins.userId, me.id),
              inArray(organizationAdmins.organizationId, orgIds),
            ),
          ),
        db
          .select({ organizationId: organizationFollowers.organizationId })
          .from(organizationFollowers)
          .where(
            and(
              eq(organizationFollowers.userId, me.id),
              inArray(organizationFollowers.organizationId, orgIds),
            ),
          ),
      ]);
      roleByOrg = new Map(
        adminRows.map((r) => [
          r.organizationId,
          r.role as "owner" | "admin" | "member",
        ]),
      );
      followedOrgIds = new Set(followRows.map((r) => r.organizationId));
    }
    const data = rows.map((o) => {
      const role = roleByOrg.get(o.id) ?? null;
      return toOrganization(o, {
        isMember: role != null,
        role,
        isFollowing: followedOrgIds.has(o.id),
      });
    });
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
    const sport =
      typeof req.body?.sport === "string" && req.body.sport.trim()
        ? req.body.sport.trim()
        : null;
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
    // Brand colors at create time (same rules as the PATCH route: hex
    // string sets, null/empty clears). Extra fields beyond the locked
    // spec (recapKind precedent), so validation lives here.
    const CREATE_HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
    const brandColors: {
      brandPrimaryColor?: string;
      brandSecondaryColor?: string;
    } = {};
    for (const key of ["brandPrimaryColor", "brandSecondaryColor"] as const) {
      const value = req.body?.[key];
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "string") {
        return reject(400, key, `${key} must be a string or null`);
      }
      const trimmed = value.trim();
      if (trimmed === "") continue;
      if (!CREATE_HEX_COLOR_PATTERN.test(trimmed)) {
        return reject(400, key, `${key} must be a hex color like #1a2b3c`);
      }
      brandColors[key] = trimmed.toLowerCase();
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
           sport,
          description: req.body?.description ?? undefined,
          city,
          state: stateRaw,
          zipCode,
          website: websiteValue,
          logoUrl: req.body?.logoUrl ?? undefined,
          ...brandColors,
          createdById: me.id,
        })
        .returning();
      // The creator becomes the org's sole owner. The role column was
      // added in task #208; before that the table held only admins and
      // "owner" was implicit (first row in the admins table).
      //
      // EXCEPTION — platform admins setting up an org to hand off: they
      // must not be listed as owner/admin/follower anywhere. The org is
      // created UNCLAIMED (no owner row) and the real admin takes it over
      // via a claim link/request. Platform admins keep full management
      // powers through the canManageOrganization bypass, so no membership
      // row is needed.
      const creatorIsPlatformAdmin = await isPlatformAdmin(me.id);
      if (!creatorIsPlatformAdmin) {
        await db
          .insert(organizationAdmins)
          .values({ organizationId: org.id, userId: me.id, role: "owner" })
          .onConflictDoNothing();
        await db
          .insert(organizationFollowers)
          .values({ organizationId: org.id, userId: me.id })
          .onConflictDoNothing();
      }
      return res.status(201).json(
        creatorIsPlatformAdmin
          ? toOrganization(org, {
              isMember: false,
              role: null,
              isFollowing: false,
            })
          : toOrganization(org, {
              isMember: true,
              role: "owner",
              isFollowing: true,
            }),
      );
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
    // Task #603 — an org page is "claimable" when it has no owner row.
    // Bulk-imported pages start ownerless (createdById null, no admins).
    const [owner] = await db
      .select({ userId: organizationAdmins.userId })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, org.id),
          eq(organizationAdmins.role, "owner"),
        ),
      )
      .limit(1);
    const hasOwner = !!owner;
    let myClaimStatus: "pending" | "approved" | "declined" | null = null;
    if (me) {
      const [claim] = await db
        .select({ status: organizationClaimRequests.status })
        .from(organizationClaimRequests)
        .where(
          and(
            eq(organizationClaimRequests.organizationId, org.id),
            eq(organizationClaimRequests.requestedByUserId, me.id),
          ),
        )
        .orderBy(desc(organizationClaimRequests.createdAt))
        .limit(1);
      myClaimStatus = claim?.status ?? null;
    }
    res.json(
      toOrganization(org, {
        isMember,
        role,
        isFollowing,
        followerCount,
        hasOwner,
        myClaimStatus,
      }),
    );
  }),
);

// Task #603 — Claim a pre-made (ownerless) org page. A signed-in admin-role
// user submits a claim request; this is NOT an instant transfer. A platform
// admin reviews it under /admin/org-claims and the approval inserts the owner
// row. Eligibility mirrors the task spec: only admin-role accounts can claim.
// Hand-written validation + customFetch precedent (Founding-100 / AI Assist) —
// the locked openapi.yaml has no path for this route.
const orgClaimLimiter = rateLimit({
  name: "org-claim",
  windowMs: 60_000,
  max: 10,
  keys: (req) => [ipKey(req)],
});
// Claiming an org page is invite-only: the owner sends a secret claim-link
// (/app/claim/<token>, handled below) directly to the intended admin. The open
// "request a claim → platform admin reviews" flow is retired so random users
// can't claim arbitrary org pages. This route is kept (not deleted) so old
// clients get a clear 403 instead of a confusing 404; existing pending claim
// rows stay reviewable in the admin queue.
router.post(
  "/organizations/:orgId/claims",
  orgClaimLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    return apiError(
      res,
      403,
      "Organizations can only be claimed via an invite link.",
      { code: "CLAIM_INVITE_ONLY" },
    );
  }),
);

// Task #610 — Secret claim-invite links for ownerless (bulk-imported) org
// pages. Unlike the public claim-request flow above (admin submits → platform
// admin reviews), possessing the secret token IS the authorization: opening
// the link and signing up makes the recipient the owner directly, bypassing
// both the admin-role gate and the review step. The link is single-purpose —
// once the org has an owner it refuses to transfer ownership (it shows an
// "already claimed" state). Hand-written validation + customFetch precedent.
const orgClaimLinkLimiter = rateLimit({
  name: "org-claim-link",
  windowMs: 60_000,
  max: 30,
  keys: (req) => [ipKey(req)],
});

// Public — resolve a secret token to its org so the landing/signup page can
// render the target org and the "already claimed" state. Never leaks the
// token itself or any other secret field.
router.get(
  "/org-claim-links/:token",
  orgClaimLinkLimiter,
  asyncHandler(async (req, res) => {
    const token = String(req.params.token ?? "");
    if (!token) return notFound(res);
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.claimToken, token))
      .limit(1);
    if (!org) return notFound(res);
    const [owner] = await db
      .select({ userId: organizationAdmins.userId })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, org.id),
          eq(organizationAdmins.role, "owner"),
        ),
      )
      .limit(1);
    // Staged promo (admin quick setup) — show the claimer their org already
    // has a discount applied. Only surfaced while the code is still
    // redeemable; never leaks anything beyond the public promo fields.
    let promo: {
      code: string;
      description: string | null;
      discountType: string;
      discountValue: number;
    } | null = null;
    if (org.pendingPromoCodeId) {
      const [p] = await db
        .select()
        .from(promoCodes)
        .where(eq(promoCodes.id, org.pendingPromoCodeId))
        .limit(1);
      if (
        p &&
        p.active &&
        (!p.expiresAt || p.expiresAt.getTime() > Date.now()) &&
        (p.maxRedemptions == null || p.redemptionCount < p.maxRedemptions)
      ) {
        promo = {
          code: p.code,
          description: p.description,
          discountType: p.discountType,
          discountValue: p.discountValue,
        };
      }
    }
    res.json({
      organization: {
        id: org.id,
        name: org.name,
        city: org.city,
        state: org.state,
        logoUrl: org.logoUrl,
      },
      alreadyClaimed: !!owner,
      promo,
      // Task #856 — plan tier staged by the platform admin at creation.
      // Pre-selected on the subscribe page after claiming; label-only here.
      pendingPlan: org.pendingPlan ?? null,
    });
  }),
);

// Auth — finalize the claim for the signed-in user. Race-safe transaction:
// insert the owner `organization_admins` row + auto-follow + stamp
// `createdById`, refusing if an owner already exists. The
// `organization_admins_one_owner_per_org` partial unique index is the
// backstop against two concurrent finalizes both passing the owner pre-check.
router.post(
  "/org-claim-links/:token/claim",
  orgClaimLinkLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const token = String(req.params.token ?? "");
    if (!token) return notFound(res);
    const [org] = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.claimToken, token))
      .limit(1);
    if (!org) return notFound(res);
    try {
      const result = await db.transaction(async (tx) => {
        const [owner] = await tx
          .select({ userId: organizationAdmins.userId })
          .from(organizationAdmins)
          .where(
            and(
              eq(organizationAdmins.organizationId, org.id),
              eq(organizationAdmins.role, "owner"),
            ),
          )
          .limit(1);
        if (owner) return { ok: false as const };
        await tx.insert(organizationAdmins).values({
          organizationId: org.id,
          userId: me.id,
          role: "owner",
        });
        await tx
          .insert(organizationFollowers)
          .values({ organizationId: org.id, userId: me.id })
          .onConflictDoNothing();
        // Task #929 — lists only apply to ownerless orgs on the admin Org
        // Links screen; clear adminListId in the same transaction as the
        // ownership grant so a claimed org can never keep stale list
        // membership the admin view has no way to show or fix.
        await tx
          .update(organizations)
          .set({ createdById: me.id, adminListId: null })
          .where(eq(organizations.id, org.id));
        return { ok: true as const };
      });
      if (!result.ok) {
        return apiError(res, 409, "This organization has already been claimed", {
          code: "ALREADY_CLAIMED",
        });
      }
      res.status(201).json({ ok: true, organizationId: org.id });
    } catch (err) {
      // A true race trips the one-owner-per-org unique index; surface the
      // same "already claimed" state rather than a 500.
      const msg = err instanceof Error ? err.message : "";
      if (/organization_admins_one_owner_per_org|duplicate key/i.test(msg)) {
        return apiError(res, 409, "This organization has already been claimed", {
          code: "ALREADY_CLAIMED",
        });
      }
      throw err;
    }
  }),
);

// ---------------------------------------------------------------------------
// Task #808 — Staged coach drafts. A platform admin setting up an unclaimed
// org can pre-stage coach emails per team. These are pure drafts: no email,
// notification, roster entry, or roster_invite exists until the post-claim
// owner reviews and confirms (the client then fans out to the normal
// POST /teams/:teamId/invites and clears the drafts). All three endpoints are
// gated on canManageOrganization, which platform admins and the (post-claim)
// owner both pass.
// ---------------------------------------------------------------------------

const STAGED_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STAGED_COACH_MAX_PER_ORG = 500;

// Multi-team coach invitations deliberately live outside the locked OpenAPI
// surface. Each child row remains a normal roster_invite, which keeps every
// team's pending-invite list and per-team withdrawal behavior intact while the
// envelope below supplies one secure token and one email for the recipient.
router.post(
  "/organizations/:orgId/coach-invites",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const orgId = req.params.orgId as string;
    if (!(await canManageOrganization(me.id, orgId))) {
      return apiError(res, 403, "Forbidden");
    }

    const rawAssignments =
      req.body?.assignments ?? req.body?.invites ?? req.body?.entries;
    if (!Array.isArray(rawAssignments) || rawAssignments.length === 0) {
      return apiError(res, 400, "assignments array required");
    }
    if (rawAssignments.length > STAGED_COACH_MAX_PER_ORG) {
      return apiError(
        res,
        400,
        `Too many coach assignments (max ${STAGED_COACH_MAX_PER_ORG})`,
      );
    }

    const assignments: Array<{ teamId: string; email: string }> = [];
    const seen = new Set<string>();
    for (const raw of rawAssignments) {
      const teamId = String(raw?.teamId ?? "");
      const email = String(raw?.email ?? "").trim().toLowerCase();
      if (!teamId || !STAGED_EMAIL_RE.test(email)) {
        return apiError(res, 400, "Every assignment needs a valid teamId and email");
      }
      const key = `${teamId}:${email}`;
      if (!seen.has(key)) {
        seen.add(key);
        assignments.push({ teamId, email });
      }
    }

    const teamIds = Array.from(new Set(assignments.map((a) => a.teamId)));
    const activeTeams = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(
        and(
          eq(teams.organizationId, orgId),
          inArray(teams.id, teamIds),
          isNull(teams.archivedAt),
        ),
      );
    const teamById = new Map(activeTeams.map((team) => [team.id, team]));
    if (teamById.size !== teamIds.length) {
      return apiError(
        res,
        400,
        "Every assigned team must be active and belong to this organization",
      );
    }
    const [organization] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!organization) return notFound(res);

    const byEmail = new Map<string, Array<{ teamId: string; email: string }>>();
    for (const assignment of assignments) {
      const group = byEmail.get(assignment.email) ?? [];
      group.push(assignment);
      byEmail.set(assignment.email, group);
    }

    const actorName = me.isMinor ? maskedDisplayName(me) : displayName(me);
    const outcomes: Array<{
      email: string;
      teamIds: string[];
      teamNames: string[];
      emailSent: boolean | null;
      notified: boolean;
      acceptUrl?: string;
      groupId?: string;
    }> = [];

    for (const [email, groupedAssignments] of byEmail) {
      const groupTeamIds = groupedAssignments.map((a) => a.teamId);
      const groupTeamNames = groupTeamIds.map((id) => teamById.get(id)!.name);
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser) {
        // Preserve the existing-account path: each team gets its familiar
        // pending row + in-app roster notification, but the browser only made
        // one manager action for the whole email group.
        const notificationRows: Array<{ teamId: string; entryId: string }> = [];
        await db.transaction(async (tx) => {
          for (const assignment of groupedAssignments) {
            await tx.insert(rosterInvites).values({
              token: generateToken(),
              teamId: assignment.teamId,
              invitedEmail: email,
              role: "coach",
              position: null,
              invitedById: me.id,
            });
            const [existingEntry] = await tx
              .select()
              .from(rosterEntries)
              .where(
                and(
                  eq(rosterEntries.teamId, assignment.teamId),
                  eq(rosterEntries.userId, existingUser.id),
                ),
              )
              .limit(1);
            let entry = existingEntry;
            if (!entry || entry.status !== "accepted") {
              if (entry) {
                [entry] = await tx
                  .update(rosterEntries)
                  .set({
                    role: "coach",
                    status: "pending",
                    position: null,
                    invitedById: me.id,
                  })
                  .where(eq(rosterEntries.id, entry.id))
                  .returning();
              } else {
                [entry] = await tx
                  .insert(rosterEntries)
                  .values({
                    teamId: assignment.teamId,
                    userId: existingUser.id,
                    role: "coach",
                    status: "pending",
                    position: null,
                    invitedById: me.id,
                  })
                  .returning();
              }
            }
            if (entry) {
              notificationRows.push({ teamId: assignment.teamId, entryId: entry.id });
            }
          }
        });
        for (const row of notificationRows) {
          const team = teamById.get(row.teamId)!;
          await ensureOrgFollowedForTeam(existingUser.id, row.teamId);
          try {
            await ensureTeamFollowed(existingUser.id, row.teamId);
            for (const guardianId of await getActiveGuardianIds(existingUser.id)) {
              await ensureTeamFollowedAsGuardian(guardianId, row.teamId);
            }
          } catch (err) {
            req.log.warn(
              { err, userId: existingUser.id, teamId: row.teamId },
              "auto-follow on grouped coach invite failed",
            );
          }
          await db.insert(notifications).values({
            userId: existingUser.id,
            kind: "roster_invite",
            message: `${actorName} invited you to ${team.name}. Tap to accept or decline.`,
            link: `/teams/${row.teamId}?roster=1&entryId=${row.entryId}`,
            actorUserId: me.id,
          });
        }
        outcomes.push({
          email,
          teamIds: groupTeamIds,
          teamNames: groupTeamNames,
          emailSent: null,
          notified: true,
        });
        continue;
      }

      const token = generateToken();
      const [group] = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(coachInviteGroups)
          .values({
            organizationId: orgId,
            invitedEmail: email,
            role: "coach",
            tokenHash: hashToken(token),
            invitedById: me.id,
          })
          .returning();
        await tx.insert(rosterInvites).values(
          groupedAssignments.map((assignment) => ({
            token: generateToken(),
            teamId: assignment.teamId,
            invitedEmail: email,
            role: "coach" as const,
            position: null,
            invitedById: me.id,
            coachInviteGroupId: created.id,
          })),
        );
        return [created];
      });

      let emailSent = false;
      try {
        await sendMultiTeamStaffInviteEmail(email, {
          inviterName: actorName,
          organizationName: organization.name,
          teamNames: groupTeamNames,
          roleLabel: staffInviteRoleLabel("coach"),
          token,
          groupId: group.id,
        });
        emailSent = true;
        await db.transaction(async (tx) => {
          await tx
            .update(coachInviteGroups)
            .set({ deliveryStatus: "sent", updatedAt: new Date() })
            .where(eq(coachInviteGroups.id, group.id));
          await tx
            .update(rosterInvites)
            .set({ deliveryStatus: "sent" })
            .where(eq(rosterInvites.coachInviteGroupId, group.id));
        });
      } catch (err) {
        req.log.warn(
          { err, orgId, kind: "grouped_coach_invite" },
          "grouped coach invite email send failed",
        );
        await db.transaction(async (tx) => {
          await tx
            .update(coachInviteGroups)
            .set({
              // `unknown` is the persisted "not handed to a provider" state.
              // Keep it valid for the existing delivery enum while exposing a
              // concrete reason and the copy-link fallback in the response.
              deliveryStatus: "unknown",
              deliveryReason: "Unable to send invite email",
              updatedAt: new Date(),
            })
            .where(eq(coachInviteGroups.id, group.id));
          await tx
            .update(rosterInvites)
            .set({
              deliveryStatus: "unknown",
              deliveryReason: "Unable to send invite email",
            })
            .where(eq(rosterInvites.coachInviteGroupId, group.id));
        });
      }
      outcomes.push({
        email,
        teamIds: groupTeamIds,
        teamNames: groupTeamNames,
        emailSent,
        notified: false,
        acceptUrl: buildInviteAcceptUrl(token),
        groupId: group.id,
      });
    }

    return res.status(201).json({ data: outcomes });
  }),
);

router.get(
  "/organizations/:orgId/staged-coaches",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (!(await canManageOrganization(me.id, req.params.orgId))) {
      return apiError(res, 403, "Forbidden");
    }
    const rows = await db
      .select({
        id: stagedCoachInvites.id,
        teamId: stagedCoachInvites.teamId,
        email: stagedCoachInvites.email,
      })
      .from(stagedCoachInvites)
      .where(eq(stagedCoachInvites.organizationId, req.params.orgId))
      .orderBy(asc(stagedCoachInvites.createdAt));
    res.json({ data: rows });
  }),
);

router.put(
  "/organizations/:orgId/staged-coaches",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const orgId = req.params.orgId;
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org) return notFound(res);
    if (!(await canManageOrganization(me.id, orgId))) {
      return apiError(res, 403, "Forbidden");
    }
    const entriesRaw = req.body?.entries;
    if (!Array.isArray(entriesRaw)) {
      return apiError(res, 400, "entries array required");
    }
    // Validate every referenced team belongs to this org.
    const orgTeams = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.organizationId, orgId));
    const orgTeamIds = new Set(orgTeams.map((t) => t.id));
    const values: Array<{ organizationId: string; teamId: string; email: string; createdById: string }> = [];
    const seen = new Set<string>();
    for (const entry of entriesRaw) {
      const teamId = String(entry?.teamId ?? "");
      if (!orgTeamIds.has(teamId)) {
        return apiError(res, 400, "teamId does not belong to this organization");
      }
      const emailsRaw = entry?.emails;
      if (!Array.isArray(emailsRaw)) {
        return apiError(res, 400, "emails array required per entry");
      }
      for (const raw of emailsRaw) {
        const email = String(raw ?? "").trim().toLowerCase();
        if (!STAGED_EMAIL_RE.test(email)) {
          return apiError(res, 400, `Invalid email: ${String(raw ?? "")}`);
        }
        const key = `${teamId}:${email}`;
        if (seen.has(key)) continue;
        seen.add(key);
        values.push({ organizationId: orgId, teamId, email, createdById: me.id });
      }
    }
    if (values.length > STAGED_COACH_MAX_PER_ORG) {
      return apiError(res, 400, `Too many staged coaches (max ${STAGED_COACH_MAX_PER_ORG})`);
    }
    // Replace-all semantics: the client always sends the full picture for
    // the org, so a save can both add and remove drafts atomically.
    await db.transaction(async (tx) => {
      await tx
        .delete(stagedCoachInvites)
        .where(eq(stagedCoachInvites.organizationId, orgId));
      if (values.length > 0) {
        await tx.insert(stagedCoachInvites).values(values);
      }
    });
    res.json({ ok: true, count: values.length });
  }),
);

// Task #836 — per-entry removal. Staged coaches persist after handoff until
// the owner invites them or removes them one by one; only the explicit
// post-invite cleanup path (or a per-row remove) deletes rows.
router.delete(
  "/organizations/:orgId/staged-coaches/:entryId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (!(await canManageOrganization(me.id, req.params.orgId))) {
      return apiError(res, 403, "Forbidden");
    }
    const deleted = await db
      .delete(stagedCoachInvites)
      .where(
        and(
          eq(stagedCoachInvites.organizationId, req.params.orgId),
          eq(stagedCoachInvites.id, req.params.entryId),
        ),
      )
      .returning({ id: stagedCoachInvites.id });
    if (deleted.length === 0) return notFound(res);
    res.json({ ok: true });
  }),
);

router.delete(
  "/organizations/:orgId/staged-coaches",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (!(await canManageOrganization(me.id, req.params.orgId))) {
      return apiError(res, 403, "Forbidden");
    }
    await db
      .delete(stagedCoachInvites)
      .where(eq(stagedCoachInvites.organizationId, req.params.orgId));
    res.json({ ok: true });
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
    let selectedOrgSport: string | null | undefined;
    if (body.sport === null || body.sport === "") {
      selectedOrgSport = null;
      patch.sport = null;
    } else if (typeof body.sport === "string") {
      selectedOrgSport = body.sport.trim();
      if (!selectedOrgSport) {
        selectedOrgSport = null;
        patch.sport = null;
      } else {
        patch.sport = selectedOrgSport;
      }
    } else if (body.sport !== undefined) {
      return apiError(res, 400, "sport must be a string or null");
    }
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
      // Task #691 — org logos arrive inline as base64 `data:` URLs; reject
      // over-cap values with a friendly 413 instead of an opaque parser error.
      if (
        body.logoUrl.startsWith("data:") &&
        body.logoUrl.length > MAX_IMAGE_DATA_URL_LENGTH
      ) {
        return apiError(
          res,
          413,
          "That image is too large. Please choose a smaller photo.",
        );
      }
      patch.logoUrl = body.logoUrl === "" ? null : body.logoUrl;
    } else if (body.logoUrl === null) {
      patch.logoUrl = null;
    }
    // Task #733 — org brand colors. Each field is independently settable
    // (hex string) or clearable (null / empty string). Extra fields beyond
    // the locked spec (recapKind precedent), so validation lives here.
    const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
    for (const key of ["brandPrimaryColor", "brandSecondaryColor"] as const) {
      const value = body[key];
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") {
          patch[key] = null;
        } else if (!HEX_COLOR_PATTERN.test(trimmed)) {
          return apiError(
            res,
            400,
            `${key} must be a hex color like #1a2b3c`,
          );
        } else {
          patch[key] = trimmed.toLowerCase();
        }
      } else if (value === null) {
        patch[key] = null;
      } else if (value !== undefined) {
        return apiError(res, 400, `${key} must be a string or null`);
      }
    }
    // Task #801 — org-level "Require recap approval" toggle. Admin-only by
    // construction (the whole PATCH is behind canManageOrganization). Extra
    // field beyond the locked spec (recapKind precedent). Strict boolean so
    // a stray string like "false" can't silently enable the queue.
    if (body.requireRecapApproval !== undefined) {
      if (typeof body.requireRecapApproval !== "boolean") {
        return apiError(res, 400, "requireRecapApproval must be a boolean");
      }
      patch.requireRecapApproval = body.requireRecapApproval;
    }
    // Serialize with the caller's real role so the admin-only
    // `requireRecapApproval` field is present on the PATCH echo.
    const myRole = await getOrgRole(me.id, req.params.orgId);
    if (Object.keys(patch).length === 0) {
      return res.json(toOrganization(existing, { isMember: true, role: myRole }));
    }
    const [updated] = await db.transaction(async (tx) => {
      const rows = await tx
        .update(organizations)
        .set(patch)
        .where(eq(organizations.id, req.params.orgId))
        .returning();
      // A selected organization sport is authoritative for every team in
      // that organization. Clearing it deliberately does not erase team
      // labels, allowing schools and other multi-sport organizations to
      // manage each team's sport individually.
      if (selectedOrgSport) {
        await tx
          .update(teams)
          .set({ sport: selectedOrgSport })
          .where(eq(teams.organizationId, req.params.orgId));
      }
      return rows;
    });
    if (!updated) return notFound(res);
    res.json(toOrganization(updated, { isMember: true, role: myRole }));
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
      )
      .orderBy(sql`nullif(btrim(lower(${teams.name})), '') asc nulls last`);
    // B1 — resolve every team's member count in a single grouped query
    // instead of one count query per team (was N+1).
    const countByTeam = await memberCountByTeam(teamRows.map((t) => t.id));
    const data = teamRows.map((t) =>
      toTeam(t, org, { memberCount: countByTeam.get(t.id) ?? 0 }),
    );
    res.json(paginate(data));
  }),
);

// Task #835 — per-team coach status for the org's "Bulk add coach" dialog.
// Org managers only (owner/admin, plus the platform-admin bypass inside
// canManageOrganization). For every active (non-archived) team, reports
// whether it already has an accepted coach and whether a coach invite is
// still pending (either a pending email rosterInvite with the coach role or
// a pending coach rosterEntry from an existing-account invite), so admins
// don't double-invite. Extra endpoint outside the locked openapi.yaml —
// consumed via customFetch, mirroring the staged-coaches pattern.
router.get(
  "/organizations/:orgId/coach-status",
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
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.organizationId, org.id), isNull(teams.archivedAt)));
    const ids = teamRows.map((t) => t.id);
    const coachTeams = new Set<string>();
    const pendingTeams = new Set<string>();
    if (ids.length > 0) {
      const entryRows = await db
        .select({ teamId: rosterEntries.teamId, status: rosterEntries.status })
        .from(rosterEntries)
        .where(
          and(
            inArray(rosterEntries.teamId, ids),
            eq(rosterEntries.role, "coach"),
          ),
        );
      for (const e of entryRows) {
        if (e.status === "accepted") coachTeams.add(e.teamId);
        else if (e.status === "pending") pendingTeams.add(e.teamId);
      }
      const inviteRows = await db
        .select({ teamId: rosterInvites.teamId })
        .from(rosterInvites)
        .where(
          and(
            inArray(rosterInvites.teamId, ids),
            eq(rosterInvites.role, "coach"),
            eq(rosterInvites.status, "pending"),
            // The email-less shareable join link is also a pending coach-role
            // rosterInvite for some teams; only email invites count here.
            isNotNull(rosterInvites.invitedEmail),
          ),
        );
      for (const i of inviteRows) pendingTeams.add(i.teamId);
    }
    res.json({
      data: ids.map((id) => ({
        teamId: id,
        hasCoach: coachTeams.has(id),
        hasPendingCoachInvite: pendingTeams.has(id),
      })),
    });
  }),
);

// Task #895 — organization managers coordinate one manual roster-outreach
// message per active team. This intentionally lives outside the locked
// OpenAPI contract and is consumed with customFetch, like coach status.
router.get(
  "/organizations/:orgId/roster-outreach",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, req.params.orgId))
      .limit(1);
    if (!org) return notFound(res);
    if (!(await canManageOrganization(me.id, org.id))) {
      return apiError(res, 403, "Org owner or admin only");
    }

    const rows = await db
      .select({
        id: teams.id,
        name: teams.name,
        sport: teams.sport,
        season: teams.season,
        level: teams.level,
        gender: teams.gender,
        sentAt: organizationRosterOutreach.sentAt,
        sentById: users.id,
        sentByName: users.name,
      })
      .from(teams)
      .leftJoin(
        organizationRosterOutreach,
        and(
          eq(organizationRosterOutreach.organizationId, org.id),
          eq(organizationRosterOutreach.teamId, teams.id),
        ),
      )
      .leftJoin(users, eq(users.id, organizationRosterOutreach.sentByUserId))
      .where(and(eq(teams.organizationId, org.id), isNull(teams.archivedAt)))
      .orderBy(sql`nullif(btrim(lower(${teams.name})), '') asc nulls last`);

    res.json({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        sport: row.sport,
        season: row.season,
        level: row.level,
        gender: row.gender,
        sentAt: row.sentAt?.toISOString() ?? null,
        sentBy: row.sentById && row.sentByName
          ? { id: row.sentById, displayName: row.sentByName }
          : null,
      })),
    });
  }),
);

router.post(
  "/organizations/:orgId/roster-outreach/:teamId/message",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, req.params.orgId))
      .limit(1);
    if (!org) return notFound(res);
    if (!(await canManageOrganization(me.id, org.id))) {
      return apiError(res, 403, "Org owner or admin only");
    }
    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(
        and(
          eq(teams.id, req.params.teamId),
          eq(teams.organizationId, org.id),
          isNull(teams.archivedAt),
        ),
      )
      .limit(1);
    if (!team) return notFound(res);

    const { token } = await getOrCreateTeamJoinLink(team.id, me.id);
    const joinLink = buildInviteAcceptUrl(token);
    res.json({
      teamId: team.id,
      joinLink,
      message: buildCoachInviteText({
        coachName: displayName(me),
        link: joinLink,
      }),
    });
  }),
);

router.patch(
  "/organizations/:orgId/roster-outreach/:teamId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (typeof req.body?.sent !== "boolean") {
      return apiError(res, 400, "sent must be a boolean");
    }
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, req.params.orgId))
      .limit(1);
    if (!org) return notFound(res);
    if (!(await canManageOrganization(me.id, org.id))) {
      return apiError(res, 403, "Org owner or admin only");
    }
    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(
        and(
          eq(teams.id, req.params.teamId),
          eq(teams.organizationId, org.id),
          isNull(teams.archivedAt),
        ),
      )
      .limit(1);
    if (!team) return notFound(res);

    const now = new Date();
    const sentAt = req.body.sent ? now : null;
    const sentByUserId = req.body.sent ? me.id : null;
    const [outreach] = await db
      .insert(organizationRosterOutreach)
      .values({
        organizationId: org.id,
        teamId: team.id,
        sentAt,
        sentByUserId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          organizationRosterOutreach.organizationId,
          organizationRosterOutreach.teamId,
        ],
        set: { sentAt, sentByUserId, updatedAt: now },
      })
      .returning();

    res.json({
      teamId: team.id,
      sentAt: outreach.sentAt?.toISOString() ?? null,
      sentBy: outreach.sentByUserId
        ? { id: outreach.sentByUserId, displayName: displayName(me) }
        : null,
    });
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
    // B1 — single grouped member-count query (was N+1).
    const countByTeam = await memberCountByTeam(teamRows.map((t) => t.id));
    const data = teamRows.map((t) =>
      toTeam(t, org, { memberCount: countByTeam.get(t.id) ?? 0 }),
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
    // Task #633 — the deferred `team_recap` email fan-out for a player/parent
    // upload, fired now that staff has approved it (staff uploads already
    // fanned out at creation time). Routed through the dispatch gate
    // (preferences, no-login unsubscribe, minor->guardian).
    await notifyTeamFollowersOfNewHighlight({
      teamId,
      teamName: team.name,
      highlightId: h.id,
      highlightTitle: h.title,
      actorName: uploader
        ? uploader.isMinor
          ? maskedDisplayName(uploader)
          : displayName(uploader)
        : "Someone",
      actorUserId: h.uploaderId ?? null,
    });
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
    // Task #782 — honor the spec's cursor/limit params so recaps older
    // than one page stay reachable on the team page.
    const pageLimit = parsePostLimit(req.query["limit"]);
    const pageCursor = decodePostCursor(req.query["cursor"]);
    const fetchCap = pageLimit + 1;
    const rows = await db
      .select({ a: articles, team: teams, org: organizations, author: users })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      // Independent / tournament temp teams have no parent org — a
      // leftJoin keeps their recaps on the team page instead of
      // silently dropping every post.
      .leftJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(
        and(
          eq(articles.status, "published"),
          or(isNull(articles.articleKind), eq(articles.articleKind, "recap")),
          eq(articles.teamId, req.params.teamId),
          // Soft-deleted recaps must not be served to the team page —
          // matches the home/profile feed behavior so a deleted
          // article disappears for everyone (author, teammates,
          // anonymous viewers) instead of lingering as a "ghost".
          isNull(articles.hiddenAt),
          ...(pageCursor ? [lte(articles.createdAt, pageCursor.ts)] : []),
        ),
      )
      .orderBy(desc(articles.createdAt))
      .limit(fetchCap);
    const hRows = await db
      .select({ h: highlights, team: teams, org: organizations, author: users })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .leftJoin(organizations, eq(teams.organizationId, organizations.id))
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
          ...(pageCursor ? [lte(highlights.createdAt, pageCursor.ts)] : []),
        ),
      )
      .orderBy(desc(highlights.createdAt))
      .limit(fetchCap);
    // "In the News" — newspaper-article links attached to this team.
    // Task #867 — news cards are full interaction targets now, so they
    // join the stat batching below.
    const nRows = await db
      .select({ n: teamNewsLinks, team: teams, org: organizations, author: users })
      .from(teamNewsLinks)
      .innerJoin(teams, eq(teamNewsLinks.teamId, teams.id))
      .leftJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(teamNewsLinks.addedByUserId, users.id))
      .where(
        and(
          eq(teamNewsLinks.teamId, req.params.teamId),
          ...(pageCursor ? [lte(teamNewsLinks.createdAt, pageCursor.ts)] : []),
        ),
      )
      .orderBy(desc(teamNewsLinks.createdAt))
      .limit(fetchCap);
    // Managers see a Remove item on news cards; one check covers the
    // whole page since every news row belongs to this team.
    const canManageNews =
      nRows.length > 0 && !!me
        ? await canManageTeam(me.id, nRows[0].team)
        : false;

    const teamPostsStatKeys = [
      ...rows.map((r) => ({ kind: "article" as const, refId: r.a.id })),
      ...hRows.map((r) => ({ kind: "highlight" as const, refId: r.h.id })),
      ...nRows.map((r) => ({ kind: "news" as const, refId: r.n.id })),
    ];
    const [stats, shareStats, canEditMap, authorRoleMap, highlightTagViews, currentUserTags] =
      await Promise.all([
        loadPostStats(me?.id ?? null, teamPostsStatKeys),
        loadPostShareStats(me?.id ?? null, teamPostsStatKeys),
        computeArticleCanEditMap(
          me?.id ?? null,
          rows.map((r) => ({
            articleId: r.a.id,
            authorId: r.a.authorId,
            orgId: r.org?.id ?? null,
          })),
        ),
        computeArticleAuthorRoleMap(
          rows.map((r) => ({
            articleId: r.a.id,
            authorId: r.a.authorId,
            teamId: r.team.id,
            orgId: r.org?.id ?? null,
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

    const teamPostsBrandMap = await loadCompetitionBrandMap(
      rows.map((r) => r.a.competitionId),
    );
    const articleData = rows.map((r) =>
      articleToPost(r.a, {
        team: r.team,
        org: r.org,
        author: r.author,
        competition:
          teamPostsBrandMap.get(r.a.competitionId ?? "") ?? null,
        canEdit: canEditMap.get(r.a.id) ?? false,
        authorRole: authorRoleMap.get(r.a.id) ?? null,
        ...statsFor(stats, "article", r.a.id),
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
        ...statsFor(stats, "highlight", r.h.id),
        ...shareStatsFor(shareStats, "highlight", r.h.id),
        taggedUsers: maskedHighlightTagViews.get(r.h.id) ?? [],
        currentUserTag:
          currentUserTags.highlightTagByHighlightId.get(r.h.id) ?? null,
        minorNameCtx: teamPostsMinorCtx,
      });
    });
    const newsData = nRows.map((r) =>
      newsLinkToPost(r.n, {
        team: r.team,
        org: r.org,
        author: r.author,
        canEdit: canManageNews,
        canDelete: canManageNews,
        ...statsFor(stats, "news", r.n.id),
        ...shareStatsFor(shareStats, "news", r.n.id),
      }),
    );
    const merged = [...articleData, ...highlightData, ...newsData].sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.id < b.id
          ? 1
          : -1
        : a.createdAt < b.createdAt
          ? 1
          : -1,
    );
    res.json(
      pagePosts(merged, {
        cursor: pageCursor,
        limit: pageLimit,
        sourcesMayHaveMore:
          rows.length >= fetchCap ||
          hRows.length >= fetchCap ||
          nRows.length >= fetchCap,
      }),
    );
  }),
);

// "In the News" — a coach/manager pastes a newspaper article's URL; we
// fetch the page once, extract headline/source/image, and store it as a
// read-only news card on the team page + followers' feeds.
router.post(
  "/teams/:teamId/news",
  requireAuth,
  rateLimit({
    name: "team-news-add",
    windowMs: 60_000,
    max: 10,
    keyFn: ipKey,
  }),
  asyncHandler(async (req, res) => {
    const me = req.sessionUser!;
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, req.params.teamId))
      .limit(1);
    if (!team) return notFound(res);
    if (!(await canManageTeam(me.id, team))) {
      return apiError(res, 403, "Only team managers can add news articles.");
    }
    const rawUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!rawUrl) return apiError(res, 400, "Paste the article's link.");
    const gameDate = normalizeNewsGameDate(req.body?.gameDate);
    if (gameDate === "invalid") {
      return apiError(res, 400, "gameDate must be a valid date (YYYY-MM-DD).");
    }
    let meta;
    try {
      meta = await fetchNewsMetadata(rawUrl);
    } catch (err) {
      if (err instanceof NewsFetchError) {
        return apiError(res, 422, err.message);
      }
      throw err;
    }
    // Same link twice on one team = the earlier card, not a duplicate.
    const [existing] = await db
      .select({ id: teamNewsLinks.id })
      .from(teamNewsLinks)
      .where(
        and(eq(teamNewsLinks.teamId, team.id), eq(teamNewsLinks.url, meta.url)),
      )
      .limit(1);
    if (existing) {
      return apiError(res, 409, "That article is already on this team's page.");
    }
    let row;
    try {
      [row] = await db
        .insert(teamNewsLinks)
        .values({
          teamId: team.id,
          addedByUserId: me.id,
          url: meta.url,
          title: meta.title,
          sourceName: meta.sourceName,
          description: meta.description,
          imageUrl: meta.imageUrl,
           gameDate,
        })
        .returning();
    } catch (err) {
      // Unique (team_id, url) index — a concurrent add of the same link
      // lost the race; surface the same 409 as the pre-insert check.
      if ((err as { code?: string })?.code === "23505" || /23505/.test(String(err))) {
        return apiError(res, 409, "That article is already on this team's page.");
      }
      throw err;
    }
    const [org] = team.organizationId
      ? await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, team.organizationId))
          .limit(1)
      : [null];
    res.status(201).json(
      newsLinkToPost(row!, {
        team,
        org: org ?? null,
        author: me,
        canEdit: true,
        canDelete: true,
      }),
    );
  }),
);

router.patch(
  "/teams/:teamId/news/:newsId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser!;
    const teamId =
      typeof req.params.teamId === "string"
        ? req.params.teamId
        : req.params.teamId?.[0];
    const newsId =
      typeof req.params.newsId === "string"
        ? req.params.newsId
        : req.params.newsId?.[0];
    if (!teamId || !newsId) return notFound(res);
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) return notFound(res);
    if (!(await canManageTeam(me.id, team))) {
      return apiError(res, 403, "Only team managers can edit news articles.");
    }
    if (
      !req.body ||
      !Object.prototype.hasOwnProperty.call(req.body, "gameDate")
    ) {
      return apiError(res, 400, "gameDate is required.");
    }
    const gameDate = normalizeNewsGameDate(req.body.gameDate);
    if (gameDate === "invalid") {
      return apiError(res, 400, "gameDate must be a valid date (YYYY-MM-DD).");
    }
    const [existing] = await db
      .select({ news: teamNewsLinks, author: users })
      .from(teamNewsLinks)
      .leftJoin(users, eq(teamNewsLinks.addedByUserId, users.id))
      .where(
        and(
          eq(teamNewsLinks.id, newsId),
          eq(teamNewsLinks.teamId, team.id),
        ),
      )
      .limit(1);
    if (!existing) return notFound(res);
    const [updated] = await db
      .update(teamNewsLinks)
      .set({ gameDate })
      .where(
        and(
          eq(teamNewsLinks.id, newsId),
          eq(teamNewsLinks.teamId, team.id),
        ),
      )
      .returning();
    if (!updated) return notFound(res);
    const [org] = team.organizationId
      ? await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, team.organizationId))
          .limit(1)
      : [null];
    return res.json(
      newsLinkToPost(updated, {
        team,
        org: org ?? null,
        author: existing.author,
        canEdit: true,
        canDelete: true,
      }),
    );
  }),
);

router.delete(
  "/teams/:teamId/news/:newsId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser!;
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, req.params.teamId))
      .limit(1);
    if (!team) return notFound(res);
    if (!(await canManageTeam(me.id, team))) {
      return apiError(res, 403, "Only team managers can remove news articles.");
    }
    const deleted = await db
      .delete(teamNewsLinks)
      .where(
        and(
          eq(teamNewsLinks.id, req.params.newsId),
          eq(teamNewsLinks.teamId, team.id),
        ),
      )
      .returning({ id: teamNewsLinks.id });
    if (deleted.length === 0) return notFound(res);
    res.status(204).end();
  }),
);

router.get(
  "/organizations/:orgId/posts",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    const orgId = req.params.orgId;
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return notFound(res);

    // Task #785 — honor the spec's cursor/limit params so org-page
    // posts older than one page stay reachable (was a hard cap of 20).
    // Same loose-SQL-cursor + strict (ts,id) JS filter pattern as the
    // feed / team page: each source over-fetches to fetchCap with a
    // loose `createdAt <= cursor.ts` bound, then `pagePosts` applies
    // the strict cursor and slices the page.
    const pageLimit = parsePostLimit(req.query["limit"]);
    const pageCursor = decodePostCursor(req.query["cursor"]);
    const fetchCap = pageLimit + 1;
    // Articles serialize `createdAt` as publishedAt ?? createdAt, so the
    // SQL bound + order MUST use the same effective timestamp — bounding
    // on raw createdAt while sorting the page on publishedAt makes the
    // fetchCap truncate in a different order than the final sort and
    // pages go missing.
    const articleEffTs = sql`coalesce(${articles.publishedAt}, ${articles.createdAt})`;
    const [articleRows, orgPostRows, orgNewsRows] = await Promise.all([
      db
        .select({ a: articles, team: teams, org: organizations, author: users })
        .from(articles)
        .innerJoin(teams, eq(articles.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .leftJoin(users, eq(articles.authorId, users.id))
        .where(
          and(
            eq(articles.status, "published"),
            or(isNull(articles.articleKind), eq(articles.articleKind, "recap")),
            eq(organizations.id, orgId),
            // Recap deletion is a soft delete (`hiddenAt`). Every public
            // surface must exclude it; without this condition, the org page
            // could keep serving a recap after it disappeared from the feed,
            // team page, profile, post detail, schedule, and notifications.
            isNull(articles.hiddenAt),
            ...(pageCursor ? [sql`${articleEffTs} <= ${pageCursor.ts}`] : []),
          ),
        )
        .orderBy(desc(articleEffTs))
        .limit(fetchCap),
      db
        .select({ p: orgPosts, author: users })
        .from(orgPosts)
        .leftJoin(users, eq(orgPosts.authorId, users.id))
        .where(
          and(
            eq(orgPosts.organizationId, orgId),
            eq(orgPosts.status, "published"),
            isNull(orgPosts.hiddenAt),
            ...(pageCursor ? [lte(orgPosts.createdAt, pageCursor.ts)] : []),
          ),
        )
        .orderBy(desc(orgPosts.createdAt))
        .limit(fetchCap),
      // "In the News" links from any of the org's teams surface on the
      // org page too, same as team recaps.
      db
        .select({ n: teamNewsLinks, team: teams, org: organizations, author: users })
        .from(teamNewsLinks)
        .innerJoin(teams, eq(teamNewsLinks.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .leftJoin(users, eq(teamNewsLinks.addedByUserId, users.id))
        .where(
          and(
            eq(organizations.id, orgId),
            ...(pageCursor ? [lte(teamNewsLinks.createdAt, pageCursor.ts)] : []),
          ),
        )
        .orderBy(desc(teamNewsLinks.createdAt))
        .limit(fetchCap),
    ]);

    const [stats, shareStats, canEditMap, authorRoleMap, currentUserTags] = await Promise.all([
      loadPostStats(me?.id ?? null, [
        ...articleRows.map((r) => ({ kind: "article" as const, refId: r.a.id })),
        ...orgPostRows.map((r) => ({ kind: "org_post" as const, refId: r.p.id })),
        ...orgNewsRows.map((r) => ({ kind: "news" as const, refId: r.n.id })),
      ]),
      // Task #190 — Articles surface share state on org-page cards too
      // (org_post is non-shareable, so it stays at the default 0/false).
      // Task #867 — news posts are shareable and surface share state.
      loadPostShareStats(me?.id ?? null, [
        ...articleRows.map((r) => ({ kind: "article" as const, refId: r.a.id })),
        ...orgNewsRows.map((r) => ({ kind: "news" as const, refId: r.n.id })),
      ]),
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

    const orgPostsBrandMap = await loadCompetitionBrandMap(
      articleRows.map((r) => r.a.competitionId),
    );
    const data = [
      ...articleRows.map((r) =>
        articleToPost(r.a, {
          team: r.team,
          org: r.org,
          author: r.author,
          competition:
            orgPostsBrandMap.get(r.a.competitionId ?? "") ?? null,
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
      // News cards — the remove flag mirrors the DELETE route's
      // canManageTeam, which org admins always pass. (Team coaches can
      // still remove from the team page itself.)
      ...orgNewsRows.map((r) =>
        newsLinkToPost(r.n, {
          team: r.team,
          org: r.org,
          author: r.author,
          canEdit: isViewerOrgAdmin,
          canDelete: isViewerOrgAdmin,
          ...statsFor(stats, "news", r.n.id),
          ...shareStatsFor(shareStats, "news", r.n.id),
        }),
      ),
    ].sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.id < b.id
          ? 1
          : -1
        : a.createdAt < b.createdAt
          ? 1
          : -1,
    );
    res.json(
      pagePosts(data, {
        cursor: pageCursor,
        limit: pageLimit,
        sourcesMayHaveMore:
          articleRows.length >= fetchCap ||
          orgPostRows.length >= fetchCap ||
          orgNewsRows.length >= fetchCap,
      }),
    );
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

// ---------------------------------------------------------------------------
// Task #623 — Monthly AI recap newsletter.
//
// Two org-scoped, manage-gated endpoints power the "Create newsletter" flow:
//   GET  /organizations/:orgId/newsletter/recaps  — the date-filtered list of
//        published recaps to pick from (id, title, team, gameDate, score).
//   POST /organizations/:orgId/newsletter/generate — feed the selected recaps
//        into the existing AI Assist (Claude) engine and return a draft.
// Posting is NOT done here — the client submits the (edited) draft through the
// existing POST /organizations/:orgId/posts announcement path. The locked
// openapi.yaml has no entries for these routes, so they follow the same
// hand-written-validation + customFetch precedent used elsewhere (Founding-100,
// AI Assist, org claims/billing).
// ---------------------------------------------------------------------------

// Cap how many recaps can be stuffed into one prompt so an org with a huge
// back-catalog can't blow up the token budget / provider bill.
const NEWSLETTER_MAX_RECAPS = 25;

// Resolve the published recaps for an org's teams within an (inclusive) date
// window, keyed off the game date, falling back to the publish/create date for
// recaps that never recorded a game date. Optionally narrowed to a specific
// set of recap ids.
async function loadOrgNewsletterRecaps(
  orgId: string,
  startMs: number | null,
  endMs: number | null,
  recapIds: string[] | null,
): Promise<
  Array<{
    id: string;
    title: string;
    teamId: string;
    teamName: string;
    gameDate: Date | null;
    opponentName: string | null;
    teamScore: number | null;
    opponentScore: number | null;
    summary: string | null;
  }>
> {
  // coalesce(game_date, published_at, created_at) is the effective date we
  // filter and sort on.
  const effDate = sql<Date>`coalesce(${articles.gameDate}, ${articles.publishedAt}, ${articles.createdAt})`;
  const conds = [
    eq(teams.organizationId, orgId),
    eq(articles.status, "published"),
    or(isNull(articles.articleKind), eq(articles.articleKind, "recap")),
    isNull(articles.hiddenAt),
  ];
  if (startMs != null) conds.push(sql`${effDate} >= ${new Date(startMs)}`);
  if (endMs != null) conds.push(sql`${effDate} <= ${new Date(endMs)}`);
  if (recapIds != null) {
    if (recapIds.length === 0) return [];
    conds.push(inArray(articles.id, recapIds));
  }
  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      teamId: teams.id,
      teamName: teams.name,
      gameDate: articles.gameDate,
      opponentName: articles.opponentName,
      teamScore: articles.teamScore,
      opponentScore: articles.opponentScore,
      summary: articles.summary,
      publishedAt: articles.publishedAt,
      createdAt: articles.createdAt,
    })
    .from(articles)
    .innerJoin(teams, eq(articles.teamId, teams.id))
    .where(and(...conds))
    .orderBy(desc(effDate))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    teamId: r.teamId,
    teamName: r.teamName,
    gameDate: r.gameDate,
    opponentName: r.opponentName,
    teamScore: r.teamScore,
    opponentScore: r.opponentScore,
    summary: r.summary,
  }));
}

// Parse a `YYYY-MM-DD` (or any Date-parseable) string into epoch ms, or null.
// `endOfDay` pushes a bare date to 23:59:59.999 so the window is inclusive of
// the whole end day.
function parseDateParam(
  value: unknown,
  endOfDay = false,
): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    d.setHours(23, 59, 59, 999);
  }
  return d.getTime();
}

const newsletterLimiter = rateLimit({
  name: "org-newsletter",
  windowMs: 60_000,
  max: 20,
  keys: (req) => [req.sessionUser?.id ?? ipKey(req)],
  message:
    "You're generating newsletters too quickly. Please wait a moment and try again.",
});

router.get(
  "/organizations/:orgId/newsletter/recaps",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const orgId = req.params.orgId;
    if (!(await canManageOrganization(me.id, orgId))) {
      return apiError(res, 403, "Org admins only");
    }
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org) return notFound(res);
    const startMs = parseDateParam(req.query.start);
    const endMs = parseDateParam(req.query.end, true);
    const recaps = await loadOrgNewsletterRecaps(orgId, startMs, endMs, null);
    res.json({
      data: recaps.map((r) => ({
        id: r.id,
        title: r.title,
        teamId: r.teamId,
        teamName: r.teamName,
        gameDate: r.gameDate ? r.gameDate.toISOString() : null,
        opponentName: r.opponentName,
        teamScore: r.teamScore,
        opponentScore: r.opponentScore,
      })),
    });
  }),
);

router.post(
  "/organizations/:orgId/newsletter/generate",
  newsletterLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const orgId = req.params.orgId;
    if (!(await canManageOrganization(me.id, orgId))) {
      return apiError(res, 403, "Org admins only");
    }
    // Mirror the COPPA egress boundary on POST /ai/assist: only users who
    // can author recaps anywhere may push content to the third-party AI
    // provider. Org owner/admins always satisfy this, but the explicit
    // check keeps the guarantee local to the AI egress.
    if (!(await canAuthorRecapAnywhere(me.id))) {
      return apiError(res, 403, "You don't have permission to use AI Assist.", {
        code: "AI_FORBIDDEN",
      });
    }
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org) return notFound(res);

    const body = req.body ?? {};
    const startMs = parseDateParam(body.startDate);
    const endMs = parseDateParam(body.endDate, true);
    if (startMs != null && endMs != null && startMs > endMs) {
      return apiError(res, 400, "Start date must be before end date.", {
        code: "VALIDATION_FAILED",
      });
    }
    let recapIds: string[] | null = null;
    if (body.recapIds != null) {
      if (!Array.isArray(body.recapIds)) {
        return apiError(res, 400, "recapIds must be a list.", {
          code: "VALIDATION_FAILED",
        });
      }
      recapIds = Array.from(
        new Set(
          body.recapIds.filter(
            (x: unknown): x is string => typeof x === "string" && !!x,
          ),
        ),
      );
      if (recapIds.length === 0) {
        return apiError(res, 400, "Select at least one recap to include.", {
          code: "VALIDATION_FAILED",
        });
      }
    }

    const recaps = await loadOrgNewsletterRecaps(orgId, startMs, endMs, recapIds);
    if (recaps.length === 0) {
      return apiError(
        res,
        400,
        "No published recaps match your selection. Pick a wider date range or different recaps.",
        { code: "NEWSLETTER_EMPTY" },
      );
    }
    if (recaps.length > NEWSLETTER_MAX_RECAPS) {
      return apiError(
        res,
        400,
        `Too many recaps selected (${recaps.length}). Please narrow it down to ${NEWSLETTER_MAX_RECAPS} or fewer.`,
        { code: "NEWSLETTER_TOO_MANY" },
      );
    }

    const fmtDate = (d: Date | null) =>
      d ? d.toISOString().slice(0, 10) : null;
    const recapInputs: NewsletterRecapInput[] = recaps.map((r) => ({
      title: r.title,
      teamName: r.teamName,
      gameDate: fmtDate(r.gameDate),
      opponentName: r.opponentName,
      teamScore: r.teamScore,
      opponentScore: r.opponentScore,
      summary: r.summary,
    }));

    try {
      const text = await generateNewsletterText({
        orgName: org.name,
        startDate:
          typeof body.startDate === "string" && body.startDate.trim()
            ? body.startDate.trim()
            : null,
        endDate:
          typeof body.endDate === "string" && body.endDate.trim()
            ? body.endDate.trim()
            : null,
        recaps: recapInputs,
      });
      if (!text) {
        return apiError(
          res,
          502,
          "The AI returned an empty response. Please try again.",
          { code: "AI_EMPTY" },
        );
      }
      res.json({ text, recapCount: recaps.length });
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        return apiError(res, 503, err.message, { code: "AI_NOT_CONFIGURED" });
      }
      req.log.error({ err }, "Newsletter generation failed");
      apiError(
        res,
        502,
        "AI request failed. An admin may need to check the API key in admin settings.",
        { code: "AI_REQUEST_FAILED" },
      );
    }
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
  if (next === "published") {
    const taggerUserId = a.authorId ?? me.id;
    // Task #739 — @-mention tags were upserted at create/publish time,
    // but the "you were tagged" notify was deferred while the recap sat
    // in pending_approval. Re-run the idempotent upsert (covers body
    // edits made while pending) and notify EVERY mentioned player that
    // holds a tag row — not just the ones inserted by this call — since
    // none of them were pinged earlier. The 10-minute throttle inside
    // the notify helper dedupes any overlap.
    const mentionResult = await applyMentionTags({
      articleId: a.id,
      teamId: a.teamId,
      taggerUserId,
      body: a.body,
    });
    // Keep the in-memory article in sync when sanitization stripped
    // forged / non-roster tokens out of the persisted body.
    if (mentionResult.sanitizedBody !== null) {
      a.body = mentionResult.sanitizedBody;
    }
    // Combined recaps carry no gameDate but still fan out to the roster
    // (task #833).
    const fanoutTagged =
      a.gameDate || a.recapKind === "combined"
        ? await applyArticleTagFanout({
            articleId: a.id,
            teamId: a.teamId,
            taggerUserId,
            explicitUserIds: [],
            gameDate: a.gameDate,
            recapKind: a.recapKind,
          })
        : [];
    const notifyIds = Array.from(
      new Set([...mentionResult.mentioned, ...fanoutTagged]),
    );
    if (notifyIds.length > 0) {
      await notifyNewlyTaggedInRecap({
        userIds: notifyIds,
        articleId: a.id,
        articleTitle: a.title,
        actorUserId: taggerUserId,
      });
    }
    // Task #633 — the same recap engagement emails the direct-publish path
    // (posts.ts) fires, but deferred to here for recaps that were created as
    // pending_approval: a one-time first-recap milestone to the author, and an
    // opt-in `team_recap` fan-out to the team's followers. Both run through the
    // COPPA-aware dispatch gate. Recap-only (`gameDate` present).
    if (a.gameDate && a.authorId) {
      const [author] = await db
        .select({ name: users.name, isMinor: users.isMinor })
        .from(users)
        .where(eq(users.id, a.authorId))
        .limit(1);
      if (author) {
        const [{ count: publishedRecapCount }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(articles)
          .where(
            and(
              eq(articles.authorId, a.authorId),
              eq(articles.status, "published"),
              or(isNull(articles.articleKind), eq(articles.articleKind, "recap")),
              isNotNull(articles.gameDate),
            ),
          );
        if (publishedRecapCount === 1) {
          await dispatchNotificationEmail({
            userId: a.authorId,
            category: "motivational",
            build: (ctx) =>
              buildFirstRecapMilestoneEmail(ctx, {
                recapTitle: a.title,
                recapUrl: buildPostUrl(`/posts/${articlePostId(a.id)}`),
              }),
          });
        }
        await notifyTeamFollowersOfNewRecap({
          teamId: a.teamId,
          teamName: t.name,
          articleId: a.id,
          articleTitle: a.title,
          actorName: author.isMinor
            ? maskedDisplayName(author)
            : displayName(author),
          actorUserId: a.authorId,
        });
      }
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
      // Task #633 — mirror each follow bell into the gated `social_follow`
      // email. The dispatch gate checks the recipient's preferences, adds the
      // no-login unsubscribe link, and routes a minor's copy to their guardian.
      const followProfileUrl = buildPostUrl(`/users/${me.id}`);
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
        await dispatchNotificationEmail({
          userId: req.params.userId,
          // Suppress self-email if the followed user is a minor whose
          // guardian is the follower.
          excludeRecipientUserId: me.id,
          category: "social_follow",
          build: (ctx) =>
            buildFollowEmail(ctx, {
              actorName: displayName(me),
              profileUrl: followProfileUrl,
              requested: false,
            }),
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
        await dispatchNotificationEmail({
          userId: req.params.userId,
          excludeRecipientUserId: me.id,
          category: "social_follow",
          build: (ctx) =>
            buildFollowEmail(ctx, {
              actorName: displayName(me),
              profileUrl: `${appBaseUrl()}/follow-requests`,
              requested: true,
            }),
        });
      } else if (target.parentId) {
        // Task #755 — notify ALL active guardians, not just the primary.
        await notifyAllGuardiansOfPendingItem({
          childUserId: target.id,
          kind: "follow",
          message: `${displayName(me)} wants to follow your child`,
        });
        // Minor target: the gate routes this `social_follow` copy to the
        // linked guardian (the minor never receives engagement email).
        await dispatchNotificationEmail({
          userId: target.id,
          excludeRecipientUserId: me.id,
          category: "social_follow",
          build: (ctx) =>
            buildFollowEmail(ctx, {
              actorName: displayName(me),
              profileUrl: followProfileUrl,
              requested: true,
            }),
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
      // NOTE: drizzle renders \`\${table.column}\` UNQUALIFIED inside raw
      // sql\`\` templates, so joins between tables sharing column names
      // ("id", "status", ...) become ambiguous and the whole query 500s.
      // These subqueries must use literal table-qualified identifiers.
      rosterCount: sql<number>`(
        select count(*)::int from roster_entries re
        inner join teams t on t.id = re.team_id
        where t.organization_id = ${orgId}
          and t.archived_at is null
      )`,
      guardianLinkCount: sql<number>`(
        select count(*)::int from roster_entries re
        inner join teams t on t.id = re.team_id
        inner join users u on u.id = re.user_id
        where t.organization_id = ${orgId}
          and t.archived_at is null
          -- Task #755: linked = any ACTIVE guardian link, not just parentId
          and exists (
            select 1 from guardian_links gl
            where gl.child_id = u.id
              and gl.status = 'active'
          )
      )`,
      pendingRosterInviteCount: sql<number>`(
        select count(*)::int from roster_invites ri
        inner join teams t on t.id = ri.team_id
        where t.organization_id = ${orgId}
          and t.archived_at is null
          and ri.status = 'pending'
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
  // "Add players" and "Invite parents/guardians" are one logical step —
  // adding a player sends the roster invite to the guardian email. The
  // locked spec still requires both booleans in `steps`, but progress
  // counts treat them as a single merged step (done if either signal
  // fired).
  const logicalSteps = [
    steps.logoSet,
    steps.hasTeam,
    steps.hasStaffOrInvite,
    steps.hasCoAdmin,
    steps.hasRosterEntry || steps.hasGuardianLinkOrInvite,
  ];
  const completedCount = logicalSteps.filter(Boolean).length;
  const totalSteps = logicalSteps.length;
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
