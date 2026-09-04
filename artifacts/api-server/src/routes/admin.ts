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
  tournaments,
  tournamentParticipants,
  announcements,
  guardianLinks,
  stagedCoachInvites,
  orgAdminLists,
  partnerLandingPages,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { hardDeleteUser } from "@workspace/user-hard-delete";
import { asyncHandler } from "../lib/async-handler";
import {
  ensureActiveGuardianLink,
  syncParentIdMirror,
} from "../lib/guardian-links";
import { hashPassword, generateToken } from "../lib/passwords";
import { requireAdmin } from "../lib/auth";
import {
  DEFAULT_PLAN,
  PLAN_TEAM_LIMITS,
  teamLimitForPlan,
  type PlanTier,
} from "../lib/plan-limits";
import { findRedeemablePromo } from "./subscriptions";
import {
  splitName,
  toPrivateUser,
  paginate,
  safeAvatarUrl,
  MAX_AVATAR_DATA_URL_LENGTH,
  MAX_IMAGE_DATA_URL_LENGTH,
} from "../lib/spec-helpers";
import {
  buildOrgClaimApprovedEmail,
  sendEmail,
} from "../lib/email";

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
    | "permanent_delete_user"
    | "reset_password"
    | "masquerade_start"
    | "masquerade_stop",
  targetType:
    | "user"
    | "article"
    | "highlight"
    | "org_post"
    | "comment"
    | "report"
    | null,
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
  return (
    s === "article" || s === "highlight" || s === "org_post" || s === "comment"
  );
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
      db
        .select({ totalUsers: sql<number>`count(*)::int` })
        .from(users)
        .where(isNull(users.deletedAt)),
      db
        .select({ role: users.role, count: sql<number>`count(*)::int` })
        .from(users)
        .where(isNull(users.deletedAt))
        .groupBy(users.role),
      db
        .select({ deletedUsers: sql<number>`count(*)::int` })
        .from(users)
        .where(isNotNull(users.deletedAt)),
      db.select({ totalOrgs: sql<number>`count(*)::int` }).from(organizations),
      db.select({ totalTeams: sql<number>`count(*)::int` }).from(teams),
      db.select({ totalArticles: sql<number>`count(*)::int` }).from(articles),
      db
        .select({ hiddenArticles: sql<number>`count(*)::int` })
        .from(articles)
        .where(isNotNull(articles.hiddenAt)),
      db
        .select({ totalHighlights: sql<number>`count(*)::int` })
        .from(highlights),
      db
        .select({ hiddenHighlights: sql<number>`count(*)::int` })
        .from(highlights)
        .where(isNotNull(highlights.hiddenAt)),
      db.select({ totalOrgPosts: sql<number>`count(*)::int` }).from(orgPosts),
      db
        .select({ totalComments: sql<number>`count(*)::int` })
        .from(postComments),
      db.select({ totalMessages: sql<number>`count(*)::int` }).from(messages),
      db
        .select({ totalUserFollows: sql<number>`count(*)::int` })
        .from(userFollowers),
      db
        .select({ totalOrgFollows: sql<number>`count(*)::int` })
        .from(organizationFollowers),
      db
        .select({ totalTeamFollows: sql<number>`count(*)::int` })
        .from(teamFollowers),
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
        .where(
          and(isNotNull(users.lastSignInAt), gte(users.lastSignInAt, since)),
        )
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
        .leftJoin(
          organizations,
          eq(organizationFollowers.organizationId, organizations.id),
        )
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
          (
            r.rows as Array<{
              userId: string;
              name: string | null;
              email: string | null;
              count: number;
            }>
          ).map((row) => ({
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
        .where(
          and(
            isNotNull(organizations.claimToken),
            gte(organizations.createdAt, since12Months),
          ),
        )
        .groupBy(sql`date_trunc('month', ${organizations.createdAt})`)
        .orderBy(sql`date_trunc('month', ${organizations.createdAt})`),
      db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${organizations.createdAt}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(organizations)
        .where(
          and(
            isNull(organizations.claimToken),
            gte(organizations.createdAt, since12Months),
          ),
        )
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
        .groupBy(
          sql`date_trunc('month', ${organizationClaimRequests.decidedAt})`,
        )
        .orderBy(
          sql`date_trunc('month', ${organizationClaimRequests.decidedAt})`,
        ),
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
      fan: 0,
    };
    for (const r of roleBreakdown) roleCounts[r.role] = r.count;

    res.json({
      totals: {
        users: totalUsers,
        athletes: roleCounts["athlete"] ?? 0,
        parents: roleCounts["parent"] ?? 0,
        coaches: roleCounts["coach"] ?? 0,
        admins: roleCounts["admin"] ?? 0,
        fans: roleCounts["fan"] ?? 0,
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

const ROLE_VALUES = ["athlete", "parent", "coach", "admin", "fan"] as const;

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
    const includeDeleted =
      req.query["includeDeleted"] === "1" ||
      req.query["includeDeleted"] === "true";
    const role = typeof req.query["role"] === "string" ? req.query["role"] : "";
    const limitRaw = parseInt(p(req.query["limit"] as string), 10);
    const offsetRaw = parseInt(p(req.query["offset"] as string), 10);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200
        ? limitRaw
        : 50;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    const conds = [] as ReturnType<typeof eq>[];
    if (!includeDeleted) conds.push(isNull(users.deletedAt));
    if (q) {
      conds.push(
        or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`))!,
      );
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
      db
        .select({ totalCount: sql<number>`count(*)::int` })
        .from(users)
        .where(where),
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
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) {
      res
        .status(409)
        .json({ error: "An account with that email already exists." });
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
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, p(req.params.userId)))
      .limit(1);
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
    if (body.jerseyNumber !== undefined)
      updates.jerseyNumber = body.jerseyNumber;
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
      updates.dateOfBirth = body.dateOfBirth
        ? new Date(body.dateOfBirth)
        : null;
    }
    // Task #755 — parentId is a mirror of the primary ACTIVE guardian
    // link. Route admin edits through the links table (below) instead of
    // writing the column directly, so the invariant holds.
    if (body.guardianEmail !== undefined)
      updates.guardianEmail = body.guardianEmail;
    if (body.requireTagConsent !== undefined) {
      updates.requireTagConsent = body.requireTagConsent;
      // Task #800 — admin edits count as deliberate choices too.
      updates.tagConsentSetExplicitly = true;
    }
    if (body.clearGuardianConfirmation === true) {
      updates.guardianConfirmedAt = null;
      updates.guardianConfirmedByUserId = null;
      updates.guardianConfirmTokenHash = null;
      updates.guardianConfirmTokenExpiresAt = null;
    }
    let [updated] = Object.keys(updates).length
      ? await db
          .update(users)
          .set(updates)
          .where(eq(users.id, u.id))
          .returning()
      : [u];
    // Task #755 — apply the parent link change via guardian_links so the
    // parentId mirror stays consistent with the links table.
    if (body.parentId !== undefined) {
      if (body.parentId) {
        await ensureActiveGuardianLink({
          childId: u.id,
          guardianId: body.parentId,
          consentMethod: "admin_edit",
        });
      } else {
        // Clearing the parent: revoke ALL active links for this child,
        // then re-sync the mirror (→ null).
        //
        // DELIBERATE POLICY EXCEPTION to "the last guardian can never be
        // removed": this platform-admin-only path is support/compliance
        // tooling (fixing wrongly-linked accounts, COPPA data corrections)
        // and is the ONLY code path allowed to leave a child with zero
        // active guardians. It is audit-logged via logAdminAction below;
        // every user-facing removal path enforces the last-guardian guard.
        await db
          .update(guardianLinks)
          .set({ status: "revoked", updatedAt: new Date() })
          .where(
            and(
              eq(guardianLinks.childId, u.id),
              ne(guardianLinks.status, "revoked"),
            ),
          );
        await syncParentIdMirror(u.id);
      }
      const [refreshed] = await db
        .select()
        .from(users)
        .where(eq(users.id, u.id))
        .limit(1);
      if (refreshed) updated = refreshed;
    }
    await logAdminAction(req.realUser!.id, "update_user", "user", u.id, {
      changed: [
        ...Object.keys(updates),
        ...(body.parentId !== undefined ? ["parentId"] : []),
      ],
    });
    res.json(toPrivateUser(updated));
  }),
);

router.delete(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, p(req.params.userId)))
      .limit(1);
    if (!u) return notFound(res, "User not found");
    if (u.id === req.realUser!.id) {
      res
        .status(400)
        .json({ error: "You cannot deactivate your own admin account." });
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
    await logAdminAction(
      req.realUser!.id,
      "soft_delete_user",
      "user",
      u.id,
      {},
    );
    res.json(toPrivateUser(updated));
  }),
);

router.post(
  "/users/:userId/restore",
  asyncHandler(async (req, res) => {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, p(req.params.userId)))
      .limit(1);
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

// Task #686 — permanently hard-delete an already-deactivated account.
// Two-step by design: an account must first be deactivated (soft-deleted,
// `deletedAt` set) before it can be purged here. Runs the shared COPPA-safe
// purge (authored content deleted, received messages redacted, orphaned
// conversation rows cleaned, then the users row deleted so cascades fire),
// which frees the email for a brand-new signup. Confirmation requires the
// caller to echo back the account's exact name or email.
const PermanentDeleteBody = z.object({
  confirm: z.string(),
});

const normalizeConfirm = (s: string) =>
  s.trim().replace(/\s+/g, " ").toLowerCase();

router.delete(
  "/users/:userId/permanent",
  asyncHandler(async (req, res) => {
    const parsed = PermanentDeleteBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Type the account's exact name or email to confirm.",
        code: "CONFIRMATION_REQUIRED",
      });
      return;
    }
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, p(req.params.userId)))
      .limit(1);
    if (!u) return notFound(res, "User not found");
    if (u.id === req.realUser!.id) {
      res
        .status(400)
        .json({ error: "You cannot delete your own admin account." });
      return;
    }
    if (!u.deletedAt) {
      res.status(400).json({
        error: "Deactivate the account before permanently deleting it.",
        code: "NOT_DEACTIVATED",
      });
      return;
    }
    const confirm = normalizeConfirm(parsed.data.confirm);
    const expectedName = normalizeConfirm(u.name ?? "");
    const expectedEmail = normalizeConfirm(u.email ?? "");
    const matches =
      (expectedName.length > 0 && confirm === expectedName) ||
      (expectedEmail.length > 0 && confirm === expectedEmail);
    if (!matches) {
      res.status(400).json({
        error: "Type the account's exact name or email to confirm.",
        code: "CONFIRMATION_REQUIRED",
      });
      return;
    }
    // Snapshot identifying fields for the audit row before the purge; the
    // users row is gone once hardDeleteUser returns.
    const snapshot = { name: u.name, email: u.email };
    await hardDeleteUser(u.id);
    await logAdminAction(
      req.realUser!.id,
      "permanent_delete_user",
      "user",
      u.id,
      snapshot,
    );
    res.json({ ok: true, id: u.id });
  }),
);

router.post(
  "/users/:userId/reset-password",
  asyncHandler(async (req, res) => {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, p(req.params.userId)))
      .limit(1);
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
      if (q)
        conds.push(
          or(ilike(articles.title, `%${q}%`), ilike(articles.body, `%${q}%`))!,
        );
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
      if (q)
        conds.push(
          or(ilike(orgPosts.title, `%${q}%`), ilike(orgPosts.body, `%${q}%`))!,
        );
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

async function setHidden(
  type: ContentType,
  id: string,
  hidden: boolean,
  adminId: string,
) {
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
    await logAdminAction(
      req.realUser!.id,
      "hide_content",
      type,
      p(req.params.id),
      {},
    );
    res.json({ ok: true });
  }),
);

router.post(
  "/content/:type/:id/unhide",
  asyncHandler(async (req, res) => {
    const type = p(req.params.type);
    if (!isValidContentType(type)) return notFound(res, "Unknown content type");
    await setHidden(type, p(req.params.id), false, req.realUser!.id);
    await logAdminAction(
      req.realUser!.id,
      "unhide_content",
      type,
      p(req.params.id),
      {},
    );
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
    await logAdminAction(
      req.realUser!.id,
      "delete_content",
      type,
      p(req.params.id),
      {},
    );
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
      .leftJoin(
        reporterAlias,
        eq(contentReports.reporterUserId, reporterAlias.id),
      )
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(contentReports.createdAt))
      .limit(200);

    // Hydrate content snippets for each report.
    const articleIds = rows
      .filter((r) => r.r.contentType === "article")
      .map((r) => r.r.contentId);
    const highlightIds = rows
      .filter((r) => r.r.contentType === "highlight")
      .map((r) => r.r.contentId);
    const orgPostIds = rows
      .filter((r) => r.r.contentType === "org_post")
      .map((r) => r.r.contentId);
    const commentIds = rows
      .filter((r) => r.r.contentType === "comment")
      .map((r) => r.r.contentId);

    const [aRows, hRows, opRows, cRows] = await Promise.all([
      articleIds.length
        ? db.select().from(articles).where(inArray(articles.id, articleIds))
        : Promise.resolve([] as (typeof articles.$inferSelect)[]),
      highlightIds.length
        ? db
            .select()
            .from(highlights)
            .where(inArray(highlights.id, highlightIds))
        : Promise.resolve([] as (typeof highlights.$inferSelect)[]),
      orgPostIds.length
        ? db.select().from(orgPosts).where(inArray(orgPosts.id, orgPostIds))
        : Promise.resolve([] as (typeof orgPosts.$inferSelect)[]),
      commentIds.length
        ? db
            .select()
            .from(postComments)
            .where(inArray(postComments.id, commentIds))
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
          ? {
              title: a.title,
              body: (a.body ?? "").slice(0, 240),
              hiddenAt: a.hiddenAt?.toISOString() ?? null,
              deleted: false,
            }
          : { title: null, body: null, hiddenAt: null, deleted: true };
      }
      if (type === "highlight") {
        const h = highlightMap.get(id);
        return h
          ? {
              title: h.title,
              body: h.description ?? "",
              hiddenAt: h.hiddenAt?.toISOString() ?? null,
              deleted: false,
            }
          : { title: null, body: null, hiddenAt: null, deleted: true };
      }
      if (type === "org_post") {
        const p = orgPostMap.get(id);
        return p
          ? {
              title: p.title,
              body: (p.body ?? "").slice(0, 240),
              hiddenAt: p.hiddenAt?.toISOString() ?? null,
              deleted: false,
            }
          : { title: null, body: null, hiddenAt: null, deleted: true };
      }
      const c = commentMap.get(id);
      return c
        ? {
            title: null,
            body: c.body,
            hiddenAt: c.hiddenAt?.toISOString() ?? null,
            deleted: !!c.deletedAt,
          }
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
  action: z.enum([
    "dismiss",
    "hide_content",
    "delete_content",
    "mark_resolved",
  ]),
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
      if (!isValidContentType(r.contentType))
        return notFound(res, "Bad content type");
      await setHidden(
        r.contentType as ContentType,
        r.contentId,
        true,
        req.realUser!.id,
      );
      await logAdminAction(
        req.realUser!.id,
        "hide_content",
        r.contentType as ContentType,
        r.contentId,
        {
          viaReportId: r.id,
        },
      );
    } else if (body.action === "delete_content") {
      const type = r.contentType as ContentType;
      if (!isValidContentType(type)) return notFound(res, "Bad content type");
      if (type === "article")
        await db.delete(articles).where(eq(articles.id, r.contentId));
      else if (type === "highlight")
        await db.delete(highlights).where(eq(highlights.id, r.contentId));
      else if (type === "org_post")
        await db.delete(orgPosts).where(eq(orgPosts.id, r.contentId));
      else
        await db
          .update(postComments)
          .set({ deletedAt: new Date() })
          .where(eq(postComments.id, r.contentId));
      await logAdminAction(
        req.realUser!.id,
        "delete_content",
        type,
        r.contentId,
        {
          viaReportId: r.id,
        },
      );
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
    const adminUserId =
      typeof req.query["adminUserId"] === "string"
        ? req.query["adminUserId"]
        : "";
    const actionType =
      typeof req.query["actionType"] === "string"
        ? req.query["actionType"]
        : "";
    const limitRaw = parseInt(p(req.query["limit"] as string), 10);
    const offsetRaw = parseInt(p(req.query["offset"] as string), 10);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200
        ? limitRaw
        : 100;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    const conds = [] as ReturnType<typeof eq>[];
    if (adminUserId) conds.push(eq(adminActivityLog.adminUserId, adminUserId));
    if (
      actionType &&
      (ACTION_TYPES as readonly string[]).includes(actionType)
    ) {
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
      res
        .status(400)
        .json({ error: "Cannot masquerade as a deactivated user." });
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
    await logAdminAction(
      req.realUser!.id,
      "masquerade_start",
      "user",
      target.id,
      {
        targetEmail: target.email,
      },
    );
    res.json({
      ok: true,
      viewingAs: { id: target.id, name: target.name, email: target.email },
    });
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
      await logAdminAction(
        req.realUser!.id,
        "masquerade_stop",
        "user",
        previousTarget,
        {},
      );
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
        rows
          .filter((r) => r.t.postKind === "article")
          .map((r) => r.t.postRefId),
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
        ? (guardianById.get(r.t.requestedByGuardianId) ?? null)
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

async function resolveTakedownRow(takedownId: string): Promise<{
  kind: "article" | "highlight" | "org_post";
  refId: string;
} | null> {
  const [row] = await db
    .select({
      postKind: takedownRequests.postKind,
      postRefId: takedownRequests.postRefId,
    })
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
        partner: {
          id: partnerLandingPages.id,
          slug: partnerLandingPages.slug,
          officialName: partnerLandingPages.officialName,
        },
      })
      .from(organizationClaimRequests)
      .leftJoin(
        organizations,
        eq(organizations.id, organizationClaimRequests.organizationId),
      )
      .leftJoin(
        users,
        eq(users.id, organizationClaimRequests.requestedByUserId),
      )
      .leftJoin(
        partnerLandingPages,
        eq(
          partnerLandingPages.id,
          organizationClaimRequests.sourcePartnerPageId,
        ),
      )
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
      submittedOrganizationName: r.c.submittedOrganizationName,
      requesterFullName: r.c.requesterFullName,
      requesterTitle: r.c.requesterTitle,
      partner: r.c.sourcePartnerPageId ? r.partner : null,
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
      // Task #929 — lists only apply to ownerless orgs on the admin Org
      // Links screen; clear adminListId in the same transaction as the
      // ownership grant so a claimed org can never keep stale list
      // membership the admin view has no way to show or fix.
      await tx
        .update(organizations)
        .set({ createdById: claim.requestedByUserId, adminListId: null })
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
            eq(organizationClaimRequests.organizationId, claim.organizationId),
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
    .select({
      name: organizations.name,
      requesterEmail: users.email,
    })
    .from(organizations)
    .leftJoin(users, eq(users.id, claim.requestedByUserId))
    .where(eq(organizations.id, claim.organizationId))
    .limit(1);
  const orgName = org?.name ?? "the organization";
  try {
    await db.insert(notifications).values({
      userId: claim.requestedByUserId,
      kind:
        decision === "approved" ? "org_claim_approved" : "org_claim_declined",
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
  if (decision === "approved" && org?.requesterEmail) {
    try {
      await sendEmail(
        buildOrgClaimApprovedEmail({
          to: org.requesterEmail,
          organizationId: claim.organizationId,
          organizationName: orgName,
        }),
      );
    } catch (err) {
      // Ownership is already committed; email delivery must never roll it back.
      req.log.error(
        { err, organizationId: claim.organizationId },
        "Failed to send org-claim approval email",
      );
    }
  }
}

router.post(
  "/org-claims/:claimId/approve",
  asyncHandler(async (req, res) => {
    const result = await decideOrgClaim(req, p(req.params.claimId), "approved");
    if (!result.ok) {
      if (result.reason === "not_found")
        return notFound(res, "Claim not found");
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
      if (result.reason === "not_found")
        return notFound(res, "Claim not found");
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
// Task #929 — Named lists to group ownerless orgs the operator set up
// ---------------------------------------------------------------------------
// A list is just an admin-facing folder for the Org Links screen (e.g. one
// per league/tournament). An org belongs to at most one list (adminListId);
// deleting a list only clears that link (ON DELETE SET NULL) — it never
// touches the orgs themselves.
// Only ownerless orgs count toward a list — a claimed org's `adminListId`
// is cleared the moment it gets an owner (see the claim-link finalize and
// org-claim approval transactions), but count defensively off the same
// ownerExists predicate the Org Links table itself filters on, so the two
// views can never disagree even if that invariant is ever violated.
const ORG_LIST_OWNERLESS_JOIN = sql`${organizations.adminListId} = ${orgAdminLists.id}
      AND NOT EXISTS (
        SELECT 1 FROM ${organizationAdmins}
        WHERE ${organizationAdmins.organizationId} = ${organizations.id}
          AND ${organizationAdmins.role} = 'owner'
      )`;

// Task #968 — Partner onboarding import. The browser parses the uploaded
// spreadsheet for a fast preview, but the server validates the normalized
// payload again before either the preview response or the write. This keeps
// the actual create operation independent from a client-controlled parser.
const ORG_BULK_MAX_ORGS = 200;
const ORG_BULK_MAX_TEAMS_PER_ORG = 100;
const ORG_BULK_MAX_TOTAL_TEAMS = 5000;
const ORG_BULK_MAX_NAME_LENGTH = 200;
const ORG_BULK_MAX_LIST_NAME_LENGTH = 120;
const ORG_BULK_DELETE_MAX_ORGS = 2000;
const ORG_BULK_DELETE_CONFIRMATION = "DELETE UNCLAIMED ORGANIZATIONS";

type BulkImportOrganization = {
  name: string;
  teams: string[];
};

type BulkImportIssue = {
  scope: "file" | "organization" | "team";
  organizationIndex?: number;
  teamIndex?: number;
  message: string;
};

function parseBulkImportOrganizations(body: unknown): {
  organizations: BulkImportOrganization[];
  issues: BulkImportIssue[];
} {
  const raw = body as { organizations?: unknown } | null;
  const issues: BulkImportIssue[] = [];
  const organizations: BulkImportOrganization[] = [];
  if (!Array.isArray(raw?.organizations)) {
    return {
      organizations,
      issues: [
        {
          scope: "file",
          message: "Upload at least one organization.",
        },
      ],
    };
  }
  if (raw.organizations.length === 0) {
    issues.push({
      scope: "file",
      message: "Upload at least one organization.",
    });
  }
  if (raw.organizations.length > ORG_BULK_MAX_ORGS) {
    issues.push({
      scope: "file",
      message: `This import has too many organizations (maximum ${ORG_BULK_MAX_ORGS}).`,
    });
  }

  const seenOrganizations = new Map<string, number>();
  let totalTeams = 0;
  for (
    let organizationIndex = 0;
    organizationIndex < raw.organizations.length;
    organizationIndex++
  ) {
    const item = raw.organizations[organizationIndex] as {
      name?: unknown;
      teams?: unknown;
    } | null;
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    const teamsRaw = Array.isArray(item?.teams) ? item.teams : [];
    const rawTeams = teamsRaw.map((team) =>
      typeof team === "string" ? team.trim() : "",
    );
    const teams: string[] = [];
    const seenTeams = new Set<string>();
    for (const team of rawTeams) {
      if (!team) {
        teams.push(team);
        continue;
      }
      const teamKey = team.toLowerCase();
      if (seenTeams.has(teamKey)) continue;
      seenTeams.add(teamKey);
      teams.push(team);
    }
    organizations.push({ name, teams });

    if (!name) {
      issues.push({
        scope: "organization",
        organizationIndex,
        message: `Organization ${organizationIndex + 1}: name required.`,
      });
    } else if (name.length > ORG_BULK_MAX_NAME_LENGTH) {
      issues.push({
        scope: "organization",
        organizationIndex,
        message: `Organization ${organizationIndex + 1}: name is too long.`,
      });
    }
    const nameKey = name.toLowerCase();
    if (nameKey) {
      const previous = seenOrganizations.get(nameKey);
      if (previous !== undefined) {
        issues.push({
          scope: "organization",
          organizationIndex,
          message: `Organization ${organizationIndex + 1}: duplicate name; it also appears as organization ${previous + 1}.`,
        });
      } else {
        seenOrganizations.set(nameKey, organizationIndex);
      }
    }

    if (teams.length > ORG_BULK_MAX_TEAMS_PER_ORG) {
      issues.push({
        scope: "organization",
        organizationIndex,
        message: `Organization ${organizationIndex + 1}: too many teams (maximum ${ORG_BULK_MAX_TEAMS_PER_ORG}).`,
      });
    }
    for (let teamIndex = 0; teamIndex < teams.length; teamIndex++) {
      const team = teams[teamIndex];
      if (!team) {
        issues.push({
          scope: "team",
          organizationIndex,
          teamIndex,
          message: `Organization ${organizationIndex + 1}, team ${teamIndex + 1}: name required.`,
        });
        continue;
      }
      if (team.length > ORG_BULK_MAX_NAME_LENGTH) {
        issues.push({
          scope: "team",
          organizationIndex,
          teamIndex,
          message: `Organization ${organizationIndex + 1}, team ${teamIndex + 1}: name is too long.`,
        });
      }
    }
    totalTeams += teams.length;
  }
  if (totalTeams > ORG_BULK_MAX_TOTAL_TEAMS) {
    issues.push({
      scope: "file",
      message: `This import has too many teams (maximum ${ORG_BULK_MAX_TOTAL_TEAMS}).`,
    });
  }
  return { organizations, issues };
}

async function bulkImportPreflight(body: unknown, checkExistingNames: boolean) {
  const raw = body as {
    listName?: unknown;
    promoCode?: unknown;
  } | null;
  const listName = typeof raw?.listName === "string" ? raw.listName.trim() : "";
  const issues: BulkImportIssue[] = [];
  if (!listName) {
    issues.push({ scope: "file", message: "List name required." });
  } else if (listName.length > ORG_BULK_MAX_LIST_NAME_LENGTH) {
    issues.push({ scope: "file", message: "List name is too long." });
  }

  const parsed = parseBulkImportOrganizations(body);
  issues.push(...parsed.issues);

  const promoCode =
    typeof raw?.promoCode === "string" ? raw.promoCode.trim() : "";
  const promo = promoCode ? await findRedeemablePromo(promoCode) : null;
  if (promoCode && !promo) {
    issues.push({
      scope: "file",
      message:
        "Choose an active promo code that has not expired or reached its redemption limit.",
    });
  } else if (promo && promo.maxRedemptions != null) {
    const [pending] = await db
      .select({ count: sql<number>`count(*)` })
      .from(organizations)
      .where(eq(organizations.pendingPromoCodeId, promo.id));
    const committedAssignments =
      promo.redemptionCount + Number(pending?.count ?? 0);
    if (
      committedAssignments + parsed.organizations.length >
      promo.maxRedemptions
    ) {
      issues.push({
        scope: "file",
        message: `Promo code "${promo.code}" does not have enough remaining redemptions for this batch. Reduce the batch or choose another code.`,
      });
    }
  }

  const existingByName = new Map<string, { id: string; name: string }>();
  if (checkExistingNames && parsed.organizations.length > 0) {
    const names = parsed.organizations
      .map((organization) => organization.name)
      .filter(Boolean);
    const nameWhere =
      names.length > 0
        ? or(
            ...names.map(
              (name) =>
                sql`lower(${organizations.name}) = ${name.toLowerCase()}`,
            ),
          )
        : undefined;
    if (nameWhere) {
      const rows = await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(nameWhere);
      for (const row of rows) existingByName.set(row.name.toLowerCase(), row);
      for (let i = 0; i < parsed.organizations.length; i++) {
        const existing = existingByName.get(
          parsed.organizations[i].name.toLowerCase(),
        );
        if (existing) {
          issues.push({
            scope: "organization",
            organizationIndex: i,
            message: `Organization "${existing.name}" already exists. Imports never merge into an existing organization.`,
          });
        }
      }
    }
  }

  let existingList: { id: string; name: string } | null = null;
  if (listName) {
    const [row] = await db
      .select({ id: orgAdminLists.id, name: orgAdminLists.name })
      .from(orgAdminLists)
      .where(sql`lower(${orgAdminLists.name}) = ${listName.toLowerCase()}`)
      .limit(1);
    existingList = row ?? null;
  }
  return {
    listName,
    promo,
    existingList,
    organizations: parsed.organizations,
    issues,
  };
}

function bulkImportIssuesResponse(issues: BulkImportIssue[]) {
  return issues.map((issue) => ({
    scope: issue.scope,
    organizationIndex: issue.organizationIndex ?? null,
    teamIndex: issue.teamIndex ?? null,
    message: issue.message,
  }));
}

router.post(
  "/org-bulk-import/validate",
  asyncHandler(async (req, res) => {
    const result = await bulkImportPreflight(req.body, true);
    res.json({
      data: {
        valid: result.issues.length === 0,
        list: result.existingList,
        promo: result.promo
          ? {
              code: result.promo.code,
              description: result.promo.description,
              discountType: result.promo.discountType,
              discountValue: result.promo.discountValue,
            }
          : null,
        organizations: result.organizations,
        issues: bulkImportIssuesResponse(result.issues),
      },
    });
  }),
);

router.post(
  "/org-bulk-import",
  asyncHandler(async (req, res) => {
    const preflight = await bulkImportPreflight(req.body, false);
    if (preflight.issues.length > 0) {
      return res.status(400).json({
        error: preflight.issues[0]?.message ?? "Invalid organization import.",
        code: "BULK_IMPORT_INVALID",
        issues: bulkImportIssuesResponse(preflight.issues),
      });
    }
    const selectedPromo = preflight.promo;

    const namesInOrder = preflight.organizations
      .map((organization) => organization.name)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const result = await db.transaction(async (tx) => {
      // Serialize concurrent imports that contain the same organization name
      // so a retry cannot pass a stale preview and create a duplicate.
      for (const name of namesInOrder) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"org-name:" + name.toLowerCase()}))`,
        );
      }
      type LockedPromo = {
        id: string;
        active: boolean;
        expires_at: Date | null;
        max_redemptions: number | null;
        redemption_count: number;
      };
      if (selectedPromo) {
        const promoResult = await tx.execute<LockedPromo>(
          sql`SELECT id, active, expires_at, max_redemptions, redemption_count
              FROM promo_codes
              WHERE id = ${selectedPromo.id}
              FOR UPDATE`,
        );
        const lockedPromo = (promoResult.rows ?? promoResult)[0] as
          | LockedPromo
          | undefined;
        const promoUnavailable =
          !lockedPromo ||
          !lockedPromo.active ||
          (lockedPromo.expires_at &&
            new Date(lockedPromo.expires_at).getTime() <= Date.now());
        if (promoUnavailable) {
          return {
            promoConflict:
              "That promo code was deactivated or expired while this import was being prepared.",
          } as const;
        }
        if (lockedPromo.max_redemptions != null) {
          const [pending] = await tx
            .select({ count: sql<number>`count(*)` })
            .from(organizations)
            .where(eq(organizations.pendingPromoCodeId, lockedPromo.id));
          const committedAssignments =
            lockedPromo.redemption_count + Number(pending?.count ?? 0);
          if (
            committedAssignments + preflight.organizations.length >
            lockedPromo.max_redemptions
          ) {
            return {
              promoConflict:
                "That promo code no longer has enough remaining redemptions for this batch.",
            } as const;
          }
        }
      }
      const duplicateRows = await tx
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(
          or(
            ...preflight.organizations.map(
              (organization) =>
                sql`lower(${organizations.name}) = ${organization.name.toLowerCase()}`,
            ),
          ),
        );
      if (duplicateRows.length > 0) {
        return { conflict: duplicateRows } as const;
      }

      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"org-list:" + preflight.listName.toLowerCase()}))`,
      );
      let [list] = await tx
        .select({ id: orgAdminLists.id, name: orgAdminLists.name })
        .from(orgAdminLists)
        .where(
          sql`lower(${orgAdminLists.name}) = ${preflight.listName.toLowerCase()}`,
        )
        .limit(1);
      if (!list) {
        const inserted = await tx.execute<{
          id: string;
          name: string;
        }>(sql`
          INSERT INTO org_admin_lists (name, created_by_id)
          VALUES (${preflight.listName}, ${req.sessionUser!.id})
          ON CONFLICT ((lower(name))) DO NOTHING
          RETURNING id, name
        `);
        const insertedRows = (inserted.rows ?? inserted) as Array<{
          id: string;
          name: string;
        }>;
        if (insertedRows.length > 0) {
          list = insertedRows[0];
        } else {
          [list] = await tx
            .select({ id: orgAdminLists.id, name: orgAdminLists.name })
            .from(orgAdminLists)
            .where(
              sql`lower(${orgAdminLists.name}) = ${preflight.listName.toLowerCase()}`,
            )
            .limit(1);
        }
      }
      if (!list) throw new Error("Organization list could not be created.");

      const created: Array<{
        id: string;
        name: string;
        token: string;
        teams: Array<{ id: string; name: string }>;
      }> = [];
      for (const organization of preflight.organizations) {
        const token = generateToken();
        const [org] = await tx
          .insert(organizations)
          .values({
            name: organization.name,
            claimToken: token,
            pendingPromoCodeId: selectedPromo?.id ?? null,
            adminListId: list.id,
          })
          .returning({ id: organizations.id, name: organizations.name });
        const createdTeams: Array<{ id: string; name: string }> = [];
        for (const teamName of organization.teams) {
          const [team] = await tx
            .insert(teams)
            .values({ organizationId: org.id, name: teamName })
            .returning({ id: teams.id, name: teams.name });
          createdTeams.push(team);
        }
        created.push({
          id: org.id,
          name: org.name,
          token,
          teams: createdTeams,
        });
      }
      return { list, created } as const;
    });

    const conflicts = "conflict" in result ? result.conflict : null;
    const promoConflict =
      "promoConflict" in result ? result.promoConflict : null;
    if (promoConflict) {
      return res.status(409).json({
        error: promoConflict,
        code: "PROMO_UNAVAILABLE",
        issues: [
          {
            scope: "file",
            organizationIndex: null,
            teamIndex: null,
            message: promoConflict,
          },
        ],
      });
    }
    if (conflicts) {
      return res.status(409).json({
        error: "One or more organizations already exist.",
        code: "ORG_NAME_TAKEN",
        issues: conflicts.map((row) => ({
          scope: "organization",
          organizationIndex: preflight.organizations.findIndex(
            (organization) =>
              organization.name.toLowerCase() === row.name.toLowerCase(),
          ),
          teamIndex: null,
          message: `Organization "${row.name}" already exists. Imports never merge into an existing organization.`,
        })),
      });
    }
    if (!("created" in result) || !result.created || !result.list) {
      throw new Error("Organization import did not return a result.");
    }
    const createdOrganizations = result.created;

    return res.status(201).json({
      data: {
        list: result.list,
        promoCode: selectedPromo?.code ?? null,
        organizations: createdOrganizations,
        organizationCount: createdOrganizations.length,
        teamCount: createdOrganizations.reduce(
          (sum, organization) => sum + organization.teams.length,
          0,
        ),
      },
    });
  }),
);

router.get(
  "/org-lists",
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({
        id: orgAdminLists.id,
        name: orgAdminLists.name,
        createdAt: orgAdminLists.createdAt,
        orgCount: sql<number>`count(${organizations.id})`.mapWith(Number),
      })
      .from(orgAdminLists)
      .leftJoin(organizations, ORG_LIST_OWNERLESS_JOIN)
      .groupBy(orgAdminLists.id)
      .orderBy(asc(orgAdminLists.name));
    res.json({
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        orgCount: r.orgCount,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  }),
);

router.post(
  "/org-lists",
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) {
      return res
        .status(400)
        .json({ error: "name required", code: "NAME_REQUIRED" });
    }
    if (name.length > 120) {
      return res
        .status(400)
        .json({ error: "name too long", code: "NAME_TOO_LONG" });
    }
    // Race-safe create-or-reuse: two admin tabs submitting the same name
    // (e.g. "Fall 2026 Soccer League") concurrently must converge on one
    // list, not have the second submit crash on the unique(lower(name))
    // index. INSERT ... ON CONFLICT DO NOTHING against that exact index
    // makes the losing writer a no-op instead of a unique-violation, and we
    // then re-select the winner's row.
    const inserted = await db.execute<{
      id: string;
      name: string;
      created_at: Date;
    }>(sql`
      INSERT INTO org_admin_lists (name, created_by_id)
      VALUES (${name}, ${req.sessionUser!.id})
      ON CONFLICT ((lower(name))) DO NOTHING
      RETURNING id, name, created_at
    `);
    const insertedRows = (inserted.rows ?? inserted) as Array<{
      id: string;
      name: string;
      created_at: Date;
    }>;
    if (insertedRows.length > 0) {
      const row = insertedRows[0];
      return res.status(201).json({
        data: {
          id: row.id,
          name: row.name,
          orgCount: 0,
          createdAt: new Date(row.created_at).toISOString(),
        },
      });
    }
    const [existing] = await db
      .select({ id: orgAdminLists.id, name: orgAdminLists.name })
      .from(orgAdminLists)
      .where(sql`lower(${orgAdminLists.name}) = ${name.toLowerCase()}`)
      .limit(1);
    if (!existing) {
      // Should be unreachable (the conflict target guarantees a matching
      // row exists), but fail loudly rather than silently 200-ing with
      // nothing if it ever happens.
      return res
        .status(500)
        .json({ error: "List creation raced unexpectedly" });
    }
    return res.status(200).json({
      data: { id: existing.id, name: existing.name, orgCount: null },
    });
  }),
);

router.delete(
  "/org-lists/:id",
  asyncHandler(async (req, res) => {
    const id = p(req.params.id);
    const [row] = await db
      .delete(orgAdminLists)
      .where(eq(orgAdminLists.id, id))
      .returning({ id: orgAdminLists.id });
    if (!row) return notFound(res, "List not found");
    res.json({ ok: true });
  }),
);

const BulkDeleteOrganizationsBody = z
  .object({
    organizationIds: z
      .array(z.string().uuid())
      .min(1)
      .max(ORG_BULK_DELETE_MAX_ORGS)
      .optional(),
    listId: z.string().uuid().optional(),
    deleteList: z.boolean().optional(),
    confirm: z.string(),
  })
  .superRefine((value, ctx) => {
    const selectedScope = value.organizationIds !== undefined;
    const listScope = value.listId !== undefined;
    if (selectedScope === listScope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose either organizationIds or listId.",
      });
    }
    if (value.deleteList && !listScope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "deleteList is only valid with listId.",
      });
    }
  });

// Permanently remove ownerless organization pages. This deliberately lives
// under the admin router rather than the public organization DELETE endpoint.
// Locking the organization rows before the final owner check serializes this
// operation with an in-flight claim: a claim that acquired its FK row lock
// first becomes protected, while a later claim cannot attach to a row this
// transaction has already committed to deleting.
router.post(
  "/org-claim-links/bulk-delete",
  asyncHandler(async (req, res) => {
    const parsed = BulkDeleteOrganizationsBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: `Choose up to ${ORG_BULK_DELETE_MAX_ORGS} organizations or one named list and provide confirmation.`,
        code: "INVALID_BULK_DELETE",
      });
    }

    const result = await db.transaction(async (tx) => {
      let list: { id: string; name: string } | null = null;
      if (parsed.data.listId) {
        [list] = await tx
          .select({ id: orgAdminLists.id, name: orgAdminLists.name })
          .from(orgAdminLists)
          .where(eq(orgAdminLists.id, parsed.data.listId))
          .limit(1);
        if (!list) return { notFound: true } as const;
      }

      const expectedConfirmation = list?.name ?? ORG_BULK_DELETE_CONFIRMATION;
      if (parsed.data.confirm !== expectedConfirmation) {
        return { confirmationRequired: true, expectedConfirmation } as const;
      }

      const requestedIds = parsed.data.organizationIds
        ? [...new Set(parsed.data.organizationIds)]
        : null;
      const candidatesResult = requestedIds
        ? await tx.execute<{ id: string; name: string }>(sql`
            SELECT id, name
            FROM organizations
            WHERE id IN (${sql.join(
              requestedIds.map((id) => sql`${id}`),
              sql`, `,
            )})
            ORDER BY id
            FOR UPDATE
          `)
        : await tx.execute<{ id: string; name: string }>(sql`
            SELECT id, name
            FROM organizations
            WHERE admin_list_id = ${list!.id}
            ORDER BY id
            FOR UPDATE
          `);
      const candidates = (candidatesResult.rows ?? candidatesResult) as Array<{
        id: string;
        name: string;
      }>;
      const candidateIds = candidates.map((row) => row.id);

      const owners =
        candidateIds.length === 0
          ? []
          : await tx
              .select({ organizationId: organizationAdmins.organizationId })
              .from(organizationAdmins)
              .where(
                and(
                  inArray(organizationAdmins.organizationId, candidateIds),
                  eq(organizationAdmins.role, "owner"),
                ),
              );
      const protectedIds = new Set(owners.map((row) => row.organizationId));
      const deletable = candidates.filter((row) => !protectedIds.has(row.id));
      const deletableIds = deletable.map((row) => row.id);

      if (deletableIds.length > 0) {
        // Most dependent rows have real ON DELETE CASCADE constraints.
        // These tables are intentionally polymorphic and therefore have no FK
        // to their target post, so remove their organization-owned targets
        // explicitly before cascading the organizations/teams/posts.
        await tx.execute(sql`
          WITH doomed_posts AS (
            SELECT 'article'::post_kind AS kind, a.id
              FROM articles a JOIN teams t ON t.id = a.team_id
             WHERE t.organization_id IN (${sql.join(
               deletableIds.map((id) => sql`${id}`),
               sql`, `,
             )})
            UNION ALL
            SELECT 'highlight'::post_kind, h.id
              FROM highlights h JOIN teams t ON t.id = h.team_id
             WHERE t.organization_id IN (${sql.join(
               deletableIds.map((id) => sql`${id}`),
               sql`, `,
             )})
            UNION ALL
            SELECT 'org_post'::post_kind, op.id
              FROM org_posts op
             WHERE op.organization_id IN (${sql.join(
               deletableIds.map((id) => sql`${id}`),
               sql`, `,
             )})
            UNION ALL
            SELECT 'news'::post_kind, nl.id
              FROM team_news_links nl JOIN teams t ON t.id = nl.team_id
             WHERE t.organization_id IN (${sql.join(
               deletableIds.map((id) => sql`${id}`),
               sql`, `,
             )})
          ),
          doomed_comments AS (
            SELECT pc.id
              FROM post_comments pc
              JOIN doomed_posts dp
                ON pc.post_kind = dp.kind AND pc.post_ref_id = dp.id
          )
          DELETE FROM content_reports cr
          USING doomed_comments dc
          WHERE cr.content_type = 'comment' AND cr.content_id = dc.id
        `);
        await tx.execute(sql`
          WITH doomed_posts AS (
            SELECT 'article'::post_kind AS kind, a.id
              FROM articles a JOIN teams t ON t.id = a.team_id
             WHERE t.organization_id IN (${sql.join(
               deletableIds.map((id) => sql`${id}`),
               sql`, `,
             )})
            UNION ALL
            SELECT 'highlight'::post_kind, h.id
              FROM highlights h JOIN teams t ON t.id = h.team_id
             WHERE t.organization_id IN (${sql.join(
               deletableIds.map((id) => sql`${id}`),
               sql`, `,
             )})
            UNION ALL
            SELECT 'org_post'::post_kind, op.id
              FROM org_posts op
             WHERE op.organization_id IN (${sql.join(
               deletableIds.map((id) => sql`${id}`),
               sql`, `,
             )})
            UNION ALL
            SELECT 'news'::post_kind, nl.id
              FROM team_news_links nl JOIN teams t ON t.id = nl.team_id
             WHERE t.organization_id IN (${sql.join(
               deletableIds.map((id) => sql`${id}`),
               sql`, `,
             )})
          )
          DELETE FROM post_comments pc
          USING doomed_posts dp
          WHERE pc.post_kind = dp.kind AND pc.post_ref_id = dp.id
        `);
        await tx.execute(sql`
          WITH doomed_posts AS (
            SELECT 'article'::post_kind AS kind, a.id FROM articles a JOIN teams t ON t.id = a.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT 'highlight'::post_kind, h.id FROM highlights h JOIN teams t ON t.id = h.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT 'org_post'::post_kind, op.id FROM org_posts op
              WHERE op.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT 'news'::post_kind, nl.id FROM team_news_links nl JOIN teams t ON t.id = nl.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
          )
          DELETE FROM post_reactions pr USING doomed_posts dp
          WHERE pr.post_kind = dp.kind AND pr.post_ref_id = dp.id
        `);
        await tx.execute(sql`
          WITH doomed_posts AS (
            SELECT 'article'::post_kind AS kind, a.id FROM articles a JOIN teams t ON t.id = a.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT 'highlight'::post_kind, h.id FROM highlights h JOIN teams t ON t.id = h.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT 'org_post'::post_kind, op.id FROM org_posts op
              WHERE op.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT 'news'::post_kind, nl.id FROM team_news_links nl JOIN teams t ON t.id = nl.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
          )
          DELETE FROM post_shares ps USING doomed_posts dp
          WHERE ps.post_kind = dp.kind AND ps.post_ref_id = dp.id
        `);
        await tx.execute(sql`
          WITH doomed_posts AS (
            SELECT 'article'::post_kind AS kind, a.id FROM articles a JOIN teams t ON t.id = a.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT 'highlight'::post_kind, h.id FROM highlights h JOIN teams t ON t.id = h.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT 'org_post'::post_kind, op.id FROM org_posts op
              WHERE op.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT 'news'::post_kind, nl.id FROM team_news_links nl JOIN teams t ON t.id = nl.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
          )
          DELETE FROM album_photos ap USING doomed_posts dp
          WHERE ap.post_kind = dp.kind AND ap.post_ref_id = dp.id
        `);
        await tx.execute(sql`
          WITH doomed_posts AS (
            SELECT 'article'::post_kind AS kind, a.id FROM articles a JOIN teams t ON t.id = a.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT 'highlight'::post_kind, h.id FROM highlights h JOIN teams t ON t.id = h.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT 'org_post'::post_kind, op.id FROM org_posts op
              WHERE op.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT 'news'::post_kind, nl.id FROM team_news_links nl JOIN teams t ON t.id = nl.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
          )
          DELETE FROM takedown_requests tr USING doomed_posts dp
          WHERE tr.post_kind = dp.kind AND tr.post_ref_id = dp.id
        `);
        await tx.execute(sql`
          WITH doomed_content AS (
            SELECT a.id FROM articles a JOIN teams t ON t.id = a.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT h.id FROM highlights h JOIN teams t ON t.id = h.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT op.id FROM org_posts op
              WHERE op.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
            UNION ALL SELECT nl.id FROM team_news_links nl JOIN teams t ON t.id = nl.team_id
              WHERE t.organization_id IN (${sql.join(
                deletableIds.map((id) => sql`${id}`),
                sql`, `,
              )})
          )
          DELETE FROM content_reports cr USING doomed_content dc
          WHERE cr.content_id = dc.id
        `);
        await tx.execute(sql`
          DELETE FROM conversation_participants cp
          WHERE cp.participant_type = 'organization'
            AND cp.participant_id IN (${sql.join(
              deletableIds.map((id) => sql`${id}`),
              sql`, `,
            )})
        `);
        await tx
          .delete(organizations)
          .where(inArray(organizations.id, deletableIds));
      }

      let listDeleted = false;
      if (list && parsed.data.deleteList) {
        await tx.delete(orgAdminLists).where(eq(orgAdminLists.id, list.id));
        listDeleted = true;
      }

      const missingCount = requestedIds
        ? requestedIds.length - candidates.length
        : 0;
      return {
        data: {
          requestedCount: requestedIds?.length ?? candidates.length,
          deletedCount: deletable.length,
          deleted: deletable,
          protectedCount: candidates.length - deletable.length,
          protected: candidates.filter((row) => protectedIds.has(row.id)),
          missingCount,
          listDeleted,
          list: list ? { id: list.id, name: list.name } : null,
        },
      } as const;
    });

    if ("notFound" in result) return notFound(res, "List not found");
    if ("confirmationRequired" in result) {
      return res.status(400).json({
        error: "Type the required confirmation exactly.",
        code: "CONFIRMATION_REQUIRED",
      });
    }
    return res.json(result);
  }),
);

// Assign, move, or clear an ownerless org's list from the Org Links table.
// Lists are an ownerless-org-only concept — once an org is claimed it drops
// off the Org Links table and its `adminListId` is cleared by the claim
// transaction, so this write must never be able to land on an already-owned
// org (which would otherwise silently resurrect a stale list membership the
// Org Links view — and its counts — can never show).
//
// The owner check and the write are done as ONE conditional UPDATE rather
// than a separate SELECT-then-UPDATE, because the latter has a real race
// with the claim transaction: a claim could commit (insert the owner row +
// null out adminListId) in the gap between this route's owner check and its
// write, and the write would then silently re-set adminListId on a
// just-claimed org. A single `UPDATE ... WHERE NOT EXISTS (owner)` closes
// that gap — Postgres re-evaluates the WHERE clause against the latest
// committed row if it has to wait on a concurrent UPDATE of the same row
// (e.g. the claim transaction's own `adminListId = NULL` write), so the two
// writers always serialize to a consistent outcome instead of interleaving.
router.patch(
  "/org-claim-links/:id/list",
  asyncHandler(async (req, res) => {
    const id = p(req.params.id);
    let listId: string | null = null;
    if (req.body?.listId != null && req.body.listId !== "") {
      listId = String(req.body.listId);
      const [list] = await db
        .select({ id: orgAdminLists.id })
        .from(orgAdminLists)
        .where(eq(orgAdminLists.id, listId))
        .limit(1);
      if (!list) {
        return res
          .status(400)
          .json({ error: "List not found", code: "LIST_NOT_FOUND" });
      }
    }
    const ownerExists = sql`EXISTS (
      SELECT 1 FROM ${organizationAdmins}
      WHERE ${organizationAdmins.organizationId} = ${organizations.id}
        AND ${organizationAdmins.role} = 'owner'
    )`;
    const [row] = await db
      .update(organizations)
      .set({ adminListId: listId })
      .where(and(eq(organizations.id, id), sql`NOT ${ownerExists}`))
      .returning({ id: organizations.id });
    if (row) return res.json({ ok: true, listId });
    // Zero rows updated — either the org doesn't exist, or it does but lost
    // the WHERE NOT ownerExists check (already claimed, possibly by a claim
    // that raced this very request). Disambiguate with a follow-up read.
    const [exists] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    if (!exists) return notFound(res, "Organization not found");
    return res.status(400).json({
      error: "Organization is already claimed and cannot be added to a list",
      code: "ALREADY_CLAIMED",
    });
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
    // The recent "Orgs I set up" section launched on 2026-08-14. Until the
    // inline add route was brought into parity, it created operator-set-up
    // organizations without stamping createdViaQuickSetupAt. Treat rows
    // created during that short gap as recent setups so existing saves are
    // not stranded in the bulk-imported list.
    const operatorSetupCompatCutoff = new Date("2026-08-14T00:00:00.000Z");
    const ownerExists = sql`EXISTS (
      SELECT 1 FROM ${organizationAdmins}
      WHERE ${organizationAdmins.organizationId} = ${organizations.id}
        AND ${organizationAdmins.role} = 'owner'
    )`;
    // Task #929 — optional `?listId=` narrows to one operator-created list;
    // pass `?listId=none` for unlisted orgs. Omitted = all (unfiltered).
    const listIdFilter =
      typeof req.query.listId === "string" ? req.query.listId : undefined;
    const listWhere =
      listIdFilter === undefined
        ? sql`true`
        : listIdFilter === "none"
          ? sql`${organizations.adminListId} IS NULL`
          : sql`${organizations.adminListId} = ${listIdFilter}`;

    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        city: organizations.city,
        state: organizations.state,
        logoUrl: organizations.logoUrl,
        claimToken: organizations.claimToken,
        outreachMessagedAt: organizations.outreachMessagedAt,
        outreachFacebookAddedAt: organizations.outreachFacebookAddedAt,
        createdViaQuickSetupAt: organizations.createdViaQuickSetupAt,
        createdAt: organizations.createdAt,
        adminListId: organizations.adminListId,
        adminListName: orgAdminLists.name,
      })
      .from(organizations)
      .leftJoin(orgAdminLists, eq(organizations.adminListId, orgAdminLists.id))
      .where(and(sql`NOT ${ownerExists}`, listWhere))
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
      facebookAddedAt: string | null;
      quickSetupAt: string | null;
      listId: string | null;
      listName: string | null;
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
        facebookAddedAt: r.outreachFacebookAddedAt
          ? r.outreachFacebookAddedAt.toISOString()
          : null,
        listId: r.adminListId,
        listName: r.adminListName,
        // Non-null for operator-created orgs so the Claim Links tab lists
        // them in its recent section. createdAt is a compatibility fallback
        // for inline saves made between that section's launch and this fix.
        quickSetupAt:
          (
            r.createdViaQuickSetupAt ??
            (r.createdAt >= operatorSetupCompatCutoff ? r.createdAt : null)
          )?.toISOString() ?? null,
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
      return res
        .status(400)
        .json({ error: "name required", code: "NAME_REQUIRED" });
    }
    if (name.length > 200) {
      return res
        .status(400)
        .json({ error: "name too long", code: "NAME_TOO_LONG" });
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
    // Optional logo + brand colors so the operator can brand the page at
    // creation time (same rules as org-quick-setup; app.ts gives this route
    // the 21 MB image JSON parser for the inline data: URL).
    let logoUrl: string | null = null;
    if (typeof req.body?.logoUrl === "string" && req.body.logoUrl) {
      if (!req.body.logoUrl.startsWith("data:image/")) {
        return res.status(400).json({
          error: "logoUrl must be an image data URL",
          code: "INVALID_LOGO",
        });
      }
      if (req.body.logoUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        return res
          .status(413)
          .json({ error: "logo too large", code: "LOGO_TOO_LARGE" });
      }
      logoUrl = req.body.logoUrl;
    }
    let brandPrimaryColor: string | null = null;
    let brandSecondaryColor: string | null = null;
    for (const [key, assign] of [
      ["brandPrimaryColor", (v: string) => (brandPrimaryColor = v)],
      ["brandSecondaryColor", (v: string) => (brandSecondaryColor = v)],
    ] as const) {
      const raw = (req.body as Record<string, unknown>)[key];
      if (raw == null || raw === "") continue;
      const v = String(raw).trim();
      if (!QUICK_SETUP_HEX_RE.test(v)) {
        return res.status(400).json({
          error: `${key} must be a #rrggbb hex color`,
          code: "INVALID_COLOR",
        });
      }
      assign(v.toLowerCase());
    }
    // Task #856 — optional staged plan tier + promo code (same rules as the
    // quick-setup route): validated now, stored on the org, and pre-selected /
    // auto-applied when the new owner reaches the subscribe page.
    let pendingPlan: PlanTier | null = null;
    if (req.body?.tier != null && req.body.tier !== "") {
      const t = String(req.body.tier).trim().toLowerCase();
      if (!(t in PLAN_TEAM_LIMITS)) {
        return res.status(400).json({
          error: `tier must be one of: ${Object.keys(PLAN_TEAM_LIMITS).join(", ")}`,
          code: "INVALID_TIER",
        });
      }
      pendingPlan = t as PlanTier;
    }
    let pendingPromoCodeId: string | null = null;
    if (typeof req.body?.promoCode === "string" && req.body.promoCode.trim()) {
      const promo = await findRedeemablePromo(req.body.promoCode);
      if (!promo) {
        return res.status(400).json({
          error:
            "That promo code isn't valid (inactive, expired, or fully redeemed).",
          code: "INVALID_PROMO_CODE",
        });
      }
      pendingPromoCodeId = promo.id;
    }
    // Task #929 — optional list to file this org under at creation time.
    let adminListId: string | null = null;
    if (typeof req.body?.listId === "string" && req.body.listId.trim()) {
      const requestedListId: string = String(req.body.listId).trim();
      const [list] = await db
        .select({ id: orgAdminLists.id })
        .from(orgAdminLists)
        .where(eq(orgAdminLists.id, requestedListId))
        .limit(1);
      if (!list) {
        return res
          .status(400)
          .json({ error: "List not found", code: "LIST_NOT_FOUND" });
      }
      adminListId = requestedListId;
    }
    const token = generateToken();
    const [org] = await db
      .insert(organizations)
      .values({
        name,
        claimToken: token,
        logoUrl: logoUrl ?? undefined,
        brandPrimaryColor: brandPrimaryColor ?? undefined,
        brandSecondaryColor: brandSecondaryColor ?? undefined,
        pendingPlan: pendingPlan ?? undefined,
        pendingPromoCodeId: pendingPromoCodeId ?? undefined,
        adminListId: adminListId ?? undefined,
        // Inline "Add an organization" is also an operator setup flow. Mark
        // it so Claim Links puts it in "Orgs I set up" alongside Quick setup.
        createdViaQuickSetupAt: new Date(),
      })
      .returning();
    return res.status(201).json({
      data: {
        id: org.id,
        name: org.name,
        city: org.city,
        state: org.state,
        logoUrl: org.logoUrl,
        token,
        listId: org.adminListId,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// Task #829 — One-page org quick setup. A platform admin fills out org info,
// bulk team rows, and per-team coach emails in one form and hits Save once.
// Everything is validated up front and created in a SINGLE transaction: the
// ownerless org (with claim token), its teams (no roster rows — hand-off
// model, same as the #808 flow), and staged coach drafts (no emails sent).
// Returns the org with its claim token so the operator can copy the link.
// NOTE: app.ts gives this route the 21 MB image JSON parser so `logoUrl` can
// be an inline base64 data: URL like the org PATCH route.
// ---------------------------------------------------------------------------
const QUICK_SETUP_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const QUICK_SETUP_MAX_TEAMS = 100;
const QUICK_SETUP_MAX_COACHES = 500;
const QUICK_SETUP_HEX_RE = /^#[0-9a-fA-F]{6}$/;

router.post(
  "/org-quick-setup",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const name = String(body.name ?? "").trim();
    if (!name) {
      return res
        .status(400)
        .json({ error: "name required", code: "NAME_REQUIRED" });
    }
    if (name.length > 200) {
      return res
        .status(400)
        .json({ error: "name too long", code: "NAME_TOO_LONG" });
    }
    const city =
      typeof body.city === "string"
        ? body.city.trim().slice(0, 120) || null
        : null;
    let state: string | null = null;
    if (typeof body.state === "string" && body.state.trim()) {
      const s = body.state.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(s)) {
        return res.status(400).json({
          error: "state must be a 2-letter code",
          code: "INVALID_STATE",
        });
      }
      state = s;
    }
    let logoUrl: string | null = null;
    if (typeof body.logoUrl === "string" && body.logoUrl) {
      if (!body.logoUrl.startsWith("data:image/")) {
        return res.status(400).json({
          error: "logoUrl must be an image data URL",
          code: "INVALID_LOGO",
        });
      }
      if (body.logoUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        return res
          .status(413)
          .json({ error: "logo too large", code: "LOGO_TOO_LARGE" });
      }
      logoUrl = body.logoUrl;
    }
    // Task #831 — optional org brand colors, stored on the same columns the
    // org branding editor uses.
    let brandPrimaryColor: string | null = null;
    let brandSecondaryColor: string | null = null;
    for (const [key, assign] of [
      ["brandPrimaryColor", (v: string) => (brandPrimaryColor = v)],
      ["brandSecondaryColor", (v: string) => (brandSecondaryColor = v)],
    ] as const) {
      const raw = (body as Record<string, unknown>)[key];
      if (raw == null || raw === "") continue;
      const v = String(raw).trim();
      if (!QUICK_SETUP_HEX_RE.test(v)) {
        return res.status(400).json({
          error: `${key} must be a #rrggbb hex color`,
          code: "INVALID_COLOR",
        });
      }
      assign(v.toLowerCase());
    }

    // Optional staged promo code — validated as redeemable now, stored on the
    // org, surfaced on the claim page, and auto-applied on the subscribe page.
    let pendingPromoCodeId: string | null = null;
    if (typeof body.promoCode === "string" && body.promoCode.trim()) {
      const promo = await findRedeemablePromo(body.promoCode);
      if (!promo) {
        return res.status(400).json({
          error:
            "That promo code isn't valid (inactive, expired, or fully redeemed).",
          code: "INVALID_PROMO_CODE",
        });
      }
      pendingPromoCodeId = promo.id;
    }

    // Task #856 — optional staged plan tier. Stored on the org, pre-selected
    // on the new owner's subscribe page (they can still change it). Omitted
    // = no staged tier; the org behaves exactly as before (Starter default).
    let pendingPlan: PlanTier | null = null;
    if (body.tier != null && body.tier !== "") {
      const t = String(body.tier).trim().toLowerCase();
      if (!(t in PLAN_TEAM_LIMITS)) {
        return res.status(400).json({
          error: `tier must be one of: ${Object.keys(PLAN_TEAM_LIMITS).join(", ")}`,
          code: "INVALID_TIER",
        });
      }
      pendingPlan = t as PlanTier;
    }

    // Task #929 — optional list to file this org under at creation time.
    let adminListId: string | null = null;
    if (typeof body.listId === "string" && body.listId.trim()) {
      const requestedListId: string = String(body.listId).trim();
      const [list] = await db
        .select({ id: orgAdminLists.id })
        .from(orgAdminLists)
        .where(eq(orgAdminLists.id, requestedListId))
        .limit(1);
      if (!list) {
        return res
          .status(400)
          .json({ error: "List not found", code: "LIST_NOT_FOUND" });
      }
      adminListId = requestedListId;
    }

    const teamsRaw = Array.isArray(body.teams) ? body.teams : [];
    if (teamsRaw.length > QUICK_SETUP_MAX_TEAMS) {
      return res.status(400).json({
        error: `too many teams (max ${QUICK_SETUP_MAX_TEAMS})`,
        code: "TOO_MANY_TEAMS",
      });
    }
    // Enforce the team cap of the staged tier (or the default entry tier when
    // none was picked) up front — same source of truth as the normal
    // team-create route. No advisory lock needed: the org doesn't exist
    // until this transaction commits, so nothing can race its team count.
    const capPlan = pendingPlan ?? DEFAULT_PLAN;
    const teamCap = teamLimitForPlan(capPlan);
    if (teamCap != null && teamsRaw.length > teamCap) {
      return res.status(400).json({
        error: `The ${capPlan} plan allows up to ${teamCap} teams. Remove some teams${pendingPlan ? " or pick a higher tier" : " or have the org upgrade after claiming"}.`,
        code: "TEAM_LIMIT_REACHED",
      });
    }

    // Validate every row BEFORE any write so a failure is all-or-nothing and
    // the client can highlight the offending row via `index`.
    // Task #831 — gender and website were dropped from quick setup (org
    // admins configure those later); any values sent are ignored.
    type TeamInput = {
      name: string;
      coachEmails: string[];
    };
    const teamInputs: TeamInput[] = [];
    const seenTeamNames = new Set<string>();
    let totalCoaches = 0;
    for (let i = 0; i < teamsRaw.length; i++) {
      const t = teamsRaw[i] ?? {};
      const teamName = String(t.name ?? "").trim();
      if (!teamName) {
        return res.status(400).json({
          error: `Team ${i + 1}: name required`,
          code: "TEAM_NAME_REQUIRED",
          index: i,
        });
      }
      if (teamName.length > 200) {
        return res.status(400).json({
          error: `Team ${i + 1}: name too long`,
          code: "TEAM_NAME_TOO_LONG",
          index: i,
        });
      }
      const nameKey = teamName.toLowerCase();
      if (seenTeamNames.has(nameKey)) {
        return res.status(400).json({
          error: `Team ${i + 1}: duplicate team name "${teamName}"`,
          code: "DUPLICATE_TEAM_NAME",
          index: i,
        });
      }
      seenTeamNames.add(nameKey);
      const emailsRaw = Array.isArray(t.coachEmails) ? t.coachEmails : [];
      const emails: string[] = [];
      const seenEmails = new Set<string>();
      for (const raw of emailsRaw) {
        const email = String(raw ?? "")
          .trim()
          .toLowerCase();
        if (!email) continue;
        if (!QUICK_SETUP_EMAIL_RE.test(email)) {
          return res.status(400).json({
            error: `Team ${i + 1}: invalid email "${String(raw)}"`,
            code: "INVALID_EMAIL",
            index: i,
          });
        }
        if (seenEmails.has(email)) continue;
        seenEmails.add(email);
        emails.push(email);
      }
      totalCoaches += emails.length;
      teamInputs.push({ name: teamName, coachEmails: emails });
    }
    if (totalCoaches > QUICK_SETUP_MAX_COACHES) {
      return res.status(400).json({
        error: `too many coach emails (max ${QUICK_SETUP_MAX_COACHES})`,
        code: "TOO_MANY_COACHES",
      });
    }

    const token = generateToken();
    const result = await db.transaction(async (tx) => {
      // Exact-name duplicate check (same rule as POST /org-claim-links),
      // done INSIDE the transaction behind an advisory lock keyed on the
      // lowercased name so two concurrent quick-setups with the same name
      // serialize and the second one sees the first's insert (there is no
      // DB unique index on lower(name) to fall back on).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"org-name:" + name.toLowerCase()}))`,
      );
      const existing = await tx
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(sql`lower(${organizations.name}) = ${name.toLowerCase()}`)
        .limit(1);
      if (existing.length > 0) {
        return { taken: existing[0] } as const;
      }
      const [org] = await tx
        .insert(organizations)
        .values({
          name,
          city: city ?? undefined,
          state: state ?? undefined,
          logoUrl: logoUrl ?? undefined,
          brandPrimaryColor: brandPrimaryColor ?? undefined,
          brandSecondaryColor: brandSecondaryColor ?? undefined,
          pendingPromoCodeId: pendingPromoCodeId ?? undefined,
          pendingPlan: pendingPlan ?? undefined,
          adminListId: adminListId ?? undefined,
          claimToken: token,
          // Task #860 — mark quick-setup orgs as "orgs I know" so the
          // Claim links tab can surface them in their own section.
          createdViaQuickSetupAt: new Date(),
        })
        .returning();
      const createdTeams: Array<{ id: string; name: string }> = [];
      const staged: Array<{
        organizationId: string;
        teamId: string;
        email: string;
        createdById: string;
      }> = [];
      for (const t of teamInputs) {
        const [team] = await tx
          .insert(teams)
          .values({
            organizationId: org.id,
            name: t.name,
          })
          .returning({ id: teams.id, name: teams.name });
        createdTeams.push(team);
        for (const email of t.coachEmails) {
          staged.push({
            organizationId: org.id,
            teamId: team.id,
            email,
            createdById: req.sessionUser!.id,
          });
        }
      }
      if (staged.length > 0) {
        await tx.insert(stagedCoachInvites).values(staged);
      }
      return { org, createdTeams, stagedCount: staged.length } as const;
    });

    if ("taken" in result) {
      return res.status(409).json({
        error: "An organization with this name already exists",
        code: "ORG_NAME_TAKEN",
        existing: result.taken,
      });
    }

    return res.status(201).json({
      data: {
        id: result.org.id,
        name: result.org.name,
        city: result.org.city,
        state: result.org.state,
        logoUrl: result.org.logoUrl,
        token,
        listId: result.org.adminListId,
        teams: result.createdTeams,
        stagedCoachCount: result.stagedCount,
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

// Toggle whether the operator has added this org on Facebook. Independent
// from the "messaged" flag. facebookAdded=true stamps now(), false clears.
router.patch(
  "/org-claim-links/:id/facebook-added",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const facebookAdded = req.body?.facebookAdded;
    if (typeof facebookAdded !== "boolean") {
      return res.status(400).json({
        error: "facebookAdded must be a boolean",
        code: "INVALID_BODY",
      });
    }
    const [org] = await db
      .update(organizations)
      .set({ outreachFacebookAddedAt: facebookAdded ? new Date() : null })
      .where(eq(organizations.id, id))
      .returning({
        id: organizations.id,
        facebookAddedAt: organizations.outreachFacebookAddedAt,
      });
    if (!org) {
      return res
        .status(404)
        .json({ error: "organization not found", code: "ORG_NOT_FOUND" });
    }
    return res.json({
      data: {
        id: org.id,
        facebookAddedAt: org.facebookAddedAt
          ? org.facebookAddedAt.toISOString()
          : null,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// Competition claim links (mirrors the org claim-links screen)
// ---------------------------------------------------------------------------
// Admin screen listing every OWNERLESS competition (owner_user_id AND
// created_by_id both NULL) with its durable secret claim token. The operator
// copies each link to the corresponding organizer; whoever opens it and signs
// up becomes the competition's operator. Self-healing: any ownerless
// competition missing a token gets one minted on read.

// Mirror of tournaments.ts slugify — base name + short random suffix so two
// same-named competitions never collide on the unique slug.
function competitionSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const suffix = generateToken().slice(0, 8).toLowerCase();
  return base ? `${base}-${suffix}` : suffix;
}

const competitionOwnerless = and(
  isNull(tournaments.ownerUserId),
  isNull(tournaments.createdById),
);

router.get(
  "/competition-claim-links",
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        type: tournaments.type,
        slug: tournaments.slug,
        location: tournaments.location,
        startDate: tournaments.startDate,
        endDate: tournaments.endDate,
        logoUrl: tournaments.logoUrl,
        brandColor: tournaments.brandColor,
        secondaryColor: tournaments.secondaryColor,
        promoCode: tournaments.promoCode,
        claimToken: tournaments.claimToken,
        outreachMessagedAt: tournaments.outreachMessagedAt,
        outreachFacebookAddedAt: tournaments.outreachFacebookAddedAt,
      })
      .from(tournaments)
      .where(competitionOwnerless)
      .orderBy(asc(tournaments.name));

    // Mint a token for any ownerless competition that lacks one (idempotent).
    const out: Array<{
      id: string;
      name: string;
      type: string;
      slug: string;
      location: string | null;
      startDate: string;
      endDate: string;
      logoUrl: string | null;
      brandColor: string | null;
      secondaryColor: string | null;
      promoCode: string | null;
      token: string;
      messagedAt: string | null;
      facebookAddedAt: string | null;
    }> = [];
    for (const r of rows) {
      let token = r.claimToken;
      if (!token) {
        token = generateToken();
        // Re-check ownerless in the WHERE so we never mint a token for a
        // competition that got claimed between the select and this update.
        const minted = await db
          .update(tournaments)
          .set({ claimToken: token })
          .where(
            and(
              eq(tournaments.id, r.id),
              isNull(tournaments.ownerUserId),
              isNull(tournaments.createdById),
            ),
          )
          .returning({ id: tournaments.id });
        if (minted.length === 0) continue;
      }
      out.push({
        id: r.id,
        name: r.name,
        type: r.type,
        slug: r.slug,
        location: r.location,
        startDate: r.startDate,
        endDate: r.endDate,
        logoUrl: r.logoUrl,
        brandColor: r.brandColor,
        secondaryColor: r.secondaryColor,
        promoCode: r.promoCode,
        token,
        messagedAt: r.outreachMessagedAt
          ? r.outreachMessagedAt.toISOString()
          : null,
        facebookAddedAt: r.outreachFacebookAddedAt
          ? r.outreachFacebookAddedAt.toISOString()
          : null,
      });
    }
    res.json({ data: out });
  }),
);

// Live duplicate detection for the "Add competition" field — surfaces any
// existing competition (claimed or not) whose name matches.
router.get(
  "/competition-name-check",
  asyncHandler(async (req, res) => {
    const name = String(req.query.name ?? "").trim();
    if (name.length < 2) {
      return res.json({ data: [] });
    }
    const rows = await db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        type: tournaments.type,
        startDate: tournaments.startDate,
        hasOwner: sql<boolean>`(${tournaments.ownerUserId} IS NOT NULL OR ${tournaments.createdById} IS NOT NULL)`,
      })
      .from(tournaments)
      .where(sql`${tournaments.name} ILIKE ${"%" + escapeLike(name) + "%"}`)
      .orderBy(asc(tournaments.name))
      .limit(8);
    const needle = name.toLowerCase();
    return res.json({
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        startDate: r.startDate,
        hasOwner: Boolean(r.hasOwner),
        exact: r.name.toLowerCase() === needle,
      })),
    });
  }),
);

