import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PostCard } from "@/components/PostCard";
import { Newspaper, FileText } from "lucide-react";
import type { PostResponse } from "@workspace/api-client-react";

interface TeamPostsSectionProps {
  teamId: string;
  isAdmin: boolean;
  posts: PostResponse[];
}

export function TeamPostsSection({
  teamId,
  isAdmin,
  posts,
}: TeamPostsSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
          <Newspaper className="w-5 h-5" />
          Recent Posts
        </h2>
        {isAdmin && (
          <Link href={`/posts/new?type=long&teamId=${teamId}`}>
            <Button
              variant="brand"
              size="sm"
              data-testid="btn-create-recap"
            >
              <FileText className="w-3.5 h-3.5 mr-1.5" />
              Create Game Recap
            </Button>
          </Link>
        )}
      </div>
      {posts.length === 0 ? (
        <Card className="rounded-xl border border-dashed border-border">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No posts for this team yet.
            {isAdmin && (
              <span className="block mt-1">
                Be the first to write a game recap.
              </span>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {posts.slice(0, 5).map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </section>
  );
}
