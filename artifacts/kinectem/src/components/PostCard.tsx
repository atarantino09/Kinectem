import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Play, FileText, Heart, MessageSquare } from "lucide-react";
import {
  useAddPostReaction,
  useRemovePostReaction,
  getListFeedQueryKey,
  type PostResponse,
  type FeedPost,
} from "@workspace/api-client-react";
import { timeAgo, getInitials } from "@/lib/format";

export function PostCard({ post }: { post: PostResponse | FeedPost }) {
  const qc = useQueryClient();
  const isShort = post.postType === "short";
  const Icon = isShort ? Play : FileText;
  const label = isShort ? "Highlight" : "Game Recap";
  const badgeClass = isShort
    ? "bg-slate-900 text-primary-foreground"
    : "bg-blue-50 text-blue-700";

  const firstImage = post.assets?.find((a) => a.fileType?.startsWith("image/"));

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
  const addReaction = useAddPostReaction({
    mutation: { onSuccess: invalidate },
  });
  const removeReaction = useRemovePostReaction({
    mutation: { onSuccess: invalidate },
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

  return (
    <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className="px-5 py-4 flex items-center justify-between border-b border-border/60">
          <Link
            href={
              post.context.type === "team"
                ? `/teams/${post.context.id}`
                : `/organizations/${post.context.id}`
            }
            className="flex items-center gap-3 min-w-0"
          >
            <Avatar className="w-10 h-10 rounded-lg">
              {post.context.avatarUrl && (
                <AvatarImage src={post.context.avatarUrl} />
              )}
              <AvatarFallback className="bg-slate-900 text-primary-foreground text-xs font-black rounded-lg">
                {getInitials(post.context.name ?? post.context.type)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-bold text-sm truncate">
                {post.context.name ?? post.context.type}
              </p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-0.5 truncate">
                {post.author.displayName} • {timeAgo(post.createdAt)}
              </p>
            </div>
          </Link>
          <Badge
            className={`${badgeClass} border-none font-bold uppercase text-[10px] tracking-widest shrink-0`}
          >
            <Icon className="w-3 h-3 mr-1 inline" />
            {label}
          </Badge>
        </div>

        <Link href={`/posts/${post.id}`}>
          <div className="cursor-pointer">
            {isShort && firstImage?.url && (
              <div className="h-72 brand-gradient-dark relative flex items-center justify-center group">
                <img
                  src={firstImage.url}
                  alt={post.title ?? ""}
                  className="absolute inset-0 w-full h-full object-cover opacity-60"
                />
                <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-primary transition-colors z-10">
                  <Play className="w-6 h-6 text-white ml-1" fill="currentColor" />
                </div>
              </div>
            )}
            <div className="px-5 py-4 hover:bg-muted/40">
              {post.title && (
                <h3 className="font-black text-xl tracking-tight leading-tight mb-2">
                  {post.title}
                </h3>
              )}
              {post.description && (
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                  {post.description}
                </p>
              )}
            </div>
          </div>
        </Link>

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
