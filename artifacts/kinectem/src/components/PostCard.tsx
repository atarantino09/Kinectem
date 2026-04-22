import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Play, FileText, Heart, MessageSquare, Video } from "lucide-react";
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
  const allImages = (post.assets ?? []).filter((a) =>
    a.fileType?.startsWith("image/"),
  );
  const videoAsset = (post.assets ?? []).find((a) =>
    a.fileType?.startsWith("video/"),
  );

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

        <div>
          {isShort && firstImage?.url && (
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
              <Link href={`/posts/${post.id}`}>
                <h3 className="font-black text-xl tracking-tight leading-tight mb-2 hover:underline cursor-pointer">
                  {post.title}
                </h3>
              </Link>
            )}
            {post.description && (
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 mb-2">
                {post.description}
              </p>
            )}
            {!isShort && post.body && (
              <RecapExcerpt body={post.body} postId={post.id} />
            )}
            {!isShort && allImages.length > 0 && (
              <PhotoAlbum
                images={allImages.map((a) => a.url)}
                postId={post.id}
              />
            )}
            {!isShort && videoAsset?.url && (
              <VideoEmbed url={videoAsset.url} />
            )}
          </div>
        </div>

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

function getYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.endsWith("youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] ?? null;
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function getVimeoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("vimeo.com")) return null;
    const id = u.pathname.split("/").filter(Boolean)[0];
    return /^\d+$/.test(id ?? "") ? id : null;
  } catch {
    return null;
  }
}

function VideoEmbed({ url }: { url: string }) {
  const ytId = getYouTubeId(url);
  const vimeoId = getVimeoId(url);
  const embedSrc = ytId
    ? `https://www.youtube.com/embed/${ytId}`
    : vimeoId
      ? `https://player.vimeo.com/video/${vimeoId}`
      : null;

  if (embedSrc) {
    return (
      <div className="mt-3 rounded-lg overflow-hidden border border-border bg-black aspect-video">
        <iframe
          src={embedSrc}
          title="Video highlight"
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted text-sm font-bold text-primary"
    >
      <Video className="w-4 h-4" />
      <span className="truncate">{url}</span>
    </a>
  );
}

function PhotoAlbum({ images, postId }: { images: string[]; postId: string }) {
  const [expanded, setExpanded] = useState(false);
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
                if (isLastTile) setExpanded(true);
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
      {visible}
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
