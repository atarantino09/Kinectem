import { Router, type IRouter } from "express";
import {
  db,
  users,
  organizations,
  organizationAdmins,
  organizationFollowers,
  userFollowers,
  teams,
  rosterEntries,
  articles,
  articleTags,
  assets,
  highlights,
  postShares,
} from "@workspace/db";
import {
  and,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
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
  toPublicUser,
  toPrivateUser,
  toOrganization,
  articleToPost,
  highlightToPost,
  paginate,
  emptyPagination,
  splitName,
  apiError,
  safeAvatarUrl,
  MAX_AVATAR_DATA_URL_LENGTH,
  notFound,
  toPostAuthor,
} from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostOwnerId,
  loadPostShareStats,
  shareStatsFor,
  type PostStats,
  type StatsKind,
} from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap, TAG_NOTIF_THROTTLE_MS } from "../lib/article-tagging";

const router: IRouter = Router();

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
          .where(
            and(
              isNull(users.deletedAt),
              or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)),
            ),
          )
          .limit(40)
      : await db.select().from(users).where(isNull(users.deletedAt)).limit(40);
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
          avatarUrl: safeAvatarUrl(u.avatarUrl),
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
    if (u.deletedAt && req.realUser?.role !== "admin") return notFound(res);
    const me = req.sessionUser;
    const isOwnProfile = me?.id === u.id;

    // Linked accounts (parent ↔ child) are sensitive on a youth-sports
    // product, but with different rules for the two halves:
    //
    //   • `parents` (who is *my* guardian) is private. Only the user
    //     themself, the linked parent/child, or an org admin who shares
    //     a team with the profile user can see it.
    //   • `children` of a parent profile are intentionally public to
    //     any logged-in user — visiting a parent's profile and seeing
    //     "Family: Samira, Riley, Cameron" with avatars is the navigation
    //     hook that lets coaches and other parents reach the kids'
    //     pages. Each child link is just `id + name + avatar`, the same
    //     fields the children already expose via search and team
    //     rosters, so there is no new data leak. Privacy on the child's
    //     own profile (DOB, email, COPPA flags) is unchanged.
    let canSeeParents = isOwnProfile;
    if (!canSeeParents && me) {
      if (me.parentId === u.id || u.parentId === me.id) {
        canSeeParents = true;
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
        if (sharedAdmin.length > 0) canSeeParents = true;
      }
    }
    const canSeeChildren = !!me; // any logged-in viewer sees the family card

    let linkedAccounts: { parents: unknown[]; children: unknown[] } | undefined;
    if (canSeeParents || canSeeChildren) {
      // IMPORTANT: filter soft-deleted accounts out of the family card.
      // The route already 404s on a deleted profile owner, but the
      // linked-account queries used to ignore `deletedAt` — which would
      // leak a deleted child's id/name/avatar through any non-deleted
      // parent's profile. Both halves now respect `deletedAt`.
      const parentRows =
        canSeeParents && u.parentId
          ? await db
              .select()
              .from(users)
              .where(and(eq(users.id, u.parentId), isNull(users.deletedAt)))
              .limit(1)
          : [];
      const childRows = canSeeChildren
        ? await db
            .select()
            .from(users)
            .where(and(eq(users.parentId, u.id), isNull(users.deletedAt)))
        : [];
      const toLinked = (row: typeof users.$inferSelect) => {
        const { firstName, lastName } = splitName(row.name);
        return {
          id: row.id,
          firstName,
          lastName,
          role: row.role,
          avatarUrl: safeAvatarUrl(row.avatarUrl),
        };
      };
      // Only emit the section when there is something to render so the
      // frontend's "no Family card" path stays clean for users with no
      // linked accounts.
      if (parentRows.length > 0 || childRows.length > 0) {
        linkedAccounts = {
          parents: parentRows.map(toLinked),
          children: childRows.map(toLinked),
        };
      }
    }

    let isFollowing = false;
    if (me && !isOwnProfile) {
      const [f] = await db
        .select()
        .from(userFollowers)
        .where(
          and(
            eq(userFollowers.followingUserId, u.id),
            eq(userFollowers.followerUserId, me.id),
          ),
        )
        .limit(1);
      isFollowing = !!f;
    }
    const [{ followerCount }] = await db
      .select({ followerCount: sql<number>`count(*)::int` })
      .from(userFollowers)
      .where(eq(userFollowers.followingUserId, u.id));
    const [{ followingCount }] = await db
      .select({ followingCount: sql<number>`count(*)::int` })
      .from(userFollowers)
      .where(eq(userFollowers.followerUserId, u.id));
    // A linked parent of the target user gets the same private fields the
    // user would see for themselves (email, role, parentId) so the parent
    // can edit the child's profile from `/family` and `/users/<childId>`.
    // Strangers still get the public-only view. The `isOwnProfile` flag on
    // the response stays `false` for the parent so the frontend doesn't
    // mistake them for the user themselves and render self-only UI.
    const isLinkedParentViewer =
      !!me && !!u.parentId && u.parentId === me.id;
    const base =
      isOwnProfile || isLinkedParentViewer
        ? toPrivateUser(u, {
            followerCount,
            followingCount,
            isOwnProfile,
            isFollowing,
          })
        : toPublicUser(u, {
            isOwnProfile: false,
            isFollowing,
            followerCount,
            followingCount,
          });
    res.json({ ...base, linkedAccounts });
  }),
);