// Shared logo validation for the claim-links routes: inline base64
// data:image URL (capped, friendly 413) or plain http(s) URL.
function parseClaimLinkLogo(
  raw: unknown,
):
  | { ok: true; logoUrl: string | null }
  | { ok: false; status: number; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, logoUrl: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, status: 400, error: "logoUrl must be a string" };
  }
  if (raw.startsWith("data:")) {
    if (!raw.startsWith("data:image/")) {
      return { ok: false, status: 400, error: "logoUrl must be an image" };
    }
    if (raw.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return {
        ok: false,
        status: 413,
        error: "That image is too large. Please choose a smaller photo.",
      };
    }
    return { ok: true, logoUrl: raw };
  }
  if (/^https?:\/\//.test(raw) && raw.length <= 2000) {
    return { ok: true, logoUrl: raw };
  }
  return {
    ok: false,
    status: 400,
    error: "logoUrl must be an image data: URL or http(s) URL",
  };
}

// Create a fresh ownerless competition with a claim token. Unlike orgs,
// competitions require a type + active window (start/end dates are NOT NULL
// and gate recap authoring), so the form collects them up front. An optional
// logo can be attached so the organizer's page is already branded when they
// claim it.
router.post(
  "/competition-claim-links",
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) {
      return res
        .status(400)
        .json({ error: "name required", code: "NAME_REQUIRED" });
    }
    if (name.length > 200) {
      return res
        .status(400)
        .json({ error: "name too long", code: "NAME_TOO_LONG" });
    }
    const type = req.body?.type === "league" ? "league" : "tournament";
    const startDate = String(req.body?.startDate ?? "").trim();
    const endDate = String(req.body?.endDate ?? "").trim();
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(startDate) || !dateRe.test(endDate)) {
      return res.status(400).json({
        error: "startDate and endDate must be YYYY-MM-DD",
        code: "INVALID_DATES",
      });
    }
    if (endDate < startDate) {
      return res.status(400).json({
        error: "endDate must be on or after startDate",
        code: "INVALID_DATES",
      });
    }
    const existing = await db
      .select({ id: tournaments.id, name: tournaments.name })
      .from(tournaments)
      .where(sql`lower(${tournaments.name}) = ${name.toLowerCase()}`)
      .limit(1);
    if (existing.length > 0) {
      return res.status(409).json({
        error: "A competition with this name already exists",
        code: "COMPETITION_NAME_TAKEN",
        existing: existing[0],
      });
    }
    const logo = parseClaimLinkLogo(req.body?.logoUrl);
    if (!logo.ok) {
      return res
        .status(logo.status)
        .json({ error: logo.error, code: "INVALID_LOGO" });
    }
    const token = generateToken();
    const [row] = await db
      .insert(tournaments)
      .values({
        slug: competitionSlug(name),
        name,
        type,
        startDate,
        endDate,
        claimToken: token,
        ...(logo.logoUrl ? { logoUrl: logo.logoUrl } : {}),
      })
      .returning();
    return res.status(201).json({
      data: {
        id: row.id,
        name: row.name,
        type: row.type,
        slug: row.slug,
        location: row.location,
        startDate: row.startDate,
        endDate: row.endDate,
        logoUrl: row.logoUrl,
        token,
      },
    });
  }),
);

