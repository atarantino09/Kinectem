import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PostCard } from "@/components/PostCard";
import { Newspaper, FileText, Clapperboard } from "lucide-react";
import type { PostResponse } from "@workspace/api-client-react";

interface TeamPostsSectionProps {
  teamId: string;
  isAdmin: boolean;
  // True when the viewer has any accepted roster entry on this team
  // (player, coach, staff, author, etc.). Drives the broader "Post
  // Highlight" CTA — `isAdmin` keeps the existing recap-only gate.
  isTeamMember: boolean;
  // True when the viewer can author a game recap on this team —
  // i.e. org admin, team coach (coach/assistant_coach/admin position),
  // or any accepted member with `position = "author"`. Mirrors the
  // server-side `canCreateRecap` rule.
  canPostRecap: boolean;
  posts: PostResponse[];
}

export function TeamPostsSection({
  teamId,
  isAdmin,
  isTeamMember,
  canPostRecap,
  posts,
}: TeamPostsSectionProps) {
  const canPostHighlight = isAdmin || isTeamMember;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
          <Newspaper className="w-5 h-5" />
          Recent Posts
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {canPostHighlight && (
            <Link href={`/posts/new?type=short&teamId=${teamId}`}>
              <Button
                variant="brand"
                size="sm"
                data-testid="btn-create-highlight"
              >
                <Clapperboard className="w-3.5 h-3.5 mr-1.5" />
                Post Highlight
              </Button>
            </Link>
          )}
          {canPostRecap && (
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
      </div>
      {posts.length === 0 ? (
        <Card className="rounded-xl border border-dashed border-border">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No posts for this team yet.
            {canPostHighlight && (
              <span className="block mt-1">
                Share the first highlight from this team.
              </span>
            )}
            {canPostRecap && (
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
