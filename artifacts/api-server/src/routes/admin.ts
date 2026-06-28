import { Router, type IRouter, type Response } from "express";
import {
  db,
  users,
  articles,
  highlights,
  orgPosts,
  postComments,
  contentReports,
  adminActivityLog,
  sessions,
  organizations,
  teams,
  messages,
  userFollowers,
  organizationFollowers,
  teamFollowers,
  takedownRequests,
  consentAuditLog,
  notifications,
  organizationAdmins,
  organizationClaimRequests,
  scheduleEvents,
  scheduleEventRsvps,
  announcements,
} from "@workspace/db";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { hashPassword, generateToken } from "../lib/passwords";
import { requireAdmin } from "../lib/auth";
import {
  splitName,
  toPrivateUser,
  paginate,
  safeAvatarUrl,
  MAX_AVATAR_DATA_URL_LENGTH,
} from "../lib/spec-helpers";

const router: IRouter = Router();
router.use(requireAdmin);

function notFound(res: Response, message = "Not found") {
  res.status(404).json({ error: message });
}

function p(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

async function logAdminAction(
  adminUserId: string,
  actionType:
    | "hide_content"
    | "unhide_content"
    | "delete_content"
    | "resolve_report"
    | "dismiss_report"
    | "create_user"
    | "update_user"
    | "soft_delete_user"
    | "restore_user"
    | "reset_password"
    | "masquerade_start"
    | "masquerade_stop",
  targetType: "user" | "article" | "highlight" | "org_post" | "comment" | "report" | null,
  targetId: string | null,
  metadata?: Record<string, unknown>,
) {
  await db.insert(adminActivityLog).values({
    adminUserId,
    actionType,
    targetType: targetType ?? undefined,
    targetId: targetId ?? undefined,
    metadata: metadata ? JSON.stringify(metadata) : undefined,
  });
}

const CONTENT_TABLES = {
  article: articles,
  highlight: highlights,
  org_post: orgPosts,
  comment: postComments,
} as const;
type ContentType = keyof typeof CONTENT_TABLES;

function isValidContentType(s: string): s is ContentType {
  return s === "article" || s === "highlight" || s === "org_post" || s === "comment";
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

router.get(
  "/analytics",
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sinceWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const since12Months = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const [
      [{ totalUsers }],
      roleBreakdown,
      [{ deletedUsers }],
      [{ totalOrgs }],
      [{ totalTeams }],
      [{ totalArticles }],
      [{ hiddenArticles }],
      [{ totalHighlights }],
      [{ hiddenHighlights }],
      [{ totalOrgPosts }],
      [{ totalComments }],
      [{ totalMessages }],
      [{ totalUserFollows }],
      [{ totalOrgFollows }],
      [{ totalTeamFollows }],
      [{ openReports }],
      newUsersByDay,
      newPostsByDay,
      newCommentsByDay,
      activeSessionsByDay,
      [{ activeUsers }],
      topFollowedOrgs,
      topFollowedUsers,
      topPostersThisWeek,
      writtenInOrgsByMonth,
      organicOrgsByMonth,
      orgsClaimedByMonth,
      newTeamsByMonth,
      gameRecapsByMonth,
    ] = await Promise.all([
      db.select({ totalUsers: sql<number>`count(*)::int` }).from(users).where(isNull(users.deletedAt)),
      db
        .select({ role: users.role, count: sql<number>`count(*)::int` })
        .from(users)
        .where(isNull(users.deletedAt))
        .groupBy(users.role),
      db.select({ deletedUsers: sql<number>`count(*)::int` }).from(users).where(isNotNull(users.deletedAt)),
      db.select({ totalOrgs: sql<number>`count(*)::int` }).from(organizations),
      db.select({ totalTeams: sql<number>`count(*)::int` }).from(teams),
      db.select({ totalArticles: sql<number>`count(*)::int` }).from(articles),
      db.select({ hiddenArticles: sql<number>`count(*)::int` }).from(articles).where(isNotNull(articles.hiddenAt)),
      db.select({ totalHighlights: sql<number>`count(*)::int` }).from(highlights),
      db
        .select({ hiddenHighlights: sql<number>`count(*)::int` })
        .from(highlights)
        .where(isNotNull(highlights.hiddenAt)),
      db.select({ totalOrgPosts: sql<number>`count(*)::int` }).from(orgPosts),
      db.select({ totalComments: sql<number>`count(*)::int` }).from(postComments),
      db.select({ totalMessages: sql<number>`count(*)::int` }).from(messages),
      db.select({ totalUserFollows: sql<number>`count(*)::int` }).from(userFollowers),
      db.select({ totalOrgFollows: sql<number>`count(*)::int` }).from(organizationFollowers),
      db.select({ totalTeamFollows: sql<number>`count(*)::int` }).from(teamFollowers),
      db
        .select({ openReports: sql<number>`count(*)::int` })
        .from(contentReports)
        .where(eq(contentReports.status, "open")),
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${users.createdAt}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(users)
        .where(gte(users.createdAt, since))
        .groupBy(sql`date_trunc('day', ${users.createdAt})`)
        .orderBy(sql`date_trunc('day', ${users.createdAt})`),
      db
        .execute(
          sql`
            SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                   count(*)::int AS count
            FROM (
              SELECT created_at FROM articles WHERE created_at >= ${since}
              UNION ALL
              SELECT created_at FROM highlights WHERE created_at >= ${since}
              UNION ALL
              SELECT created_at FROM org_posts WHERE created_at >= ${since}
            ) AS all_posts
            GROUP BY date_trunc('day', created_at)
            ORDER BY date_trunc('day', created_at)
          `,
        )
        .then((r) =>
          (r.rows as Array<{ day: string; count: number }>).map((row) => ({
            day: row.day,
            count: Number(row.count),
          })),
        ),
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${postComments.createdAt}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(postComments)
        .where(gte(postComments.createdAt, since))
        .groupBy(sql`date_trunc('day', ${postComments.createdAt})`)
        .orderBy(sql`date_trunc('day', ${postComments.createdAt})`),
      // Active sessions/day = distinct users with activity (lastSignInAt) on that day.
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${users.lastSignInAt}), 'YYYY-MM-DD')`,
          count: sql<number>`count(distinct ${users.id})::int`,
        })
        .from(users)
        .where(and(isNotNull(users.lastSignInAt), gte(users.lastSignInAt, since)))
        .groupBy(sql`date_trunc('day', ${users.lastSignInAt})`)
        .orderBy(sql`date_trunc('day', ${users.lastSignInAt})`),
      db
        .select({ activeUsers: sql<number>`count(*)::int` })
        .from(users)
        .where(and(isNull(users.deletedAt), gte(users.lastSignInAt, since))),
      db
        .select({
          orgId: organizationFollowers.organizationId,
          name: organizations.name,
          count: sql<number>`count(*)::int`,
        })
        .from(organizationFollowers)
        .leftJoin(organizations, eq(organizationFollowers.organizationId, organizations.id))
        .groupBy(organizationFollowers.organizationId, organizations.name)
        .orderBy(sql`count(*) desc`)
        .limit(10),
      db
        .select({
          userId: userFollowers.followingUserId,
          name: users.name,
          email: users.email,
          count: sql<number>`count(*)::int`,
        })
        .from(userFollowers)
        .leftJoin(users, eq(userFollowers.followingUserId, users.id))
        .where(isNull(users.deletedAt))
        .groupBy(userFollowers.followingUserId, users.name, users.email)
        .orderBy(sql`count(*) desc`)
        .limit(10),
      db
        .execute(
          sql`
            SELECT poster.user_id AS "userId",
                   u.name AS name,
                   u.email AS email,
                   count(*)::int AS count
            FROM (
              SELECT author_id AS user_id FROM articles
                WHERE author_id IS NOT NULL AND created_at >= ${sinceWeek}
              UNION ALL
              SELECT uploader_id AS user_id FROM highlights
                WHERE uploader_id IS NOT NULL AND created_at >= ${sinceWeek}
              UNION ALL
              SELECT author_id AS user_id FROM org_posts
                WHERE author_id IS NOT NULL AND created_at >= ${sinceWeek}
            ) AS poster
            LEFT JOIN users u ON u.id = poster.user_id
            GROUP BY poster.user_id, u.name, u.email
            ORDER BY count(*) DESC
            LIMIT 10
          `,
        )
        .then((r) =>
          (r.rows as Array<{
            userId: string;
            name: string | null;
            email: string | null;
            count: number;
          }>).map((row) => ({
            userId: row.userId,
            name: row.name,
            email: row.email,
            count: Number(row.count),
          })),
        ),
      // Operator-seeded ("written in") orgs: bulk-imported pages carry a claim
      // token; organic orgs (created by a real user) never get one.
      db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${organizations.createdAt}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(organizations)
        .where(and(isNotNull(organizations.claimToken), gte(organizations.createdAt, since12Months)))
        .groupBy(sql`date_trunc('month', ${organizations.createdAt})`)
        .orderBy(sql`date_trunc('month', ${organizations.createdAt})`),
      db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${organizations.createdAt}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(organizations)
        .where(and(isNull(organizations.claimToken), gte(organizations.createdAt, since12Months)))
        .groupBy(sql`date_trunc('month', ${organizations.createdAt})`)
        .orderBy(sql`date_trunc('month', ${organizations.createdAt})`),
      // Claimed orgs, dated by when the claim was approved (not when created).
      db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${organizationClaimRequests.decidedAt}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(organizationClaimRequests)
        .where(
          and(
            eq(organizationClaimRequests.status, "approved"),
            isNotNull(organizationClaimRequests.decidedAt),
            gte(organizationClaimRequests.decidedAt, since12Months),
          ),
        )
        .groupBy(sql`date_trunc('month', ${organizationClaimRequests.decidedAt})`)
        .orderBy(sql`date_trunc('month', ${organizationClaimRequests.decidedAt})`),
      db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${teams.createdAt}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(teams)
        .where(gte(teams.createdAt, since12Months))
        .groupBy(sql`date_trunc('month', ${teams.createdAt})`)
        .orderBy(sql`date_trunc('month', ${teams.createdAt})`),
      db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${articles.createdAt}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(articles)
        .where(gte(articles.createdAt, since12Months))
        .groupBy(sql`date_trunc('month', ${articles.createdAt})`)
        .orderBy(sql`date_trunc('month', ${articles.createdAt})`),
    ]);

    const roleCounts: Record<string, number> = {
      athlete: 0,
      parent: 0,
      coach: 0,
      admin: 0,
    };
    for (const r of roleBreakdown) roleCounts[r.role] = r.count;

    res.json({
      totals: {
        users: totalUsers,
        athletes: roleCounts["athlete"] ?? 0,
        parents: roleCounts["parent"] ?? 0,
        coaches: roleCounts["coach"] ?? 0,
        admins: roleCounts["admin"] ?? 0,
        deletedUsers,
        organizations: totalOrgs,
        teams: totalTeams,
        articles: totalArticles,
        hiddenArticles,
        highlights: totalHighlights,
        hiddenHighlights,
        orgPosts: totalOrgPosts,
        comments: totalComments,
        messages: totalMessages,
        follows: totalUserFollows + totalOrgFollows + totalTeamFollows,
        userFollows: totalUserFollows,
        orgFollows: totalOrgFollows,
        teamFollows: totalTeamFollows,
        openReports,
        activeUsersLast30d: activeUsers,
      },
      series: {
        newUsersByDay,
        newPostsByDay,
        commentsByDay: newCommentsByDay,
        activeSessionsByDay,
        writtenInOrgsByMonth,
        organicOrgsByMonth,
        orgsClaimedByMonth,
        newTeamsByMonth,
        gameRecapsByMonth,
      },
      top: {
        followedOrganizations: topFollowedOrgs,
        followedUsers: topFollowedUsers,
        postersThisWeek: topPostersThisWeek,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const ROLE_VALUES = ["athlete", "parent", "coach", "admin"] as const;

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
    const includeDeleted =
      req.query["includeDeleted"] === "1" || req.query["includeDeleted"] === "true";
    const role = typeof req.query["role"] === "string" ? req.query["role"] : "";
    const limitRaw = parseInt(p(req.query["limit"] as string), 10);
    const offsetRaw = parseInt(p(req.query["offset"] as string), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    const conds = [] as ReturnType<typeof eq>[];
    if (!includeDeleted) conds.push(isNull(users.deletedAt));
    if (q) {
      conds.push(or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`))!);
    }
    if (role && (ROLE_VALUES as readonly string[]).includes(role)) {
      conds.push(eq(users.role, role as (typeof ROLE_VALUES)[number]));
    }
    const where = conds.length ? and(...conds) : undefined;

    const [rows, [{ totalCount }]] = await Promise.all([
      db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ totalCount: sql<number>`count(*)::int` }).from(users).where(where),
    ]);
    const data = rows.map((u) => {
      const { firstName, lastName } = splitName(u.name);
      return {
        id: u.id,
        firstName,
        lastName,
        displayName: u.name,
        email: u.email ?? null,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
        lastSignInAt: u.lastSignInAt ? u.lastSignInAt.toISOString() : null,
        deletedAt: u.deletedAt ? u.deletedAt.toISOString() : null,
        avatarUrl: safeAvatarUrl(u.avatarUrl),
        sport: u.sport ?? null,
        position: u.position ?? null,
        jerseyNumber: u.jerseyNumber ?? null,
        grade: u.grade ?? null,
        location: u.location ?? null,
        bio: u.bio ?? null,
        dateOfBirth: u.dateOfBirth ? u.dateOfBirth.toISOString() : null,
        parentId: u.parentId ?? null,
        guardianEmail: u.guardianEmail ?? null,
        guardianConfirmedAt: u.guardianConfirmedAt
          ? u.guardianConfirmedAt.toISOString()
          : null,
        requireTagConsent: u.requireTagConsent,
      };
    });
    res.json({
      data,
      pagination: {
        nextCursor: null,
        hasMore: offset + data.length < totalCount,
        totalCount,
        limit,
        offset,
      },
    });
  }),
);

const CreateUserBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLE_VALUES),
});

router.post(
  "/users",
  asyncHandler(async (req, res) => {
    const body = CreateUserBody.parse(req.body);
    const email = body.email.toLowerCase();
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }
    const passwordHash = await hashPassword(body.password);
    const [created] = await db
      .insert(users)
      .values({
        name: `${body.firstName} ${body.lastName}`.trim(),
        email,
        role: body.role,
        passwordHash,
      })
      .returning();
    await logAdminAction(req.realUser!.id, "create_user", "user", created.id, {
      email,
      role: body.role,
    });
    res.status(201).json(toPrivateUser(created));
  }),
);

const UpdateUserBody = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(ROLE_VALUES).optional(),
  bio: z.string().nullable().optional(),
  sport: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  jerseyNumber: z.number().int().nullable().optional(),
  grade: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  guardianEmail: z.string().email().nullable().optional(),
  requireTagConsent: z.boolean().optional(),
  clearGuardianConfirmation: z.boolean().optional(),
});

router.patch(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const [u] = await db.select().from(users).where(eq(users.id, p(req.params.userId))).limit(1);
    if (!u) return notFound(res, "User not found");
    const body = UpdateUserBody.parse(req.body);
    const updates: Partial<typeof users.$inferInsert> = {};
    if (body.firstName !== undefined || body.lastName !== undefined) {
      const cur = splitName(u.name);
      const fn = body.firstName ?? cur.firstName;
      const ln = body.lastName ?? cur.lastName;
      updates.name = `${fn} ${ln}`.trim();
    }
    if (body.email !== undefined) updates.email = body.email.toLowerCase();
    if (body.role !== undefined) updates.role = body.role;
    if (body.bio !== undefined) updates.bio = body.bio;
    if (body.sport !== undefined) updates.sport = body.sport;
    if (body.position !== undefined) updates.position = body.position;
    if (body.jerseyNumber !== undefined) updates.jerseyNumber = body.jerseyNumber;
    if (body.grade !== undefined) updates.grade = body.grade;
    if (body.location !== undefined) updates.location = body.location;
    if (body.avatarUrl !== undefined) {
      // Mirror the cap enforced by PATCH /users/:userId so an admin
      // cannot reintroduce a multi-megabyte data: URL after we've cleaned
      // them out of the database. http(s) URLs are not length-limited
      // here.
      if (
        typeof body.avatarUrl === "string" &&
        body.avatarUrl.startsWith("data:") &&
        body.avatarUrl.length > MAX_AVATAR_DATA_URL_LENGTH
      ) {
        res.status(400).json({ error: "avatarUrl is too long" });
        return;
      }
      updates.avatarUrl = body.avatarUrl;
    }
    if (body.dateOfBirth !== undefined) {
      updates.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
    }
    if (body.parentId !== undefined) updates.parentId = body.parentId;
    if (body.guardianEmail !== undefined) updates.guardianEmail = body.guardianEmail;
    if (body.requireTagConsent !== undefined)
      updates.requireTagConsent = body.requireTagConsent;
    if (body.clearGuardianConfirmation === true) {
      updates.guardianConfirmedAt = null;
      updates.guardianConfirmedByUserId = null;
      updates.guardianConfirmTokenHash = null;
      updates.guardianConfirmTokenExpiresAt = null;
    }
    const [updated] = Object.keys(updates).length
      ? await db.update(users).set(updates).where(eq(users.id, u.id)).returning()
      : [u];
    await logAdminAction(req.realUser!.id, "update_user", "user", u.id, {
      changed: Object.keys(updates),
    });
    res.json(toPrivateUser(updated));
  }),
);