// Set / replace / clear the logo on an ownerless competition so its page is
// already branded when the organizer claims it. Body: { logoUrl } where
// null/"" clears. Restricted to ownerless competitions — once claimed, the
// operator manages branding through the normal competition settings.
router.patch(
  "/competition-claim-links/:id/logo",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const logo = parseClaimLinkLogo(req.body?.logoUrl);
    if (!logo.ok) {
      return res
        .status(logo.status)
        .json({ error: logo.error, code: "INVALID_LOGO" });
    }
    const [row] = await db
      .update(tournaments)
      .set({ logoUrl: logo.logoUrl, updatedAt: new Date() })
      .where(
        and(
          eq(tournaments.id, id),
          isNull(tournaments.ownerUserId),
          isNull(tournaments.createdById),
        ),
      )
      .returning({ id: tournaments.id, logoUrl: tournaments.logoUrl });
    if (!row) {
      return res.status(404).json({
        error: "Ownerless competition not found (it may already be claimed)",
        code: "COMPETITION_NOT_FOUND",
      });
    }
    return res.json({ data: { id: row.id, logoUrl: row.logoUrl } });
  }),
);

// Set / clear brand colors on an ownerless competition so its page (and
// claim landing card) is already branded when the organizer claims it.
// Body: { brandColor?, secondaryColor? } — #rrggbb hex or null/"" to clear;
// omitted fields are left untouched.
router.patch(
  "/competition-claim-links/:id/branding",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const HEX = /^#[0-9a-fA-F]{6}$/;
    const parseColor = (
      raw: unknown,
      field: string,
    ): { ok: true; value: string | null } | { ok: false; error: string } => {
      if (raw === null || raw === "") return { ok: true, value: null };
      if (typeof raw !== "string" || !HEX.test(raw.trim())) {
        return { ok: false, error: `${field} must be a #rrggbb hex color` };
      }
      return { ok: true, value: raw.trim() };
    };
    const updates: {
      brandColor?: string | null;
      secondaryColor?: string | null;
    } = {};
    if (req.body && "brandColor" in req.body) {
      const p = parseColor(req.body.brandColor, "brandColor");
      if (!p.ok)
        return res.status(400).json({ error: p.error, code: "INVALID_COLOR" });
      updates.brandColor = p.value;
    }
    if (req.body && "secondaryColor" in req.body) {
      const p = parseColor(req.body.secondaryColor, "secondaryColor");
      if (!p.ok)
        return res.status(400).json({ error: p.error, code: "INVALID_COLOR" });
      updates.secondaryColor = p.value;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: "Provide brandColor and/or secondaryColor",
        code: "INVALID_BODY",
      });
    }
    const [row] = await db
      .update(tournaments)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(tournaments.id, id),
          isNull(tournaments.ownerUserId),
          isNull(tournaments.createdById),
        ),
      )
      .returning({
        id: tournaments.id,
        brandColor: tournaments.brandColor,
        secondaryColor: tournaments.secondaryColor,
      });
    if (!row) {
      return res.status(404).json({
        error: "Ownerless competition not found (it may already be claimed)",
        code: "COMPETITION_NOT_FOUND",
      });
    }
    return res.json({ data: row });
  }),
);

