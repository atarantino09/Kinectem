import { Router, type IRouter } from "express";
import {
  db,
  users,
  organizations,
  organizationAdmins,
  organizationFollowers,
  userFollowers,
  teams,
  teamFollowers,
  rosterEntries,
  articles,
  articleTags,
  assets,
  highlights,
  highlightTags,
  postShares,
  takedownRequests,
} from "@workspace/db";
import {
  aliasedTable,
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
import {
  canCreateRecap,
  canManageOrganization,
  computeArticleCanEditMap,
  computeArticleAuthorRoleMap,
  isTeamMember,
  canManageTeam,
} from "../lib/permissions";
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
import { loadHighlightTagViews } from "../lib/highlight-tagging";
import { loadCurrentUserTags } from "../lib/current-user-tag";
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
import { normalizeWebsite } from "../lib/normalize-website";
import { filterOutMinors, rejectMinorProfileFields } from "../lib/coppa";

const router: IRouter = Router();

// Task #349 — Server-side allow-list for the optional `state` field on a
// user profile. Mirrors the enum on the OpenAPI spec and the same set
// `routes/organizations.ts` validates against. Kept local so the user
// route doesn't need to import from organizations.
const USER_PROFILE_US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY",
]);

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
    // Task #359 — minors are not discoverable through public listings.
    // The viewer-aware filter still surfaces the minor to themselves and
    // to their linked guardian.
    rows = filterOutMinors(rows, req.sessionUser?.id ?? null);
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

    // Minor profiles aren't directly retrievable by the public — only
    // self, linked guardian, platform admin, an org admin sharing a
    // team with the minor, or (task #367) a follower whose follow
    // edge has been guardian-approved. Everyone else gets 404.
    //
    // Task #367 — only fire the carve-out for minors whose
    // `profileVisibility` is restricted (anything other than `public`).
    // Guardians who explicitly consent to a public profile keep the
    // adult-equivalent surface so the intentionally-public flow works.
    if (u.isMinor && u.profileVisibility !== "public" && !isOwnProfile) {
      // Task #367 — restricted-minor profile audience is intentionally
      // narrow: self, linked guardian, platform admin, or a follower
      // whose follow edge has been guardian-approved. Shared org/team
      // admin does NOT confer access here — that carve-out is reserved
      // for staff-style admin flows where the org explicitly opted in,
      // and would otherwise widen the disclosure surface beyond what
      // the guardian intended when leaving the profile non-`public`.
      const isLinkedGuardian = !!me && u.parentId === me.id;
      const isPlatformAdmin = req.realUser?.role === "admin";
      let isApprovedFollower = false;
      if (!isLinkedGuardian && !isPlatformAdmin && me) {
        const followRow = await db
          .select({ s: userFollowers.moderationStatus })
          .from(userFollowers)
          .where(
            and(
              eq(userFollowers.followingUserId, u.id),
              eq(userFollowers.followerUserId, me.id),
              eq(userFollowers.moderationStatus, "approved"),
            ),
          )
          .limit(1);
        isApprovedFollower = followRow.length > 0;
      }
      if (!isLinkedGuardian && !isPlatformAdmin && !isApprovedFollower) {
        return notFound(res);
      }
      // Task #367 — minor profile pages must not be search-indexed.
      // The X-Robots-Tag header is honored by Google / Bing / DDG and
      // belt-and-braces with the in-page <meta> the SPA mounts.
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noimageindex");
    }

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
              inArray(organizationAdmins.role, ["owner", "admin"]),
            ),
          )
          .limit(1);
        if (sharedAdmin.length > 0) canSeeParents = true;
      }
    }
    // Children are minors — only self, platform admin, or an org
    // admin sharing a team with one of the children sees them.
    let canSeeChildren = isOwnProfile;
    if (!canSeeChildren && me) {
      if (req.realUser?.role === "admin") {
        canSeeChildren = true;
      } else {
        const sharedAdmin = await db
          .select({ id: organizationAdmins.organizationId })
          .from(organizationAdmins)
          .innerJoin(teams, eq(teams.organizationId, organizationAdmins.organizationId))
          .innerJoin(rosterEntries, eq(rosterEntries.teamId, teams.id))
          .innerJoin(users, eq(users.id, rosterEntries.userId))
          .where(
            and(
              eq(organizationAdmins.userId, me.id),
              eq(users.parentId, u.id),
              inArray(organizationAdmins.role, ["owner", "admin"]),
            ),
          )
          .limit(1);
        if (sharedAdmin.length > 0) canSeeChildren = true;
      }
    }

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
      // Task #363 — pending follow edges must not show as "following"
      // until the linked guardian approves them; only approved rows
      // count toward the boolean.
      const [f] = await db
        .select()
        .from(userFollowers)
        .where(
          and(
            eq(userFollowers.followingUserId, u.id),
            eq(userFollowers.followerUserId, me.id),
            eq(userFollowers.moderationStatus, "approved"),
          ),
        )
        .limit(1);
      isFollowing = !!f;
    }
    // Task #363 — pending follow edges must not bump publicly-visible
    // counts; only approved edges count toward follower/following totals.
    const [{ followerCount }] = await db
      .select({ followerCount: sql<number>`count(*)::int` })
      .from(userFollowers)
      .where(
        and(
          eq(userFollowers.followingUserId, u.id),
          eq(userFollowers.moderationStatus, "approved"),
        ),
      );
    const [{ followingCount }] = await db
      .select({ followingCount: sql<number>`count(*)::int` })
      .from(userFollowers)
      .where(
        and(
          eq(userFollowers.followerUserId, u.id),
          eq(userFollowers.moderationStatus, "approved"),
        ),
      );
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
    // Task #359 — when the target is a minor, the data-minimization rules
    // apply even if the editor is the linked parent (FTC: parents can
    // edit but operators must still keep collection minimal).
    if (existing.isMinor) {
      // Task #359 — single source of truth for which PII fields are
      // forbidden on minor accounts. Adding "location" here used to
      // be done inline in this route; importing the centralized
      // helper means /users/:userId PATCH and the helper-driven paths
      // (current-user PATCH, etc.) never drift apart.
      if (rejectMinorProfileFields(res, req.body)) return;
    }
    const body = req.body ?? {};
    const updates: Partial<typeof users.$inferInsert> = {};
    if (body.firstName || body.lastName) {
      const cur = splitName(existing.name);
      updates.name = `${body.firstName ?? cur.firstName} ${body.lastName ?? cur.lastName}`.trim();
    }
    if (body.bio !== undefined) updates.bio = body.bio;
    // Task #293 — Personal website. Mirrors the org-website behavior added
    // in #290: an explicit `null` clears, an empty string clears, a string
    // is normalized via normalizeWebsite() (bare domains get a https://
    // prefix), and obvious garbage is rejected with a 400.
    if (body.website === null) {
      updates.website = null;
    } else if (typeof body.website === "string") {
      const websiteResult = normalizeWebsite(body.website);
      if (!websiteResult.ok) return apiError(res, 400, websiteResult.error);
      updates.website = websiteResult.value === "" ? null : websiteResult.value;
    } else if (body.website !== undefined) {
      return apiError(res, 400, "website must be a string or null");
    }
    // Task #349 — Optional city / 2-letter US state postal code on the
    // profile. Both clear on null or empty string. State is normalized
    // to uppercase and validated against the same 50-states-plus-DC set
    // organizations use; mismatches return a 400.
    if (body.city === null) {
      updates.city = null;
    } else if (typeof body.city === "string") {
      const trimmed = body.city.trim();
      if (trimmed.length > 100) {
        return apiError(res, 400, "city must be 100 characters or fewer");
      }
      updates.city = trimmed === "" ? null : trimmed;
    } else if (body.city !== undefined) {
      return apiError(res, 400, "city must be a string or null");
    }
    if (body.state === null) {
      updates.state = null;
    } else if (typeof body.state === "string") {
      const stateRaw = body.state.trim().toUpperCase();
      if (stateRaw === "") {
        updates.state = null;
      } else if (!USER_PROFILE_US_STATE_CODES.has(stateRaw)) {
        return apiError(
          res,
          400,
          "state must be a 2-letter US state code (e.g. NJ)",
        );
      } else {
        updates.state = stateRaw;
      }
    } else if (body.state !== undefined) {
      return apiError(res, 400, "state must be a string or null");
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
    // (so a freshly-shared old recap rises to the top), recap articles
    // use their publish time (publishedAt ?? createdAt) so a freshly
    // written recap about an old game lands at the top of the feed
    // instead of being buried next to the game it covers, and
    // highlights fall back to createdAt.
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

    // Task #367 — minor profile listings mirror the visibility carve-out
    // applied by GET /users/:userId. The carve-out only fires for minors
    // whose `profileVisibility` is restricted (anything other than
    // explicit `public`). When a guardian has consented to a public
    // profile we treat the listing the same as for an adult so the
    // intentional public surface keeps working.
    //
    // For restricted-visibility minors the visible set is: self, linked
    // guardian, platform admin, an org admin sharing a team with the
    // minor, OR an approved follower. Everyone else gets 404 — we do
    // NOT 403 because that would leak existence of the minor.
    const minorIsRestricted = u.isMinor && u.profileVisibility !== "public";
    if (minorIsRestricted && !isSelf && !isAdmin && !isParent) {
      // Task #367 — narrow audience matches GET /users/:userId for
      // restricted minors: self/guardian/platform admin (handled
      // above) OR an approved follower. Shared-team-admin is NOT
      // a carve-out here — see the matching note in GET /users/:id.
      let isApprovedFollower = false;
      if (me) {
        const followRow = await db
          .select({ s: userFollowers.moderationStatus })
          .from(userFollowers)
          .where(
            and(
              eq(userFollowers.followingUserId, u.id),
              eq(userFollowers.followerUserId, me.id),
              eq(userFollowers.moderationStatus, "approved"),
            ),
          )
          .limit(1);
        isApprovedFollower = followRow.length > 0;
      }
      if (!isApprovedFollower) {
        return notFound(res);
      }
      // Belt-and-braces: profile itself sets X-Robots-Tag, but the
      // posts feed for a minor profile is part of the same indexing
      // surface so we set it here too.
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noimageindex");
    }

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

    // 3b) Highlights the user is tagged in. Mirrors the article tag
    //     visibility rules from block #2: strangers see only `approved`
    //     tags; self / real parent / real admin also see `pending`.
    //     Declined / removed tags never surface (the tagged player
    //     pulled or rejected the tag, so it must drop off their
    //     profile feed for everyone). Hidden highlights are filtered
    //     out the same way as uploaded ones.
    const highlightTagConds = [
      eq(highlightTags.userId, u.id),
      canSeePending
        ? inArray(highlightTags.status, ["approved", "pending"] as const)
        : eq(highlightTags.status, "approved"),
    ];
    const taggedHighlights = await db
      .select({
        h: highlights,
        team: teams,
        org: organizations,
        author: users,
        tagStatus: highlightTags.status,
      })
      .from(highlightTags)
      .innerJoin(highlights, eq(highlightTags.highlightId, highlights.id))
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(highlights.uploaderId, users.id))
      .where(
        and(
          and(...highlightTagConds),
          ...(isAdmin ? [] : [isNull(highlights.hiddenAt)]),
        ),
      );

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
      // Set when this row only made it onto the profile because the
      // user was tagged in someone else's highlight (block 3b). The
      // serializer surfaces it as a top-level `tagStatus` so the
      // client can render the same "Pending tag" affordance it shows
      // for tagged-in articles.
      tagStatus?: "approved" | "pending";
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
    for (const row of taggedHighlights) {
      const key = `highlight-${row.h.id}`;
      // Uploader entry already won — don't double-render and don't
      // overwrite the uploader's empty tagStatus with one from the
      // tag join.
      if (seen.has(key)) continue;
      seen.set(key, {
        kind: "highlight",
        h: row.h,
        team: row.team,
        org: row.org,
        author: row.author,
        tagStatus: row.tagStatus as "approved" | "pending",
      });
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
    // shared old recap rises), recap articles use their publish time
    // (publishedAt ?? createdAt) so newly-written recaps land at the
    // top regardless of when the game was played, and highlights
    // fall back to createdAt.
    const effectiveDate = (row: MergedRow): number => {
      if (row.sharedAt) return row.sharedAt.getTime();
      if (row.kind === "article") {
        return (row.a.publishedAt ?? row.a.createdAt).getTime();
      }
      return row.h.createdAt.getTime();
    };
    // Task #367 — drop pending-takedown items from the profile feed.
    // Mirrors the same filter applied in /feed: the requesting guardian
    // and platform admins continue to see flagged content via
    // GET /posts/:postId so they can resolve the queue.
    const allArticleIds = Array.from(seen.values())
      .filter((r): r is Extract<MergedRow, { kind: "article" }> => r.kind === "article")
      .map((r) => r.a.id);
    const allHighlightIds = Array.from(seen.values())
      .filter((r): r is Extract<MergedRow, { kind: "highlight" }> => r.kind === "highlight")
      .map((r) => r.h.id);
    const pendingTakedownArticleIds = new Set<string>();
    const pendingTakedownHighlightIds = new Set<string>();
    if (!isAdmin && (allArticleIds.length || allHighlightIds.length)) {
      const tdRows = await db
        .select({
          postKind: takedownRequests.postKind,
          postRefId: takedownRequests.postRefId,
          requestedByGuardianId: takedownRequests.requestedByGuardianId,
        })
        .from(takedownRequests)
        .where(
          and(
            eq(takedownRequests.status, "pending"),
            inArray(takedownRequests.postRefId, [
              ...allArticleIds,
              ...allHighlightIds,
            ]),
          ),
        );
      for (const r of tdRows) {
        // The requesting guardian still sees their own pending takedown
        // so they can act on it from the profile too.
        if (me?.id && r.requestedByGuardianId === me.id) continue;
        if (r.postKind === "article") pendingTakedownArticleIds.add(r.postRefId);
        else if (r.postKind === "highlight") pendingTakedownHighlightIds.add(r.postRefId);
      }
    }
    const filteredSeen = Array.from(seen.values()).filter((r) => {
      if (r.kind === "article") return !pendingTakedownArticleIds.has(r.a.id);
      return !pendingTakedownHighlightIds.has(r.h.id);
    });
    const ordered = filteredSeen.sort((x, y) => effectiveDate(y) - effectiveDate(x));
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
    const articleRows = limited.filter(
      (row): row is Extract<MergedRow, { kind: "article" }> => row.kind === "article",
    );
    const articleEditRows = articleRows.map((row) => ({
      articleId: row.a.id,
      authorId: row.a.authorId,
      orgId: row.org.id,
    }));
    const articleRoleRows = articleRows.map((row) => ({
      articleId: row.a.id,
      authorId: row.a.authorId,
      teamId: row.team.id,
      orgId: row.org.id,
    }));
    const highlightRows = limited.filter(
      (row): row is Extract<MergedRow, { kind: "highlight" }> => row.kind === "highlight",
    );
    const [stats, shareStats, canEditMap, authorRoleMap, highlightTagViews, currentUserTags] =
      await Promise.all([
        loadPostStats(me?.id ?? null, statKeys),
        loadPostShareStats(me?.id ?? null, shareStatKeys),
        computeArticleCanEditMap(me?.id ?? null, articleEditRows),
        computeArticleAuthorRoleMap(articleRoleRows),
        loadHighlightTagViews(
          me?.id ?? null,
          highlightRows.map((row) => ({
            id: row.h.id,
            uploaderId: row.h.uploaderId,
          })),
        ),
        loadCurrentUserTags(me?.id ?? null, {
          articleIds: articleRows.map((row) => row.a.id),
          highlightIds: highlightRows.map((row) => row.h.id),
        }),
      ]);

    const posts = limited.map((row) => {
      const sharedBy = row.sharedAt ? toPostAuthor(u) : undefined;
      const sharedAt = row.sharedAt ? row.sharedAt.toISOString() : undefined;
      if (row.kind === "article") {
        const post = articleToPost(row.a, {
          team: row.team,
          org: row.org,
          author: row.author,
          canEdit: canEditMap.get(row.a.id) ?? false,
          authorRole: authorRoleMap.get(row.a.id) ?? null,
          ...statsFor(stats, "article", row.a.id),
          ...shareStatsFor(shareStats, "article", row.a.id),
          sharedBy,
          sharedAt,
          currentUserTag:
            currentUserTags.articleTagByArticleId.get(row.a.id) ?? null,
        });
        if (row.tagStatus === "pending") {
          return { ...post, tagStatus: "pending" as const };
        }
        return post;
      }
      // Uploader-only edit/delete affordance for highlights — same
      // rule the post page enforces.
      const isUploader = !!me && row.h.uploaderId === me.id;
      const post = highlightToPost(row.h, {
        team: row.team,
        org: row.org,
        author: row.author,
        canEdit: isUploader,
        canDelete: isUploader,
        ...statsFor(stats, "highlight", row.h.id),
        ...shareStatsFor(shareStats, "highlight", row.h.id),
        taggedUsers: highlightTagViews.get(row.h.id) ?? [],
        sharedBy,
        sharedAt,
        currentUserTag:
          currentUserTags.highlightTagByHighlightId.get(row.h.id) ?? null,
      });
      // Mirror the article path: when the only reason this highlight
      // is on the profile is a pending tag on the viewed user, surface
      // `tagStatus: "pending"` so the client can show a "Pending tag"
      // affordance. Approved tags don't need the annotation — they
      // show normally.
      if (row.tagStatus === "pending") {
        return { ...post, tagStatus: "pending" as const };
      }
      return post;
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
      .select({ org: organizations, role: organizationAdmins.role })
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
    // The user's stored role per org from organization_admins (owner /
    // admin / member). Orgs the user is only on via a roster entry — i.e.
    // not in organization_admins at all — fall back to the implicit
    // "member" role surfaced by the page-membership UI.
    const roleByOrg = new Map<string, "owner" | "admin" | "member">(
      adminRows.map((r) => [r.org.id, r.role]),
    );
    const seen = new Set<string>();
    const all = [...orgRows, ...adminRows, ...followRows].filter((r) => {
      if (seen.has(r.org.id)) return false;
      seen.add(r.org.id);
      return true;
    });
    const data = all.map((r) => {
      const role: "owner" | "admin" | "member" = roleByOrg.get(r.org.id) ?? "member";
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
    // Express 5's typed params widens to string | string[]; UUID route
    // params are always a single string here.
    const targetId = String(req.params.userId);
    // Composer "Post to Team" picker: restrict to teams the caller can
    // actually author posts on (mirrors canCreateRecap — org owner/admin
    // OR roster role=coach OR roster position=author). Self-only because
    // the answer is viewer-relative; other callers get a 403 to avoid
    // leaking another user's authoring scope.
    const authorable =
      typeof req.query.authorable === "string"
        ? req.query.authorable === "true"
        : req.query.authorable === true;
    if (authorable) {
      if (!me) return apiError(res, 401, "Not authenticated");
      if (me.id !== targetId)
        return apiError(res, 403, "Can only list your own authorable teams.");
      // Roster-derived authoring teams: any accepted entry where the
      // user is a coach or holds the explicit "author" position.
      const rosterRows = await db
        .select({ r: rosterEntries, t: teams, org: organizations })
        .from(rosterEntries)
        .innerJoin(teams, eq(rosterEntries.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .where(
          and(
            eq(rosterEntries.userId, me.id),
            eq(rosterEntries.status, "accepted"),
            or(
              eq(rosterEntries.role, "coach"),
              eq(rosterEntries.position, "author"),
            ),
          ),
        );
      // Org-admin-derived authoring teams: every team in any org where
      // the user holds owner/admin. Unioned with roster matches and
      // de-duped by teamId, preferring the roster row when both exist
      // (so role/position/seasonId come from the real membership).
      const adminOrgRows = await db
        .select({ orgId: organizationAdmins.organizationId })
        .from(organizationAdmins)
        .where(
          and(
            eq(organizationAdmins.userId, me.id),
            inArray(organizationAdmins.role, ["owner", "admin"]),
          ),
        );
      const adminOrgIds = adminOrgRows.map((r) => r.orgId);
      const orgTeamRows = adminOrgIds.length
        ? await db
            .select({ t: teams, org: organizations })
            .from(teams)
            .innerJoin(
              organizations,
              eq(teams.organizationId, organizations.id),
            )
            .where(inArray(teams.organizationId, adminOrgIds))
        : [];
      const seen = new Set<string>();
      const data: Array<Record<string, unknown>> = [];
      for (const r of rosterRows) {
        seen.add(r.t.id);
        data.push({
          id: r.r.id,
          teamId: r.t.id,
          teamName: r.t.name,
          teamSlug: r.t.name.toLowerCase().replace(/\s+/g, "-"),
          teamAvatarUrl: r.t.logoUrl ?? null,
          teamBannerUrl: r.t.bannerUrl ?? null,
          organization: {
            id: r.org.id,
            name: r.org.name,
            slug: r.org.name.toLowerCase().replace(/\s+/g, "-"),
          },
          role: r.r.role === "coach" ? "admin" : ("member" as const),
          position: r.r.role === "player" ? "player" : "coach",
          status: "active",
          seasonId: r.t.id,
          seasonName: r.t.season ?? null,
          jerseyNumber: r.r.jerseyNumber ?? null,
          joinedAt: r.r.createdAt.toISOString(),
        });
      }
      for (const r of orgTeamRows) {
        if (seen.has(r.t.id)) continue;
        seen.add(r.t.id);
        // Synthetic membership row for an org admin who isn't on the
        // team's roster. The schema requires `id` to be a UUID, so we
        // reuse the team's UUID — it's stable, opaque to clients, and
        // can't collide with any real roster_entries.id row in this
        // response (we already de-duped by teamId above and a roster
        // row would have taken the slot first). role=admin reflects
        // the org-derived authority.
        data.push({
          id: r.t.id,
          teamId: r.t.id,
          teamName: r.t.name,
          teamSlug: r.t.name.toLowerCase().replace(/\s+/g, "-"),
          teamAvatarUrl: r.t.logoUrl ?? null,
          teamBannerUrl: r.t.bannerUrl ?? null,
          organization: {
            id: r.org.id,
            name: r.org.name,
            slug: r.org.name.toLowerCase().replace(/\s+/g, "-"),
          },
          role: "admin" as const,
          position: "admin",
          status: "active",
          seasonId: r.t.id,
          seasonName: r.t.season ?? null,
          jerseyNumber: null,
          joinedAt: r.t.createdAt?.toISOString?.() ?? new Date(0).toISOString(),
        });
      }
      data.sort((a, b) =>
        String(a.teamName).localeCompare(String(b.teamName)),
      );
      res.json(paginate(data));
      return;
    }
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
    const data: Array<Record<string, unknown>> = [];
    const seenTeamIds = new Set<string>();
    for (const r of rows) {
      seenTeamIds.add(r.t.id);
      data.push({
        id: r.r.id,
        teamId: r.t.id,
        teamName: r.t.name,
        teamSlug: r.t.name.toLowerCase().replace(/\s+/g, "-"),
        teamAvatarUrl: r.t.logoUrl ?? null,
        teamBannerUrl: r.t.bannerUrl ?? null,
        organization: {
          id: r.org.id,
          name: r.org.name,
          slug: r.org.name.toLowerCase().replace(/\s+/g, "-"),
        },
        role: r.r.role === "coach" ? "admin" : ("member" as const),
        position: r.r.role === "player" ? "player" : "coach",
        status: r.r.status === "accepted" ? "active" : "pending",
        seasonId: r.t.id,
        seasonName: r.t.season ?? null,
        jerseyNumber: r.r.jerseyNumber ?? null,
        joinedAt: r.r.createdAt.toISOString(),
      });
    }
    // "Via child" teams: surface every team where the target user is a
    // team_followers row AND is the parentId of at least one user with an
    // accepted roster entry on that team. Synthesizes a `position: "parent"`
    // membership row so the team appears in the parent's profile Teams
    // section even though the parent isn't on the roster themselves.
    // De-duped against the roster-derived rows above by teamId — a real
    // membership wins.
    const child = aliasedTable(users, "child");
    const viaChildRows = await db
      .select({
        t: teams,
        org: organizations,
        followedAt: teamFollowers.createdAt,
      })
      .from(teamFollowers)
      .innerJoin(teams, eq(teamFollowers.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .innerJoin(rosterEntries, eq(rosterEntries.teamId, teams.id))
      .innerJoin(child, eq(rosterEntries.userId, child.id))
      .where(
        and(
          eq(teamFollowers.userId, targetId),
          eq(child.parentId, targetId),
          eq(rosterEntries.status, "accepted"),
        ),
      );
    const viaChildSeen = new Set<string>();
    for (const r of viaChildRows) {
      if (seenTeamIds.has(r.t.id)) continue;
      if (viaChildSeen.has(r.t.id)) continue;
      viaChildSeen.add(r.t.id);
      seenTeamIds.add(r.t.id);
      // Synthetic membership row. `id` reuses the team UUID (stable,
      // opaque, and de-duped above so it can't collide with a real
      // roster_entries.id). `position: "parent"` is the wire-format
      // marker the client uses to render the "Parent" badge.
      data.push({
        id: r.t.id,
        teamId: r.t.id,
        teamName: r.t.name,
        teamSlug: r.t.name.toLowerCase().replace(/\s+/g, "-"),
        teamAvatarUrl: r.t.logoUrl ?? null,
        teamBannerUrl: r.t.bannerUrl ?? null,
        organization: {
          id: r.org.id,
          name: r.org.name,
          slug: r.org.name.toLowerCase().replace(/\s+/g, "-"),
        },
        role: "member" as const,
        position: "parent",
        status: "active",
        seasonId: r.t.id,
        seasonName: r.t.season ?? null,
        jerseyNumber: null,
        joinedAt: (r.followedAt ?? new Date(0)).toISOString(),
      });
    }
    res.json(paginate(data));
  }),
);

export default router;
