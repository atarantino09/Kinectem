import { Router, type IRouter } from "express";
import {
  db,
  users,
  organizations,
  teams,
  articles,
  articleTags,
  highlights,
  highlightTags,
  rosterEntries,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
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
  articlePostId,
  highlightPostId,
  apiError,
  notFound,
  parsePostId,
} from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostOwnerId,
  type PostStats,
  type StatsKind,
} from "../lib/post-stats";
import {
  applyArticleTagFanout,
  notifyNewlyTaggedInRecap,
  notifyNewlyTaggedInHighlight,
  TAG_NOTIF_THROTTLE_MS,
} from "../lib/article-tagging";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Tag management (player-removable tags)
// ---------------------------------------------------------------------------

router.get(
  "/users/me/tags",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
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
      .where(and(eq(articleTags.userId, me.id), eq(articleTags.status, "approved")))
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
      .where(and(eq(highlightTags.userId, me.id), eq(highlightTags.status, "approved")))
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

// ---------------------------------------------------------------------------
// POST /posts/:postId/tags — propose tags on a post
// ---------------------------------------------------------------------------
// Used by the highlight composer to tag specific roster players when
// publishing a clip (task #313). Mirrors the consent semantics of the
// existing recap auto-fanout: a target whose own user (or guardian)
// has `requireTagConsent` set lands as `pending`; everyone else is
// `approved` immediately. Idempotent on the (post, user) pair —
// re-tagging a user who is already tagged is a no-op for that user.
//
// Permission: only the post author/uploader, or an org admin/owner of
// the post's owning org, may add tags. We deliberately don't widen
// this further (e.g. to all roster members) — the manual tag in this
// flow is "the author of the post is calling out who appears in it",
// which the ux only exposes to that author.
router.post(
  "/posts/:postId/tags",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed) return notFound(res);

    const rawTags: unknown = req.body?.tags;
    if (!Array.isArray(rawTags))
      return apiError(res, 400, "tags must be an array");
    type IncomingTag = {
      taggedEntityType: string;
      taggedEntityId: string;
      direction?: string;
    };
    const userTagIds: string[] = [];
    for (const t of rawTags as IncomingTag[]) {
      if (!t || typeof t !== "object") continue;
      // For now this endpoint only handles user tags — the
      // highlight composer is the only caller and only proposes
      // user tags. team/organization targets are accepted by the
      // spec but not yet wired into any persistence path here.
      if (t.taggedEntityType !== "user") continue;
      if (typeof t.taggedEntityId !== "string" || t.taggedEntityId.length === 0)
        continue;
      userTagIds.push(t.taggedEntityId);
    }
    // De-dupe early so the same (post, user) pair isn't proposed
    // twice in a single request.
    const uniqueUserIds = Array.from(new Set(userTagIds));

    // Look up the underlying post + owning team/org so we can run
    // the permission check and the consent lookup.
    let teamId: string;
    let isAuthor: boolean;
    // Cached so the highlight branch can pass the post title into the
    // notification helper without re-fetching the row after insert.
    let highlightTitle: string | null = null;
    if (parsed.kind === "article") {
      const [a] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, parsed.id))
        .limit(1);
      if (!a) return notFound(res);
      teamId = a.teamId;
      isAuthor = a.authorId === me.id;
    } else {
      const [h] = await db
        .select()
        .from(highlights)
        .where(eq(highlights.id, parsed.id))
        .limit(1);
      if (!h) return notFound(res);
      teamId = h.teamId;
      isAuthor = h.uploaderId === me.id;
      highlightTitle = h.title ?? null;
    }
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) return notFound(res);
    const isAdmin = await canManageOrganization(me.id, team.organizationId);
    if (!isAuthor && !isAdmin)
      return apiError(res, 403, "Only the post author can add tags");

    // No-op fast path keeps the response shape consistent and
    // avoids issuing empty IN(...) lookups against the users table.
    if (uniqueUserIds.length === 0) {
      return res.status(201).json({ tags: [] });
    }

    // Roster eligibility gate (task #313 hardening, fixed in #319):
    // a manual user tag is only valid for accepted player-role
    // roster members of the post's team. The "is this a player?"
    // decision lives on `role` (player/coach/admin), NOT on
    // `position` — `position` stores the football position
    // (e.g. "WR", "QB") and is null for coaches, so filtering by
    // `position === "player"` silently rejected every valid tag
    // (#319). Coaches/admins, pending invitees, and anyone not on
    // the roster are silently dropped — the composer's player picker
    // already filters to the same set, so the only way to hit this
    // branch is a hand-rolled request. Mirrors the recap auto-fanout's
    // eligibility rules (see article-tagging.ts) and prevents an
    // author or org admin from spraying tags at unrelated users.
    const eligibleRows = await db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.status, "accepted"),
          eq(rosterEntries.role, "player"),
          inArray(rosterEntries.userId, uniqueUserIds),
        ),
      );
    const eligibleIds = new Set(eligibleRows.map((r) => r.userId));
    const eligibleUserIds = uniqueUserIds.filter((id) => eligibleIds.has(id));
    if (eligibleUserIds.length === 0) {
      return res.status(201).json({ tags: [] });
    }

    // Resolve consent for each target: a user requires consent
    // either because their own `requireTagConsent` is true, or
    // because they're a minor whose linked guardian has it set.
    const userRows = await db
      .select({
        id: users.id,
        requireTagConsent: users.requireTagConsent,
        parentId: users.parentId,
      })
      .from(users)
      .where(inArray(users.id, eligibleUserIds));
    const parentIds = Array.from(
      new Set(
        userRows.map((u) => u.parentId).filter((p): p is string => !!p),
      ),
    );
    const parentConsent = new Map<string, boolean>();
    if (parentIds.length > 0) {
      const parents = await db
        .select({ id: users.id, flag: users.requireTagConsent })
        .from(users)
        .where(inArray(users.id, parentIds));
      for (const p of parents) parentConsent.set(p.id, !!p.flag);
    }

    if (parsed.kind === "article") {
      // Skip rows for users who are already tagged so the response
      // only carries the freshly-inserted tags. Matches the recap
      // fanout's "ON CONFLICT DO NOTHING" behavior.
      const existing = await db
        .select({ userId: articleTags.userId })
        .from(articleTags)
        .where(eq(articleTags.articleId, parsed.id));
      const skip = new Set(existing.map((r) => r.userId));
      const toInsert = userRows
        .filter((u) => !skip.has(u.id))
        .map((u) => {
          const parentRequires = u.parentId
            ? !!parentConsent.get(u.parentId)
            : false;
          const requires = !!u.requireTagConsent || parentRequires;
          return {
            articleId: parsed.id,
            userId: u.id,
            taggerUserId: me.id,
            status: (requires ? "pending" : "approved") as
              | "pending"
              | "approved",
            source: "manual" as const,
          };
        });
      const inserted = toInsert.length
        ? await db
            .insert(articleTags)
            .values(toInsert)
            .onConflictDoNothing()
            .returning()
        : [];
      // Unknown user ids are silently dropped — the response only
      // carries what we actually persisted. The composer surfaces
      // any gap with a non-blocking toast when the count comes
      // back smaller than expected.
      return res.status(201).json({
        tags: inserted.map((t) => ({
          id: t.id,
          postId: articlePostId(t.articleId),
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
    }

    // Highlight branch.
    const existing = await db
      .select({ userId: highlightTags.userId })
      .from(highlightTags)
      .where(eq(highlightTags.highlightId, parsed.id));
    const skip = new Set(existing.map((r) => r.userId));
    const toInsert = userRows
      .filter((u) => !skip.has(u.id))
      .map((u) => {
        const parentRequires = u.parentId
          ? !!parentConsent.get(u.parentId)
          : false;
        const requires = !!u.requireTagConsent || parentRequires;
        return {
          highlightId: parsed.id,
          userId: u.id,
          taggerUserId: me.id,
          status: (requires ? "pending" : "approved") as
            | "pending"
            | "approved",
          source: "manual" as const,
        };
      });
    const inserted = toInsert.length
      ? await db
          .insert(highlightTags)
          .values(toInsert)
          .onConflictDoNothing()
          .returning()
      : [];
    // Bell-notify each newly-tagged player so they don't have to discover
    // the tag by accident. Mirrors the recap fan-out's notify step (task
    // #320). Self-tags are dropped inside the helper, and pending tags
    // get a "review" prompt instead of the plain "you were tagged" line.
    if (inserted.length > 0) {
      await notifyNewlyTaggedInHighlight({
        tags: inserted.map((t) => ({
          userId: t.userId,
          status: t.status as "pending" | "approved",
        })),
        highlightId: parsed.id,
        highlightTitle,
        actorUserId: me.id,
      });
    }
    return res.status(201).json({
      tags: inserted.map((t) => ({
        id: t.id,
        postId: highlightPostId(t.highlightId),
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

// DELETE /article-tags/:tagId — remove a single tag from a recap.
// Three roles can delete:
//   - the tagged user themselves (the original "you can untag yourself"
//     path that the My Tags page uses).
//   - the post author (so they can fine-tune who appears on the recap
//     after publishing — matches the same actor that can ADD tags via
//     POST /posts/:postId/tags).
//   - an org admin/owner of the team's owning org (mirrors the add-tag
//     permission: anyone who can add a tag here can also remove one).
// Idempotent: a missing tagId still returns 204 so a stale UI that
// re-issues a delete after the row is gone doesn't surface an error.
router.delete(
  "/article-tags/:tagId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [t] = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.id, req.params.tagId))
      .limit(1);
    if (!t) return res.status(204).end();
    let allowed = t.userId === me.id;
    if (!allowed) {
      const [a] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, t.articleId))
        .limit(1);
      if (a) {
        if (a.authorId === me.id) {
          allowed = true;
        } else {
          const [team] = await db
            .select()
            .from(teams)
            .where(eq(teams.id, a.teamId))
            .limit(1);
          if (team) {
            allowed = await canManageOrganization(me.id, team.organizationId);
          }
        }
      }
    }
    if (!allowed) return apiError(res, 403, "Not your tag");
    await db.delete(articleTags).where(eq(articleTags.id, t.id));
    res.status(204).end();
  }),
);

// DELETE /highlight-tags/:tagId — same permission model as the
// article-tags delete above (tagged user, highlight uploader, or an
// org admin/owner of the team's owning org).
router.delete(
  "/highlight-tags/:tagId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [t] = await db
      .select()
      .from(highlightTags)
      .where(eq(highlightTags.id, req.params.tagId))
      .limit(1);
    if (!t) return res.status(204).end();
    let allowed = t.userId === me.id;
    if (!allowed) {
      const [h] = await db
        .select()
        .from(highlights)
        .where(eq(highlights.id, t.highlightId))
        .limit(1);
      if (h) {
        if (h.uploaderId === me.id) {
          allowed = true;
        } else {
          const [team] = await db
            .select()
            .from(teams)
            .where(eq(teams.id, h.teamId))
            .limit(1);
          if (team) {
            allowed = await canManageOrganization(me.id, team.organizationId);
          }
        }
      }
    }
    if (!allowed) return apiError(res, 403, "Not your tag");
    await db.delete(highlightTags).where(eq(highlightTags.id, t.id));
    res.status(204).end();
  }),
);

router.delete("/tags/:tagId", (_req, res) => res.status(204).end());

router.patch(
  "/users/me/tag-consent",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const requireTagConsent = !!req.body?.requireTagConsent;
    const [updated] = await db
      .update(users)
      .set({ requireTagConsent })
      .where(eq(users.id, me.id))
      .returning();
    res.json({ requireTagConsent: updated.requireTagConsent });
  }),
);

export default router;