// Set / clear the promo code on an ownerless competition. The code lands in
// tournaments.promo_code, which is exactly the field the operator's invite
// message auto-fills from (Task #818 resolveEffectivePromoCode), so once
// they claim the competition their outreach message already carries it.
// Body: { promoCode } where null/"" clears.
router.patch(
  "/competition-claim-links/:id/promo-code",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    // Require the key explicitly — a body missing `promoCode` must not
    // silently clear an existing code.
    if (!req.body || !("promoCode" in req.body)) {
      return res.status(400).json({
        error: 'promoCode is required (null/"" clears)',
        code: "INVALID_BODY",
      });
    }
    const raw = req.body.promoCode;
    let promoCode: string | null = null;
    if (raw !== undefined && raw !== null && raw !== "") {
      if (typeof raw !== "string") {
        return res
          .status(400)
          .json({ error: "promoCode must be a string", code: "INVALID_BODY" });
      }
      promoCode = raw.trim();
      if (!promoCode) promoCode = null;
      else if (promoCode.length > 64) {
        return res.status(400).json({
          error: "promoCode must be 64 characters or fewer",
          code: "PROMO_CODE_TOO_LONG",
        });
      }
    }
    const [row] = await db
      .update(tournaments)
      .set({ promoCode, updatedAt: new Date() })
      .where(
        and(
          eq(tournaments.id, id),
          isNull(tournaments.ownerUserId),
          isNull(tournaments.createdById),
        ),
      )
      .returning({ id: tournaments.id, promoCode: tournaments.promoCode });
    if (!row) {
      return res.status(404).json({
        error: "Ownerless competition not found (it may already be claimed)",
        code: "COMPETITION_NOT_FOUND",
      });
    }
    return res.json({ data: { id: row.id, promoCode: row.promoCode } });
  }),
);

