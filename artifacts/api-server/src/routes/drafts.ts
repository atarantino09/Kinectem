import { Router, type IRouter } from "express";
import {
  db,
  users,
  organizations,
  teams,
  articles,
  articleAuthors,
  articleTags,
  notifications,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import { sendGuardianConfirmationEmail, sendGuardianExpiredEmail, sendPasswordResetEmail } from "../lib/email";
import { canManageOrganization } from "../lib/permissions";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../lib/auth";
import {
  articleToPost,
  paginate,
  parsePostId,
  apiError,
  safeAvatarUrl,
  notFound,
} from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostOwnerId,
  type PostStats,
  type StatsKind,
} from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap } from "../lib/article-tagging";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Drafts & co-authors
// ---------------------------------------------------------------------------

router.get(
  "/drafts",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
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
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed || parsed.kind !== "article") return notFound(res);
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, parsed.id))
      .limit(1);
    if (!a) return notFound(res);
    const [team] = await db.select().from(teams).where(eq(teams.id, a.teamId)).limit(1);
    if (!team) return notFound(res);
    // Author + co-authors can always edit. Org admins of the team's
    // org can also edit (so they can fix a coach's recap, including
    // toggling the auto-tag fan-out on/off after publish).
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
    const isOrgAdmin =
      isAuthor || coAuthor
        ? false
        : await canManageOrganization(me.id, team.organizationId);
    if (!isAuthor && !coAuthor && !isOrgAdmin)
      return apiError(res, 403, "Not an author");
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
    // gameDate: presence (or absence) marks the article as a recap.
    // For drafts we keep the historical behavior — the fan-out fires
    // at publish, never on PATCH. For already-published articles we
    // need to react to the transition right here so a coach can flip
    // the "Tag every rostered player" checkbox on the Edit screen and
    // see it take effect immediately.
    let nextGameDate: Date | null | undefined; // undefined = unchanged
    if ("gameDate" in body) {
      if (body.gameDate === null || body.gameDate === "") {
        nextGameDate = null;
        updates["gameDate"] = null;
      } else if (typeof body.gameDate === "string") {
        const parsedDate = new Date(body.gameDate);
        if (!Number.isNaN(parsedDate.getTime())) {
          nextGameDate = parsedDate;
          updates["gameDate"] = parsedDate;
        }
      }
    }
    if (Object.keys(updates).length === 0)
      return apiError(res, 400, "no changes");
    const [updated] = await db
      .update(articles)
      .set(updates)
      .where(eq(articles.id, a.id))
      .returning();
    // Auto-tag fan-out maintenance for already-published recaps.
    // Drafts skip this — the publish handler runs the fan-out then.
    if (a.status === "published" && nextGameDate !== undefined) {
      const wasRecap = !!a.gameDate;
      const isRecap = !!nextGameDate;
      if (!wasRecap && isRecap) {
        // Coach turned tagging ON for a published recap. Insert any
        // missing roster tags as `source = "auto"`. Existing rows
        // (manual or auto, any status) are preserved untouched.
        const inserted = await applyArticleTagFanout({
          articleId: updated.id,
          teamId: updated.teamId,
          taggerUserId: updated.authorId ?? me.id,
          explicitUserIds: [],
          gameDate: nextGameDate,
        });
        // Bell-notify each newly-tagged player. Throttling inside the
        // helper prevents a coach who toggles the checkbox repeatedly
        // from spamming the same player's notifications.
        await notifyNewlyTaggedInRecap({
          userIds: inserted,
          articleId: updated.id,
          articleTitle: updated.title,
          actorUserId: updated.authorId ?? me.id,
        });
      } else if (wasRecap && !isRecap) {
        // Coach turned tagging OFF for a published recap. Remove only
        // the rows the fan-out created (`source = "auto"`). Manual
        // tags — explicit @-mentions, or rows somebody approved/declined
        // through the consent flow — are preserved.
        // Capture which users are about to lose their auto-tag so we
        // can clear their stale "you were tagged" bell rows. Players
        // who still have a manual tag on this article keep their
        // notification (they're still tagged).
        const removedAutoUsers = await db
          .select({ userId: articleTags.userId })
          .from(articleTags)
          .where(
            and(
              eq(articleTags.articleId, updated.id),
              eq(articleTags.source, "auto"),
            ),
          );
        await db
          .delete(articleTags)
          .where(
            and(
              eq(articleTags.articleId, updated.id),
              eq(articleTags.source, "auto"),
            ),
          );
        // Per-task: we do NOT re-notify the removed players (avoid
        // noise), but their bell badge needs to clear since the
        // article no longer references them. We MARK READ rather
        // than DELETE so the row stays around as the throttle signal
        // for the next ON toggle — otherwise a coach who quickly
        // flips OFF then back ON would re-notify everyone. Marking
        // read drops the unread count to zero (badge clears) and
        // preserves the recent-notification record.
        if (removedAutoUsers.length > 0) {
          await db
            .update(notifications)
            .set({ read: true })
            .where(
              and(
                eq(notifications.kind, "post_tag"),
                eq(notifications.link, `/posts/${updated.id}`),
                eq(notifications.read, false),
                inArray(
                  notifications.userId,
                  removedAutoUsers.map((r) => r.userId),
                ),
              ),
            );
        }
      }
    }
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, team.organizationId))
      .limit(1);
    const [author] = updated.authorId
      ? await db.select().from(users).where(eq(users.id, updated.authorId)).limit(1)
      : [null];
    if (!org) return notFound(res);
    res.json(
      articleToPost(updated, {
        team,
        org,
        author,
        canEdit: true,
      }),
    );
  }),
);

router.post(
  "/posts/:postId/publish",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
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
      return apiError(res, 403, "Only the author can publish");
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
    // Re-run the auto-tag fan-out at publish time so drafts that
    // had a game date added later (via PATCH) still tag the roster.
    // The helper itself does per-user dedupe, so this is safe to call
    // even if some players are already tagged — only missing roster
    // members get inserted, and existing tag statuses (approved /
    // pending / declined) are preserved untouched.
    if (updated.gameDate) {
      await applyArticleTagFanout({
        articleId: updated.id,
        teamId: updated.teamId,
        taggerUserId: updated.authorId ?? me.id,
        explicitUserIds: [],
        gameDate: updated.gameDate,
      });
    }
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
        avatarUrl: safeAvatarUrl(r.u.avatarUrl),
      })),
    });
  }),
);

router.post(
  "/posts/:postId/co-authors",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed || parsed.kind !== "article") return notFound(res);
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, parsed.id))
      .limit(1);
    if (!a) return notFound(res);
    if (a.authorId !== me.id)
      return apiError(res, 403, "Only the author can add co-authors");
    const userId = String(req.body?.userId ?? "");
    if (!userId) return apiError(res, 400, "userId required");
    await db
      .insert(articleAuthors)
      .values({ articleId: a.id, userId })
      .onConflictDoNothing();
    await db.insert(notifications).values({
      userId,
      kind: "mention",
      message: `${me.firstName} ${me.lastName} added you as a co-author on "${a.title ?? "Untitled"}"`,
      link: `/posts/${a.id}`,
      actorUserId: me.id,
    });
    res.status(201).json({ ok: true });
  }),
);

router.delete(
  "/posts/:postId/co-authors/:userId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = parsePostId(req.params.postId);
    if (!parsed || parsed.kind !== "article") return notFound(res);
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, parsed.id))
      .limit(1);
    if (!a) return notFound(res);
    if (a.authorId !== me.id && me.id !== req.params.userId)
      return apiError(res, 403, "Forbidden");
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

export default router;
