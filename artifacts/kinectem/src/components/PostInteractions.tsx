import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAddPostReaction,
  useRemovePostReaction,
  useListPostComments,
  useCreatePostComment,
  useDeletePostComment,
  useGetLoggedInUser,
  getGetPostQueryKey,
  getListPostCommentsQueryKey,
  type PostResponse,
  type CommentResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Heart, MessageSquare, Trash2, Flag } from "lucide-react";
import { timeAgo, getInitials } from "@/lib/format";
import { ReportDialog } from "@/components/ReportDialog";

export function PostInteractions({ post }: { post: PostResponse }) {
  const qc = useQueryClient();
  const { data: me } = useGetLoggedInUser();
  const [body, setBody] = useState("");

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
        {post.recentReactorName && (
          <span className="text-xs text-muted-foreground ml-2">
            {post.recentReactorName}
            {post.reactionCount > 1
              ? ` and ${post.reactionCount - 1} others reacted`
              : " reacted"}
          </span>
        )}
      </div>

      {me && (
        <form onSubmit={onSubmitComment} className="flex gap-3">
          <Avatar className="w-9 h-9 mt-1">
            <AvatarImage src={me.avatarUrl ?? undefined} />
            <AvatarFallback className="bg-slate-900 text-primary-foreground font-bold text-xs">
              {getInitials(`${me.firstName} ${me.lastName}`)}
            </AvatarFallback>
          </Avatar>
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
                size="sm"
                disabled={!body.trim() || createComment.isPending}
                className="font-bold"
                data-testid="button-submit-comment"
              >
                Post Comment
              </Button>
            </div>
          </div>
        </form>
      )}

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
          <Avatar className="w-8 h-8">
            <AvatarImage src={comment.author.avatarUrl ?? undefined} />
            <AvatarFallback className="bg-slate-100 text-slate-800 font-bold text-[10px]">
              {getInitials(comment.author.displayName)}
            </AvatarFallback>
          </Avatar>
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
