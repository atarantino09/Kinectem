import { useParams, Link } from "wouter";
import { useGetPost } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Play, FileText } from "lucide-react";
import { timeAgo, getInitials } from "@/lib/format";
import { PostInteractions } from "@/components/PostInteractions";
import { GamePhotoAlbum } from "@/components/GamePhotoAlbum";

export default function PostPage() {
  const params = useParams<{ postId: string }>();
  const postId = params.postId;
  const { data: post, isLoading } = useGetPost(postId);

  if (isLoading || !post) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-2/3 rounded" />
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  const isShort = post.postType === "short";
  const Icon = isShort ? Play : FileText;
  const label = isShort ? "Highlight" : "Game Recap";
  const images = post.assets?.filter((a) => a.fileType?.startsWith("image/")) ?? [];

  return (
    <article className="max-w-3xl mx-auto space-y-6">
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

      <div className="flex items-center gap-3">
        <Avatar className="w-10 h-10">
          {post.author.avatarUrl && <AvatarImage src={post.author.avatarUrl} />}
          <AvatarFallback className="bg-slate-900 text-primary-foreground font-bold text-xs">
            {getInitials(post.author.displayName)}
          </AvatarFallback>
        </Avatar>
        <div>
          <Link href={`/users/${post.author.id}`}>
            <p className="font-bold text-sm hover:text-primary cursor-pointer">
              {post.author.displayName}
            </p>
          </Link>
          <p className="text-xs text-muted-foreground font-medium">
            {timeAgo(post.createdAt)}
            {post.isEdited && " • edited"}
          </p>
        </div>
      </div>

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

      {post.description && (
        <Card className="rounded-xl border border-border">
          <CardContent className="p-5">
            <p className="text-base leading-relaxed text-muted-foreground">
              {post.description}
            </p>
          </CardContent>
        </Card>
      )}

      {post.body && (
        <div className="prose prose-slate max-w-none">
          {post.body.split("\n").map((para, i) => (
            <p key={i} className="text-base leading-relaxed">
              {para}
            </p>
          ))}
        </div>
      )}

      <PostInteractions post={post} />

      {!isShort && <GamePhotoAlbum postId={postId} />}
    </article>
  );
}
