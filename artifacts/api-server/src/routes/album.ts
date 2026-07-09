// Task #535 — Fan photo album routes.
//
// The fan album lives in its own table (`album_photos`) so it doesn't
// pollute the post's hero `assets` gallery. Rows are polymorphic over
// `(postKind, postRefId)` to match the existing convention used by
// `post_comments` / `post_shares` / `post_reactions` — so the client
// keeps passing the synthetic prefixed post id (`article-<uuid>`,
// `highlight-<uuid>`, `orgpost-<uuid>`) and we `parsePostId` at the
// boundary. The actual image bytes live in the existing `assets` table,
// so the minor-asset EXIF strip in `assets.ts` already covers uploads
// done through this flow.
import { Router, type IRouter } from "express";
import {
  db,
  albumPhotos,
  assets,
  articles,
  highlights,
  orgPosts,
  organizationAdmins,
  teams,
  users,
  takedownRequests,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import {
  apiError,
  notFound,
  parsePostId,
  safeAvatarUrl,
  type PostKind,
} from "../lib/spec-helpers";
import {
  canManageTeam,
  canManageOrganization,
  canViewTeamSchedule,
} from "../lib/permissions";

const router: IRouter = Router();

// Express 5's `req.params.X` is typed `string | string[]`. Path-segment
// params can never actually be arrays, so a tiny normaliser keeps the
// downstream drizzle calls clean and the route file lint-clean.
function pathParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

// Returns the post's author id when the underlying row exists, or
// `null` when the post is gone (drives the 404 in callers). For
// articles we also require `status='published'` and `hidden_at IS NULL`
// so unpublished drafts and admin-hidden posts don't accept new album
// entries through the fan-album flow.
type VisiblePost = {
  authorId: string | null;
  teamId: string | null;
  organizationId: string | null;
};

async function loadVisiblePost(
  kind: PostKind,
  refId: string,
): Promise<VisiblePost | null> {
  if (kind === "article") {
    const [a] = await db
      .select({
        authorId: articles.authorId,
        teamId: articles.teamId,
        status: articles.status,
        hiddenAt: articles.hiddenAt,
      })
      .from(articles)
      .where(eq(articles.id, refId))
      .limit(1);
    if (!a) return null;
    if (a.status !== "published") return null;
    if (a.hiddenAt) return null;
    return { authorId: a.authorId ?? null, teamId: a.teamId ?? null, organizationId: null };
  }
  if (kind === "highlight") {
    const [h] = await db
      .select({
        uploaderId: highlights.uploaderId,
        teamId: highlights.teamId,
        hiddenAt: highlights.hiddenAt,
      })
      .from(highlights)
      .where(eq(highlights.id, refId))
      .limit(1);
    if (!h) return null;
    if (h.hiddenAt) return null;
    return { authorId: h.uploaderId ?? null, teamId: h.teamId ?? null, organizationId: null };
  }
  // org_post
  const [op] = await db
    .select({
      authorId: orgPosts.authorId,
      organizationId: orgPosts.organizationId,
      hiddenAt: orgPosts.hiddenAt,
    })
    .from(orgPosts)
    .where(eq(orgPosts.id, refId))
    .limit(1);
  if (!op) return null;
  if (op.hiddenAt) return null;
  return { authorId: op.authorId ?? null, teamId: null, organizationId: op.organizationId ?? null };
}

// Task #660 — album uploads are restricted to the post's team community:
// accepted roster members (players, coaches, managers, authors, ...),
// parents of active roster members, and org owners/admins. Followers can
// view the album (same as the recap) but cannot contribute. Org posts
// restrict uploads to anyone with an org membership row; posts with no
// team/org (profile-only highlights) accept uploads from the author only.
async function canContributeToAlbum(
  userId: string,
  isPlatformAdmin: boolean,
  post: VisiblePost,
): Promise<boolean> {
  if (isPlatformAdmin) return true;
  if (post.authorId === userId) return true;
  if (post.teamId) {
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, post.teamId))
      .limit(1);
    if (!team) return false;
    // canViewTeamSchedule = org managers + accepted roster members +
    // parents of active members; canManageTeam adds the solo-team creator.
    if (await canViewTeamSchedule(userId, team)) return true;
    return canManageTeam(userId, team);
  }
  if (post.organizationId) {
    const [row] = await db
      .select({ id: organizationAdmins.userId })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, post.organizationId),
          eq(organizationAdmins.userId, userId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
  return false;
}

