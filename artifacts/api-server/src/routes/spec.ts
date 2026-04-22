import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  users,
  organizations,
  organizationAdmins,
  organizationFollowers,
  teams,
  rosterEntries,
  rosterInvites,
  articles,
  articleAuthors,
  articleTags,
  highlights,
  highlightTags,
  notifications,
} from "@workspace/db";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import {
  canCreateRecap,
  canManageOrganization,
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
  paginate,
  emptyPagination,
  splitName,
  parsePostId,
  articlePostId,
  highlightPostId,
} from "../lib/spec-helpers";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Auth (custom — not in spec)
// ---------------------------------------------------------------------------
const LoginBody = z.object({ userId: z.string().uuid() });
const SignupBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1).optional().default(""),
  role: z.enum(["athlete", "coach", "admin", "parent"]),
  email: z.string().email().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
});

router.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const body = LoginBody.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.id, body.userId)).limit(1);
    if (!user) return notFound(res);
    const sess = await createSession(user.id);
    setSessionCookie(res, sess.id, sess.expiresAt);
    res.json(toPrivateUser(user));
  }),
);

router.post(
  "/auth/signup",
  asyncHandler(async (req, res) => {
    const body = SignupBody.parse(req.body);
    const dob = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
    if (dob) {
      const ageYears = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (ageYears < 13 && !body.parentId) {
        res
          .status(400)
          .json({ error: "Players under 13 require a parent or guardian account." });
        return;
      }
    }
    if (body.email) {
      const [exists] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
      if (exists) {
        res.status(409).json({ error: "Email already in use" });
        return;
      }
    }
    const [created] = await db
      .insert(users)
      .values({
        name: `${body.firstName} ${body.lastName}`.trim(),
        role: body.role,
        email: body.email ?? undefined,
        dateOfBirth: dob ?? undefined,
        parentId: body.parentId ?? undefined,
      })
      .returning();
    const sess = await createSession(created.id);
    setSessionCookie(res, sess.id, sess.expiresAt);
    res.status(201).json(toPrivateUser(created));
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
    const rows = await db.select().from(users).orderBy(users.role, users.name).limit(100);
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

async function getOrFallbackUser(req: Request) {
  if (req.sessionUser) return req.sessionUser;
  const [fallback] = await db.select().from(users).where(eq(users.role, "athlete")).limit(1);
  return fallback ?? null;
}

router.get(
  "/users/me",
  asyncHandler(async (req, res) => {
    const u = await getOrFallbackUser(req);
    if (!u) return notFound(res);
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
          .where(or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)))
          .limit(40)
      : await db.select().from(users).limit(40);
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
    const me = await getOrFallbackUser(req);
    const isOwnProfile = me?.id === u.id;

    // Linked accounts (parent ↔ child) are sensitive on a youth-sports
    // product. Only show them to: the user themself, their linked parents
    // or children, or an org admin of an organization that the profile
    // user belongs to.
    let canSeeFamily = isOwnProfile;
    if (!canSeeFamily && me) {
      if (me.parentId === u.id || u.parentId === me.id) {
        canSeeFamily = true;
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
        if (sharedAdmin.length > 0) canSeeFamily = true;
      }
    }

    let linkedAccounts: { parents: unknown[]; children: unknown[] } | undefined;
    if (canSeeFamily) {
      const parentRows = u.parentId
        ? await db.select().from(users).where(eq(users.id, u.parentId)).limit(1)
        : [];
      const childRows = await db
        .select()
        .from(users)
        .where(eq(users.parentId, u.id));
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
      linkedAccounts = {
        parents: parentRows.map(toLinked),
        children: childRows.map(toLinked),
      };
    }

    const base = isOwnProfile
      ? toPrivateUser(u)
      : toPublicUser(u, { isOwnProfile: false, isFollowing: false });
    res.json({ ...base, linkedAccounts });
  }),
);

router.patch(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.params.userId))
      .limit(1);
    if (!existing) return notFound(res);
    const body = req.body ?? {};
    const updates: Partial<typeof users.$inferInsert> = {};
    if (body.firstName || body.lastName) {
      const cur = splitName(existing.name);
      updates.name = `${body.firstName ?? cur.firstName} ${body.lastName ?? cur.lastName}`.trim();
    }
    if (body.bio !== undefined) updates.bio = body.bio;
    const [updated] = Object.keys(updates).length
      ? await db.update(users).set(updates).where(eq(users.id, existing.id)).returning()
      : [existing];
    res.json(toPrivateUser(updated));
  }),
);