router.delete(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const [u] = await db.select().from(users).where(eq(users.id, p(req.params.userId))).limit(1);
    if (!u) return notFound(res, "User not found");
    if (u.id === req.realUser!.id) {
      res.status(400).json({ error: "You cannot deactivate your own admin account." });
      return;
    }
    if (u.deletedAt) {
      res.json(toPrivateUser(u));
      return;
    }
    const [updated] = await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, u.id))
      .returning();
    // Invalidate all the deleted user's sessions.
    await db.delete(sessions).where(eq(sessions.userId, u.id));
    await logAdminAction(req.realUser!.id, "soft_delete_user", "user", u.id, {});
    res.json(toPrivateUser(updated));
  }),
);

router.post(
  "/users/:userId/restore",
  asyncHandler(async (req, res) => {
    const [u] = await db.select().from(users).where(eq(users.id, p(req.params.userId))).limit(1);
    if (!u) return notFound(res, "User not found");
    const [updated] = await db
      .update(users)
      .set({ deletedAt: null })
      .where(eq(users.id, u.id))
      .returning();
    await logAdminAction(req.realUser!.id, "restore_user", "user", u.id, {});
    res.json(toPrivateUser(updated));
  }),
);

router.post(
  "/users/:userId/reset-password",
  asyncHandler(async (req, res) => {
    const [u] = await db.select().from(users).where(eq(users.id, p(req.params.userId))).limit(1);
    if (!u) return notFound(res, "User not found");
    const tempPassword = generateToken().slice(0, 16);
    const passwordHash = await hashPassword(tempPassword);
    await db.update(users).set({ passwordHash }).where(eq(users.id, u.id));
    await db.delete(sessions).where(eq(sessions.userId, u.id));
    await logAdminAction(req.realUser!.id, "reset_password", "user", u.id, {});
    res.json({ tempPassword });
  }),
);

// ---------------------------------------------------------------------------
// Content moderation
// ---------------------------------------------------------------------------

