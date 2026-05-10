import { useParams, Link, useSearch, useLocation } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetPostQueryKey,
  getListFeedQueryKey,
  getListOrgPostApprovalsQueryKey,
  getListOrgPostsQueryKey,
  getListTeamPostsQueryKey,
  getListUserPostsQueryKey,
  useApproveOrgPostApproval,
  useDeclineOrgPostApproval,
  useDeletePost,
  useListOrgPostApprovals,
  useUpdatePost,
  type PostApprovalResponse,
  type PostResponse,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { NoIndex } from "@/components/NoIndex";
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
import { TaggedPlayers } from "@/components/TaggedPlayers";
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
  const [reportSubmitting, setReportSubmitting] = useState(false);
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

  // Inline edit state for the admin-on-pending-recap flow. Initialized
  // from the post payload after it loads (see useEffect below). We
  // keep the buffer separate from `postQuery.data` so Cancel can revert
  // without round-tripping the network.
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBody, setEditBody] = useState("");

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
    // Always refetch on mount so navigating back here from a flow that
    // mutates server-side state (e.g. approving / removing a pending
    // tag from /tags/pending) shows the latest state, even if the
    // cache eviction in the mutating flow didn't fire for any reason
    // (closure issue, browser BFCache restoring React state, etc).
    // The post-detail endpoint is cheap and this is a single fetch
    // per page load, not per render.
    refetchOnMount: "always",
  });
  const post = postQuery.data;
  const isLoading = postQuery.isLoading;
  const error = postQuery.error;

  // Task #451 — surface the org post-approvals queue when the viewer
  // can edit this post and the post belongs to an org-scoped team. We
  // gate on `canEdit` so we don't issue a doomed 403 for every random
  // viewer; org admins (and authors who happen to also be admins) get
  // a 200 and we look for this post's row in the response. Non-team
  // posts (org posts, user-context highlights) skip the query entirely
  // — they don't go through the approvals queue.
  const orgIdForApprovals =
    post && !asChildId && post.canEdit && post.context?.type === "team"
      ? (post.context.orgId ?? null)
      : null;
  const approvalsQuery = useListOrgPostApprovals(
    orgIdForApprovals ?? "",
    undefined,
    {
      query: {
        queryKey: getListOrgPostApprovalsQueryKey(orgIdForApprovals ?? ""),
        enabled: !!orgIdForApprovals,
        // 403 here just means the viewer isn't an org admin; don't
        // hammer the endpoint retrying.
        retry: false,
      },
    },
  );
  const pendingApproval: PostApprovalResponse | null = useMemo(() => {
    if (!post) return null;
    const rows = approvalsQuery.data?.data ?? [];
    return rows.find((r) => r.postId === post.id) ?? null;
  }, [approvalsQuery.data, post]);
  const isAdminOnPending = !!pendingApproval;

  // Sync the edit buffer with the post payload whenever a fresh copy
  // arrives (initial load, post-save refetch). We avoid clobbering the
  // buffer mid-edit so an in-flight refetch can't overwrite the
  // admin's typing.
  useEffect(() => {
    if (!post || editing) return;
    setEditTitle(post.title ?? "");
    setEditDescription(post.description ?? "");
    setEditBody(post.body ?? "");
  }, [post, editing]);

  const updatePost = useUpdatePost();
  const approveApproval = useApproveOrgPostApproval();
  const declineApproval = useDeclineOrgPostApproval();

  const hasUnsavedEdits =
    editing &&
    !!post &&
    (editTitle !== (post.title ?? "") ||
      editDescription !== (post.description ?? "") ||
      editBody !== (post.body ?? ""));

  const refreshApprovalsAndPost = () => {
    if (orgIdForApprovals) {
      qc.invalidateQueries({
        queryKey: getListOrgPostApprovalsQueryKey(orgIdForApprovals),
      });
    }
    if (postId) {
      qc.invalidateQueries({ queryKey: getGetPostQueryKey(postId) });
      qc.invalidateQueries({ queryKey: ["post", postId] });
    }
    qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
    if (post?.context?.type === "team" && post.context.id) {
      qc.invalidateQueries({
        queryKey: getListTeamPostsQueryKey(post.context.id),
      });
    }
    if (post?.context?.type === "organization" && post.context.id) {
      qc.invalidateQueries({
        queryKey: getListOrgPostsQueryKey(post.context.id),
      });
    }
  };

  const handleSaveEdits = async () => {
    if (!post) return;
    try {
      await updatePost.mutateAsync({
        postId: post.id,
        data: {
          title: editTitle.trim() ? editTitle : null,
          description: editDescription.trim() ? editDescription : null,
          body: editBody.trim() ? editBody : null,
        },
      });
      setEditing(false);
      refreshApprovalsAndPost();
      toast({ title: "Changes saved" });
    } catch (err) {
      toast({
        title: "Couldn't save changes",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleApproveFromPost = async () => {
    if (!pendingApproval || !orgIdForApprovals) return;
    try {
      await approveApproval.mutateAsync({
        orgId: orgIdForApprovals,
        approvalId: pendingApproval.id,
      });
      setEditing(false);
      refreshApprovalsAndPost();
      setLocation(`/organizations/${orgIdForApprovals}`);
      toast({ title: "Recap approved" });
    } catch (err) {
      toast({
        title: "Couldn't approve recap",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDeclineFromPost = async () => {
    if (!pendingApproval || !orgIdForApprovals) return;
    try {
      await declineApproval.mutateAsync({
        orgId: orgIdForApprovals,
        approvalId: pendingApproval.id,
      });
      setEditing(false);
      refreshApprovalsAndPost();
      toast({ title: "Recap declined" });
    } catch (err) {
      toast({
        title: "Couldn't decline recap",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

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

  // Task #367 — keep recap/highlight URLs out of search engines if the
  // author is a minor. Minor-tagged posts also get the header from the
  // server; this <meta> covers the SPA-shell render path.
  const authorIsMinor = Boolean((post.author as { isMinor?: boolean })?.isMinor);

  // Task #367 — guardian-only "Report photo of my child" action. We
  // only surface this in the existing guardian preview mode (where
  // the guardian arrived from /family with a known childId), so we
  // already know who the takedown is being filed on behalf of and
  // don't need a child-picker modal for the MVP. The action POSTs
  // to the COPPA Phase 3 endpoint; a successful filing immediately
  // hides the post from feeds for everyone except admin + the
  // requesting guardian.
  const handleReportPhotoOfChild = async () => {
    if (!asChildId) return;
    setReportSubmitting(true);
    try {
      // Task #367 — `post.id` is the synthetic id (e.g.
      // `article-<uuid>` / `highlight-<uuid>`). The takedown
      // endpoint expects the canonical `article:<uuid>` /
      // `highlight:<uuid>` format, so strip the prefix and rebuild.
      const refKind = isShort ? "highlight" : "article";
      const refUuid = post.id.startsWith(`${refKind}-`)
        ? post.id.slice(refKind.length + 1)
        : post.id;
      await customFetch(
        `/api/v1/guardians/children/${asChildId}/takedown-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId: `${refKind}:${refUuid}` }),
        },
      );
      toast({
        title: "Takedown requested",
        description:
          "We've notified moderators. The post is hidden from public feeds while we review it.",
      });
      qc.invalidateQueries({ queryKey: ["post", postId] });
      qc.invalidateQueries({ queryKey: ["child-post", asChildId, postId] });
    } catch (err) {
      toast({
        title: "Couldn't submit takedown",
        description:
          err instanceof Error
            ? err.message
            : "Something went wrong filing the takedown request.",
        variant: "destructive",
      });
    } finally {
      setReportSubmitting(false);
    }
  };

  return (
    <article className="max-w-3xl mx-auto space-y-6">
      {authorIsMinor ? <NoIndex /> : null}
      {asChildId && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={reportSubmitting}
            onClick={handleReportPhotoOfChild}
            data-testid="btn-report-photo-of-child"
          >
            {reportSubmitting ? "Submitting…" : "Report photo of my child"}
          </Button>
        </div>
      )}
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
        {post.context.type === "team" &&
          post.context.orgId &&
          post.context.orgName && (
            <Link href={`/organizations/${post.context.orgId}`}>
              <Badge
                variant="outline"
                className="font-bold cursor-pointer"
                data-testid="link-post-context-organization"
              >
                {post.context.orgName}
              </Badge>
            </Link>
          )}
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

      {isAdminOnPending && (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
          data-testid="post-approval-bar"
        >
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-amber-900">
              Pending recap approval
            </p>
            <p className="text-xs text-amber-900/80">
              {hasUnsavedEdits
                ? "Save your changes before approving this recap."
                : "Approve to publish this recap, or decline to send it back to draft."}
            </p>
          </div>
          <div className="flex gap-2 self-end sm:self-auto shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="font-bold"
              disabled={
                declineApproval.isPending || approveApproval.isPending
              }
              onClick={handleDeclineFromPost}
              data-testid="btn-post-page-decline"
            >
              Decline
            </Button>
            <Button
              variant="brand"
              size="sm"
              className="font-bold"
              disabled={
                hasUnsavedEdits ||
                approveApproval.isPending ||
                declineApproval.isPending ||
                updatePost.isPending
              }
              onClick={handleApproveFromPost}
              data-testid="btn-post-page-approve"
              title={
                hasUnsavedEdits
                  ? "Save your changes before approving"
                  : undefined
              }
            >
              Approve
            </Button>
          </div>
        </div>
      )}

      {editing && isAdminOnPending ? (
        <div className="space-y-2">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
            Title
          </label>
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="text-2xl font-black h-auto py-2"
            placeholder="Recap title"
            data-testid="input-post-edit-title"
          />
        </div>
      ) : (
        post.title && (
          <h1 className="text-4xl font-black tracking-tight leading-tight">
            {post.title}
          </h1>
        )
      )}
      {((editing && isAdminOnPending) || post.title) && !isShort && (
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
        {isAdminOnPending ? (
          editing ? (
            <div
              className="inline-flex gap-2"
              data-testid="post-inline-edit-actions"
            >
              <Button
                variant="outline"
                size="sm"
                className="font-bold rounded-full"
                onClick={() => {
                  setEditing(false);
                  setEditTitle(post.title ?? "");
                  setEditDescription(post.description ?? "");
                  setEditBody(post.body ?? "");
                }}
                disabled={updatePost.isPending}
                data-testid="button-post-edit-cancel"
              >
                Cancel
              </Button>
              <Button
                variant="brand"
                size="sm"
                className="font-bold rounded-full"
                onClick={handleSaveEdits}
                disabled={updatePost.isPending || !hasUnsavedEdits}
                data-testid="button-post-edit-save"
              >
                {updatePost.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="font-bold rounded-full"
              onClick={() => setEditing(true)}
              data-testid="button-edit-post-inline"
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              Edit
            </Button>
          )
        ) : post.canEdit && (
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

      {editing && isAdminOnPending ? (
        <>
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
              Description
            </label>
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              placeholder="Short summary or caption"
              data-testid="textarea-post-edit-description"
            />
          </div>
          {!isShort && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                Body
              </label>
              <Textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={12}
                placeholder="Write the full recap…"
                data-testid="textarea-post-edit-body"
              />
            </div>
          )}
        </>
      ) : (
        <>
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
        </>
      )}

      {videoAsset?.url && (
        <VideoEmbed
          url={videoAsset.url}
          className="rounded-xl overflow-hidden border border-border bg-black aspect-video"
        />
      )}

      {/*
       * Highlight detail page surfaces tagged players directly under
       * the video so viewers can see who is featured and tap through
       * to a player profile. The server filters pending tags down to
       * the post uploader and the tagged player themselves; for
       * everyone else only approved tags appear here.
       */}
      {isShort && (
        <TaggedPlayers
          taggedUsers={
            "taggedUsers" in post ? post.taggedUsers : undefined
          }
          postId={post.id}
          variant="detail"
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