router.get(
  "/users/:userId/posts",
  asyncHandler(async (req, res) => {
    // Posts authored by user or where user is tagged. Simple: tagged.
    const [u] = await db.select().from(users).where(eq(users.id, req.params.userId)).limit(1);
    if (!u) return notFound(res);

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
      .where(and(eq(articles.authorId, u.id), eq(articles.status, "published")))
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
    const rows = await db
      .select({ r: rosterEntries, t: teams, org: organizations })
      .from(rosterEntries)
      .innerJoin(teams, eq(rosterEntries.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(eq(rosterEntries.userId, req.params.userId));
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
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const [org] = await db
      .insert(organizations)
      .values({
        name,
        description: req.body?.description ?? undefined,
        city: req.body?.city ?? undefined,
        state: req.body?.state ?? undefined,
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
    const me = await getOrFallbackUser(req);
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
    res.json(toOrganization(org, { isMember, role, isFollowing }));
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
    const teamIds = (
      await db.select({ id: teams.id }).from(teams).where(eq(teams.organizationId, req.params.orgId))
    ).map((t) => t.id);
    if (teamIds.length === 0) return res.json(paginate([]));
    const rows = await db
      .select({ a: articles, team: teams, org: organizations, author: users })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(and(eq(articles.status, "published"), eq(organizations.id, req.params.orgId)))
      .orderBy(desc(articles.createdAt))
      .limit(20);
    const data = rows.map((r) =>
      articleToPost(r.a, { team: r.team, org: r.org, author: r.author }),
    );
    res.json(paginate(data));
  }),
);

// Stub: org join requests, post approvals, follow, privacy
router.get("/organizations/:orgId/join-requests", (_req, res) => res.json(paginate([])));
router.post("/organizations/:orgId/join-requests/:id/approve", (_req, res) => res.json({ status: "approved" }));
router.post("/organizations/:orgId/join-requests/:id/decline", (_req, res) => res.json({ status: "declined" }));

router.get(
  "/organizations/:orgId/post-approvals",
  asyncHandler(async (req, res) => {
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const isAdmin = await canManageOrganization(me.id, req.params.orgId);
    if (!isAdmin) return res.status(403).json({ error: "Org admins only" });
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
  const me = await getOrFallbackUser(req);
  if (!me) return res.status(401).json({ error: "Not authenticated" });
  const isAdmin = await canManageOrganization(me.id, req.params.orgId);
  if (!isAdmin) return res.status(403).json({ error: "Org admins only" });
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
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
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
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    await db
      .delete(organizationFollowers)
      .where(
        and(
          eq(organizationFollowers.organizationId, req.params.orgId),
          eq(organizationFollowers.userId, me.id),
        ),
      );
    res.status(204).end();
  }),
);
router.get("/organizations/:orgId/privacy", (_req, res) =>
  res.json({ orgId: _req.params.orgId, settings: {} }),
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
    if (!name) return res.status(400).json({ error: "name required" });
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
    res.json(toTeam(t, org, { memberCount: count }));
  }),
);

router.patch(
  "/teams/:teamId",
  asyncHandler(async (req, res) => {
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "unauthorized" });
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
    if (!adminRow) return res.status(403).json({ error: "forbidden" });
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.sport === "string") patch.sport = body.sport;
    if (typeof body.level === "string") patch.level = body.level;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.logoUrl === "string") patch.logoUrl = body.logoUrl;
    if (typeof body.bannerUrl === "string") patch.bannerUrl = body.bannerUrl;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "no updatable fields" });
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
    const data = rows.map((r) => toTeamMember(r.r, r.u));
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
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const teamId = req.params.teamId;
    const userId = String(req.body?.userId ?? "");
    if (!userId) return res.status(400).json({ error: "userId required" });
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    if (!(await canManageTeam(me.id, t)))
      return res.status(403).json({ error: "Team coaches or org admins only" });
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
      await db.insert(notifications).values({
        userId,
        kind: "roster_invite",
        message: `${displayName(me)} added you to ${t.name}. Tap to accept or decline.`,
        link: `/teams/${teamId}`,
      });
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

