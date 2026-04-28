import { Router, type IRouter } from "express";
import {
  db,
  users,
  organizations,
  organizationAdmins,
  organizationFollowers,
  userFollowers,
  teamFollowers,
  teams,
  rosterEntries,
  articles,
  articleAuthors,
  articleTags,
  highlights,
  highlightTags,
  orgPosts,
  notifications,
  postReactions,
  postComments,
  postShares,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
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
  displayName,
  toOrganization,
  toTeam,
  articleToPost,
  highlightToPost,
  orgPostToPost,
  toPostAuthor,
  paginate,
  parsePostId,
  articlePostId,
  highlightPostId,
  toComment,
  apiError,
  notFound,
} from "../lib/spec-helpers";
import { loadPostStats, statsFor, loadPostOwnerId, loadPostShareStats, shareStatsFor } from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap } from "../lib/article-tagging";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

router.get(
  "/feed",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");

    const [followedOrgRows, followedTeamRows, followedUserRows] = await Promise.all([
      db
        .select({ id: organizationFollowers.organizationId })
        .from(organizationFollowers)
        .where(eq(organizationFollowers.userId, me.id)),
      db
        .select({ id: teamFollowers.teamId })
        .from(teamFollowers)
        .where(eq(teamFollowers.userId, me.id)),
      db
        .select({ id: userFollowers.followingUserId })
        .from(userFollowers)
        .where(eq(userFollowers.followerUserId, me.id)),
    ]);
    const followedOrgIds = followedOrgRows.map((r) => r.id);
    const followedTeamIds = followedTeamRows.map((r) => r.id);
    const followedUserIds = followedUserRows.map((r) => r.id);

    if (
      followedOrgIds.length === 0 &&
      followedTeamIds.length === 0 &&
      followedUserIds.length === 0
    ) {
      // User follows nothing: only show their own posts.
      const ownArts = await db
        .select({ a: articles, team: teams, org: organizations, author: users })
        .from(articles)
        .innerJoin(teams, eq(articles.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .leftJoin(users, eq(articles.authorId, users.id))
        .where(
          and(
            eq(articles.status, "published"),
            eq(articles.authorId, me.id),
            isNull(articles.hiddenAt),
          ),
        )
        .orderBy(desc(articles.createdAt))
        .limit(10);
      const ownHls = await db
        .select({ h: highlights, team: teams, org: organizations, uploader: users })
        .from(highlights)
        .innerJoin(teams, eq(highlights.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .leftJoin(users, eq(highlights.uploaderId, users.id))
        .where(and(eq(highlights.uploaderId, me.id), isNull(highlights.hiddenAt)))
        .orderBy(desc(highlights.createdAt))
        .limit(10);
      const statKeys = [
        ...ownArts.map((r) => ({ kind: "article" as const, refId: r.a.id })),
        ...ownHls.map((r) => ({ kind: "highlight" as const, refId: r.h.id })),
      ];
      const articleRoleRows = ownArts.map((r) => ({
        articleId: r.a.id,
        authorId: r.a.authorId,
        teamId: r.team.id,
        orgId: r.org.id,
      }));
      const [stats, shareStats, canEditMap, authorRoleMap] = await Promise.all([
        loadPostStats(me.id, statKeys),
        loadPostShareStats(me.id, statKeys),
        computeArticleCanEditMap(
          me.id,
          ownArts.map((r) => ({
            articleId: r.a.id,
            authorId: r.a.authorId,
            orgId: r.org.id,
          })),
        ),
        computeArticleAuthorRoleMap(articleRoleRows),
      ]);
      const items = [
        ...ownArts.map((r) =>
          articleToPost(r.a, {
            team: r.team,
            org: r.org,
            author: r.author,
            canEdit: canEditMap.get(r.a.id) ?? false,
            authorRole: authorRoleMap.get(r.a.id) ?? null,
            ...statsFor(stats, "article", r.a.id),
            ...shareStatsFor(shareStats, "article", r.a.id),
          }),
        ),
        ...ownHls.map((r) =>
          highlightToPost(r.h, {
            team: r.team,
            org: r.org,
            author: r.uploader,
            ...statsFor(stats, "highlight", r.h.id),
            ...shareStatsFor(shareStats, "highlight", r.h.id),
          }),
        ),
      ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return res.json(paginate(items));
    }

    // Articles whose tagged users include any followed user.
    const articleIdsByTaggedUser = followedUserIds.length
      ? (
          await db
            .selectDistinct({ id: articleTags.articleId })
            .from(articleTags)
            .where(inArray(articleTags.userId, followedUserIds))
        ).map((r) => r.id)
      : [];
    const highlightIdsByTaggedUser = followedUserIds.length
      ? (
          await db
            .selectDistinct({ id: highlightTags.highlightId })
            .from(highlightTags)
            .where(inArray(highlightTags.userId, followedUserIds))
        ).map((r) => r.id)
      : [];

    const articleConds = [eq(articles.authorId, me.id)];
    if (followedTeamIds.length)
      articleConds.push(inArray(articles.teamId, followedTeamIds));
    if (followedOrgIds.length)
      articleConds.push(inArray(teams.organizationId, followedOrgIds));
    if (followedUserIds.length)
      articleConds.push(inArray(articles.authorId, followedUserIds));
    if (articleIdsByTaggedUser.length)
      articleConds.push(inArray(articles.id, articleIdsByTaggedUser));

    const arts = await db
      .select({ a: articles, team: teams, org: organizations, author: users })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(
        and(
          eq(articles.status, "published"),
          isNull(articles.hiddenAt),
          or(...articleConds),
        ),
      )
      .orderBy(desc(articles.createdAt))
      .limit(20);

    const highlightConds = [eq(highlights.uploaderId, me.id)];
    if (followedTeamIds.length)
      highlightConds.push(inArray(highlights.teamId, followedTeamIds));
    if (followedOrgIds.length)
      highlightConds.push(inArray(teams.organizationId, followedOrgIds));
    if (followedUserIds.length)
      highlightConds.push(inArray(highlights.uploaderId, followedUserIds));
    if (highlightIdsByTaggedUser.length)
      highlightConds.push(inArray(highlights.id, highlightIdsByTaggedUser));

    const hls = await db
      .select({ h: highlights, team: teams, org: organizations, uploader: users })
      .from(highlights)
      .innerJoin(teams, eq(highlights.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .leftJoin(users, eq(highlights.uploaderId, users.id))
      .where(and(isNull(highlights.hiddenAt), or(...highlightConds)))
      .orderBy(desc(highlights.createdAt))
      .limit(20);

    // Org-level announcements from followed organizations.
    const orgPostRows = followedOrgIds.length
      ? await db
          .select({ p: orgPosts, org: organizations, author: users })
          .from(orgPosts)
          .innerJoin(organizations, eq(orgPosts.organizationId, organizations.id))
          .leftJoin(users, eq(orgPosts.authorId, users.id))
          .where(
            and(
              eq(orgPosts.status, "published"),
              isNull(orgPosts.hiddenAt),
              inArray(orgPosts.organizationId, followedOrgIds),
            ),
          )
          .orderBy(desc(orgPosts.createdAt))
          .limit(20)
      : [];

    // Re-shares posted by the viewer or any followed user. Each
    // share row joins back to its underlying article/highlight; we
    // drop targets that have been hidden / deleted / unpublished so
    // a moderation action can never resurface a post via a stale
    // share. Originals already in the feed win — we only inject the
    // share card if the viewer hasn't seen the post yet (in which
    // case it appears with `sharedBy`/`sharedAt` set).
    const sharerIds = [me.id, ...followedUserIds];
    const shareRows = await db
      .select({ s: postShares, sharer: users })
      .from(postShares)
      .leftJoin(users, eq(postShares.sharerUserId, users.id))
      .where(inArray(postShares.sharerUserId, sharerIds))
      .orderBy(desc(postShares.createdAt))
      .limit(40);

    const sharedArticleIds = shareRows
      .filter((r) => r.s.postKind === "article")
      .map((r) => r.s.postRefId);
    const sharedHighlightIds = shareRows
      .filter((r) => r.s.postKind === "highlight")
      .map((r) => r.s.postRefId);

    const sharedArticleRows = sharedArticleIds.length
      ? await db
          .select({ a: articles, team: teams, org: organizations, author: users })
          .from(articles)
          .innerJoin(teams, eq(articles.teamId, teams.id))
          .innerJoin(organizations, eq(teams.organizationId, organizations.id))
          .leftJoin(users, eq(articles.authorId, users.id))
          .where(
            and(
              inArray(articles.id, sharedArticleIds),
              eq(articles.status, "published"),
              isNull(articles.hiddenAt),
            ),
          )
      : [];
    const sharedHighlightRows = sharedHighlightIds.length
      ? await db
          .select({ h: highlights, team: teams, org: organizations, uploader: users })
          .from(highlights)
          .innerJoin(teams, eq(highlights.teamId, teams.id))
          .innerJoin(organizations, eq(teams.organizationId, organizations.id))
          .leftJoin(users, eq(highlights.uploaderId, users.id))
          .where(and(inArray(highlights.id, sharedHighlightIds), isNull(highlights.hiddenAt)))
      : [];

    const sharedArticleById = new Map(sharedArticleRows.map((r) => [r.a.id, r]));
    const sharedHighlightById = new Map(sharedHighlightRows.map((r) => [r.h.id, r]));

    const statKeys = [
      ...arts.map((r) => ({ kind: "article" as const, refId: r.a.id })),
      ...hls.map((r) => ({ kind: "highlight" as const, refId: r.h.id })),
      ...orgPostRows.map((r) => ({ kind: "org_post" as const, refId: r.p.id })),
      ...sharedArticleRows.map((r) => ({ kind: "article" as const, refId: r.a.id })),
      ...sharedHighlightRows.map((r) => ({ kind: "highlight" as const, refId: r.h.id })),
    ];
    const shareStatKeys = statKeys.filter(
      (k): k is { kind: "article" | "highlight"; refId: string } =>
        k.kind === "article" || k.kind === "highlight",
    );
    const articleEditRows = [
      ...arts.map((r) => ({
        articleId: r.a.id,
        authorId: r.a.authorId,
        orgId: r.org.id,
      })),
      ...sharedArticleRows.map((r) => ({
        articleId: r.a.id,
        authorId: r.a.authorId,
        orgId: r.org.id,
      })),
    ];
    // Same row set as `articleEditRows`, but extended with the team id
    // so the role lookup can scope coach / "author" position lookups
    // to the recap's team without a per-row query.
    const articleRoleRows = [
      ...arts.map((r) => ({
        articleId: r.a.id,
        authorId: r.a.authorId,
        teamId: r.team.id,
        orgId: r.org.id,
      })),
      ...sharedArticleRows.map((r) => ({
        articleId: r.a.id,
        authorId: r.a.authorId,
        teamId: r.team.id,
        orgId: r.org.id,
      })),
    ];
    const [stats, shareStats, canEditMap, authorRoleMap] = await Promise.all([
      loadPostStats(me?.id ?? null, statKeys),
      loadPostShareStats(me?.id ?? null, shareStatKeys),
      computeArticleCanEditMap(me?.id ?? null, articleEditRows),
      computeArticleAuthorRoleMap(articleRoleRows),
    ]);

    const seenIds = new Set<string>([
      ...arts.map((r) => `article-${r.a.id}`),
      ...hls.map((r) => `highlight-${r.h.id}`),
    ]);

    const items: ReturnType<typeof articleToPost>[] = [
      ...arts.map((r) =>
        articleToPost(r.a, {
          team: r.team,
          org: r.org,
          author: r.author,
          canEdit: canEditMap.get(r.a.id) ?? false,
          authorRole: authorRoleMap.get(r.a.id) ?? null,
          ...statsFor(stats, "article", r.a.id),
          ...shareStatsFor(shareStats, "article", r.a.id),
        }),
      ),
      ...hls.map((r) =>
        highlightToPost(r.h, {
          team: r.team,
          org: r.org,
          author: r.uploader,
          ...statsFor(stats, "highlight", r.h.id),
          ...shareStatsFor(shareStats, "highlight", r.h.id),
        }),
      ),
      ...orgPostRows.map((r) =>
        orgPostToPost(r.p, {
          org: r.org,
          author: r.author,
          ...statsFor(stats, "org_post", r.p.id),
        }),
      ),
    ];

    for (const sr of shareRows) {
      const key = `${sr.s.postKind}-${sr.s.postRefId}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      const sharedBy = sr.sharer ? toPostAuthor(sr.sharer) : null;
      const sharedAt = sr.s.createdAt.toISOString();
      if (sr.s.postKind === "article") {
        const row = sharedArticleById.get(sr.s.postRefId);
        if (!row) continue;
        items.push(
          articleToPost(row.a, {
            team: row.team,
            org: row.org,
            author: row.author,
            canEdit: canEditMap.get(row.a.id) ?? false,
            authorRole: authorRoleMap.get(row.a.id) ?? null,
            ...statsFor(stats, "article", row.a.id),
            ...shareStatsFor(shareStats, "article", row.a.id),
            sharedBy,
            sharedAt,
          }),
        );
      } else if (sr.s.postKind === "highlight") {
        const row = sharedHighlightById.get(sr.s.postRefId);
        if (!row) continue;
        items.push(
          highlightToPost(row.h, {
            team: row.team,
            org: row.org,
            author: row.uploader,
            ...statsFor(stats, "highlight", row.h.id),
            ...shareStatsFor(shareStats, "highlight", row.h.id),
            sharedBy,
            sharedAt,
          }),
        );
      }
    }

    // Order by effective date: shares use sharedAt so a freshly
    // shared old recap rises to the top; everything else uses its
    // own createdAt.
    items.sort((a, b) => {
      const ad = a.sharedAt ?? a.createdAt;
      const bd = b.sharedAt ?? b.createdAt;
      return ad < bd ? 1 : -1;
    });
    res.json(paginate(items));
  }),
);

router.get(
  "/follow-suggestions",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");

    const SUGGESTION_LIMIT = 5;

    const [
      followedOrgRows,
      adminOrgRows,
      followedTeamRows,
      memberTeamRows,
      followedUserRows,
    ] = await Promise.all([
      db
        .select({ id: organizationFollowers.organizationId })
        .from(organizationFollowers)
        .where(eq(organizationFollowers.userId, me.id)),
      db
        .select({ id: organizationAdmins.organizationId })
        .from(organizationAdmins)
        .where(eq(organizationAdmins.userId, me.id)),
      db
        .select({ id: teamFollowers.teamId })
        .from(teamFollowers)
        .where(eq(teamFollowers.userId, me.id)),
      db
        .select({ id: rosterEntries.teamId })
        .from(rosterEntries)
        .where(eq(rosterEntries.userId, me.id)),
      db
        .select({ id: userFollowers.followingUserId })
        .from(userFollowers)
        .where(eq(userFollowers.followerUserId, me.id)),
    ]);

    const excludedOrgIds = new Set<string>([
      ...followedOrgRows.map((r) => r.id),
      ...adminOrgRows.map((r) => r.id),
    ]);
    const excludedTeamIds = new Set<string>([
      ...followedTeamRows.map((r) => r.id),
      ...memberTeamRows.map((r) => r.id),
    ]);
    const excludedUserIds = new Set<string>([
      ...followedUserRows.map((r) => r.id),
      me.id,
    ]);

    const orgRows = await db
      .select({
        org: organizations,
        followerCount: sql<number>`count(${organizationFollowers.userId})::int`,
      })
      .from(organizations)
      .leftJoin(
        organizationFollowers,
        eq(organizationFollowers.organizationId, organizations.id),
      )
      .groupBy(organizations.id)
      .orderBy(
        desc(sql<number>`count(${organizationFollowers.userId})`),
        desc(organizations.createdAt),
      )
      .limit(SUGGESTION_LIMIT + excludedOrgIds.size);
    const orgSuggestions = orgRows
      .filter((r) => !excludedOrgIds.has(r.org.id))
      .slice(0, SUGGESTION_LIMIT)
      .map((r) => toOrganization(r.org, { isMember: false, isFollowing: false }));

    const teamRows = await db
      .select({
        team: teams,
        org: organizations,
        followerCount: sql<number>`count(${teamFollowers.userId})::int`,
      })
      .from(teams)
      .innerJoin(organizations, eq(organizations.id, teams.organizationId))
      .leftJoin(teamFollowers, eq(teamFollowers.teamId, teams.id))
      .groupBy(teams.id, organizations.id)
      .orderBy(
        desc(sql<number>`count(${teamFollowers.userId})`),
        desc(teams.createdAt),
      )
      .limit(SUGGESTION_LIMIT + excludedTeamIds.size);
    const teamSuggestions = teamRows
      .filter((r) => !excludedTeamIds.has(r.team.id))
      .slice(0, SUGGESTION_LIMIT)
      .map((r) =>
        toTeam(r.team, r.org, {
          followerCount: r.followerCount,
          isFollowing: false,
        }),
      );

    const userRows = await db
      .select({
        user: users,
        followerCount: sql<number>`count(${userFollowers.followerUserId})::int`,
      })
      .from(users)
      .leftJoin(
        userFollowers,
        eq(userFollowers.followingUserId, users.id),
      )
      .where(ne(users.id, me.id))
      .groupBy(users.id)
      .orderBy(
        desc(sql<number>`count(${userFollowers.followerUserId})`),
        desc(users.createdAt),
      )
      .limit(SUGGESTION_LIMIT + excludedUserIds.size);
    const userSuggestions = userRows
      .filter((r) => !excludedUserIds.has(r.user.id))
      .slice(0, SUGGESTION_LIMIT)
      .map((r) => toPublicUser(r.user, { isOwnProfile: false, isFollowing: false }));

    res.json({
      organizations: orgSuggestions,
      teams: teamSuggestions,
      users: userSuggestions,
    });
  }),
);

router.get(
  "/posts/:postId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    const isAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
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
      if (row.a.hiddenAt && !isAdmin) return notFound(res);
      const isAuthor = !!me && row.a.authorId === me.id;
      const isOrgAdmin =
        !!me && (await canManageOrganization(me.id, row.org.id));
      if (row.a.status !== "published" && !isAuthor && !isOrgAdmin) {
        return notFound(res);
      }
      // Co-authors get the same edit affordance as the author. Skip
      // the lookup if we already know the viewer can edit (author/admin)
      // or if they're not logged in.
      let isCoAuthor = false;
      if (me && !isAuthor) {
        const [coRow] = await db
          .select({ id: articleAuthors.userId })
          .from(articleAuthors)
          .where(
            and(
              eq(articleAuthors.articleId, row.a.id),
              eq(articleAuthors.userId, me.id),
            ),
          )
          .limit(1);
        isCoAuthor = !!coRow;
      }
      const canEdit = isAuthor || isCoAuthor || isOrgAdmin;
      const [stats, shareStats, authorRoleMap] = await Promise.all([
        loadPostStats(me?.id ?? null, [{ kind: "article", refId: row.a.id }]),
        loadPostShareStats(me?.id ?? null, [{ kind: "article", refId: row.a.id }]),
        computeArticleAuthorRoleMap([
          {
            articleId: row.a.id,
            authorId: row.a.authorId,
            teamId: row.team.id,
            orgId: row.org.id,
          },
        ]),
      ]);
      res.json(
        articleToPost(row.a, {
          team: row.team,
          org: row.org,
          author: row.author,
          canEdit,
          authorRole: authorRoleMap.get(row.a.id) ?? null,
          ...statsFor(stats, "article", row.a.id),
          ...shareStatsFor(shareStats, "article", row.a.id),
        }),
      );
      return;
    }
    if (parsed.kind === "org_post") {
      const [row] = await db
        .select({ p: orgPosts, org: organizations, author: users })
        .from(orgPosts)
        .innerJoin(organizations, eq(orgPosts.organizationId, organizations.id))
        .leftJoin(users, eq(orgPosts.authorId, users.id))
        .where(eq(orgPosts.id, parsed.id))
        .limit(1);
      if (!row) return notFound(res);
      if (row.p.hiddenAt && !isAdmin) return notFound(res);
      if (row.p.status !== "published") {
        const isAuthor = !!me && row.p.authorId === me.id;
        const isOrgAdmin = !!me && (await canManageOrganization(me.id, row.org.id));
        if (!isAuthor && !isOrgAdmin) return notFound(res);
      }
      const stats = await loadPostStats(me?.id ?? null, [
        { kind: "org_post", refId: row.p.id },
      ]);
      res.json(
        orgPostToPost(row.p, {
          org: row.org,
          author: row.author,
          ...statsFor(stats, "org_post", row.p.id),
        }),
      );
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
    if (row.h.hiddenAt && !isAdmin) return notFound(res);
    const [stats, shareStats] = await Promise.all([
      loadPostStats(me?.id ?? null, [{ kind: "highlight", refId: row.h.id }]),
      loadPostShareStats(me?.id ?? null, [{ kind: "highlight", refId: row.h.id }]),
    ]);
    res.json(
      highlightToPost(row.h, {
        team: row.team,
        org: row.org,
        author: row.uploader,
        ...statsFor(stats, "highlight", row.h.id),
        ...shareStatsFor(shareStats, "highlight", row.h.id),
      }),
    );
  }),
);

router.get(
  "/posts/:postId/comments",
  asyncHandler(async (req, res) => {
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    const isAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
    const conds = [
      eq(postComments.postKind, parsed.kind),
      eq(postComments.postRefId, parsed.id),
      isNull(postComments.deletedAt),
    ];
    if (!isAdmin) conds.push(isNull(postComments.hiddenAt));
    const rows = await db
      .select({ c: postComments, author: users })
      .from(postComments)
      .leftJoin(users, eq(postComments.authorId, users.id))
      .where(and(...conds))
      .orderBy(asc(postComments.createdAt));
    res.json(paginate(rows.map((r) => toComment(r.c, r.author))));
  }),
);

router.post(
  "/posts/:postId/comments",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    const body = String(req.body?.body ?? "").trim();
    if (!body) return apiError(res, 400, "Comment body is required");
    const [c] = await db
      .insert(postComments)
      .values({
        postKind: parsed.kind,
        postRefId: parsed.id,
        authorId: me.id,
        body,
      })
      .returning();
    res.status(201).json(toComment(c, me));
  }),
);

router.delete(
  "/posts/:postId/comments/:commentId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [c] = await db
      .select()
      .from(postComments)
      .where(eq(postComments.id, req.params.commentId))
      .limit(1);
    if (!c) return notFound(res);
    if (c.authorId !== me.id)
      return apiError(res, 403, "Only the author can delete this comment");
    await db
      .update(postComments)
      .set({ deletedAt: new Date() })
      .where(eq(postComments.id, c.id));
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Share / Re-share — task #190 (polymorphic over article|highlight)
// ---------------------------------------------------------------------------
//
// Re-shares are stored polymorphically in `post_shares (postKind,
// postRefId, sharerUserId)` and are scoped to the two viewer-facing
// post kinds: game-recap articles and highlights. Org posts are
// rejected with 400. Visibility mirrors GET /posts/:postId — drafts,
// hidden, and non-recap articles return 404 to non-authors. Any
// viewer of the post (including team-follower fans who are not on
// the roster) may share it.

async function loadShareableTarget(
  parsed: { kind: "article" | "highlight"; id: string },
  meId: string | null,
  isAdmin: boolean,
): Promise<{ ok: true; ownerId: string | null; title: string; kindLabel: "recap" | "highlight" } | { ok: false }> {
  if (parsed.kind === "article") {
    const [row] = await db
      .select({
        a: articles,
        org: organizations,
      })
      .from(articles)
      .innerJoin(teams, eq(articles.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(eq(articles.id, parsed.id))
      .limit(1);
    if (!row) return { ok: false };
    if (row.a.hiddenAt && !isAdmin) return { ok: false };
    const isAuthor = !!meId && row.a.authorId === meId;
    const isOrgAdmin =
      !!meId && (await canManageOrganization(meId, row.org.id));
    if (row.a.status !== "published" && !isAuthor && !isOrgAdmin) {
      return { ok: false };
    }
    // Recap-only: a long-form article without a gameDate is not a
    // game recap and is not shareable per task #162 (kept under #190).
    if (!row.a.gameDate) return { ok: false };
    return { ok: true, ownerId: row.a.authorId, title: row.a.title, kindLabel: "recap" };
  }
  const [row] = await db
    .select({ h: highlights })
    .from(highlights)
    .where(eq(highlights.id, parsed.id))
    .limit(1);
  if (!row) return { ok: false };
  if (row.h.hiddenAt && !isAdmin) return { ok: false };
  return { ok: true, ownerId: row.h.uploaderId, title: row.h.title, kindLabel: "highlight" };
}

router.post(
  "/posts/:postId/share",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    if (parsed.kind === "org_post") {
      return apiError(res, 400, "Org posts cannot be re-shared");
    }
    const shareableParsed = parsed as { kind: "article" | "highlight"; id: string };
    const isAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
    const target = await loadShareableTarget(shareableParsed, me.id, isAdmin);
    if (!target.ok) return notFound(res);

    const inserted = await db
      .insert(postShares)
      .values({
        postKind: shareableParsed.kind,
        postRefId: shareableParsed.id,
        sharerUserId: me.id,
      })
      .onConflictDoNothing()
      .returning({ id: postShares.id });

    // Bell-notify the original uploader on a fresh share (not on
    // duplicate toggles, not on self-shares, not when the recipient
    // has opted out via PATCH /notifications/share-preference, and
    // not for orphaned posts whose author has been deleted).
    if (inserted.length > 0 && target.ownerId && target.ownerId !== me.id) {
      const [owner] = await db
        .select({
          id: users.id,
          shareOptOut: users.shareNotificationsOptOut,
        })
        .from(users)
        .where(eq(users.id, target.ownerId))
        .limit(1);
      if (owner && !owner.shareOptOut) {
        await db.insert(notifications).values({
          userId: owner.id,
          kind: "share",
          message: `${displayName(me)} shared your ${target.kindLabel} '${target.title}'`,
          link: `/posts/${req.params.postId}`,
          actorUserId: me.id,
        });
      }
    }
    res.status(204).end();
  }),
);

router.delete(
  "/posts/:postId/share",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    if (parsed.kind === "org_post") {
      return apiError(res, 400, "Org posts cannot be re-shared");
    }
    await db
      .delete(postShares)
      .where(
        and(
          eq(postShares.postKind, parsed.kind),
          eq(postShares.postRefId, parsed.id),
          eq(postShares.sharerUserId, me.id),
        ),
      );
    // Retract the still-unread share notification (if any) so the
    // bell doesn't claim a share that the sharer has rolled back.
    // Read notifications stay put — they're part of the recipient's
    // history and should not be silently rewritten.
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.kind, "share"),
          eq(notifications.link, `/posts/${req.params.postId}`),
          eq(notifications.actorUserId, me.id),
          eq(notifications.read, false),
        ),
      );
    res.status(204).end();
  }),
);

router.post(
  "/posts/:postId/reactions",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    const inserted = await db
      .insert(postReactions)
      .values({
        postKind: parsed.kind,
        postRefId: parsed.id,
        userId: me.id,
        reactionType: "like",
      })
      .onConflictDoNothing()
      .returning({ userId: postReactions.userId });
    // Bell-notify the post owner exactly once per fresh like. We
    // look up the owner per post kind. The notification carries
    // `actorUserId` so the family dashboard's Remove can revoke
    // this specific like row, and a `/posts/<postId>` link so the
    // Remove handler can locate the post unambiguously. Self-likes
    // and re-likes (no insert happened) skip the bell.
    if (inserted.length > 0) {
      const ownerId = await loadPostOwnerId(parsed);
      if (ownerId && ownerId !== me.id) {
        await db.insert(notifications).values({
          userId: ownerId,
          kind: "like",
          message: `${displayName(me)} liked your post`,
          link: `/posts/${req.params.postId}`,
          actorUserId: me.id,
        });
      }
    }
    res.status(204).end();
  }),
);

router.delete(
  "/posts/:postId/reactions",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    await db
      .delete(postReactions)
      .where(
        and(
          eq(postReactions.postKind, parsed.kind),
          eq(postReactions.postRefId, parsed.id),
          eq(postReactions.userId, me.id),
        ),
      );
    res.status(204).end();
  }),
);

router.get(
  "/posts/:postId/tags",
  asyncHandler(async (req, res) => {
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);
    if (parsed.kind === "article") {
      const rows = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.articleId, parsed.id))
        .orderBy(desc(articleTags.createdAt));
      res.json({
        tags: rows.map((t) => ({
          id: t.id,
          postId: articlePostId(parsed.id),
          taggedEntityType: "user" as const,
          taggedEntityId: t.userId,
          direction: "lateral" as const,
          status: t.status,
          approverId: t.userId,
          createdBy: t.taggerUserId ?? null,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        })),
      });
      return;
    }
    const rows = await db
      .select()
      .from(highlightTags)
      .where(eq(highlightTags.highlightId, parsed.id))
      .orderBy(desc(highlightTags.createdAt));
    res.json({
      tags: rows.map((t) => ({
        id: t.id,
        postId: highlightPostId(parsed.id),
        taggedEntityType: "user" as const,
        taggedEntityId: t.userId,
        direction: "lateral" as const,
        status: t.status,
        approverId: t.userId,
        createdBy: t.taggerUserId ?? null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  }),
);

router.post(
  "/posts",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const body = req.body ?? {};
    // Team selection rules. The team chosen here is the team the article
    // is filed under AND the roster the auto-tag fan-out runs against,
    // so it must be unambiguous — silently picking "any team in the
    // database" was the regression that caused recaps to tag the wrong
    // (or no) players (task #242).
    //   1. Explicit context.id / teamId always wins.
    //   2. With only an organizationId, resolve to the user's single
    //      authoring team in that org:
    //        - Coach/author roster affiliations: exactly 1 -> use it,
    //          multiple -> 400 (ambiguous).
    //        - Org admin with no specific roster affiliation: exactly 1
    //          team in the org -> use it, multiple -> 400 (ambiguous).
    //          We deliberately do NOT silently pick orgTeams[0] for
    //          admins, because canCreateRecap is true for them on every
    //          team in the org and the fan-out would tag the wrong
    //          roster (task #242).
    //        - Unauthorized user, no affiliation: fall back to
    //          orgTeams[0] so the inner canCreateRecap below returns
    //          its own clean 403 — preserves the
    //          "Only admins, coaches, and authors can create game
    //          recaps" message tests depend on.
    //   3. With neither teamId nor organizationId, return 400.
    let teamId: string | undefined = body.context?.id ?? body.teamId;
    if (!teamId && body.organizationId) {
      const orgTeams = await db
        .select()
        .from(teams)
        .where(eq(teams.organizationId, body.organizationId));
      const callerTeamRows = await db
        .select({ teamId: rosterEntries.teamId })
        .from(rosterEntries)
        .innerJoin(teams, eq(rosterEntries.teamId, teams.id))
        .where(
          and(
            eq(teams.organizationId, body.organizationId),
            eq(rosterEntries.userId, me.id),
            eq(rosterEntries.status, "accepted"),
            or(
              eq(rosterEntries.role, "coach"),
              eq(rosterEntries.position, "author"),
            ),
          ),
        );
      const callerTeamIds = new Set(callerTeamRows.map((r) => r.teamId));
      if (callerTeamIds.size === 1) {
        teamId = [...callerTeamIds][0];
      } else if (callerTeamIds.size > 1) {
        return apiError(
          res,
          400,
          "Multiple teams available — please pick a team before posting.",
        );
      } else {
        // No specific coach/author affiliation. If the caller is an org
        // admin we still need to resolve a team to avoid silently
        // picking the wrong one for fan-out.
        const isOrgAdmin = await canManageOrganization(
          me.id,
          body.organizationId,
        );
        if (isOrgAdmin) {
          if (orgTeams.length === 1) {
            teamId = orgTeams[0].id;
          } else if (orgTeams.length > 1) {
            return apiError(
              res,
              400,
              "Multiple teams available — please pick a team before posting.",
            );
          }
          // 0 teams in the org falls through to the !teamId 400 below.
        } else if (orgTeams.length > 0) {
          // Unauthorized user — let canCreateRecap return the proper
          // 403 with the message tests depend on.
          teamId = orgTeams[0].id;
        }
      }
    }
    if (!teamId)
      return apiError(
        res,
        400,
        "teamId is required (post from a team page or include teamId in the request).",
      );
    if (body.postType === "long") {
      const isDraft = body.status === "draft";
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
      const [org] = team
        ? await db.select().from(organizations).where(eq(organizations.id, team.organizationId)).limit(1)
        : [null];
      if (!team || !org) return notFound(res);
      const allowed = await canCreateRecap(me.id, team);
      if (!allowed)
        return apiError(res, 403, "Only admins, coaches, and authors can create game recaps");
      const isAdmin = await canManageOrganization(me.id, team.organizationId);
      const status: "draft" | "pending_approval" | "published" = isDraft
        ? "draft"
        : isAdmin
          ? "published"
          : "pending_approval";
      const photoUrls: string[] = Array.isArray(body.photoUrls)
        ? body.photoUrls.filter((u: unknown) => typeof u === "string")
        : [];
      // Game-recap fields. The presence of `gameDate` is what marks
      // an article as a recap and triggers the auto-tag fan-out below.
      let gameDate: Date | null = null;
      if (typeof body.gameDate === "string" && body.gameDate.length > 0) {
        const parsed = new Date(body.gameDate);
        if (!Number.isNaN(parsed.getTime())) gameDate = parsed;
      }
      const opponentName: string | null =
        typeof body.opponentName === "string" && body.opponentName.trim().length > 0
          ? body.opponentName.trim()
          : null;
      let teamScore: number | null = null;
      let opponentScore: number | null = null;
      if (typeof body.gameScore === "string") {
        const m = /^(\d+)\s*-\s*(\d+)$/.exec(body.gameScore.trim());
        if (m) {
          teamScore = Number(m[1]);
          opponentScore = Number(m[2]);
        }
      }
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
          opponentName,
          teamScore,
          opponentScore,
          gameDate,
          status,
          publishedAt: status === "published" ? new Date() : null,
        })
        .returning();

      const newlyTagged = await applyArticleTagFanout({
        articleId: a.id,
        teamId,
        taggerUserId: me.id,
        explicitUserIds: Array.isArray(body.taggedUserIds)
          ? body.taggedUserIds.filter((u: unknown): u is string => typeof u === "string")
          : [],
        gameDate,
      });
      // Bell-notify each newly-tagged player. Drafts skip this — there
      // is no published article to link to yet, and the publish handler
      // re-runs the fan-out + notify when the draft goes live. Pending-
      // approval recaps also skip this step; the admin approval handler
      // (organizations.ts) runs the notify after it flips the status to
      // "published" so players don't get pinged about a recap that may
      // never go live. (task #249)
      if (status === "published" && newlyTagged.length > 0) {
        await notifyNewlyTaggedInRecap({
          userIds: newlyTagged,
          articleId: a.id,
          articleTitle: a.title,
          actorUserId: me.id,
        });
      }

      // Compute the role label so the response carries the same
      // header data the client will need when it opens the recap.
      const authorRoleMap = await computeArticleAuthorRoleMap([
        { articleId: a.id, authorId: a.authorId, teamId: team.id, orgId: org.id },
      ]);
      res.status(201).json({
        ...articleToPost(a, {
          team,
          org,
          author: me,
          authorRole: authorRoleMap.get(a.id) ?? null,
        }),
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

export default router;
