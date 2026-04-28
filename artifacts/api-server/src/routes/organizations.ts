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
  articles,
  highlights,
  orgPosts,
  notifications,
  organizationJoinRequests,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import { sendGuardianConfirmationEmail, sendGuardianExpiredEmail, sendPasswordResetEmail } from "../lib/email";
import { canManageOrganization, getOrgRole } from "../lib/permissions";
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
  highlightToPost,
  orgPostToPost,
  paginate,
  parsePostId,
  toJoinRequest,
  apiError,
  notFound,
} from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostShareStats,
  shareStatsFor,
} from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap } from "../lib/article-tagging";

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
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const name = String(req.body?.name ?? "").trim();
    if (!name) return apiError(res, 400, "name required");
    const city = String(req.body?.city ?? "").trim();
    if (!city) return apiError(res, 400, "city required");
    const stateRaw = String(req.body?.state ?? "").trim().toUpperCase();
    if (!stateRaw) return apiError(res, 400, "state required");
    if (!US_STATE_CODES.has(stateRaw)) {
      return apiError(
        res,
        400,
        "state must be a 2-letter US state code (e.g. NJ)",
      );
    }
    const zipCode = String(req.body?.zipCode ?? "").trim();
    if (!zipCode) return apiError(res, 400, "zipCode required");
    if (!US_ZIP_PATTERN.test(zipCode)) {
      return apiError(
        res,
        400,
        "zipCode must be a US zip (5 digits or 5+4 like 12345-6789)",
      );
    }
    const [org] = await db
      .insert(organizations)
      .values({
        name,
        description: req.body?.description ?? undefined,
        city,
        state: stateRaw,
        zipCode,
        website: req.body?.website ?? undefined,
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
    if (typeof body.website === "string") patch.website = body.website;
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
      .where(and(eq(articles.status, "published"), eq(articles.teamId, req.params.teamId)))
      .orderBy(desc(articles.createdAt))
      .limit(20);
    const hRows = await db
      .select({ h: highlights, team: teams, org: organizations, author: users })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(highlights.uploaderId, users.id))
      .where(eq(highlights.teamId, req.params.teamId))
      .orderBy(desc(highlights.createdAt))
      .limit(20);

    const shareStats = await loadPostShareStats(me?.id ?? null, [
      ...rows.map((r) => ({ kind: "article" as const, refId: r.a.id })),
      ...hRows.map((r) => ({ kind: "highlight" as const, refId: r.h.id })),
    ]);

    const articleData = rows.map((r) =>
      articleToPost(r.a, {
        team: r.team,
        org: r.org,
        author: r.author,
        ...shareStatsFor(shareStats, "article", r.a.id),
      }),
    );
    const highlightData = hRows.map((r) =>
      highlightToPost(r.h, {
        team: r.team,
        org: r.org,
        author: r.author,
        ...shareStatsFor(shareStats, "highlight", r.h.id),
      }),
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
    // Task #190 — Articles surface share state on org-page cards too
    // (org_post is non-shareable, so it stays at the default 0/false).
    const shareStats = await loadPostShareStats(
      me?.id ?? null,
      articleRows.map((r) => ({ kind: "article" as const, refId: r.a.id })),
    );

    const data = [
      ...articleRows.map((r) =>
        articleToPost(r.a, {
          team: r.team,
          org: r.org,
          author: r.author,
          ...statsFor(stats, "article", r.a.id),
          ...shareStatsFor(shareStats, "article", r.a.id),
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
    const inserted = await db
      .insert(userFollowers)
      .values({ followingUserId: req.params.userId, followerUserId: me.id })
      .onConflictDoNothing()
      .returning({ followerUserId: userFollowers.followerUserId });
    // Bell-notify the followed user. Stamp `actorUserId` with the
    // follower so the family dashboard's Remove action can revoke
    // exactly this (follower → child) edge. Only insert when the
    // follow was actually new — re-following someone who already
    // follows them shouldn't re-ring the bell.
    if (inserted.length > 0) {
      await db.insert(notifications).values({
        userId: req.params.userId,
        kind: "follow",
        message: `${displayName(me)} started following you`,
        link: `/users/${me.id}`,
        actorUserId: me.id,
      });
    }
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

export default router;
