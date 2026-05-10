import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PostCard } from "@/components/PostCard";
import { UserAvatar } from "@/components/UserAvatar";
import {
  useListTeamPendingPosts,
  queryOpts,
  type PostResponse,
} from "@workspace/api-client-react";
import { Newspaper, FileText, Clapperboard, Clock, Pencil } from "lucide-react";

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
  // server-side `canCreateRecap` rule. Also gates the "Waiting for
  // approval" pending-recaps section below — non-authors don't see it
  // and the underlying request never fires.
  canPostRecap: boolean;
  posts: PostResponse[];
}

function shortExcerpt(p: PostResponse): string {
  const raw =
    (p as { description?: string | null }).description ??
    (p as { body?: string | null }).body ??
    "";
  const text = String(raw).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function formatSubmitted(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function TeamPostsSection({
  teamId,
  isAdmin,
  isTeamMember,
  canPostRecap,
  posts,
}: TeamPostsSectionProps) {
  const canPostHighlight = isAdmin || isTeamMember;
  // Task #452 — only fetch the pending-recaps list when the viewer
  // has author capability on the team. Non-authors never trigger the
  // request and never see the section.
  const { data: pendingResp } = useListTeamPendingPosts(teamId, undefined, {
    query: queryOpts({ enabled: !!teamId && canPostRecap }),
  });
  const pendingRecaps = pendingResp?.data ?? [];
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
      {canPostRecap && pendingRecaps.length > 0 && (
        <Card
          className="rounded-xl border border-amber-200 bg-amber-50/50"
          data-testid="section-pending-recaps"
        >
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <Clock className="w-4 h-4" />
              Waiting for approval
              <span className="text-xs font-normal text-amber-800">
                ({pendingRecaps.length})
              </span>
            </div>
            <div className="space-y-2">
              {pendingRecaps.map((p) => {
                const author = (p as { author?: { id?: string; displayName?: string; avatarUrl?: string | null } }).author;
                const canEdit = (p as { canEdit?: boolean }).canEdit === true;
                return (
                  <div
                    key={p.id}
                    className="flex items-start gap-3 rounded-lg border border-amber-100 bg-white p-3"
                    data-testid={`row-pending-recap-${p.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">
                        {p.title ?? "Untitled"}
                      </div>
                      {shortExcerpt(p) && (
                        <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                          {shortExcerpt(p)}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        {author && (
                          <span className="flex items-center gap-1.5">
                            <UserAvatar
                              size="xs"
                              avatarUrl={author.avatarUrl ?? null}
                              displayName={author.displayName ?? ""}
                            />
                            <span className="truncate">
                              {author.displayName ?? "Unknown"}
                            </span>
                          </span>
                        )}
                        <span>·</span>
                        <span>Submitted {formatSubmitted(p.createdAt)}</span>
                      </div>
                    </div>
                    {canEdit && (
                      <Link href={`/posts/new?editId=${p.id}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid={`btn-edit-pending-recap-${p.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1.5" />
                          Edit
                        </Button>
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
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