// Moderation rights over album photos beyond "it's my photo": the post's
// author, team managers (org owner/admin, coach, solo creator), and org
// managers for org posts. Platform admins are handled by callers.
async function canModerateAlbum(
  userId: string,
  post: VisiblePost,
): Promise<boolean> {
  if (post.authorId === userId) return true;
  if (post.teamId) {
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, post.teamId))
      .limit(1);
    if (team && (await canManageTeam(userId, team))) return true;
  }
  if (post.organizationId) {
    return canManageOrganization(userId, post.organizationId);
  }
  return false;
}

// Mirrors the helper in `posts.ts`: a post with a pending takedown is
// hidden from everyone except the requesting guardian and platform
// admins. The album follows the same rule — minors flagged for
// takedown should not accept new fan-album uploads, and existing
// album entries shouldn't surface to strangers.
async function isPendingTakedown(
  kind: PostKind,
  refId: string,
  viewerId: string | null,
  viewerIsAdmin: boolean,
): Promise<boolean> {
  const rows = await db
    .select({ requestedByGuardianId: takedownRequests.requestedByGuardianId })
    .from(takedownRequests)
    .where(
      and(
        eq(takedownRequests.postKind, kind),
        eq(takedownRequests.postRefId, refId),
        eq(takedownRequests.status, "pending"),
      ),
    );
  if (rows.length === 0) return false;
  if (viewerIsAdmin) return false;
  if (viewerId && rows.some((r) => r.requestedByGuardianId === viewerId)) {
    return false;
  }
  return true;
}

type AlbumRow = typeof albumPhotos.$inferSelect;

function toAlbumPhotoResponse(
  row: AlbumRow,
  // The synthetic prefixed post id, recomposed from the row's
  // (postKind, postRefId). Keeps the wire shape stable for clients.
  prefixedPostId: string,
  assetUrl: string | null,
) {
  return {
    id: row.id,
    postId: prefixedPostId,
    assetId: row.assetId,
    url: safeAvatarUrl(assetUrl) ?? assetUrl ?? "",
    uploaderUserId: row.uploaderUserId,
    uploaderName: row.uploaderName,
    caption: row.caption,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get(
  "/posts/:postId/album",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated");
      return;
    }
    const rawPostId = pathParam(req.params.postId);
    const parsed = parsePostId(rawPostId);
    if (!parsed) {
      notFound(res);
      return;
    }
    const isAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
    const post = await loadVisiblePost(parsed.kind, parsed.id);
    if (!post) {
      notFound(res);
      return;
    }
    if (await isPendingTakedown(parsed.kind, parsed.id, me.id, isAdmin)) {
      notFound(res);
      return;
    }
    const rows = await db
      .select({ p: albumPhotos, url: assets.url })
      .from(albumPhotos)
      .leftJoin(assets, eq(assets.id, albumPhotos.assetId))
      .where(
        and(
          eq(albumPhotos.postKind, parsed.kind),
          eq(albumPhotos.postRefId, parsed.id),
        ),
      )
      .orderBy(desc(albumPhotos.createdAt));
    // Viewer capabilities so the client can hide the upload button for
    // followers and the delete button for photos the viewer can't remove.
    const canUpload = await canContributeToAlbum(me.id, isAdmin, post);
    const canModerate = isAdmin || (await canModerateAlbum(me.id, post));
    res.json({
      data: rows.map((r) => ({
        ...toAlbumPhotoResponse(r.p, rawPostId, r.url ?? null),
        canDelete: canModerate || r.p.uploaderUserId === me.id,
      })),
      canUpload,
    });
  }),
);

