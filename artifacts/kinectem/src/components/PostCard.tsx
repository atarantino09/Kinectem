import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Play, FileText, Heart, MessageSquare, MoreVertical, Flag, Pencil, Share2, Repeat2, UserMinus } from "lucide-react";
import { VideoEmbed, getEmbedSrc } from "@/components/VideoEmbed";
import {
  customFetch,
  useAddPostReaction,
  useRemovePostReaction,
  useSharePost,
  useUnsharePost,
  getListFeedQueryKey,
  getGetPostQueryKey,
  type PostResponse,
  type FeedPost,
} from "@workspace/api-client-react";
import { timeAgo } from "@/lib/format";
import { linkify } from "@/lib/linkify";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ReportDialog, type ReportContentType } from "@/components/ReportDialog";
import { TakedownDialog } from "@/components/TakedownDialog";
import { apiErrorMessage } from "@/lib/api-errors";
import { AvatarLightbox } from "@/components/AvatarLightbox";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { ShareConfirmDialog } from "@/components/ShareConfirmDialog";
import { TaggedPlayers } from "@/components/TaggedPlayers";
import { useToast } from "@/hooks/use-toast";

function getContextHref(context: {
  type: "team" | "organization" | "user";
  id: string;
}): string {
  switch (context.type) {
    case "team":
      return `/teams/${context.id}`;
    case "organization":
      return `/organizations/${context.id}`;
    case "user":
      return `/users/${context.id}`;
  }
}

function parseSyntheticPostId(
  id: string,
): { contentType: ReportContentType; contentId: string } {
  if (id.startsWith("article-")) {
    return { contentType: "article", contentId: id.slice("article-".length) };
  }
  if (id.startsWith("highlight-")) {
    return { contentType: "highlight", contentId: id.slice("highlight-".length) };
  }
  if (id.startsWith("orgpost-")) {
    return { contentType: "org_post", contentId: id.slice("orgpost-".length) };
  }
  return { contentType: "article", contentId: id };
}