// Outreach bookkeeping toggles (mirror the org claim-links ones).
router.patch(
  "/competition-claim-links/:id/messaged",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const messaged = req.body?.messaged;
    if (typeof messaged !== "boolean") {
      return res
        .status(400)
        .json({ error: "messaged must be a boolean", code: "INVALID_BODY" });
    }
    const [row] = await db
      .update(tournaments)
      .set({ outreachMessagedAt: messaged ? new Date() : null })
      .where(eq(tournaments.id, id))
      .returning({
        id: tournaments.id,
        messagedAt: tournaments.outreachMessagedAt,
      });
    if (!row) {
      return res.status(404).json({
        error: "competition not found",
        code: "COMPETITION_NOT_FOUND",
      });
    }
    return res.json({
      data: {
        id: row.id,
        messagedAt: row.messagedAt ? row.messagedAt.toISOString() : null,
      },
    });
  }),
);

router.patch(
  "/competition-claim-links/:id/facebook-added",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const facebookAdded = req.body?.facebookAdded;
    if (typeof facebookAdded !== "boolean") {
      return res.status(400).json({
        error: "facebookAdded must be a boolean",
        code: "INVALID_BODY",
      });
    }
    const [row] = await db
      .update(tournaments)
      .set({ outreachFacebookAddedAt: facebookAdded ? new Date() : null })
      .where(eq(tournaments.id, id))
      .returning({
        id: tournaments.id,
        facebookAddedAt: tournaments.outreachFacebookAddedAt,
      });
    if (!row) {
      return res.status(404).json({
        error: "competition not found",
        code: "COMPETITION_NOT_FOUND",
      });
    }
    return res.json({
      data: {
        id: row.id,
        facebookAddedAt: row.facebookAddedAt
          ? row.facebookAddedAt.toISOString()
          : null,
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
    const limitRaw =
      typeof limitParam === "string" ? parseInt(limitParam, 10) : NaN;
    const limit = Math.min(
      Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1),
      200,
    );
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
      .leftJoin(
        organizations,
        eq(organizations.id, scheduleEvents.organizationId),
      )
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
    const byEvent = new Map<
      string,
      { going: number; maybe: number; out: number }
    >();
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
    const patch: Partial<typeof announcements.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (title !== undefined) patch.title = title;
    if (body !== undefined) patch.body = body;
    if (level !== undefined) patch.level = level;
    if (active !== undefined) patch.active = active;
    if (startsAt !== undefined)
      patch.startsAt = startsAt ? new Date(startsAt) : null;
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

// ---------------------------------------------------------------------------
// Lightweight team list for the admin console's "assign user to team"
// picker. Returns every non-archived team with its parent org name (null
// for independent teams).
// ---------------------------------------------------------------------------
router.get(
  "/teams",
  asyncHandler(async (req, res) => {
    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
    const conds = [isNull(teams.archivedAt)];
    if (q) conds.push(ilike(teams.name, `%${q}%`));
    const rows = await db
      .select({
        id: teams.id,
        name: teams.name,
        sport: teams.sport,
        organizationId: teams.organizationId,
        organizationName: organizations.name,
      })
      .from(teams)
      .leftJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(and(...conds))
      .orderBy(asc(teams.name))
      .limit(500);
    res.json({ data: rows });
  }),
);

// ---------------------------------------------------------------------------
// GET /admin/claims — one place to track everything that has been claimed.
// Extra-spec (openapi locked), platform-admin only via router-wide gate.
//
// "Claimable" org = one that carries a claim token (bulk-seeded hand-off
// pages) OR that ever received a claim request. An org counts as CLAIMED
// when it has an owner row AND is claimable — orgs created the normal way
// (owner from day one, no token, no request) are excluded so the list is
// about the hand-off funnel, not every org on the platform.
// Method: an approved claim request by the owner = "request"; otherwise the
// owner arrived through the secret claim link = "link".
//
// Competition claims come in two shapes:
//  - page takeovers: seeded competitions (claim token) whose owner_user_id
//    is now set (the link claim stamps owner + createdBy together).
//    tournaments has no claim timestamp, so claimedAt is null there.
//  - team-slot claims: tournament_participants rows with claimed_by stamped
//    (these DO carry claimed_at).
// ---------------------------------------------------------------------------
router.get(
  "/claims",
  asyncHandler(async (_req, res) => {
    const owners = alias(users, "owners");

    // --- Organizations ----------------------------------------------------
    const [orgTotals] = await db
      .select({
        seeded: sql<number>`count(*) filter (where ${organizations.claimToken} is not null)::int`,
      })
      .from(organizations);

    const claimedOrgs = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        city: organizations.city,
        state: organizations.state,
        claimToken: organizations.claimToken,
        ownerId: organizationAdmins.userId,
        ownerName: owners.name,
        ownerEmail: owners.email,
        ownerSince: organizationAdmins.createdAt,
        // Literal table qualification on purpose: drizzle renders ${table.col}
        // inside raw sql`` UNQUALIFIED, which breaks correlation with the
        // outer query (see drizzle-sql-template-unqualified memory).
        approvedRequestAt: sql<string | null>`(
          select max(ocr.decided_at)
          from organization_claim_requests ocr
          where ocr.organization_id = organizations.id
            and ocr.requested_by_user_id = organization_admins.user_id
            and ocr.status = 'approved'
        )`,
        hasAnyRequest: sql<boolean>`exists (
          select 1 from organization_claim_requests ocr
          where ocr.organization_id = organizations.id
        )`,
      })
      .from(organizations)
      .innerJoin(
        organizationAdmins,
        and(
          eq(organizationAdmins.organizationId, organizations.id),
          eq(organizationAdmins.role, "owner"),
        ),
      )
      .innerJoin(owners, eq(owners.id, organizationAdmins.userId))
      .orderBy(desc(organizationAdmins.createdAt));

    const orgRows = claimedOrgs
      .filter((r) => r.claimToken != null || r.hasAnyRequest)
      .map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        state: r.state,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        ownerEmail: r.ownerEmail,
        claimedAt: (r.approvedRequestAt ?? r.ownerSince) as
          | Date
          | string
          | null,
        method: r.approvedRequestAt ? ("request" as const) : ("link" as const),
      }));

    // --- Competitions: page takeovers --------------------------------------
    const [compTotals] = await db
      .select({
        seeded: sql<number>`count(*) filter (where ${tournaments.claimToken} is not null)::int`,
        claimed: sql<number>`count(*) filter (where ${tournaments.claimToken} is not null and ${tournaments.ownerUserId} is not null)::int`,
      })
      .from(tournaments);

    const claimedComps = await db
      .select({
        id: tournaments.id,
        slug: tournaments.slug,
        name: tournaments.name,
        type: tournaments.type,
        startDate: tournaments.startDate,
        endDate: tournaments.endDate,
        ownerId: tournaments.ownerUserId,
        ownerName: owners.name,
        ownerEmail: owners.email,
        updatedAt: tournaments.updatedAt,
      })
      .from(tournaments)
      .innerJoin(owners, eq(owners.id, tournaments.ownerUserId))
      .where(isNotNull(tournaments.claimToken))
      .orderBy(desc(tournaments.updatedAt));

    // --- Competitions: team-slot claims ------------------------------------
    const claimers = alias(users, "claimers");
    const slotClaims = await db
      .select({
        participantId: tournamentParticipants.id,
        competitionId: tournaments.id,
        competitionSlug: tournaments.slug,
        competitionName: tournaments.name,
        slotName: tournamentParticipants.name,
        division: tournamentParticipants.division,
        teamId: tournamentParticipants.teamId,
        teamName: teams.name,
        claimedById: tournamentParticipants.claimedByUserId,
        claimedByName: claimers.name,
        claimedByEmail: claimers.email,
        claimedAt: tournamentParticipants.claimedAt,
      })
      .from(tournamentParticipants)
      .innerJoin(
        tournaments,
        eq(tournaments.id, tournamentParticipants.tournamentId),
      )
      .leftJoin(teams, eq(teams.id, tournamentParticipants.teamId))
      .innerJoin(
        claimers,
        eq(claimers.id, tournamentParticipants.claimedByUserId),
      )
      .orderBy(desc(tournamentParticipants.claimedAt));

    res.json({
      organizations: {
        totals: { seeded: orgTotals?.seeded ?? 0, claimed: orgRows.length },
        claimed: orgRows,
      },
      competitions: {
        totals: {
          seeded: compTotals?.seeded ?? 0,
          claimed: compTotals?.claimed ?? 0,
        },
        claimed: claimedComps,
      },
      slotClaims,
    });
  }),
);

export default router;