router.post(
  "/posts/:postId/album",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated");
      return;
    }
    const rawPostId = pathParam(req.params.postId);
    const parsed = parsePostId(rawPostId);
    if (!parsed) {
      notFound(res);
      return;
    }
    const assetId = String(req.body?.assetId ?? "").trim();
    const uploaderName = String(req.body?.uploaderName ?? "").trim();
    const caption = String(req.body?.caption ?? "").trim();
    if (!assetId) {
      apiError(res, 400, "assetId is required");
      return;
    }
    if (!uploaderName) {
      apiError(res, 400, "uploaderName is required");
      return;
    }
    if (uploaderName.length > 80) {
      apiError(res, 400, "uploaderName too long (max 80)");
      return;
    }
    if (caption.length > 280) {
      apiError(res, 400, "caption too long (max 280)");
      return;
    }

    const isAdmin = req.realUser?.role === "admin" && !req.isMasquerading;
    const post = await loadVisiblePost(parsed.kind, parsed.id);
    if (!post) {
      notFound(res);
      return;
    }
    if (await isPendingTakedown(parsed.kind, parsed.id, me.id, isAdmin)) {
      notFound(res);
      return;
    }
    // Uploads are restricted to the team community (roster members,
    // parents of active members, org managers). Followers get 403.
    if (!(await canContributeToAlbum(me.id, isAdmin, post))) {
      apiError(res, 403, "Only team members can add photos to this album", {
        code: "ALBUM_MEMBERS_ONLY",
      });
      return;
    }

    // The asset must exist, be confirmed, and belong to the caller —
    // mirrors the ownership checks in `/assets/*`.
    const [asset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!asset) {
      apiError(res, 404, "Asset not found");
      return;
    }
    if (asset.ownerId !== me.id) {
      apiError(res, 403, "Forbidden");
      return;
    }
    if (asset.status !== "confirmed") {
      apiError(res, 422, "Asset has not been confirmed yet");
      return;
    }

    const [created] = await db
      .insert(albumPhotos)
      .values({
        postKind: parsed.kind,
        postRefId: parsed.id,
        uploaderUserId: me.id,
        uploaderName,
        caption,
        assetId,
      })
      .returning();
    res
      .status(201)
      .json(toAlbumPhotoResponse(created, rawPostId, asset.url ?? null));
  }),
);

router.delete(
  "/posts/:postId/album/:photoId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated");
      return;
    }
    const rawPostId = pathParam(req.params.postId);
    const photoId = pathParam(req.params.photoId);
    const parsed = parsePostId(rawPostId);
    if (!parsed) {
      notFound(res);
      return;
    }
    const [row] = await db
      .select()
      .from(albumPhotos)
      .where(
        and(
          eq(albumPhotos.id, photoId),
          eq(albumPhotos.postKind, parsed.kind),
          eq(albumPhotos.postRefId, parsed.id),
        ),
      )
      .limit(1);
    if (!row) {
      notFound(res);
      return;
    }

    // Uploader may delete their own photo; the post's author and team/org
    // managers may delete any photo; platform admins always can.
    let allowed = row.uploaderUserId === me.id;
    if (!allowed) {
      const post = await loadVisiblePost(parsed.kind, parsed.id);
      if (post && (await canModerateAlbum(me.id, post))) allowed = true;
    }
    if (!allowed) {
      const [u] = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, me.id))
        .limit(1);
      if (u?.role === "admin") allowed = true;
    }
    if (!allowed) {
      apiError(res, 403, "Forbidden");
      return;
    }

    await db.delete(albumPhotos).where(eq(albumPhotos.id, photoId));
    res.status(204).end();
  }),
);

export default router;