export function PostCard({ post }: { post: PostResponse | FeedPost }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [currentPath, setLocation] = useLocation();
  const [reportOpen, setReportOpen] = useState(false);
  // Task #367 — when a guardian is browsing in child-preview mode
  // (URL carries `?asChild=<uuid>` from server-generated deep-links
  // such as parent-inbox / article-tagging notifications, or the
  // legacy `?asChildId=<uuid>` form), expose the "Report photo of
  // my child" action right on each feed card so they don't have to
  // click into the post first. The same action is also rendered on
  // PostPage as a top-level button.
  const search = useSearch();
  const asChildId = (() => {
    const p = new URLSearchParams(search);
    const v = p.get("asChild") ?? p.get("asChildId");
    return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
  })();
  const [reportingPhoto, setReportingPhoto] = useState(false);
  const [takedownOpen, setTakedownOpen] = useState(false);
  const submitTakedown = async (reason: string | null) => {
    if (!asChildId) return;
    setReportingPhoto(true);
    try {
      await customFetch(
        `/api/v1/guardians/children/${asChildId}/takedown-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            postId: `${reportTarget.contentType}:${reportTarget.contentId}`,
            ...(reason ? { reason } : {}),
          }),
        },
      );
      toast({
        title: "Takedown requested",
        description:
          "We've notified moderators. The post is hidden from public feeds while we review it.",
      });
      qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
      setTakedownOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't submit takedown",
        description:
          apiErrorMessage(err) ??
          "Something went wrong filing the takedown request.",
        variant: "destructive",
      });
    } finally {
      setReportingPhoto(false);
    }
  };
  const [confirmShareOpen, setConfirmShareOpen] = useState(false);
  const [untagOpen, setUntagOpen] = useState(false);
  const [untagging, setUntagging] = useState(false);
  const isShort = post.postType === "short";
  const Icon = isShort ? Play : FileText;
  const reportTarget = parseSyntheticPostId(post.id);
  // Task #524 — only surface the takedown affordance on posts where the
  // selected child has a plausible client-visible link: child is the
  // author, OR child is tagged on this article/highlight (the child-
  // scoped fetch sets `currentUserTag` to the child's tag). The server
  // is still the source of truth — roster-only org_post links that
  // aren't visible client-side will simply not render the action here;
  // an admin or the guardian can still file via the post detail page
  // when the relationship is detectable.
  const childPlausiblyLinked =
    !!asChildId &&
    (post.author.id === asChildId || !!post.currentUserTag);
  // The composer at /posts/new is kind-aware: it loads and PATCHes
  // recap articles, highlights, and org_post Updates. The server
  // populates `canEdit` per-viewer for all three kinds (author /
  // co-author / org-admin for articles, uploader for highlights,
  // author or org-admin for Updates), so the menu item just mirrors
  // that flag — no client-side kind gate.
  const canEditPost = post.canEdit === true;
  const label =
    reportTarget.contentType === "highlight"
      ? "Highlight"
      : reportTarget.contentType === "org_post"
        ? "Update"
        : "Game Recap";
  const badgeClass = "brand-pill";

  const firstImage = post.assets?.find((a) => a.fileType?.startsWith("image/"));
  const allImages = (post.assets ?? []).filter((a) =>
    a.fileType?.startsWith("image/"),
  );
  const videoAsset = (post.assets ?? []).find((a) =>
    a.fileType?.startsWith("video/"),
  );
  // True only when we can render an inline iframe player. For
  // unknown providers we still surface the URL, but as a clickable
  // link below the body rather than as a tall blank player area.
  const hasEmbeddableVideo =
    !!videoAsset?.url && getEmbedSrc(videoAsset.url) !== null;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
  const addReaction = useAddPostReaction({
    mutation: { onSuccess: invalidate },
  });
  const removeReaction = useRemovePostReaction({
    mutation: { onSuccess: invalidate },
  });
  const invalidateShareSurfaces = () => {
    invalidate();
    qc.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        typeof q.queryKey[0] === "string" &&
        q.queryKey[0].startsWith("/api/v1/users/") &&
        q.queryKey[0].endsWith("/posts"),
    });
    qc.invalidateQueries({ queryKey: getGetPostQueryKey(post.id) });
  };
  type ListSnapshot = { key: readonly unknown[]; data: unknown }[];
  const optimisticShareToggleInLists = (next: boolean): ListSnapshot => {
    const snapshot: ListSnapshot = [];
    qc
      .getQueryCache()
      .findAll({
        predicate: (q) => {
          const k = q.queryKey;
          if (!Array.isArray(k) || typeof k[0] !== "string") return false;
          if (k[0] === "/api/v1/feed") return true;
          return k[0].startsWith("/api/v1/users/") && k[0].endsWith("/posts");
        },
      })
      .forEach((q) => {
        const data = q.state.data as
          | { data?: Array<{ id: string; hasShared?: boolean; shareCount?: number }> }
          | undefined;
        if (!data?.data) return;
        snapshot.push({ key: q.queryKey, data: q.state.data });
        qc.setQueryData(q.queryKey, {
          ...data,
          data: data.data.map((p) =>
            p.id === post.id
              ? {
                  ...p,
                  hasShared: next,
                  shareCount: Math.max(
                    0,
                    (p.shareCount ?? 0) + (next ? 1 : -1),
                  ),
                }
              : p,
          ),
        });
      });
    return snapshot;
  };
  const onShareError = (snapshot: ListSnapshot, action: string) => {
    snapshot.forEach((s) => qc.setQueryData(s.key, s.data));
    toast({
      title: `Couldn't ${action} this ${shareKindLabel}`,
      description: "Please try again in a moment.",
      variant: "destructive",
    });
  };
  const sharePost = useSharePost({
    mutation: {
      onMutate: () => ({ snapshot: optimisticShareToggleInLists(true) }),
      onError: (_e, _v, ctx) =>
        onShareError((ctx?.snapshot as ListSnapshot) ?? [], "share"),
      onSuccess: invalidateShareSurfaces,
    },
  });
  const unsharePost = useUnsharePost({
    mutation: {
      onMutate: () => ({ snapshot: optimisticShareToggleInLists(false) }),
      onError: (_e, _v, ctx) =>
        onShareError((ctx?.snapshot as ListSnapshot) ?? [], "unshare"),
      onSuccess: invalidateShareSurfaces,
    },
  });

  const onToggleReaction = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (post.hasReacted) {
      removeReaction.mutate({ postId: post.id });
    } else {
      addReaction.mutate({ postId: post.id, data: { reactionType: "like" } });
    }
  };

  // Task #190 — Shareable kinds are game-recap articles (long-form
  // article + gameDate) and any highlight. Org posts and free-form
  // long-form articles without a gameDate stay un-shareable to mirror
  // the server gating.
  const isShareable =
    (post.id.startsWith("article-") &&
      post.postType === "long" &&
      !!post.gameDate) ||
    post.id.startsWith("highlight-");
  const shareKindLabel: "highlight" | "recap" = post.id.startsWith(
    "highlight-",
  )
    ? "highlight"
    : "recap";
  const onToggleShare = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (post.hasShared) {
      unsharePost.mutate({ postId: post.id });
    } else {
      setConfirmShareOpen(true);
    }
  };
  const onConfirmShare = () => {
    setConfirmShareOpen(false);
    sharePost.mutate({ postId: post.id });
  };

  const sharedBy = "sharedBy" in post ? post.sharedBy : null;

  return (
    <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
      <CardContent className="p-0">
        {sharedBy && (
          <Link
            href={`/users/${sharedBy.id}`}
            className="block px-5 pt-3 pb-1 text-[11px] font-bold text-muted-foreground uppercase tracking-wider hover:text-primary"
            data-testid={`label-shared-by-${post.id}`}
          >
            <Repeat2 className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
            Shared by {sharedBy.displayName}
          </Link>
        )}
        <div className="px-5 py-4 flex items-center justify-between border-b border-border/60">
          <div className="flex items-center gap-3 min-w-0">
            {(() => {
              // For team-context posts, the avatar slot shows the parent
              // organization's logo instead of the team's own logo so it
              // never renders as a blank initials tile when only the team
              // is missing a logo. If the parent org has no logo either,
              // we intentionally fall straight through to the team-name
              // initials (the existing TeamAvatar fallback) — we do NOT
              // use the team's own logoUrl in this branch. Non-team
              // contexts keep their existing avatar source.
              const displayedAvatarUrl =
                post.context.type === "team"
                  ? ("orgAvatarUrl" in post.context
                      ? post.context.orgAvatarUrl ?? null
                      : null)
                  : post.context.avatarUrl;
              return (
                <AvatarLightbox
                  avatarUrl={displayedAvatarUrl}
                  displayName={post.context.name ?? post.context.type}
                  triggerClassName="shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  triggerTestId={`btn-open-post-avatar-lightbox-${post.id}`}
                  dialogTestId={`dialog-post-avatar-lightbox-${post.id}`}
                  imageTestId={`img-post-avatar-lightbox-${post.id}`}
                >
                  <TeamAvatar
                    avatarUrl={displayedAvatarUrl}
                    displayName={post.context.name ?? post.context.type}
                    size="lg"
                    className={`shrink-0 ${displayedAvatarUrl ? "cursor-pointer" : ""}`}
                    fallbackClassName="bg-slate-900 text-primary-foreground font-black"
                  />
                </AvatarLightbox>
              );
            })()}
            <div className="min-w-0">
              {post.context.type === "team" && post.context.orgName && post.context.orgId && (
                <Link href={`/organizations/${post.context.orgId}`}>
                  <p
                    className="text-xs text-muted-foreground truncate hover:underline"
                    data-testid={`text-post-parent-org-${post.id}`}
                  >
                    {post.context.orgName}
                  </p>
                </Link>
              )}
              <Link href={getContextHref(post.context)}>
                <p className="font-bold text-sm truncate hover:underline">
                  {post.context.name ?? post.context.type}
                </p>
              </Link>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-0.5 truncate">
                <Link
                  href={`/users/${post.author.id}`}
                  className="hover:underline hover:text-primary"
                  data-testid={`link-post-author-${post.id}`}
                >
                  {post.author.displayName}
                </Link>
                {"authorRole" in post.author && post.author.authorRole && (
                  <span data-testid={`text-post-author-role-${post.id}`}>
                    {" · "}
                    {post.author.authorRole}
                  </span>
                )}
                {" • "}
                {timeAgo(post.createdAt)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge
              className={`${badgeClass} border-none font-bold uppercase text-[10px] tracking-widest`}
            >
              <Icon className="w-3 h-3 mr-1 inline" />
              {label}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  data-testid={`btn-post-menu-${post.id}`}
                  aria-label="Post actions"
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEditPost && (
                  <DropdownMenuItem
                    onSelect={() =>
                      setLocation(
                        `/posts/new?editId=${encodeURIComponent(post.id)}&from=${encodeURIComponent(currentPath + (typeof window !== "undefined" ? window.location.search : ""))}`,
                      )
                    }
                    data-testid={`menuitem-edit-${post.id}`}
                  >
                    <Pencil className="w-4 h-4 mr-2" /> Edit post
                  </DropdownMenuItem>
                )}
                {asChildId && childPlausiblyLinked && (
                  <DropdownMenuItem
                    disabled={reportingPhoto}
                    onSelect={(e) => {
                      e.preventDefault();
                      setTakedownOpen(true);
                    }}
                    data-testid="menu-report-photo-of-child"
                  >
                    <Flag className="w-4 h-4 mr-2" />
                    {reportingPhoto ? "Submitting…" : "Report photo of my child"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => setReportOpen(true)}
                  data-testid={`menuitem-report-${post.id}`}
                >
                  <Flag className="w-4 h-4 mr-2" /> Report post
                </DropdownMenuItem>
                {/* Task #344 — A tagged player can untag themselves from a
                    post directly from its three-dot menu. The server only
                    populates `currentUserTag` when the viewer has an
                    approved or pending tag on this article/highlight, so
                    the menu item naturally hides for everyone else. Org
                    Updates have no tag concept and never expose this. */}
                {post.currentUserTag && (
                  <DropdownMenuItem
                    onSelect={() => setUntagOpen(true)}
                    data-testid={`menuitem-untag-${post.id}`}
                  >
                    <UserMinus className="w-4 h-4 mr-2" /> Remove me from this
                    post
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          contentType={reportTarget.contentType}
          contentId={reportTarget.contentId}
        />
        {asChildId && childPlausiblyLinked && (
          <TakedownDialog
            open={takedownOpen}
            onOpenChange={setTakedownOpen}
            onConfirm={submitTakedown}
            submitting={reportingPhoto}
            postKindLabel={label.toLowerCase()}
          />
        )}
        {post.currentUserTag && (
          <AlertDialog open={untagOpen} onOpenChange={setUntagOpen}>
            <AlertDialogContent data-testid={`dialog-untag-${post.id}`}>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove yourself from this post?</AlertDialogTitle>
                <AlertDialogDescription>
                  You'll no longer appear as tagged on this{" "}
                  {post.currentUserTag.kind === "highlight"
                    ? "highlight"
                    : "game recap"}
                  . The author and other viewers won't be notified, and you can
                  always be re-tagged later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={untagging}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={untagging}
                  data-testid={`btn-confirm-untag-${post.id}`}
                  onClick={async (e) => {
                    e.preventDefault();
                    if (!post.currentUserTag) return;
                    setUntagging(true);
                    const path =
                      post.currentUserTag.kind === "article"
                        ? `/api/v1/article-tags/${post.currentUserTag.id}`
                        : `/api/v1/highlight-tags/${post.currentUserTag.id}`;
                    try {
                      await customFetch(path, { method: "DELETE" });
                      toast({ title: "Removed from this post" });
                      // Refresh every surface that may show this post as
                      // tagging the viewer: the various feed variants, the
                      // user's own profile post list, and the canonical
                      // GET /posts/:id detail. The "My Tags" page and the
                      // pending-tags badge are plain customFetch calls
                      // keyed by URL, so invalidate by path.
                      await Promise.all([
                        qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
                        // Invalidate ALL user-post lists, not just the
                        // author's. The viewer is most likely browsing
                        // their own /users/<viewerId>/posts (their
                        // tagged feed) or another teammate's profile,
                        // and the active query key won't match the
                        // author id. Mirror the predicate-based
                        // invalidation already used by share actions.
                        qc.invalidateQueries({
                          predicate: (q) =>
                            Array.isArray(q.queryKey) &&
                            typeof q.queryKey[0] === "string" &&
                            q.queryKey[0].startsWith("/api/v1/users/") &&
                            q.queryKey[0].endsWith("/posts"),
                        }),
                        qc.invalidateQueries({
                          queryKey: getGetPostQueryKey(post.id),
                        }),
                        qc.invalidateQueries({ queryKey: ["/api/v1/users/me/tags"] }),
                        qc.invalidateQueries({ queryKey: ["/api/v1/tags/pending"] }),
                      ]);
                      setUntagOpen(false);
                    } catch {
                      toast({
                        title: "Couldn't remove tag",
                        variant: "destructive",
                      });
                    } finally {
                      setUntagging(false);
                    }
                  }}
                >
                  {untagging ? "Removing…" : "Remove me"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {isShareable && (
          <ShareConfirmDialog
            open={confirmShareOpen}
            onOpenChange={setConfirmShareOpen}
            onConfirm={onConfirmShare}
            recapTitle={post.title}
            kind={shareKindLabel}
          />
        )}

        <div>
          {isShort && !hasEmbeddableVideo && firstImage?.url && (
            <Link href={`/posts/${post.id}`}>
              <div className="h-72 brand-gradient-dark relative flex items-center justify-center group cursor-pointer">
                <img
                  src={firstImage.url}
                  alt={post.title ?? ""}
                  className="absolute inset-0 w-full h-full object-cover opacity-60"
                />
                <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-primary transition-colors z-10">
                  <Play className="w-6 h-6 text-white ml-1" fill="currentColor" />
                </div>
              </div>
            </Link>
          )}
          <div className="px-5 py-4">
            {post.title && (
              <div className="flex items-start gap-2 mb-2">
                <Link href={`/posts/${post.id}`} className="flex-1 min-w-0">
                  <h3 className="font-black text-lg tracking-tight leading-tight hover:underline cursor-pointer">
                    {post.title}
                  </h3>
                </Link>
                {"tagStatus" in post && post.tagStatus === "pending" && (
                  <span
                    className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                    title="You were tagged in this game recap. It is hidden from other viewers until you approve the tag."
                  >
                    Pending tag
                  </span>
                )}
              </div>
            )}
            {post.title &&
              !isShort &&
              reportTarget.contentType === "article" && (
                <hr
                  className="border-t border-border mb-2"
                  data-testid={`divider-post-title-card-${post.id}`}
                />
              )}
            {post.description && (
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 mb-2">
                {linkify(post.description)}
              </p>
            )}
            {!isShort && post.body && (
              <RecapExcerpt body={post.body} postId={post.id} />
            )}
            {!isShort && allImages.length > 0 && (
              <PhotoAlbum
                images={allImages
                  .map((a) => a.url)
                  .filter((u): u is string => typeof u === "string")}
                postId={post.id}
              />
            )}
            {!isShort && videoAsset?.url && (
              <VideoEmbed url={videoAsset.url} />
            )}
            {/* Highlights render the video after the title and
                description so the card matches the new-post form
                and the post detail page. Embeddable providers
                (YouTube/Vimeo) get an inline player in a
                brand-gradient banner; unsupported providers fall
                back to a clickable link via VideoEmbed's default. */}
            {isShort && hasEmbeddableVideo && videoAsset?.url && (
              <div className="brand-gradient-dark p-3 -mx-5 mt-3">
                <VideoEmbed
                  url={videoAsset.url}
                  className="rounded-lg overflow-hidden border border-border bg-black aspect-video"
                />
              </div>
            )}
            {isShort && !hasEmbeddableVideo && videoAsset?.url && (
              <VideoEmbed url={videoAsset.url} />
            )}
          </div>
        </div>

        {/*
         * Highlight cards surface the players tagged on the clip so
         * viewers can jump straight to a tagged player's profile.
         * `taggedUsers` is currently only populated for highlights;
         * other post kinds leave it undefined so the section hides.
         * Pending tags are pre-filtered server-side to the post
         * uploader and the tagged player themselves.
         */}
        {isShort && (
          <TaggedPlayers
            taggedUsers={
              "taggedUsers" in post ? post.taggedUsers : undefined
            }
            postId={post.id}
            variant="card"
          />
        )}

        <div className="px-5 py-3 border-t border-border/60 flex items-center gap-2">
          <Button
            variant={post.hasReacted ? "default" : "outline"}
            size="sm"
            onClick={onToggleReaction}
            disabled={addReaction.isPending || removeReaction.isPending}
            className="font-bold gap-1.5 h-8"
            data-testid={`button-reaction-${post.id}`}
          >
            <Heart
              className={`w-3.5 h-3.5 ${post.hasReacted ? "fill-current" : ""}`}
            />
            {post.reactionCount}
          </Button>
          <Link href={`/posts/${post.id}`}>
            <Button
              variant="outline"
              size="sm"
              className="font-bold gap-1.5 h-8"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              {post.commentCount}
            </Button>
          </Link>
          {isShareable && (
            <Button
              variant={post.hasShared ? "default" : "outline"}
              size="sm"
              onClick={onToggleShare}
              disabled={sharePost.isPending || unsharePost.isPending}
              className="font-bold gap-1.5 h-8"
              data-testid={`button-share-${post.id}`}
              aria-pressed={post.hasShared}
              aria-label={
                post.hasShared
                  ? `Unshare ${shareKindLabel}`
                  : `Share ${shareKindLabel}`
              }
            >
              <Share2
                className={`w-3.5 h-3.5 ${post.hasShared ? "fill-current" : ""}`}
              />
              {post.shareCount ?? 0}
            </Button>
          )}
          {post.recentReactorName && post.reactionCount > 0 && (
            <span className="text-xs text-muted-foreground ml-1 truncate">
              {post.recentReactorName}
              {post.reactionCount > 1 ? ` +${post.reactionCount - 1}` : ""}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


function PhotoAlbum({ images, postId }: { images: string[]; postId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const initial = images.slice(0, 4);
  const rest = images.slice(4);
  const hasMore = rest.length > 0;
  const visible = expanded ? images : initial;

  return (
    <div className="mt-3">
      <div className="grid grid-cols-4 gap-1.5">
        {visible.map((src, i) => {
          const isLastTile = !expanded && hasMore && i === initial.length - 1;
          return (
            <button
              key={`${postId}-img-${i}`}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isLastTile) {
                  setExpanded(true);
                } else {
                  setLightboxIndex(i);
                }
              }}
              className="relative aspect-square rounded-lg overflow-hidden bg-muted border border-border group"
              data-testid={`photo-tile-${postId}-${i}`}
            >
              <img
                src={src}
                alt={`Photo ${i + 1}`}
                className="absolute inset-0 w-full h-full object-cover"
              />
              {isLastTile && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <span className="text-white font-black text-lg">
                    +{rest.length}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
      {expanded && hasMore && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded(false);
          }}
          className="mt-2 text-xs font-bold text-muted-foreground hover:underline"
          data-testid={`button-collapse-photos-${postId}`}
        >
          Show fewer photos
        </button>
      )}
      <PhotoLightbox
        images={images}
        startIndex={lightboxIndex ?? 0}
        open={lightboxIndex !== null}
        onOpenChange={(o) => {
          if (!o) setLightboxIndex(null);
        }}
        testIdPrefix={`photo-lightbox-${postId}`}
      />
    </div>
  );
}

function RecapExcerpt({ body, postId }: { body: string; postId: string }) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_CHARS = 280;
  const isLong = body.length > PREVIEW_CHARS;
  const visible = expanded || !isLong ? body : body.slice(0, PREVIEW_CHARS).trimEnd() + "…";
  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap mt-1">
      {linkify(visible)}
      {isLong && !expanded && (
        <>
          {" "}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(true);
            }}
            className="font-bold text-primary hover:underline"
            data-testid={`button-see-more-${postId}`}
          >
            See more
          </button>
        </>
      )}
      {isLong && expanded && (
        <>
          {" "}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(false);
            }}
            className="font-bold text-muted-foreground hover:underline"
            data-testid={`button-see-less-${postId}`}
          >
            See less
          </button>
        </>
      )}
    </div>
  );
}