router.get(
  "/content/:type",
  asyncHandler(async (req, res) => {
    const type = p(req.params.type);
    if (!isValidContentType(type)) return notFound(res, "Unknown content type");
    const onlyHidden =
      req.query["hidden"] === "1" || req.query["hidden"] === "true";
    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";

    if (type === "article") {
      const conds = [] as ReturnType<typeof eq>[];
      if (onlyHidden) conds.push(isNotNull(articles.hiddenAt));
      if (q) conds.push(or(ilike(articles.title, `%${q}%`), ilike(articles.body, `%${q}%`))!);
      const rows = await db
        .select({ a: articles, author: users })
        .from(articles)
        .leftJoin(users, eq(articles.authorId, users.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(articles.createdAt))
        .limit(200);
      res.json(
        paginate(
          rows.map((r) => ({
            id: r.a.id,
            type: "article" as const,
            title: r.a.title,
            body: (r.a.body ?? "").slice(0, 240),
            authorId: r.a.authorId,
            authorName: r.author?.name ?? null,
            createdAt: r.a.createdAt.toISOString(),
            hiddenAt: r.a.hiddenAt ? r.a.hiddenAt.toISOString() : null,
          })),
        ),
      );
      return;
    }
    if (type === "highlight") {
      const conds = [] as ReturnType<typeof eq>[];
      if (onlyHidden) conds.push(isNotNull(highlights.hiddenAt));
      if (q) conds.push(ilike(highlights.title, `%${q}%`));
      const rows = await db
        .select({ h: highlights, author: users })
        .from(highlights)
        .leftJoin(users, eq(highlights.uploaderId, users.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(highlights.createdAt))
        .limit(200);
      res.json(
        paginate(
          rows.map((r) => ({
            id: r.h.id,
            type: "highlight" as const,
            title: r.h.title,
            body: r.h.description ?? "",
            authorId: r.h.uploaderId,
            authorName: r.author?.name ?? null,
            createdAt: r.h.createdAt.toISOString(),
            hiddenAt: r.h.hiddenAt ? r.h.hiddenAt.toISOString() : null,
          })),
        ),
      );
      return;
    }
    if (type === "org_post") {
      const conds = [] as ReturnType<typeof eq>[];
      if (onlyHidden) conds.push(isNotNull(orgPosts.hiddenAt));
      if (q) conds.push(or(ilike(orgPosts.title, `%${q}%`), ilike(orgPosts.body, `%${q}%`))!);
      const rows = await db
        .select({ p: orgPosts, author: users })
        .from(orgPosts)
        .leftJoin(users, eq(orgPosts.authorId, users.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(orgPosts.createdAt))
        .limit(200);
      res.json(
        paginate(
          rows.map((r) => ({
            id: r.p.id,
            type: "org_post" as const,
            title: r.p.title,
            body: (r.p.body ?? "").slice(0, 240),
            authorId: r.p.authorId,
            authorName: r.author?.name ?? null,
            createdAt: r.p.createdAt.toISOString(),
            hiddenAt: r.p.hiddenAt ? r.p.hiddenAt.toISOString() : null,
          })),
        ),
      );
      return;
    }
    // comment
    const conds = [isNull(postComments.deletedAt)] as ReturnType<typeof eq>[];
    if (onlyHidden) conds.push(isNotNull(postComments.hiddenAt));
    if (q) conds.push(ilike(postComments.body, `%${q}%`));
    const rows = await db
      .select({ c: postComments, author: users })
      .from(postComments)
      .leftJoin(users, eq(postComments.authorId, users.id))
      .where(and(...conds))
      .orderBy(desc(postComments.createdAt))
      .limit(200);
    res.json(
      paginate(
        rows.map((r) => ({
          id: r.c.id,
          type: "comment" as const,
          title: `Comment on ${r.c.postKind} ${r.c.postRefId.slice(0, 8)}`,
          body: r.c.body,
          authorId: r.c.authorId,
          authorName: r.author?.name ?? null,
          createdAt: r.c.createdAt.toISOString(),
          hiddenAt: r.c.hiddenAt ? r.c.hiddenAt.toISOString() : null,
        })),
      ),
    );
  }),
);

async function setHidden(type: ContentType, id: string, hidden: boolean, adminId: string) {
  const table = CONTENT_TABLES[type];
  const update = hidden
    ? { hiddenAt: new Date(), hiddenByUserId: adminId }
    : { hiddenAt: null, hiddenByUserId: null };
  // Using sql cast: drizzle .update on the right table
  if (type === "article") {
    await db.update(articles).set(update).where(eq(articles.id, id));
  } else if (type === "highlight") {
    await db.update(highlights).set(update).where(eq(highlights.id, id));
  } else if (type === "org_post") {
    await db.update(orgPosts).set(update).where(eq(orgPosts.id, id));
  } else {
    await db.update(postComments).set(update).where(eq(postComments.id, id));
  }
  return table;
}

router.post(
  "/content/:type/:id/hide",
  asyncHandler(async (req, res) => {
    const type = p(req.params.type);
    if (!isValidContentType(type)) return notFound(res, "Unknown content type");
    await setHidden(type, p(req.params.id), true, req.realUser!.id);
    await logAdminAction(req.realUser!.id, "hide_content", type, p(req.params.id), {});
    res.json({ ok: true });
  }),
);

router.post(
  "/content/:type/:id/unhide",
  asyncHandler(async (req, res) => {
    const type = p(req.params.type);
    if (!isValidContentType(type)) return notFound(res, "Unknown content type");
    await setHidden(type, p(req.params.id), false, req.realUser!.id);
    await logAdminAction(req.realUser!.id, "unhide_content", type, p(req.params.id), {});
    res.json({ ok: true });
  }),
);

router.delete(
  "/content/:type/:id",
  asyncHandler(async (req, res) => {
    const type = p(req.params.type);
    if (!isValidContentType(type)) return notFound(res, "Unknown content type");
    if (type === "article") {
      await db.delete(articles).where(eq(articles.id, p(req.params.id)));
    } else if (type === "highlight") {
      await db.delete(highlights).where(eq(highlights.id, p(req.params.id)));
    } else if (type === "org_post") {
      await db.delete(orgPosts).where(eq(orgPosts.id, p(req.params.id)));
    } else {
      await db
        .update(postComments)
        .set({ deletedAt: new Date() })
        .where(eq(postComments.id, p(req.params.id)));
    }
    await logAdminAction(req.realUser!.id, "delete_content", type, p(req.params.id), {});
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

router.get(
  "/reports",
  asyncHandler(async (req, res) => {
    const status = req.query["status"];
    const conds = [] as ReturnType<typeof eq>[];
    if (status === "open" || status === "resolved" || status === "dismissed") {
      conds.push(eq(contentReports.status, status));
    }
    const reporterAlias = users;
    const rows = await db
      .select({ r: contentReports, reporter: reporterAlias })
      .from(contentReports)
      .leftJoin(reporterAlias, eq(contentReports.reporterUserId, reporterAlias.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(contentReports.createdAt))
      .limit(200);

    // Hydrate content snippets for each report.
    const articleIds = rows.filter((r) => r.r.contentType === "article").map((r) => r.r.contentId);
    const highlightIds = rows.filter((r) => r.r.contentType === "highlight").map((r) => r.r.contentId);
    const orgPostIds = rows.filter((r) => r.r.contentType === "org_post").map((r) => r.r.contentId);
    const commentIds = rows.filter((r) => r.r.contentType === "comment").map((r) => r.r.contentId);

    const [aRows, hRows, opRows, cRows] = await Promise.all([
      articleIds.length
        ? db.select().from(articles).where(inArray(articles.id, articleIds))
        : Promise.resolve([] as (typeof articles.$inferSelect)[]),
      highlightIds.length
        ? db.select().from(highlights).where(inArray(highlights.id, highlightIds))
        : Promise.resolve([] as (typeof highlights.$inferSelect)[]),
      orgPostIds.length
        ? db.select().from(orgPosts).where(inArray(orgPosts.id, orgPostIds))
        : Promise.resolve([] as (typeof orgPosts.$inferSelect)[]),
      commentIds.length
        ? db.select().from(postComments).where(inArray(postComments.id, commentIds))
        : Promise.resolve([] as (typeof postComments.$inferSelect)[]),
    ]);

    const articleMap = new Map(aRows.map((r) => [r.id, r]));
    const highlightMap = new Map(hRows.map((r) => [r.id, r]));
    const orgPostMap = new Map(opRows.map((r) => [r.id, r]));
    const commentMap = new Map(cRows.map((r) => [r.id, r]));

    function snippetFor(type: string, id: string) {
      if (type === "article") {
        const a = articleMap.get(id);
        return a
          ? { title: a.title, body: (a.body ?? "").slice(0, 240), hiddenAt: a.hiddenAt?.toISOString() ?? null, deleted: false }
          : { title: null, body: null, hiddenAt: null, deleted: true };
      }
      if (type === "highlight") {
        const h = highlightMap.get(id);
        return h
          ? { title: h.title, body: h.description ?? "", hiddenAt: h.hiddenAt?.toISOString() ?? null, deleted: false }
          : { title: null, body: null, hiddenAt: null, deleted: true };
      }
      if (type === "org_post") {
        const p = orgPostMap.get(id);
        return p
          ? { title: p.title, body: (p.body ?? "").slice(0, 240), hiddenAt: p.hiddenAt?.toISOString() ?? null, deleted: false }
          : { title: null, body: null, hiddenAt: null, deleted: true };
      }
      const c = commentMap.get(id);
      return c
        ? { title: null, body: c.body, hiddenAt: c.hiddenAt?.toISOString() ?? null, deleted: !!c.deletedAt }
        : { title: null, body: null, hiddenAt: null, deleted: true };
    }

    res.json(
      paginate(
        rows.map((r) => ({
          id: r.r.id,
          contentType: r.r.contentType,
          contentId: r.r.contentId,
          reason: r.r.reason,
          note: r.r.note,
          status: r.r.status,
          resolution: r.r.resolution,
          createdAt: r.r.createdAt.toISOString(),
          resolvedAt: r.r.resolvedAt?.toISOString() ?? null,
          reporter: r.reporter
            ? {
                id: r.reporter.id,
                name: r.reporter.name,
                email: r.reporter.email,
              }
            : null,
          content: snippetFor(r.r.contentType, r.r.contentId),
        })),
      ),
    );
  }),
);

const ResolveReportBody = z.object({
  action: z.enum(["dismiss", "hide_content", "delete_content", "mark_resolved"]),
  note: z.string().optional(),
});

router.post(
  "/reports/:reportId/resolve",
  asyncHandler(async (req, res) => {
    const [r] = await db
      .select()
      .from(contentReports)
      .where(eq(contentReports.id, p(req.params.reportId)))
      .limit(1);
    if (!r) return notFound(res, "Report not found");
    const body = ResolveReportBody.parse(req.body);
    if (body.action === "hide_content") {
      if (!isValidContentType(r.contentType)) return notFound(res, "Bad content type");
      await setHidden(r.contentType as ContentType, r.contentId, true, req.realUser!.id);
      await logAdminAction(req.realUser!.id, "hide_content", r.contentType as ContentType, r.contentId, {
        viaReportId: r.id,
      });
    } else if (body.action === "delete_content") {
      const type = r.contentType as ContentType;
      if (!isValidContentType(type)) return notFound(res, "Bad content type");
      if (type === "article") await db.delete(articles).where(eq(articles.id, r.contentId));
      else if (type === "highlight") await db.delete(highlights).where(eq(highlights.id, r.contentId));
      else if (type === "org_post") await db.delete(orgPosts).where(eq(orgPosts.id, r.contentId));
      else
        await db
          .update(postComments)
          .set({ deletedAt: new Date() })
          .where(eq(postComments.id, r.contentId));
      await logAdminAction(req.realUser!.id, "delete_content", type, r.contentId, {
        viaReportId: r.id,
      });
    }
    const isDismiss = body.action === "dismiss";
    const newStatus = isDismiss ? "dismissed" : "resolved";
    await db
      .update(contentReports)
      .set({
        status: newStatus,
        resolution: body.action,
        resolvedAt: new Date(),
        resolvedByUserId: req.realUser!.id,
      })
      .where(eq(contentReports.id, r.id));
    await logAdminAction(
      req.realUser!.id,
      isDismiss ? "dismiss_report" : "resolve_report",
      "report",
      r.id,
      { action: body.action, note: body.note },
    );

    // Resolve all open reports targeting the same content if we hid/deleted it.
    if (body.action === "hide_content" || body.action === "delete_content") {
      await db
        .update(contentReports)
        .set({
          status: "resolved",
          resolution: body.action,
          resolvedAt: new Date(),
          resolvedByUserId: req.realUser!.id,
        })
        .where(
          and(
            eq(contentReports.contentType, r.contentType),
            eq(contentReports.contentId, r.contentId),
            eq(contentReports.status, "open"),
          ),
        );
    }
    res.json({ ok: true, status: newStatus });
  }),
);

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

const ACTION_TYPES = [
  "hide_content",
  "unhide_content",
  "delete_content",
  "resolve_report",
  "dismiss_report",
  "create_user",
  "update_user",
  "soft_delete_user",
  "restore_user",
  "reset_password",
  "masquerade_start",
  "masquerade_stop",
] as const;

router.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const adminUserId = typeof req.query["adminUserId"] === "string"
      ? req.query["adminUserId"]
      : "";
    const actionType = typeof req.query["actionType"] === "string"
      ? req.query["actionType"]
      : "";
    const limitRaw = parseInt(p(req.query["limit"] as string), 10);
    const offsetRaw = parseInt(p(req.query["offset"] as string), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 100;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    const conds = [] as ReturnType<typeof eq>[];
    if (adminUserId) conds.push(eq(adminActivityLog.adminUserId, adminUserId));
    if (actionType && (ACTION_TYPES as readonly string[]).includes(actionType)) {
      conds.push(
        eq(
          adminActivityLog.actionType,
          actionType as (typeof ACTION_TYPES)[number],
        ),
      );
    }
    const where = conds.length ? and(...conds) : undefined;

    const [rows, [{ totalCount }]] = await Promise.all([
      db
        .select({ a: adminActivityLog, admin: users })
        .from(adminActivityLog)
        .leftJoin(users, eq(adminActivityLog.adminUserId, users.id))
        .where(where)
        .orderBy(desc(adminActivityLog.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ totalCount: sql<number>`count(*)::int` })
        .from(adminActivityLog)
        .where(where),
    ]);
    const data = rows.map((r) => ({
      id: r.a.id,
      actionType: r.a.actionType,
      targetType: r.a.targetType,
      targetId: r.a.targetId,
      metadata: r.a.metadata ? JSON.parse(r.a.metadata) : null,
      createdAt: r.a.createdAt.toISOString(),
      admin: r.admin
        ? { id: r.admin.id, name: r.admin.name, email: r.admin.email }
        : null,
    }));
    res.json({
      data,
      pagination: {
        nextCursor: null,
        hasMore: offset + data.length < totalCount,
        totalCount,
        limit,
        offset,
      },
    });
  }),
);

// Distinct admins who have logged at least one action (for filter dropdown).
router.get(
  "/activity/admins",
  asyncHandler(async (_req, res) => {
    const rows = await db
      .selectDistinct({ id: users.id, name: users.name, email: users.email })
      .from(adminActivityLog)
      .innerJoin(users, eq(adminActivityLog.adminUserId, users.id))
      .orderBy(users.name);
    res.json({ data: rows });
  }),
);

// ---------------------------------------------------------------------------
// Masquerade
// ---------------------------------------------------------------------------

router.post(
  "/masquerade/:userId/start",
  asyncHandler(async (req, res) => {
    const [target] = await db
      .select()
      .from(users)
      .where(eq(users.id, p(req.params.userId)))
      .limit(1);
    if (!target) return notFound(res, "User not found");
    if (target.deletedAt) {
      res.status(400).json({ error: "Cannot masquerade as a deactivated user." });
      return;
    }
    if (target.id === req.realUser!.id) {
      res.status(400).json({ error: "You are already that user." });
      return;
    }
    if (!req.sessionRow) {
      res.status(400).json({ error: "No active session." });
      return;
    }
    await db
      .update(sessions)
      .set({ masqueradingAsUserId: target.id })
      .where(eq(sessions.id, req.sessionRow.id));
    await logAdminAction(req.realUser!.id, "masquerade_start", "user", target.id, {
      targetEmail: target.email,
    });
    res.json({ ok: true, viewingAs: { id: target.id, name: target.name, email: target.email } });
  }),
);

router.post(
  "/masquerade/stop",
  asyncHandler(async (req, res) => {
    if (!req.sessionRow) {
      res.status(400).json({ error: "No active session." });
      return;
    }
    const previousTarget = req.sessionRow.masqueradingAsUserId;
    await db
      .update(sessions)
      .set({ masqueradingAsUserId: null })
      .where(eq(sessions.id, req.sessionRow.id));
    if (previousTarget) {
      await logAdminAction(req.realUser!.id, "masquerade_stop", "user", previousTarget, {});
    }
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Task #368 — COPPA Phase 4: photo-of-minor takedown queue (admin UI).
// ---------------------------------------------------------------------------
//
// Lists pending guardian-filed takedowns and lets a platform admin
// approve (delete the post + cascade FKs) or decline (mark declined,
// post becomes visible again). Mirrors the operator script
// `pnpm --filter @workspace/scripts run coppa:delete -- --post ...`
// so the in-app UI and CLI stay behaviorally identical.

router.get(
  "/takedowns",
  asyncHandler(async (req, res) => {
    const status =
      typeof req.query["status"] === "string" ? req.query["status"] : "pending";
    const filter =
      status === "pending" || status === "approved" || status === "declined"
        ? eq(takedownRequests.status, status)
        : undefined;
    // Task #368 — paginated. The default page is 100 to keep the
    // existing UI behavior, but operators can walk older history with
    // `?limit=&offset=` or bump `limit` up to 500 per request.
    const limitRaw = parseInt(
      typeof req.query["limit"] === "string" ? req.query["limit"] : "",
      10,
    );
    const offsetRaw = parseInt(
      typeof req.query["offset"] === "string" ? req.query["offset"] : "",
      10,
    );
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 500
        ? limitRaw
        : 100;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
    const rows = await db
      .select({
        t: takedownRequests,
        child: {
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(takedownRequests)
      .leftJoin(users, eq(users.id, takedownRequests.childUserId))
      .where(filter)
      .orderBy(desc(takedownRequests.createdAt))
      .limit(limit)
      .offset(offset);

    // B2 — resolve guardians + post snapshots in batched queries (one per
    // entity type) instead of two queries per row (was N+1). Collect the
    // distinct ids per kind, fetch them in a single `inArray` each, then
    // hydrate every row synchronously from the resulting maps.
    const guardianIds = [
      ...new Set(
        rows
          .map((r) => r.t.requestedByGuardianId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const articleIds = [
      ...new Set(
        rows.filter((r) => r.t.postKind === "article").map((r) => r.t.postRefId),
      ),
    ];
    const highlightIds = [
      ...new Set(
        rows
          .filter((r) => r.t.postKind === "highlight")
          .map((r) => r.t.postRefId),
      ),
    ];
    const orgPostIds = [
      ...new Set(
        rows
          .filter((r) => r.t.postKind === "org_post")
          .map((r) => r.t.postRefId),
      ),
    ];

    const [guardianRows, articleRows, highlightRows, orgPostRows] =
      await Promise.all([
        guardianIds.length
          ? db
              .select({ id: users.id, name: users.name, email: users.email })
              .from(users)
              .where(inArray(users.id, guardianIds))
          : Promise.resolve([]),
        articleIds.length
          ? db
              .select({ id: articles.id, title: articles.title })
              .from(articles)
              .where(inArray(articles.id, articleIds))
          : Promise.resolve([]),
        highlightIds.length
          ? db
              .select({ id: highlights.id, title: highlights.title })
              .from(highlights)
              .where(inArray(highlights.id, highlightIds))
          : Promise.resolve([]),
        orgPostIds.length
          ? db
              .select({ id: orgPosts.id, title: orgPosts.title })
              .from(orgPosts)
              .where(inArray(orgPosts.id, orgPostIds))
          : Promise.resolve([]),
      ]);

    const guardianById = new Map(guardianRows.map((g) => [g.id, g]));
    const titleByArticle = new Map(articleRows.map((a) => [a.id, a.title]));
    const titleByHighlight = new Map(highlightRows.map((h) => [h.id, h.title]));
    const titleByOrgPost = new Map(orgPostRows.map((p) => [p.id, p.title]));

    const out = rows.map((r) => {
      const guardian = r.t.requestedByGuardianId
        ? guardianById.get(r.t.requestedByGuardianId) ?? null
        : null;
      const kind = r.t.postKind as "article" | "highlight" | "org_post";
      let title: string | null = null;
      let exists = false;
      if (kind === "article" && titleByArticle.has(r.t.postRefId)) {
        title = titleByArticle.get(r.t.postRefId) ?? null;
        exists = true;
      } else if (kind === "highlight" && titleByHighlight.has(r.t.postRefId)) {
        title = titleByHighlight.get(r.t.postRefId) ?? null;
        exists = true;
      } else if (kind === "org_post" && titleByOrgPost.has(r.t.postRefId)) {
        title = titleByOrgPost.get(r.t.postRefId) ?? null;
        exists = true;
      }
      return {
        id: r.t.id,
        status: r.t.status,
        reason: r.t.reason,
        createdAt: r.t.createdAt.toISOString(),
        decidedAt: r.t.decidedAt?.toISOString() ?? null,
        child: r.child,
        guardian,
        post: { id: r.t.postRefId, kind, title, exists },
      };
    });
    res.json({ data: out });
  }),
);

async function resolveTakedownRow(
  takedownId: string,
): Promise<{
  kind: "article" | "highlight" | "org_post";
  refId: string;
} | null> {
  const [row] = await db
    .select({ postKind: takedownRequests.postKind, postRefId: takedownRequests.postRefId })
    .from(takedownRequests)
    .where(eq(takedownRequests.id, takedownId))
    .limit(1);
  if (!row) return null;
  if (
    row.postKind !== "article" &&
    row.postKind !== "highlight" &&
    row.postKind !== "org_post"
  ) {
    return null;
  }
  return { kind: row.postKind, refId: row.postRefId };
}

// Decide a takedown atomically. Wraps the post mutation, the conditional
// status update (only rows still `pending` are transitioned, so concurrent
// approve/decline races collapse to a single winner), and the per-child
// audit-log insert in one transaction. The audit log is driven by
// `RETURNING` so we never emit decisions for rows another moderator already
// closed.
async function decideTakedown(
  req: import("express").Request,
  ref: { kind: "article" | "highlight" | "org_post"; refId: string },
  decision: "approved" | "declined",
): Promise<
  { id: string; childUserId: string; requestedByGuardianId: string | null }[]
> {
  const event =
    decision === "approved"
      ? ("guardian_takedown_approved" as const)
      : ("guardian_takedown_declined" as const);
  const transitioned = await db.transaction(async (tx) => {
    // Transition pending rows first; if a concurrent decision already
    // closed them, `transitioned` will be empty and we must not delete
    // the post or write audit rows.
    const rows = await tx
      .update(takedownRequests)
      .set({
        status: decision,
        decidedByUserId: req.realUser!.id,
        decidedAt: new Date(),
      })
      .where(
        and(
          eq(takedownRequests.postKind, ref.kind),
          eq(takedownRequests.postRefId, ref.refId),
          eq(takedownRequests.status, "pending"),
        ),
      )
      .returning({
        id: takedownRequests.id,
        childUserId: takedownRequests.childUserId,
        requestedByGuardianId: takedownRequests.requestedByGuardianId,
      });
    if (rows.length > 0 && decision === "approved") {
      // Hard takedown: delete the post; FKs cascade tags/reactions/etc.
      if (ref.kind === "article") {
        await tx.delete(articles).where(eq(articles.id, ref.refId));
      } else if (ref.kind === "highlight") {
        await tx.delete(highlights).where(eq(highlights.id, ref.refId));
      } else {
        // Task #524 — org_post hard takedown.
        await tx.delete(orgPosts).where(eq(orgPosts.id, ref.refId));
      }
    }
    if (rows.length > 0) {
      await tx.insert(consentAuditLog).values(
        rows.map((r) => ({
          event,
          childUserId: r.childUserId,
          actorEmail: req.realUser?.email ?? null,
          details: JSON.stringify({
            takedownId: r.id,
            kind: ref.kind,
            refId: ref.refId,
            via: "admin_ui",
          }),
        })),
      );
    }
    return rows;
  });
  // Task #369 — notify each requesting guardian that the moderator
  // decided their takedown. Done OUTSIDE the transaction on purpose:
  // a notification insert error (e.g. a stale schema row) must not
  // abort the moderation action, which has already been committed
  // and audited above. `requestedByGuardianId` is nullable
  // (`onDelete: set null`) so we filter unlinked rows before insert
  // to avoid a NOT NULL violation on `notifications.userId`.
  const notifyRows = transitioned
    .filter(
      (r): r is typeof r & { requestedByGuardianId: string } =>
        r.requestedByGuardianId !== null,
    )
    .map((r) => ({
      userId: r.requestedByGuardianId,
      kind:
        decision === "approved"
          ? "guardian_takedown_approved"
          : "guardian_takedown_declined",
      message:
        decision === "approved"
          ? `Your takedown request for a ${ref.kind} was approved and the post was removed.`
          : `Your takedown request for a ${ref.kind} was declined by a moderator.`,
      link: `/family?childId=${r.childUserId}`,
      actorUserId: req.realUser!.id,
    }));
  if (notifyRows.length > 0) {
    try {
      await db.insert(notifications).values(notifyRows);
    } catch (err) {
      req.log.error(
        { err },
        "Failed to write guardian takedown-decision notification",
      );
    }
  }
  return transitioned;
}

router.post(
  "/takedowns/:takedownId/approve",
  asyncHandler(async (req, res) => {
    const ref = await resolveTakedownRow(p(req.params.takedownId));
    if (!ref) return notFound(res, "Takedown not found");
    const transitioned = await decideTakedown(req, ref, "approved");
    res.json({ ok: true, decision: "approved", affected: transitioned.length });
  }),
);

router.post(
  "/takedowns/:takedownId/decline",
  asyncHandler(async (req, res) => {
    const ref = await resolveTakedownRow(p(req.params.takedownId));
    if (!ref) return notFound(res, "Takedown not found");
    const transitioned = await decideTakedown(req, ref, "declined");
    res.json({ ok: true, decision: "declined", affected: transitioned.length });
  }),
);

// ---------------------------------------------------------------------------
// Task #603 — Organization page claims
// ---------------------------------------------------------------------------
// Platform admins review claim requests on ownerless (bulk-imported) org
// pages. Approval atomically inserts the owner `organization_admins` row and
// stamps `organizations.createdById`, refusing if an owner already exists
// (race-safe via a conditional insert). The claimer is notified on both
// approve and decline. Hand-written validation + customFetch precedent.

router.get(
  "/org-claims",
  asyncHandler(async (req, res) => {
    const status =
      typeof req.query["status"] === "string" ? req.query["status"] : "pending";
    const filter =
      status === "pending" || status === "approved" || status === "declined"
        ? eq(organizationClaimRequests.status, status)
        : undefined;
    const limitRaw = parseInt(
      typeof req.query["limit"] === "string" ? req.query["limit"] : "",
      10,
    );
    const offsetRaw = parseInt(
      typeof req.query["offset"] === "string" ? req.query["offset"] : "",
      10,
    );
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 500
        ? limitRaw
        : 100;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
    const rows = await db
      .select({
        c: organizationClaimRequests,
        org: {
          id: organizations.id,
          name: organizations.name,
          city: organizations.city,
          state: organizations.state,
          logoUrl: organizations.logoUrl,
        },
        requester: {
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(organizationClaimRequests)
      .leftJoin(
        organizations,
        eq(organizations.id, organizationClaimRequests.organizationId),
      )
      .leftJoin(users, eq(users.id, organizationClaimRequests.requestedByUserId))
      .where(filter)
      .orderBy(desc(organizationClaimRequests.createdAt))
      .limit(limit)
      .offset(offset);
    const out = rows.map((r) => ({
      id: r.c.id,
      status: r.c.status,
      createdAt: r.c.createdAt.toISOString(),
      decidedAt: r.c.decidedAt?.toISOString() ?? null,
      organization: r.org,
      requester: r.requester,
    }));
    res.json({ data: out });
  }),
);

// Approve or decline a claim atomically. On approve we conditionally insert
// the owner row only if the org still has no owner (defends against a page
// that was claimed/created between list and decision). The status transition
// is itself gated on `status = 'pending'` so concurrent approve/decline races
// collapse to a single winner. Notifications fire OUTSIDE the transaction so a
// notification failure never rolls back the (committed) ownership grant.
async function decideOrgClaim(
  req: import("express").Request,
  claimId: string,
  decision: "approved" | "declined",
): Promise<
  | { ok: true; claim: { organizationId: string; requestedByUserId: string } }
  | { ok: false; reason: "not_found" | "already_decided" | "already_claimed" }
> {
  return db.transaction(async (tx) => {
    const [claim] = await tx
      .select()
      .from(organizationClaimRequests)
      .where(eq(organizationClaimRequests.id, claimId))
      .limit(1);
    if (!claim) return { ok: false, reason: "not_found" as const };
    if (claim.status !== "pending") {
      return { ok: false, reason: "already_decided" as const };
    }
    if (decision === "approved") {
      // Refuse if an owner already exists for this org.
      const [owner] = await tx
        .select({ userId: organizationAdmins.userId })
        .from(organizationAdmins)
        .where(
          and(
            eq(organizationAdmins.organizationId, claim.organizationId),
            eq(organizationAdmins.role, "owner"),
          ),
        )
        .limit(1);
      if (owner) return { ok: false, reason: "already_claimed" as const };
      // Grant ownership: insert the owner row + auto-follow, stamp creator.
      await tx
        .insert(organizationAdmins)
        .values({
          organizationId: claim.organizationId,
          userId: claim.requestedByUserId,
          role: "owner",
        })
        .onConflictDoNothing();
      await tx
        .insert(organizationFollowers)
        .values({
          organizationId: claim.organizationId,
          userId: claim.requestedByUserId,
        })
        .onConflictDoNothing();
      await tx
        .update(organizations)
        .set({ createdById: claim.requestedByUserId })
        .where(eq(organizations.id, claim.organizationId));
      // Auto-decline any other pending claims on the same org.
      await tx
        .update(organizationClaimRequests)
        .set({
          status: "declined",
          decidedByUserId: req.realUser!.id,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(
              organizationClaimRequests.organizationId,
              claim.organizationId,
            ),
            eq(organizationClaimRequests.status, "pending"),
            sql`${organizationClaimRequests.id} <> ${claim.id}`,
          ),
        );
    }
    const [updated] = await tx
      .update(organizationClaimRequests)
      .set({
        status: decision,
        decidedByUserId: req.realUser!.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationClaimRequests.id, claim.id),
          eq(organizationClaimRequests.status, "pending"),
        ),
      )
      .returning({
        organizationId: organizationClaimRequests.organizationId,
        requestedByUserId: organizationClaimRequests.requestedByUserId,
      });
    if (!updated) return { ok: false, reason: "already_decided" as const };
    return { ok: true, claim: updated };
  });
}

async function notifyOrgClaimDecision(
  req: import("express").Request,
  claim: { organizationId: string; requestedByUserId: string },
  decision: "approved" | "declined",
) {
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, claim.organizationId))
    .limit(1);
  const orgName = org?.name ?? "the organization";
  try {
    await db.insert(notifications).values({
      userId: claim.requestedByUserId,
      kind: decision === "approved" ? "org_claim_approved" : "org_claim_declined",
      message:
        decision === "approved"
          ? `Your claim for ${orgName} was approved. You're now the owner of the page.`
          : `Your claim for ${orgName} was declined by a moderator.`,
      link: `/organizations/${claim.organizationId}`,
      actorUserId: req.realUser!.id,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to write org-claim decision notification");
  }
}

router.post(
  "/org-claims/:claimId/approve",
  asyncHandler(async (req, res) => {
    const result = await decideOrgClaim(req, p(req.params.claimId), "approved");
    if (!result.ok) {
      if (result.reason === "not_found") return notFound(res, "Claim not found");
      return res.status(409).json({
        error:
          result.reason === "already_claimed"
            ? "This organization already has an owner"
            : "This claim has already been decided",
        code:
          result.reason === "already_claimed"
            ? "ALREADY_CLAIMED"
            : "ALREADY_DECIDED",
      });
    }
    await notifyOrgClaimDecision(req, result.claim, "approved");
    res.json({ ok: true, decision: "approved" });
  }),
);

router.post(
  "/org-claims/:claimId/decline",
  asyncHandler(async (req, res) => {
    const result = await decideOrgClaim(req, p(req.params.claimId), "declined");
    if (!result.ok) {
      if (result.reason === "not_found") return notFound(res, "Claim not found");
      return res.status(409).json({
        error: "This claim has already been decided",
        code: "ALREADY_DECIDED",
      });
    }
    await notifyOrgClaimDecision(req, result.claim, "declined");
    res.json({ ok: true, decision: "declined" });
  }),
);

// ---------------------------------------------------------------------------
// Task #610 — Secret claim-invite links for ownerless org pages
// ---------------------------------------------------------------------------
// Lists every ownerless (no `organization_admins` owner row) org alongside
// its durable secret claim token, which the operator copies/pastes to each
// org. The screen is self-healing: any ownerless org still missing a token
// gets one minted on read, so newly bulk-imported orgs surface immediately
// without a separate backfill step. Tokens are never (re)issued for orgs that
// already have an owner — those drop off this list once claimed.
router.get(
  "/org-claim-links",
  asyncHandler(async (req, res) => {
    const ownerExists = sql`EXISTS (
      SELECT 1 FROM ${organizationAdmins}
      WHERE ${organizationAdmins.organizationId} = ${organizations.id}
        AND ${organizationAdmins.role} = 'owner'
    )`;
    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        city: organizations.city,
        state: organizations.state,
        logoUrl: organizations.logoUrl,
        claimToken: organizations.claimToken,
        outreachMessagedAt: organizations.outreachMessagedAt,
      })
      .from(organizations)
      .where(sql`NOT ${ownerExists}`)
      .orderBy(asc(organizations.name));

    // Mint a token for any ownerless org that lacks one (idempotent).
    const out: Array<{
      id: string;
      name: string;
      city: string | null;
      state: string | null;
      logoUrl: string | null;
      token: string;
      messagedAt: string | null;
    }> = [];
    for (const r of rows) {
      let token = r.claimToken;
      if (!token) {
        token = generateToken();
        await db
          .update(organizations)
          .set({ claimToken: token })
          .where(eq(organizations.id, r.id));
      }
      out.push({
        id: r.id,
        name: r.name,
        city: r.city,
        state: r.state,
        logoUrl: r.logoUrl,
        token,
        messagedAt: r.outreachMessagedAt
          ? r.outreachMessagedAt.toISOString()
          : null,
      });
    }
    res.json({ data: out });
  }),
);

// ---------------------------------------------------------------------------
// Quick "Add org" + live duplicate detection for the claim-links screen
// ---------------------------------------------------------------------------
// Operators discover orgs to message on social and want to spin up a claimable
// page on the fly. As they type, GET /org-name-check surfaces any existing org
// (claimed or not) whose name matches so duplicates are obvious before submit;
// POST /org-claim-links creates a fresh ownerless page with a claim token,
// refusing an exact (case-insensitive) duplicate.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

router.get(
  "/org-name-check",
  asyncHandler(async (req, res) => {
    const name = String(req.query.name ?? "").trim();
    if (name.length < 2) {
      return res.json({ data: [] });
    }
    const ownerExists = sql<boolean>`EXISTS (
      SELECT 1 FROM ${organizationAdmins}
      WHERE ${organizationAdmins.organizationId} = ${organizations.id}
        AND ${organizationAdmins.role} = 'owner'
    )`;
    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        city: organizations.city,
        state: organizations.state,
        hasOwner: ownerExists,
      })
      .from(organizations)
      .where(sql`${organizations.name} ILIKE ${"%" + escapeLike(name) + "%"}`)
      .orderBy(asc(organizations.name))
      .limit(8);
    const needle = name.toLowerCase();
    return res.json({
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        state: r.state,
        hasOwner: Boolean(r.hasOwner),
        exact: r.name.toLowerCase() === needle,
      })),
    });
  }),
);

router.post(
  "/org-claim-links",
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) {
      return res.status(400).json({ error: "name required", code: "NAME_REQUIRED" });
    }
    if (name.length > 200) {
      return res.status(400).json({ error: "name too long", code: "NAME_TOO_LONG" });
    }
    const existing = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(sql`lower(${organizations.name}) = ${name.toLowerCase()}`)
      .limit(1);
    if (existing.length > 0) {
      return res.status(409).json({
        error: "An organization with this name already exists",
        code: "ORG_NAME_TAKEN",
        existing: existing[0],
      });
    }
    const token = generateToken();
    const [org] = await db
      .insert(organizations)
      .values({ name, claimToken: token })
      .returning();
    return res.status(201).json({
      data: {
        id: org.id,
        name: org.name,
        city: org.city,
        state: org.state,
        logoUrl: org.logoUrl,
        token,
      },
    });
  }),
);

// Toggle whether the operator has messaged this org (e.g. on Facebook) to
// invite them to claim their page. messaged=true stamps now(), false clears.
router.patch(
  "/org-claim-links/:id/messaged",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const messaged = req.body?.messaged;
    if (typeof messaged !== "boolean") {
      return res
        .status(400)
        .json({ error: "messaged must be a boolean", code: "INVALID_BODY" });
    }
    const [org] = await db
      .update(organizations)
      .set({ outreachMessagedAt: messaged ? new Date() : null })
      .where(eq(organizations.id, id))
      .returning({
        id: organizations.id,
        messagedAt: organizations.outreachMessagedAt,
      });
    if (!org) {
      return res
        .status(404)
        .json({ error: "organization not found", code: "ORG_NOT_FOUND" });
    }
    return res.json({
      data: {
        id: org.id,
        messagedAt: org.messagedAt ? org.messagedAt.toISOString() : null,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// Cross-team schedule oversight — upcoming events across EVERY team with a
// per-event RSVP tally. Read-only platform-admin view (no edits here).
// ---------------------------------------------------------------------------
router.get(
  "/schedule/upcoming",
  asyncHandler(async (req, res) => {
    const limitParam = req.query["limit"];
    const limitRaw = typeof limitParam === "string" ? parseInt(limitParam, 10) : NaN;
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 200);
    const now = new Date();

    const events = await db
      .select({
        id: scheduleEvents.id,
        teamId: scheduleEvents.teamId,
        teamName: teams.name,
        organizationId: scheduleEvents.organizationId,
        organizationName: organizations.name,
        eventType: scheduleEvents.eventType,
        title: scheduleEvents.title,
        opponent: scheduleEvents.opponent,
        status: scheduleEvents.status,
        startAt: scheduleEvents.startAt,
        endAt: scheduleEvents.endAt,
        locationName: scheduleEvents.locationName,
      })
      .from(scheduleEvents)
      .innerJoin(teams, eq(teams.id, scheduleEvents.teamId))
      .leftJoin(organizations, eq(organizations.id, scheduleEvents.organizationId))
      .where(gte(scheduleEvents.startAt, now))
      .orderBy(asc(scheduleEvents.startAt))
      .limit(limit);

    const eventIds = events.map((e) => e.id);
    const counts = eventIds.length
      ? await db
          .select({
            eventId: scheduleEventRsvps.eventId,
            status: scheduleEventRsvps.status,
            count: sql<number>`count(*)::int`,
          })
          .from(scheduleEventRsvps)
          .where(inArray(scheduleEventRsvps.eventId, eventIds))
          .groupBy(scheduleEventRsvps.eventId, scheduleEventRsvps.status)
      : [];
    const byEvent = new Map<string, { going: number; maybe: number; out: number }>();
    for (const c of counts) {
      const cur = byEvent.get(c.eventId) ?? { going: 0, maybe: 0, out: 0 };
      cur[c.status as "going" | "maybe" | "out"] = c.count;
      byEvent.set(c.eventId, cur);
    }

    const data = events.map((e) => {
      const r = byEvent.get(e.id) ?? { going: 0, maybe: 0, out: 0 };
      return {
        id: e.id,
        teamId: e.teamId,
        teamName: e.teamName,
        organizationId: e.organizationId,
        organizationName: e.organizationName ?? null,
        eventType: e.eventType,
        title: e.title ?? null,
        opponent: e.opponent ?? null,
        status: e.status,
        startAt: e.startAt.toISOString(),
        endAt: e.endAt ? e.endAt.toISOString() : null,
        locationName: e.locationName ?? null,
        rsvps: r,
      };
    });
    res.json({ data });
  }),
);

// ---------------------------------------------------------------------------
// System announcements — platform-wide in-app banner managed by admins.
// ---------------------------------------------------------------------------
function toAnnouncement(a: typeof announcements.$inferSelect) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    level: a.level,
    active: a.active,
    startsAt: a.startsAt ? a.startsAt.toISOString() : null,
    endsAt: a.endsAt ? a.endsAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

const windowValid = (data: {
  startsAt?: string | null;
  endsAt?: string | null;
}) =>
  !data.startsAt ||
  !data.endsAt ||
  new Date(data.endsAt).getTime() >= new Date(data.startsAt).getTime();
const windowError = {
  message: "endsAt must be on or after startsAt",
  path: ["endsAt"],
};

const createAnnouncementZ = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2000),
    level: z.enum(["info", "warning", "success"]).default("info"),
    startsAt: z.string().datetime().nullish(),
    endsAt: z.string().datetime().nullish(),
  })
  .refine(windowValid, windowError);

const patchAnnouncementZ = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(2000).optional(),
    level: z.enum(["info", "warning", "success"]).optional(),
    active: z.boolean().optional(),
    startsAt: z.string().datetime().nullish(),
    endsAt: z.string().datetime().nullish(),
  })
  .refine(windowValid, windowError);

router.get(
  "/announcements",
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt))
      .limit(100);
    res.json({ data: rows.map(toAnnouncement) });
  }),
);

