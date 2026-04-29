import { useParams, Link, useSearch, useLocation } from "wouter";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getListFeedQueryKey,
  getListOrgPostsQueryKey,
  getListTeamPostsQueryKey,
  getListUserPostsQueryKey,
  useDeletePost,
  type PostResponse,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import {
  Play,
  FileText,
  Pencil,
  ArrowLeft,
  Eye,
  ChevronDown,
  Trash2,
} from "lucide-react";
import { timeAgo } from "@/lib/format";
import { linkify } from "@/lib/linkify";
import { PostInteractions } from "@/components/PostInteractions";
import { GamePhotoAlbum } from "@/components/GamePhotoAlbum";
import { AvatarLightbox } from "@/components/AvatarLightbox";
import { VideoEmbed } from "@/components/VideoEmbed";
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
import { useToast } from "@/hooks/use-toast";

export default function PostPage() {
  const params = useParams<{ postId: string }>();
  const postId = params.postId;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const deletePost = useDeletePost();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // When the parent jumps in here from the family stream the link carries
  // `?asChild=<id>`. Surface that context so the parent knows why they
  // landed here, and fetch the post through the child-scoped endpoint so
  // viewer-specific stats (their own reactions, draft access) reflect the
  // child rather than the parent.
  const search = useSearch();
  const [currentPath] = useLocation();
  const asChildId = useMemo(() => {
    const sp = new URLSearchParams(search ?? "");
    const v = sp.get("asChild");
    return v && v.length > 0 ? v : null;
  }, [search]);

  const postQuery = useQuery<PostResponse>({
    queryKey: asChildId
      ? ["child-post", asChildId, postId]
      : ["post", postId],
    queryFn: () =>
      customFetch<PostResponse>(
        asChildId
          ? `/api/v1/users/me/children/${asChildId}/posts/${postId}`
          : `/api/v1/posts/${postId}`,
      ),
    enabled: !!postId,
  });
  const post = postQuery.data;
  const isLoading = postQuery.isLoading;
  const error = postQuery.error;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-2/3 rounded" />
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (error || !post) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : "We couldn't load this post.";
    return (
      <div
        className="max-w-3xl mx-auto space-y-4 text-center py-12"
        data-testid="post-error-state"
      >
        <h1 className="text-2xl font-black">
          {asChildId ? "Can't preview this post" : "Post not available"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {asChildId
            ? "We couldn't load this post in guardian preview mode. It may have been removed, hidden, or your child no longer has access."
            : message}
        </p>
        <Link
          href={asChildId ? "/family" : "/"}
          className="inline-flex items-center gap-1 text-sm font-bold hover:underline"
          data-testid="link-post-error-back"
        >
          <ArrowLeft className="w-3 h-3" />
          {asChildId ? "Back to family" : "Back to feed"}
        </Link>
      </div>
    );
  }

  const isShort = post.postType === "short";
  const Icon = isShort ? Play : FileText;
  const label = isShort ? "Highlight" : "Game Recap";
  const images = post.assets?.filter((a) => a.fileType?.startsWith("image/")) ?? [];
  const videoAsset = post.assets?.find((a) => a.fileType?.startsWith("video/"));

  return (
    <article className="max-w-3xl mx-auto space-y-6">
      {asChildId && (
        <div
          className="flex items-start gap-2 rounded-lg bg-muted/60 border border-border px-3 py-2"
          data-testid="banner-guardian-view"
        >
          <Eye className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-xs flex-1">
            <p className="font-bold">Following your child's stream</p>
            <p className="text-muted-foreground">
              You opened this from your family inbox.{" "}
              <Link
                href="/family"
                className="font-bold text-foreground hover:underline inline-flex items-center gap-1"
                data-testid="link-back-to-family-from-post"
              >
                <ArrowLeft className="w-3 h-3" />
                Back to family
              </Link>
            </p>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Badge className="bg-slate-900 text-primary-foreground font-bold uppercase text-[10px] tracking-widest">
          <Icon className="w-3 h-3 mr-1 inline" />
          {label}
        </Badge>
        {post.context.name && (
          <Link
            href={
              post.context.type === "team"
                ? `/teams/${post.context.id}`
                : post.context.type === "organization"
                  ? `/organizations/${post.context.id}`
                  : `/users/${post.context.id}`
            }
          >
            <Badge
              variant="outline"
              className="font-bold cursor-pointer"
              data-testid={`link-post-context-${post.context.type}`}
            >
              {post.context.name}
            </Badge>
          </Link>
        )}
      </div>

      {post.title && (
        <h1 className="text-4xl font-black tracking-tight leading-tight">
          {post.title}
        </h1>
      )}
      {post.title && !isShort && (
        <hr
          className="border-t border-border"
          data-testid="divider-post-title"
        />
      )}

      <div className="flex items-center gap-3">
        <AvatarLightbox
          avatarUrl={post.author.avatarUrl}
          displayName={post.author.displayName}
          triggerTestId={`btn-open-post-author-avatar-lightbox-${post.id}`}
          dialogTestId={`dialog-post-author-avatar-lightbox-${post.id}`}
          imageTestId={`img-post-author-avatar-lightbox-${post.id}`}
        >
          <UserAvatar
            avatarUrl={post.author.avatarUrl}
            displayName={post.author.displayName}
            size="lg"
            className={post.author.avatarUrl ? "cursor-pointer" : undefined}
            fallbackClassName="bg-slate-900 text-primary-foreground"
          />
        </AvatarLightbox>
        <div className="flex-1 min-w-0">
          <Link href={`/users/${post.author.id}`}>
            <p
              className="font-bold text-sm hover:text-primary cursor-pointer"
              data-testid={`text-post-author-name-${post.id}`}
            >
              {post.author.displayName}
              {post.author.authorRole && (
                <span
                  className="ml-1 text-xs text-muted-foreground font-medium"
                  data-testid={`text-post-author-role-${post.id}`}
                >
                  · {post.author.authorRole}
                </span>
              )}
            </p>
          </Link>
          <p className="text-xs text-muted-foreground font-medium">
            {timeAgo(post.createdAt)}
            {post.isEdited && " • edited"}
          </p>
        </div>
        {post.canEdit && (
          post.canDelete ? (
            // Original author: Edit + chevron dropdown that includes
            // "Delete post". Co-authors / coaches / org admins (who
            // get `canEdit` but never `canDelete`) fall through to the
            // plain Edit button below.
            <div
              className="inline-flex rounded-full border border-input overflow-hidden"
              data-testid="post-author-actions"
            >
              <Link
                href={`/posts/new?editId=${encodeURIComponent(post.id)}&from=${encodeURIComponent(currentPath + (search ? `?${search}` : ""))}`}
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="font-bold rounded-none border-0"
                  data-testid="button-edit-post"
                >
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  Edit
                </Button>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="font-bold rounded-none border-0 border-l border-input px-2"
                    aria-label="More post actions"
                    data-testid="button-post-actions-menu"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setConfirmDelete(true);
                    }}
                    className="text-destructive focus:text-destructive"
                    data-testid="menuitem-delete-post"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                    Delete post
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <Link
              href={`/posts/new?editId=${encodeURIComponent(post.id)}&from=${encodeURIComponent(currentPath + (search ? `?${search}` : ""))}`}
            >
              <Button
                variant="outline"
                size="sm"
                className="font-bold rounded-full"
                data-testid="button-edit-post"
              >
                <Pencil className="w-3.5 h-3.5 mr-1.5" />
                Edit
              </Button>
            </Link>
          )
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid="dialog-delete-post-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the post from feeds, your profile, and any
              team or organization page where it appeared. This can't be
              undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-post-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deletePost.isPending}
              onClick={async (e) => {
                e.preventDefault();
                try {
                  await deletePost.mutateAsync({ postId: post.id });
                  setConfirmDelete(false);
                  // Invalidate every list the deleted post might have
                  // appeared on so the user doesn't see stale copies
                  // when they navigate back: the home feed, the
                  // post-author's profile posts, and the team or org
                  // posts list (whichever scope the post belonged to).
                  // We invalidate without arguments where supported so
                  // any cached page/filter variant gets refetched.
                  qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
                  if (post.author?.id) {
                    qc.invalidateQueries({
                      queryKey: getListUserPostsQueryKey(post.author.id),
                    });
                  }
                  if (post.context?.type === "team" && post.context.id) {
                    qc.invalidateQueries({
                      queryKey: getListTeamPostsQueryKey(post.context.id),
                    });
                  }
                  if (post.context?.type === "organization" && post.context.id) {
                    qc.invalidateQueries({
                      queryKey: getListOrgPostsQueryKey(post.context.id),
                    });
                  }
                  qc.removeQueries({ queryKey: ["post", post.id] });
                  toast({ title: "Post deleted" });
                  // Land somewhere sensible: highlights and articles
                  // bounce back to their team page; org Updates bounce
                  // back to their organization page; otherwise we drop
                  // the user on the home feed.
                  setLocation(
                    post.context?.type === "team" && post.context.id
                      ? `/teams/${post.context.id}`
                      : post.context?.type === "organization" && post.context.id
                        ? `/organizations/${post.context.id}`
                        : "/",
                  );
                } catch {
                  toast({
                    title: "Couldn't delete post",
                    description: "Please try again.",
                    variant: "destructive",
                  });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-post-confirm"
            >
              {deletePost.isPending ? "Deleting…" : "Delete post"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {post.description && (
        <Card className="rounded-xl border border-border">
          <CardContent className="p-5">
            <p className="text-base leading-relaxed text-muted-foreground">
              {linkify(post.description)}
            </p>
          </CardContent>
        </Card>
      )}

      {post.body && !isShort && (
        <Card className="rounded-xl border border-border">
          <CardContent className="p-5">
            <div className="prose prose-slate max-w-none">
              {post.body.split("\n").map((para, i) => (
                <p key={i} className="text-base leading-relaxed">
                  {linkify(para)}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {post.body && isShort && (
        <div className="prose prose-slate max-w-none">
          {post.body.split("\n").map((para, i) => (
            <p key={i} className="text-base leading-relaxed">
              {linkify(para)}
            </p>
          ))}
        </div>
      )}

      {videoAsset?.url && (
        <VideoEmbed
          url={videoAsset.url}
          className="rounded-xl overflow-hidden border border-border bg-black aspect-video"
        />
      )}

      {/* Photos render after the body in the order the API returns them,
          which mirrors the upload order chosen in the new-post form. */}
      {images.length > 0 && (
        <div className="grid grid-cols-1 gap-3">
          {images.map((img) => (
            <div
              key={img.id}
              className="rounded-xl overflow-hidden bg-muted aspect-video"
            >
              {img.url && (
                <img
                  src={img.url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {asChildId ? (
        <div
          className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
          data-testid="banner-interactions-disabled"
        >
          Reactions and comments are hidden in guardian preview mode.
        </div>
      ) : (
        <PostInteractions post={post} />
      )}

      {!isShort && <GamePhotoAlbum postId={postId} />}
    </article>
  );
}
