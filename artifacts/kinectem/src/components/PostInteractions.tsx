import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAddPostReaction,
  useRemovePostReaction,
  useListPostComments,
  useCreatePostComment,
  useDeletePostComment,
  useSharePost,
  useUnsharePost,
  useGetLoggedInUser,
  getGetPostQueryKey,
  getListPostCommentsQueryKey,
  getListFeedQueryKey,
  type PostResponse,
  type CommentResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/UserAvatar";
import { Card, CardContent } from "@/components/ui/card";
import { Heart, MessageSquare, Trash2, Flag, Share2 } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { ReportDialog } from "@/components/ReportDialog";
import { ShareConfirmDialog } from "@/components/ShareConfirmDialog";
import { useToast } from "@/hooks/use-toast";

export function PostInteractions({ post }: { post: PostResponse }) {
  const qc = useQueryClient();
  const { data: me } = useGetLoggedInUser();
  const [body, setBody] = useState("");
  const [confirmShareOpen, setConfirmShareOpen] = useState(false);
  const { toast } = useToast();

  const invalidatePost = () =>
    qc.invalidateQueries({ queryKey: getGetPostQueryKey(post.id) });
  const invalidateComments = () =>
    qc.invalidateQueries({ queryKey: getListPostCommentsQueryKey(post.id) });

  const addReaction = useAddPostReaction({
    mutation: { onSuccess: invalidatePost },
  });
  const removeReaction = useRemovePostReaction({
    mutation: { onSuccess: invalidatePost },
  });
  const createComment = useCreatePostComment({
    mutation: {
      onSuccess: () => {
        invalidatePost();
        invalidateComments();
        setBody("");
      },
    },
  });
  const deleteComment = useDeletePostComment({
    mutation: {
      onSuccess: () => {
        invalidatePost();
        invalidateComments();
      },
    },
  });
  const invalidateShareSurfaces = () => {
    invalidatePost();
    qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
    qc.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        typeof q.queryKey[0] === "string" &&
        q.queryKey[0].startsWith("/api/v1/users/") &&
        q.queryKey[0].endsWith("/posts"),
    });
  };
  const optimisticShareToggle = (next: boolean) => {
    const key = getGetPostQueryKey(post.id);
    const prev = qc.getQueryData<PostResponse>(key);
    if (prev) {
      qc.setQueryData<PostResponse>(key, {
        ...prev,
        hasShared: next,
        shareCount: Math.max(0, (prev.shareCount ?? 0) + (next ? 1 : -1)),
      });
    }
    return prev;
  };
  const onShareError = (prev: PostResponse | undefined, action: string) => {
    if (prev) qc.setQueryData(getGetPostQueryKey(post.id), prev);
    toast({
      title: `Couldn't ${action} this ${shareKindLabel}`,
      description: "Please try again in a moment.",
      variant: "destructive",
    });
  };
  const sharePost = useSharePost({
    mutation: {
      onMutate: () => ({ prev: optimisticShareToggle(true) }),
      onError: (_e, _v, ctx) =>
        onShareError(ctx?.prev as PostResponse | undefined, "share"),
      onSuccess: invalidateShareSurfaces,
    },
  });
  const unsharePost = useUnsharePost({
    mutation: {
      onMutate: () => ({ prev: optimisticShareToggle(false) }),
      onError: (_e, _v, ctx) =>
        onShareError(ctx?.prev as PostResponse | undefined, "unshare"),
      onSuccess: invalidateShareSurfaces,
    },
  });

  const { data: comments, isLoading: commentsLoading } = useListPostComments(
    post.id,
  );

  const onToggleReaction = () => {
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
  const shareKindLabel = post.id.startsWith("highlight-") ? "highlight" : "recap";
  const onToggleShare = () => {
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

  const onSubmitComment = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    createComment.mutate({ postId: post.id, data: { body: trimmed } });
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-2 border-y border-border py-3">
        <Button
          variant={post.hasReacted ? "default" : "outline"}
          size="sm"
          onClick={onToggleReaction}
          disabled={addReaction.isPending || removeReaction.isPending}
          className="font-bold gap-2"
          data-testid="button-reaction"
        >
          <Heart
            className={`w-4 h-4 ${post.hasReacted ? "fill-current" : ""}`}
          />
          {post.reactionCount}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="font-bold gap-2"
          disabled
        >
          <MessageSquare className="w-4 h-4" />
          {post.commentCount}
        </Button>
        {isShareable && (
          <Button
            variant={post.hasShared ? "default" : "outline"}
            size="sm"
            onClick={onToggleShare}
            disabled={sharePost.isPending || unsharePost.isPending}
            className="font-bold gap-2"
            data-testid="button-share"
            aria-pressed={post.hasShared}
            aria-label={
              post.hasShared
                ? `Unshare ${shareKindLabel}`
                : `Share ${shareKindLabel}`
            }
          >
            <Share2
              className={`w-4 h-4 ${post.hasShared ? "fill-current" : ""}`}
            />
            {post.shareCount ?? 0}
          </Button>
        )}
        {post.recentReactorName && (
          <span className="text-xs text-muted-foreground ml-2">
            {post.recentReactorName}
            {post.reactionCount > 1
              ? ` and ${post.reactionCount - 1} others reacted`
              : " reacted"}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {commentsLoading ? (
          <p className="text-sm text-muted-foreground">Loading comments…</p>
        ) : !comments || comments.data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Be the first to comment.
          </p>
        ) : (
          comments.data.map((c: CommentResponse) => (
            <CommentRow
              key={c.id}
              comment={c}
              canDelete={!!me && c.author.id === me.id}
              onDelete={() =>
                deleteComment.mutate({ postId: post.id, commentId: c.id })
              }
            />
          ))
        )}
      </div>

      {me && (
        <form
          onSubmit={onSubmitComment}
          className="flex gap-3 pt-4 border-t border-border"
        >
          <UserAvatar
            avatarUrl={me.avatarUrl}
            displayName={`${me.firstName} ${me.lastName}`}
            size="md"
            className="mt-1"
            fallbackClassName="bg-slate-900 text-primary-foreground"
          />
          <div className="flex-1 space-y-2">
            <Textarea
              placeholder="Add a comment..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              className="resize-none"
              data-testid="input-comment-body"
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="brand"
                size="sm"
                disabled={!body.trim() || createComment.isPending}
                data-testid="button-submit-comment"
              >
                Post Comment
              </Button>
            </div>
          </div>
        </form>
      )}
      <ShareConfirmDialog
        open={confirmShareOpen}
        onOpenChange={setConfirmShareOpen}
        onConfirm={onConfirmShare}
        recapTitle={post.title}
        kind={shareKindLabel}
      />
    </div>
  );
}

function CommentRow({
  comment,
  canDelete,
  onDelete,
}: {
  comment: CommentResponse;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  return (
    <Card className="rounded-xl border border-border">
      <CardContent className="p-3">
        <div className="flex gap-3">
          <UserAvatar
            avatarUrl={comment.author.avatarUrl}
            displayName={comment.author.displayName}
            size="sm"
            fallbackClassName="bg-slate-100 text-slate-800"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <p className="font-bold text-sm">{comment.author.displayName}</p>
              <p className="text-[11px] text-muted-foreground">
                {timeAgo(comment.createdAt)}
              </p>
            </div>
            <p className="text-sm mt-1 leading-relaxed whitespace-pre-wrap">
              {comment.body}
            </p>
          </div>
          {canDelete ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              className="w-7 h-7 text-muted-foreground hover:text-destructive"
              data-testid={`button-delete-comment-${comment.id}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setReportOpen(true)}
              className="w-7 h-7 text-muted-foreground hover:text-destructive"
              data-testid={`button-report-comment-${comment.id}`}
              aria-label="Report comment"
            >
              <Flag className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          contentType="comment"
          contentId={comment.id}
        />
      </CardContent>
    </Card>
  );
}
