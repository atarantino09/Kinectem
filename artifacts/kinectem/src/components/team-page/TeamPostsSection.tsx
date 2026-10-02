import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorMessage } from "@/lib/api-errors";
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
  customFetch,
  queryOpts,
  type PostResponse,
} from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { useInfiniteScrollSentinel } from "@/hooks/useInfiniteScrollSentinel";
import { EmptyState } from "@/components/EmptyState";
import {
  Newspaper,
  History,
  FileText,
  ClipboardList,
  Clapperboard,
  Clock,
  Pencil,
  Check,
  X,
  Trophy,
  ChevronDown,
  Plus,
} from "lucide-react";

interface TeamPostsSectionProps {
  teamId: string;
  isAdmin: boolean;
  // Mirrors the server's `canManageTeam` (org admins/owners, platform
  // admins, AND coach-level roster staff). Gates the "Add News Article"
  // control — coaches can add news even though they aren't org admins.
  canManage: boolean;
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
  // Task #782 — cursor pagination controls so older recaps stay
  // reachable instead of capping at the newest page.
  hasMorePosts: boolean;
  isLoadingMorePosts: boolean;
  // Task #785 — true when the last page fetch failed; pauses the
  // auto-load sentinel and shows a manual retry button instead.
  loadMorePostsFailed?: boolean;
  onLoadMorePosts: () => void;
  onCreatePracticePlan?: () => void;
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
  canManage,
  isTeamMember,
  canPostRecap,
  teamName,
  posts,
  hasMorePosts,
  isLoadingMorePosts,
  loadMorePostsFailed = false,
  onLoadMorePosts,
  onCreatePracticePlan,
}: TeamPostsSectionProps) {
  // Task #785 — infinite scroll: auto-fetch the next cursor page when
  // the sentinel below the last post scrolls into view. On fetch
  // failure the sentinel pauses and a manual retry button renders.
  const loadMoreSentinelRef = useInfiniteScrollSentinel({
    hasMore: hasMorePosts,
    isLoading: isLoadingMorePosts,
    hasError: loadMorePostsFailed,
    onLoadMore: onLoadMorePosts,
  });
  const canPostHighlight = isAdmin || isTeamMember;
  const hasPostOptions = canPostRecap || canManage;
  const [seasonRecapOpen, setSeasonRecapOpen] = useState(false);
  // "In the News" — paste a newspaper article's link; the server fetches
  // the headline/source/photo and posts a read-only news card.
  const [addNewsOpen, setAddNewsOpen] = useState(false);
  const [newsUrl, setNewsUrl] = useState("");
  const [newsGameDate, setNewsGameDate] = useState("");
  const [addingNews, setAddingNews] = useState(false);
  const submitNewsUrl = async () => {
    const url = newsUrl.trim();
    if (!url) return;
    setAddingNews(true);
    try {
      await customFetch(`/api/v1/teams/${teamId}/news`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          ...(newsGameDate ? { gameDate: newsGameDate } : {}),
        }),
      });
      toast({ title: "Article added to the team page" });
      setAddNewsOpen(false);
      setNewsUrl("");
      setNewsGameDate("");
      await qc.invalidateQueries({
        queryKey: getListTeamPostsQueryKey(teamId),
      });
    } catch (err) {
      toast({
        title: "Couldn't add that article",
        description:
          apiErrorMessage(err) ??
          "Check the link and try again — it should be the article's web address.",
        variant: "destructive",
      });
    } finally {
      setAddingNews(false);
    }
  };
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
          <Newspaper className="w-5 h-5" />
          Recent Posts
        </h2>
        {(canPostHighlight || canPostRecap || canManage) && (
          <div
            className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end"
            data-testid="team-post-actions"
          >
            {canPostRecap ? (
              <Link href={`/posts/new?type=long&teamId=${teamId}`}>
                <Button
                  variant="brand"
                  size="sm"
                  className="w-full font-bold sm:w-auto"
                  data-testid="btn-create-recap"
                >
                  <FileText className="w-3.5 h-3.5 mr-1.5" />
                  Create Game Recap
                </Button>
              </Link>
            ) : canPostHighlight ? (
              <Link href={`/posts/new?type=short&teamId=${teamId}`}>
                <Button
                  variant="brand"
                  size="sm"
                  className="w-full font-bold sm:w-auto"
                  data-testid="btn-create-highlight"
                >
                  <Clapperboard className="w-3.5 h-3.5 mr-1.5" />
                  Post Highlight
                </Button>
              </Link>
            ) : null}
            {hasPostOptions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full font-bold sm:w-auto"
                    data-testid="btn-open-post-options"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    Other post options
                    <ChevronDown className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {canPostHighlight && canPostRecap && (
                    <DropdownMenuItem asChild>
                      <Link
                        href={`/posts/new?type=short&teamId=${teamId}`}
                        data-testid="btn-create-highlight"
                      >
                        <Clapperboard className="w-4 h-4 mr-2" />
                        Post Highlight
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {canPostRecap && (
                    <DropdownMenuItem asChild>
                      <Link
                        href={`/historical-recap?teamId=${teamId}`}
                        data-testid="link-historical-recap-team"
                      >
                        <History className="w-4 h-4 mr-2" />
                        Historical Recap
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {canPostRecap && (
                    <DropdownMenuItem
                      onSelect={() => setSeasonRecapOpen(true)}
                      data-testid="btn-season-recap"
                    >
                      <Trophy className="w-4 h-4 mr-2" />
                      Combined Recap
                    </DropdownMenuItem>
                  )}
                  {canPostRecap && (
                    <DropdownMenuItem asChild>
                      <Link href="/drafts" data-testid="link-historical-drafts-team">
                        <Pencil className="w-4 h-4 mr-2" />
                        Drafts
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {canManage && (
                    <>
                      {canPostRecap && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        onSelect={onCreatePracticePlan}
                        data-testid="btn-create-practice-plan"
                      >
                        <ClipboardList className="w-4 h-4 mr-2" />
                        Practice Plan
                      </DropdownMenuItem>
                    </>
                  )}
                  {canManage && (
                    <DropdownMenuItem
                      onSelect={() => setAddNewsOpen(true)}
                      data-testid="btn-add-news"
                    >
                      <Newspaper className="w-4 h-4 mr-2" />
                      Add News Article
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
      {canManage && (
        <Dialog
          open={addNewsOpen}
          onOpenChange={(o) => !addingNews && setAddNewsOpen(o)}
        >
          <DialogContent data-testid="dialog-add-news">
            <DialogHeader>
              <DialogTitle>Add a news article</DialogTitle>
              <DialogDescription>
                Paste the web address of a newspaper article about this team.
                We'll pull in the headline and photo automatically, and the card
                will appear on the team page and followers' feeds.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitNewsUrl();
              }}
              className="space-y-3"
            >
              <Input
                type="url"
                inputMode="url"
                placeholder="https://www.yourlocalpaper.com/sports/…"
                value={newsUrl}
                onChange={(e) => setNewsUrl(e.target.value)}
                disabled={addingNews}
                autoFocus
                data-testid="input-news-url"
              />
              <div className="space-y-1.5">
                <label
                  htmlFor="input-news-game-date"
                  className="text-sm font-semibold"
                >
                  Game played on
                </label>
                <Input
                  id="input-news-game-date"
                  type="date"
                  value={newsGameDate}
                  onChange={(e) => setNewsGameDate(e.target.value)}
                  disabled={addingNews}
                  className={
                    newsGameDate ? "text-foreground" : "text-muted-foreground"
                  }
                  data-testid="input-news-game-date"
                />
                <p className="text-xs text-muted-foreground">
                  Optional — leave blank for articles that are not about a
                  specific game.
                </p>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddNewsOpen(false)}
                  disabled={addingNews}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="brand"
                  disabled={addingNews || !newsUrl.trim()}
                  data-testid="btn-submit-news"
                >
                  {addingNews ? "Fetching article…" : "Add article"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
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
                const author = (
                  p as {
                    author?: {
                      id?: string;
                      displayName?: string;
                      avatarUrl?: string | null;
                    };
                  }
                ).author;
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
                const author = (
                  p as {
                    author?: {
                      id?: string;
                      displayName?: string;
                      avatarUrl?: string | null;
                    };
                  }
                ).author;
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
        <Card className="app-surface">
          <CardContent className="p-0">
            <EmptyState
              icon={<Newspaper className="h-5 w-5" />}
              title="No posts for this team yet."
              description={
                <>
                  {canPostHighlight && (
                    <span className="block">
                      Share the first highlight from this team.
                    </span>
                  )}
                  {canPostRecap && (
                    <span className="block mt-1">
                      Be the first to write a game recap.
                    </span>
                  )}
                </>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
          {/* Task #785 — auto-load older posts as the sentinel scrolls
              into view (replaces the "Load older posts" button). When
              a page fetch fails, auto-loading pauses and a manual
              retry button takes its place. */}
          {hasMorePosts &&
            (loadMorePostsFailed ? (
              <div className="flex flex-col items-center gap-2 py-3">
                <span className="text-xs text-muted-foreground">
                  Couldn't load older posts.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onLoadMorePosts}
                  disabled={isLoadingMorePosts}
                  data-testid="btn-retry-load-more-posts"
                >
                  Retry loading older posts
                </Button>
              </div>
            ) : (
              <div
                ref={loadMoreSentinelRef}
                className="flex justify-center py-3"
                data-testid="sentinel-load-more-posts"
              >
                {isLoadingMorePosts && (
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Loading older posts…
                  </span>
                )}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
