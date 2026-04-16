import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Play, FileText } from "lucide-react";
import type { PostResponse, FeedPost } from "@workspace/api-client-react";
import { timeAgo } from "@/lib/format";
import { getInitials } from "@/lib/format";

export function PostCard({ post }: { post: PostResponse | FeedPost }) {
  const isShort = post.postType === "short";
  const Icon = isShort ? Play : FileText;
  const label = isShort ? "Highlight" : "Game Recap";
  const badgeClass = isShort
    ? "bg-slate-900 text-primary-foreground"
    : "bg-blue-50 text-blue-700";

  const firstImage = post.assets?.find((a) => a.fileType?.startsWith("image/"));

  return (
    <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className="px-5 py-4 flex items-center justify-between border-b border-border/60">
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10">
              {post.author.avatarUrl && <AvatarImage src={post.author.avatarUrl} />}
              <AvatarFallback className="bg-slate-900 text-primary-foreground text-xs font-bold">
                {getInitials(post.author.displayName)}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-bold text-sm">{post.author.displayName}</p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-0.5">
                {post.context.name ?? post.context.type} • {timeAgo(post.createdAt)}
              </p>
            </div>
          </div>
          <Badge
            className={`${badgeClass} border-none font-bold uppercase text-[10px] tracking-widest`}
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
      </CardContent>
    </Card>
  );
}
