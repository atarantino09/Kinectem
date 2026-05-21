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
async function loadVisiblePost(
  kind: PostKind,
  refId: string,
): Promise<{ authorId: string | null } | null> {
  if (kind === "article") {
    const [a] = await db
      .select({
        authorId: articles.authorId,
        status: articles.status,
        hiddenAt: articles.hiddenAt,
      })
      .from(articles)
      .where(eq(articles.id, refId))
      .limit(1);
    if (!a) return null;
    if (a.status !== "published") return null;
    if (a.hiddenAt) return null;
    return { authorId: a.authorId ?? null };
  }
  if (kind === "highlight") {
    const [h] = await db
      .select({ uploaderId: highlights.uploaderId, hiddenAt: highlights.hiddenAt })
      .from(highlights)
      .where(eq(highlights.id, refId))
      .limit(1);
    if (!h) return null;
    if (h.hiddenAt) return null;
    return { authorId: h.uploaderId ?? null };
  }
  // org_post
  const [op] = await db
    .select({ authorId: orgPosts.authorId, hiddenAt: orgPosts.hiddenAt })
    .from(orgPosts)
    .where(eq(orgPosts.id, refId))
    .limit(1);
  if (!op) return null;
  if (op.hiddenAt) return null;
  return { authorId: op.authorId ?? null };
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
    res.json({
      data: rows.map((r) => toAlbumPhotoResponse(r.p, rawPostId, r.url ?? null)),
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

    let allowed = row.uploaderUserId === me.id;
    if (!allowed) {
      const post = await loadVisiblePost(parsed.kind, parsed.id);
      if (post && post.authorId === me.id) allowed = true;
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