router.post(
  "/teams/:teamId/members/:memberId/accept",
  asyncHandler(async (req, res) => {
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
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
    if (entry.userId !== me.id) return res.status(403).json({ error: "Forbidden" });
    const [updated] = await db
      .update(rosterEntries)
      .set({ status: "accepted" })
      .where(eq(rosterEntries.id, entry.id))
      .returning();
    res.json(toTeamMember(updated, me));
  }),
);

router.post(
  "/teams/:teamId/members/:memberId/decline",
  asyncHandler(async (req, res) => {
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
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
    if (entry.userId !== me.id) return res.status(403).json({ error: "Forbidden" });
    await db.delete(rosterEntries).where(eq(rosterEntries.id, entry.id));
    res.status(204).end();
  }),
);

// Email invite — creates a pending rosterInvite with a token.
router.post(
  "/teams/:teamId/invites",
  asyncHandler(async (req, res) => {
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const teamId = req.params.teamId;
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    if (!(await canManageTeam(me.id, t)))
      return res.status(403).json({ error: "Team coaches or org admins only" });
    const email = String(req.body?.email ?? "").trim();
    if (!email) return res.status(400).json({ error: "email required" });
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
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const [invite] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.token, req.params.token))
      .limit(1);
    if (!invite) return notFound(res);
    if (invite.status !== "pending")
      return res.status(409).json({ error: "Invite no longer pending" });

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
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const [invite] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.token, req.params.token))
      .limit(1);
    if (!invite) return notFound(res);
    if (invite.position !== "player") {
      return res
        .status(400)
        .json({ error: "Only player invites support adding children" });
    }
    const firstName = String(req.body?.firstName ?? "").trim();
    const lastName = String(req.body?.lastName ?? "").trim();
    if (!firstName || !lastName) {
      return res
        .status(400)
        .json({ error: "firstName and lastName required" });
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
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
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
    if (!adminRow) return res.status(403).json({ error: "Not a team admin" });
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

router.post("/teams/:teamId/follow", (_req, res) =>
  res.json({ followerId: "me", teamId: _req.params.teamId, createdAt: new Date().toISOString() }),
);
router.delete("/teams/:teamId/follow", (_req, res) => res.status(204).end());

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

router.get(
  "/feed",
  asyncHandler(async (_req, res) => {
    const arts = await db
      .select({ a: articles, team: teams, org: organizations, author: users })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(eq(articles.status, "published"))
      .orderBy(desc(articles.createdAt))
      .limit(10);
    const hls = await db
      .select({ h: highlights, team: teams, org: organizations, uploader: users })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(highlights.uploaderId, users.id))
      .orderBy(desc(highlights.createdAt))
      .limit(10);
    const items = [
      ...arts.map((r) =>
        articleToPost(r.a, { team: r.team, org: r.org, author: r.author }),
      ),
      ...hls.map((r) =>
        highlightToPost(r.h, { team: r.team, org: r.org, author: r.uploader }),
      ),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json(paginate(items));
  }),
);

router.get(
  "/posts/:postId",
  asyncHandler(async (req, res) => {
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
      if (row.a.status !== "published") {
        const me = await getOrFallbackUser(req);
        const isAuthor = !!me && row.a.authorId === me.id;
        const isOrgAdmin = !!me && (await canManageOrganization(me.id, row.org.id));
        if (!isAuthor && !isOrgAdmin) return notFound(res);
      }
      res.json(articleToPost(row.a, { team: row.team, org: row.org, author: row.author }));
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
    res.json(highlightToPost(row.h, { team: row.team, org: row.org, author: row.uploader }));
  }),
);

router.get("/posts/:postId/comments", (_req, res) => res.json(paginate([])));
router.post("/posts/:postId/comments", (req, res) => {
  res.status(201).json({
    id: `comment-${Date.now()}`,
    postId: req.params.postId,
    body: req.body?.body ?? "",
    author: { id: "me", displayName: "You", avatarUrl: null },
    reactionCount: 0,
    hasReacted: false,
    recentReactorName: null,
    createdAt: new Date().toISOString(),
  });
});
router.delete("/posts/:postId/comments/:commentId", (_req, res) => res.status(204).end());
router.post("/posts/:postId/reactions", (_req, res) => res.status(204).end());
router.delete("/posts/:postId/reactions", (_req, res) => res.status(204).end());
router.get("/posts/:postId/tags", (_req, res) => res.json({ data: [], pagination: emptyPagination() }));

router.post(
  "/posts",
  asyncHandler(async (req, res) => {
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
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
    if (!teamId) return res.status(400).json({ error: "no team context available" });
    if (body.postType === "long") {
      const isDraft = body.status === "draft";
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
      const [org] = team
        ? await db.select().from(organizations).where(eq(organizations.id, team.organizationId)).limit(1)
        : [null];
      if (!team || !org) return notFound(res);
      const allowed = await canCreateRecap(me.id, team);
      if (!allowed)
        return res
          .status(403)
          .json({ error: "Only admins, coaches, and authors can create game recaps" });
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
    const me = await getOrFallbackUser(req);
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
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
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
      return res.status(403).json({ error: "Not an author" });
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
      return res.status(400).json({ error: "no changes" });
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
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
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
      return res.status(403).json({ error: "Only the author can publish" });
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
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const parsed = parsePostId(req.params.postId);
    if (!parsed || parsed.kind !== "article") return notFound(res);
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, parsed.id))
      .limit(1);
    if (!a) return notFound(res);
    if (a.authorId !== me.id)
      return res.status(403).json({ error: "Only the author can add co-authors" });
    const userId = String(req.body?.userId ?? "");
    if (!userId) return res.status(400).json({ error: "userId required" });
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
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const parsed = parsePostId(req.params.postId);
    if (!parsed || parsed.kind !== "article") return notFound(res);
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, parsed.id))
      .limit(1);
    if (!a) return notFound(res);
    if (a.authorId !== me.id && me.id !== req.params.userId)
      return res.status(403).json({ error: "Forbidden" });
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
    const me = await getOrFallbackUser(req);
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
    const me = await getOrFallbackUser(req);
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
    const me = await getOrFallbackUser(req);
    if (!me) return res.json({ markedCount: 0 });
    const result = await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.userId, me.id), eq(notifications.read, false)))
      .returning({ id: notifications.id });
    res.json({ markedCount: result.length });
  }),
);