router.post(
  "/announcements",
  asyncHandler(async (req, res) => {
    const parsed = createAnnouncementZ.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    }
    const { title, body, level, startsAt, endsAt } = parsed.data;
    const [row] = await db
      .insert(announcements)
      .values({
        title,
        body,
        level,
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
        createdById: req.realUser?.id ?? null,
      })
      .returning();
    return res.status(201).json(toAnnouncement(row));
  }),
);

router.patch(
  "/announcements/:id",
  asyncHandler(async (req, res) => {
    const id = p(req.params["id"]);
    const parsed = patchAnnouncementZ.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    }
    const { title, body, level, active, startsAt, endsAt } = parsed.data;
    const patch: Partial<typeof announcements.$inferInsert> = { updatedAt: new Date() };
    if (title !== undefined) patch.title = title;
    if (body !== undefined) patch.body = body;
    if (level !== undefined) patch.level = level;
    if (active !== undefined) patch.active = active;
    if (startsAt !== undefined) patch.startsAt = startsAt ? new Date(startsAt) : null;
    if (endsAt !== undefined) patch.endsAt = endsAt ? new Date(endsAt) : null;
    const [row] = await db
      .update(announcements)
      .set(patch)
      .where(eq(announcements.id, id))
      .returning();
    if (!row) return notFound(res, "Announcement not found");
    return res.json(toAnnouncement(row));
  }),
);

export default router;