router.patch(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.params.userId))
      .limit(1);
    if (!existing) return notFound(res);
    const isAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
    // Soft-deleted users are hidden from non-admins — same rule GET uses.
    // Without this, a linked parent of a soft-deleted child could still
    // mutate the row.
    if (existing.deletedAt && !isAdmin) return notFound(res);
    // A linked parent (existing.parentId === me.id) may edit their own
    // child's profile fields. Masqueraded sessions don't get this power —
    // it's a real-account-only check, the same rule the admin branch uses.
    const isLinkedParent =
      !!existing.parentId &&
      existing.parentId === me.id &&
      !req.isMasquerading;
    if (existing.id !== me.id && !isAdmin && !isLinkedParent) {
      return apiError(res, 403, "Forbidden");
    }
    const body = req.body ?? {};
    const updates: Partial<typeof users.$inferInsert> = {};
    if (body.firstName || body.lastName) {
      const cur = splitName(existing.name);
      updates.name = `${body.firstName ?? cur.firstName} ${body.lastName ?? cur.lastName}`.trim();
    }
    if (body.bio !== undefined) updates.bio = body.bio;
    if (body.nickname !== undefined) {
      // Mirror what the Edit Profile dialog does: trim whitespace, treat
      // an empty string as "clear it". Cap length to match the OpenAPI
      // schema (PublicUserResponse.nickname.maxLength: 100) so the DB
      // can never end up with a value the spec says shouldn't exist.
      if (body.nickname === null) {
        updates.nickname = null;
      } else if (typeof body.nickname !== "string") {
        return apiError(res, 400, "nickname must be a string or null");
      } else {
        const trimmed = body.nickname.trim();
        if (trimmed.length > 100) {
          return apiError(res, 400, "nickname is too long (max 100 chars)");
        }
        updates.nickname = trimmed === "" ? null : trimmed;
      }
    }
    if (body.avatarUrl !== undefined) {
      if (body.avatarUrl !== null && typeof body.avatarUrl !== "string") {
        return apiError(res, 400, "avatarUrl must be a string or null");
      }
      // The asset upload pipeline still allows up to ASSET_MAX_BYTES (10 MB)
      // for general assets, but a profile avatar is shipped inline on every
      // user-bearing response (feed items, comments, mentions, message
      // threads, search, follow lists, etc.). To keep those payloads sane
      // we cap the *avatar* URL well below the general asset cap. The same
      // cap is applied at egress by `safeAvatarUrl()` so any pre-existing
      // oversize row in the database is already filtered to null.
      if (
        typeof body.avatarUrl === "string" &&
        body.avatarUrl.startsWith("data:") &&
        body.avatarUrl.length > MAX_AVATAR_DATA_URL_LENGTH
      ) {
        return apiError(res, 400, "avatarUrl is too long");
      }
      if (typeof body.avatarUrl === "string") {
        // Avatar URLs must come from a confirmed asset that the caller (not
        // the target user, since admins may edit anyone) owns. This prevents
        // direct API callers from pointing at arbitrary external URLs that
        // bypass the upload + confirm flow.
        const [ownedAsset] = await db
          .select()
          .from(assets)
          .where(
            and(
              eq(assets.url, body.avatarUrl),
              eq(assets.ownerId, me.id),
              eq(assets.status, "confirmed"),
            ),
          )
          .limit(1);
        if (!ownedAsset) {
          return apiError(
            res,
            400,
            "avatarUrl must reference a confirmed asset you uploaded",
          );
        }
      }
      updates.avatarUrl = body.avatarUrl;
    }
    const [updated] = Object.keys(updates).length
      ? await db.update(users).set(updates).where(eq(users.id, existing.id)).returning()
      : [existing];
    // Keep the response's `isOwnProfile` flag honest: when a parent or
    // admin patches someone else's profile, the response shouldn't claim
    // it belongs to the caller. Matches the GET /users/:userId behavior.
    res.json(toPrivateUser(updated, { isOwnProfile: existing.id === me.id }));
  }),
);

