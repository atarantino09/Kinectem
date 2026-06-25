import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PostCard } from "@/components/PostCard";
import { UserAvatar } from "@/components/UserAvatar";
import { SeasonRecapDialog } from "@/components/team-page/SeasonRecapDialog";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTeamPendingPosts,
  useListTeamPendingHighlights,
  useApproveTeamHighlight,
  useDeclineTeamHighlight,
  getListTeamPendingHighlightsQueryKey,
  getListTeamPostsQueryKey,
  queryOpts,
  type PostResponse,
} from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import {
  Newspaper,
  FileText,
  Clapperboard,
  Clock,
  Pencil,
  Check,
  X,
  Trophy,
} from "lucide-react";

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
  // Team display name — used to title the AI season/tournament recap.
  teamName: string;
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
  teamName,
  posts,
}: TeamPostsSectionProps) {
  const canPostHighlight = isAdmin || isTeamMember;
  const [seasonRecapOpen, setSeasonRecapOpen] = useState(false);
  // Task #452 — only fetch the pending-recaps list when the viewer
  // has author capability on the team. Non-authors never trigger the
  // request and never see the section.
  const { data: pendingResp } = useListTeamPendingPosts(teamId, undefined, {
    query: queryOpts({ enabled: !!teamId && canPostRecap }),
  });
  const pendingRecaps = pendingResp?.data ?? [];
  // Task #559 — staff approvers see the player/parent highlight
  // review queue here. `canPostRecap` mirrors the server-side
  // `canApproveTeamHighlight` (same staff set), so we reuse it as
  // the gate without a second whoami round-trip.
  const qc = useQueryClient();
  const { data: pendingHighlightsResp } = useListTeamPendingHighlights(
    teamId,
    undefined,
    { query: queryOpts({ enabled: !!teamId && canPostRecap }) },
  );
  const pendingHighlights = pendingHighlightsResp?.data ?? [];
  const approveHighlight = useApproveTeamHighlight();
  const declineHighlight = useDeclineTeamHighlight();
  const onDecideHighlight = async (
    highlightId: string,
    decision: "approve" | "decline",
  ) => {
    try {
      if (decision === "approve") {
        await approveHighlight.mutateAsync({ teamId, highlightId });
      } else {
        // Task #559 — optional staff-supplied decline reason. Empty
        // input (or cancel) sends an empty body; server trims and
        // ignores blank strings so the uploader's notification falls
        // back to the generic "was declined." copy.
        const reason =
          typeof window !== "undefined"
            ? (window.prompt(
                "Optional: tell the uploader why this highlight was declined. Leave blank to skip.",
                "",
              ) ?? "")
            : "";
        await declineHighlight.mutateAsync({
          teamId,
          highlightId,
          data: { reason: reason.trim() || undefined },
        });
      }
      await Promise.all([
        qc.invalidateQueries({
          queryKey: getListTeamPendingHighlightsQueryKey(teamId),
        }),
        qc.invalidateQueries({ queryKey: getListTeamPostsQueryKey(teamId) }),
      ]);
      toast({
        title:
          decision === "approve" ? "Highlight approved" : "Highlight declined",
      });
    } catch {
      toast({
        title: "Couldn't update highlight",
        variant: "destructive",
      });
    }
  };
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
          {canPostRecap && (
            <Button
              variant="brand"
              size="sm"
              onClick={() => setSeasonRecapOpen(true)}
              data-testid="btn-season-recap"
            >
              <Trophy className="w-3.5 h-3.5 mr-1.5" />
              Combined Recap
            </Button>
          )}
        </div>
      </div>
      {canPostRecap && (
        <SeasonRecapDialog
          teamId={teamId}
          teamName={teamName}
          open={seasonRecapOpen}
          onOpenChange={setSeasonRecapOpen}
        />
      )}
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
      {canPostRecap && pendingHighlights.length > 0 && (
        <Card
          className="rounded-xl border border-amber-200 bg-amber-50/50"
          data-testid="section-pending-highlights"
        >
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <Clapperboard className="w-4 h-4" />
              Highlights awaiting approval
              <span className="text-xs font-normal text-amber-800">
                ({pendingHighlights.length})
              </span>
            </div>
            <div className="space-y-2">
              {pendingHighlights.map((p) => {
                const author = (p as {
                  author?: {
                    id?: string;
                    displayName?: string;
                    avatarUrl?: string | null;
                  };
                }).author;
                return (
                  <div
                    key={p.id}
                    className="flex items-start gap-3 rounded-lg border border-amber-100 bg-white p-3"
                    data-testid={`row-pending-highlight-${p.id}`}
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
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          approveHighlight.isPending ||
                          declineHighlight.isPending
                        }
                        onClick={() => onDecideHighlight(p.id, "approve")}
                        data-testid={`btn-approve-highlight-${p.id}`}
                      >
                        <Check className="w-3.5 h-3.5 mr-1.5" />
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          approveHighlight.isPending ||
                          declineHighlight.isPending
                        }
                        onClick={() => onDecideHighlight(p.id, "decline")}
                        data-testid={`btn-decline-highlight-${p.id}`}
                      >
                        <X className="w-3.5 h-3.5 mr-1.5" />
                        Decline
                      </Button>
                    </div>
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