router.get("/notifications/email-preference", (_req, res) =>
  res.json({ emailOptOut: false }),
);
router.put("/notifications/email-preference", (req, res) =>
  res.json({ emailOptOut: !!req.body?.emailOptOut }),
);

// ---------------------------------------------------------------------------
// Conversations / Messages (stubs)
// ---------------------------------------------------------------------------

router.get("/conversations", (_req, res) => res.json(paginate([])));
router.get("/conversations/unread-count", (_req, res) => res.json({ unreadCount: 0 }));
router.post("/conversations", (req, res) => {
  res.status(201).json({
    id: `conv-${Date.now()}`,
    type: "direct",
    participant: { id: req.body?.recipientId, type: "user", displayName: "User", avatarUrl: null },
    unreadCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});
router.get("/conversations/:id", (req, res) => {
  res.json({
    id: req.params.id,
    type: "direct",
    participant: { id: "u", type: "user", displayName: "User", avatarUrl: null },
    unreadCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});
router.delete("/conversations/:id", (_req, res) => res.status(204).end());
router.get("/conversations/:id/messages", (_req, res) => res.json(paginate([])));
router.post("/conversations/:id/messages", (req, res) => {
  res.status(201).json({
    id: `msg-${Date.now()}`,
    senderId: "me",
    senderDisplayName: "You",
    senderAvatarUrl: null,
    body: req.body?.body ?? "",
    assets: [],
    createdAt: new Date().toISOString(),
  });
});
router.post("/conversations/:id/read", (_req, res) => res.status(204).end());

// ---------------------------------------------------------------------------
// Tags (pending) — stubs
// ---------------------------------------------------------------------------

router.get("/tags/pending", (_req, res) => res.json(paginate([])));
router.post("/tags/:tagId/approve", (req, res) =>
  res.json({ id: req.params.tagId, status: "approved" }),
);
router.post("/tags/:tagId/decline", (req, res) =>
  res.json({ id: req.params.tagId, status: "declined" }),
);

// ---------------------------------------------------------------------------
// Tag management (player-removable tags)
// ---------------------------------------------------------------------------

router.get(
  "/users/me/tags",
  asyncHandler(async (req, res) => {
    const me = await getOrFallbackUser(req);
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
      .where(eq(articleTags.userId, me.id))
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
      .where(eq(highlightTags.userId, me.id))
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
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const [t] = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.id, req.params.tagId))
      .limit(1);
    if (!t) return res.status(204).end();
    if (t.userId !== me.id)
      return res.status(403).json({ error: "Not your tag" });
    await db.delete(articleTags).where(eq(articleTags.id, t.id));
    res.status(204).end();
  }),
);

router.delete(
  "/highlight-tags/:tagId",
  asyncHandler(async (req, res) => {
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const [t] = await db
      .select()
      .from(highlightTags)
      .where(eq(highlightTags.id, req.params.tagId))
      .limit(1);
    if (!t) return res.status(204).end();
    if (t.userId !== me.id)
      return res.status(403).json({ error: "Not your tag" });
    await db.delete(highlightTags).where(eq(highlightTags.id, t.id));
    res.status(204).end();
  }),
);

router.delete("/tags/:tagId", (_req, res) => res.status(204).end());

router.patch(
  "/users/me/tag-consent",
  asyncHandler(async (req, res) => {
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
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

router.get(
  "/users/me/children",
  asyncHandler(async (req, res) => {
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.parentId, me.id));
    res.json({
      data: rows.map((u) => {
        const [first, ...rest] = u.name.split(" ");
        return {
          id: u.id,
          firstName: first ?? u.name,
          lastName: rest.join(" "),
          role: u.role,
          email: u.email ?? null,
          avatarUrl: u.avatarUrl ?? null,
          requireTagConsent: u.requireTagConsent,
        };
      }),
    });
  }),
);

router.post(
  "/users/me/children",
  asyncHandler(async (req, res) => {
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    if (me.role !== "parent") {
      return res
        .status(403)
        .json({ error: "Only parent accounts can link children" });
    }
    const childId = String(req.body?.childId ?? "").trim();
    if (!childId) return res.status(400).json({ error: "childId required" });
    const [child] = await db
      .select()
      .from(users)
      .where(eq(users.id, childId))
      .limit(1);
    if (!child) return res.status(404).json({ error: "User not found" });
    if (child.parentId && child.parentId !== me.id) {
      return res
        .status(409)
        .json({ error: "Already linked to another guardian" });
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

router.patch(
  "/users/me/children/:childId/visibility",
  asyncHandler(async (req, res) => {
    const me = await getOrFallbackUser(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    const [child] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.params.childId))
      .limit(1);
    if (!child || child.parentId !== me.id) {
      return res.status(404).json({ error: "Child not found" });
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
      db.select().from(users).where(ilike(users.name, `%${q}%`)).limit(10),
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
// Misc stubs (consent, guardians, assets, follows, privacy, phones, addresses)
// ---------------------------------------------------------------------------

router.get("/consent/status", (_req, res) => res.json({ status: "none" }));
router.post("/consent/requests", (_req, res) => res.status(201).json({ status: "pending" }));
router.get("/users/:userId/guardians", (_req, res) => res.json({ data: [] }));
router.get("/users/:userId/children", (_req, res) => res.json({ data: [] }));
router.post("/users/:userId/follow", (_req, res) => res.json({ followerId: "me", followingId: _req.params.userId, createdAt: new Date().toISOString() }));
router.delete("/users/:userId/follow", (_req, res) => res.status(204).end());
router.get("/users/:userId/followers", (_req, res) => res.json(paginate([])));
router.get("/users/:userId/following", (_req, res) => res.json(paginate([])));
router.get("/users/:userId/privacy", (_req, res) => res.json({ userId: _req.params.userId, settings: {} }));
router.get("/users/:userId/sports", (_req, res) => res.json({ sports: [] }));
router.post("/assets/upload", (_req, res) =>
  res.status(201).json({ assetId: `asset-${Date.now()}`, uploadUrl: "https://example.invalid", expiresIn: 600 }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notFound(res: Response) {
  return res.status(404).json({ error: "Not found" });
}

// Suppress unused warning for requireAuth (kept for future use)
void requireAuth;

export default router;