router.get(
  "/users/:userId/posts",
  asyncHandler(async (req, res) => {
    // The Posts tab on a profile is a chronological archive of:
    //   1. Articles the user authored,
    //   2. Articles the user is tagged in (via article_tags),
    //   3. Highlights the user uploaded, AND
    //   4. Re-shares (article|highlight) the user posted (task #190).
    // Visibility for #2 mirrors the recap visibility rules:
    //   - Strangers only see articles where their tag is approved.
    //   - The user themselves, their real (non-masquerading) parent,
    //     and real admins also see pending-tag articles, with a small
    //     `tagStatus: "pending"` annotation so the client can render a
    //     "Pending tag" affordance.
    // Visibility for #3/#4 mirrors the public listing rules — hidden
    // posts are filtered out for everyone but real admins, and shares
    // pointing at hidden / unpublished targets simply drop out of the
    // feed (so a user's profile can never resurface a recap that has
    // been moderated away).
    // Ordering uses an "effective date" per row: shares use sharedAt
    // (so a freshly-shared old recap rises to the top), originals use
    // gameDate (recaps) or createdAt (everything else).
    const [u] = await db.select().from(users).where(eq(users.id, req.params.userId)).limit(1);
    if (!u) return notFound(res);

    const me = req.sessionUser;
    const isAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
    const isSelf = me?.id === u.id;
    let isParent = false;
    if (!isSelf && !isAdmin && me && !req.isMasquerading && u.parentId) {
      isParent = u.parentId === me.id;
    }
    const canSeePending = isSelf || isAdmin || isParent;

    const articleConds = [eq(articles.status, "published")];
    if (!isAdmin) articleConds.push(isNull(articles.hiddenAt));

    // 1) Articles the user authored.
    const authored = await db
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
      .where(and(eq(articles.authorId, u.id), ...articleConds));

    // 2) Articles the user is tagged in. Stranger viewers only see
    //    approved tags; self/parent/admin also see pending.
    //    Declined / removed tags are NEVER surfaced — once a user has
    //    actively rejected or pulled a tag the article must drop off
    //    their profile feed for everyone (including admins).
    const tagConds = [
      eq(articleTags.userId, u.id),
      canSeePending
        ? inArray(articleTags.status, ["approved", "pending"] as const)
        : eq(articleTags.status, "approved"),
    ];
    const tagged = await db
      .select({
        a: articles,
        team: teams,
        org: organizations,
        author: users,
        tagStatus: articleTags.status,
      })
      .from(articleTags)
      .innerJoin(articles, eq(articleTags.articleId, articles.id))
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(and(and(...tagConds), ...articleConds));

    // 3) Highlights the user uploaded.
    const highlightConds = [eq(highlights.uploaderId, u.id)];
    if (!isAdmin) highlightConds.push(isNull(highlights.hiddenAt));
    const uploadedHighlights = await db
      .select({
        h: highlights,
        team: teams,
        org: organizations,
        author: users,
      })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(highlights.uploaderId, users.id))
      .where(and(...highlightConds));

    // 4) Re-shares the user has posted. Each share row is joined
    //    against its underlying post; rows whose target has gone
    //    away (deleted, hidden to non-admins, or no longer a valid
    //    recap) are dropped at the merge step below.
    const shares = await db
      .select({
        share: postShares,
      })
      .from(postShares)
      .where(eq(postShares.sharerUserId, u.id));

    const sharedArticleIds = shares
      .filter((s) => s.share.postKind === "article")
      .map((s) => s.share.postRefId);
    const sharedHighlightIds = shares
      .filter((s) => s.share.postKind === "highlight")
      .map((s) => s.share.postRefId);

    const sharedArticleRows = sharedArticleIds.length
      ? await db
          .select({ a: articles, team: teams, org: organizations, author: users })
          .from(articles)
          .innerJoin(teams, eq(articles.teamId, teams.id))
          .innerJoin(organizations, eq(teams.organizationId, organizations.id))
          .leftJoin(users, eq(articles.authorId, users.id))
          .where(and(inArray(articles.id, sharedArticleIds), ...articleConds))
      : [];
    const sharedHighlightRows = sharedHighlightIds.length
      ? await db
          .select({ h: highlights, team: teams, org: organizations, author: users })
          .from(highlights)
          .innerJoin(teams, eq(highlights.teamId, teams.id))
          .innerJoin(organizations, eq(teams.organizationId, organizations.id))
          .leftJoin(users, eq(highlights.uploaderId, users.id))
          .where(
            and(
              inArray(highlights.id, sharedHighlightIds),
              ...(isAdmin ? [] : [isNull(highlights.hiddenAt)]),
            ),
          )
      : [];

    type ArticleRow = {
      kind: "article";
      a: typeof articles.$inferSelect;
      team: typeof teams.$inferSelect;
      org: typeof organizations.$inferSelect;
      author: typeof users.$inferSelect | null;
      tagStatus?: "approved" | "pending";
      sharedAt?: Date;
    };
    type HighlightRow = {
      kind: "highlight";
      h: typeof highlights.$inferSelect;
      team: typeof teams.$inferSelect;
      org: typeof organizations.$inferSelect;
      author: typeof users.$inferSelect | null;
      sharedAt?: Date;
    };
    type MergedRow = ArticleRow | HighlightRow;

    // We key by post id so authored / tagged / share rows for the
    // same item collapse into one card. Original (non-share) rows
    // win over share rows so a user who shared their own recap is
    // still presented as the author rather than a re-sharer.
    const seen = new Map<string, MergedRow>();
    for (const row of authored) {
      seen.set(`article-${row.a.id}`, { kind: "article", ...row });
    }
    for (const row of tagged) {
      const key = `article-${row.a.id}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        kind: "article",
        a: row.a,
        team: row.team,
        org: row.org,
        author: row.author,
        tagStatus: row.tagStatus as "approved" | "pending",
      });
    }
    for (const row of uploadedHighlights) {
      seen.set(`highlight-${row.h.id}`, { kind: "highlight", ...row });
    }
    const shareByKey = new Map<string, Date>();
    for (const s of shares) {
      shareByKey.set(`${s.share.postKind}-${s.share.postRefId}`, s.share.createdAt);
    }
    for (const row of sharedArticleRows) {
      const key = `article-${row.a.id}`;
      const sharedAt = shareByKey.get(key);
      if (!sharedAt) continue;
      const existing = seen.get(key);
      if (existing) {
        // Already authored / tagged — leave the original card alone.
        continue;
      }
      seen.set(key, { kind: "article", ...row, sharedAt });
    }
    for (const row of sharedHighlightRows) {
      const key = `highlight-${row.h.id}`;
      const sharedAt = shareByKey.get(key);
      if (!sharedAt) continue;
      if (seen.has(key)) continue;
      seen.set(key, { kind: "highlight", ...row, sharedAt });
    }

    // Order by "effective date": shares use sharedAt (so a freshly
    // shared old recap rises), articles use gameDate, everything
    // else falls back to createdAt.
    const effectiveDate = (row: MergedRow): number => {
      if (row.sharedAt) return row.sharedAt.getTime();
      if (row.kind === "article") {
        return (row.a.gameDate ?? row.a.createdAt).getTime();
      }
      return row.h.createdAt.getTime();
    };
    const ordered = Array.from(seen.values()).sort((x, y) => effectiveDate(y) - effectiveDate(x));
    const limited = ordered.slice(0, 20);

    // Bulk-load reaction / comment / share stats for the page.
    const statKeys: { kind: StatsKind; refId: string }[] = limited.map((row) =>
      row.kind === "article"
        ? { kind: "article", refId: row.a.id }
        : { kind: "highlight", refId: row.h.id },
    );
    const shareStatKeys = statKeys.filter(
      (k): k is { kind: "article" | "highlight"; refId: string } =>
        k.kind === "article" || k.kind === "highlight",
    );
    const [stats, shareStats] = await Promise.all([
      loadPostStats(me?.id ?? null, statKeys),
      loadPostShareStats(me?.id ?? null, shareStatKeys),
    ]);

    const posts = limited.map((row) => {
      const sharedBy = row.sharedAt ? toPostAuthor(u) : undefined;
      const sharedAt = row.sharedAt ? row.sharedAt.toISOString() : undefined;
      if (row.kind === "article") {
        const post = articleToPost(row.a, {
          team: row.team,
          org: row.org,
          author: row.author,
          ...statsFor(stats, "article", row.a.id),
          ...shareStatsFor(shareStats, "article", row.a.id),
          sharedBy,
          sharedAt,
        });
        if (row.tagStatus === "pending") {
          return { ...post, tagStatus: "pending" as const };
        }
        return post;
      }
      return highlightToPost(row.h, {
        team: row.team,
        org: row.org,
        author: row.author,
        ...statsFor(stats, "highlight", row.h.id),
        ...shareStatsFor(shareStats, "highlight", row.h.id),
        sharedBy,
        sharedAt,
      });
    });
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
    const me = req.sessionUser;
    const targetId = req.params.userId;
    // A profile's pending invites should only be visible to people who
    // can actually act on them: the user themselves, their real
    // (non-masquerading) parent, or a real admin. Everyone else only
    // sees teams they have actually joined.
    const isSelf = me?.id === targetId;
    const isRealAdmin =
      !!me && req.realUser?.role === "admin" && !req.isMasquerading;
    let isParent = false;
    if (!isSelf && !isRealAdmin && me && !req.isMasquerading) {
      const [child] = await db
        .select({ parentId: users.parentId })
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      isParent = !!child && child.parentId === me.id;
    }
    const showPending = isSelf || isRealAdmin || isParent;
    const rows = await db
      .select({ r: rosterEntries, t: teams, org: organizations })
      .from(rosterEntries)
      .innerJoin(teams, eq(rosterEntries.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(
        showPending
          ? eq(rosterEntries.userId, targetId)
          : and(
              eq(rosterEntries.userId, targetId),
              eq(rosterEntries.status, "accepted"),
            ),
      );
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

export default router;
