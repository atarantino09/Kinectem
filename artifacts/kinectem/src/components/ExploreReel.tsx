import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, getListFeedQueryKey, useFollowOrg, useFollowTeam, useGetLoggedInUser, type PostResponse } from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, Compass, Sparkles } from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-errors";
import { SPORTS } from "@/lib/sports";
import { US_STATES } from "@/lib/usStates";

export const EXPLORE_QUERY_KEY = ["/api/v1/posts/explore"] as const;

type ExploreItem = {
  post: PostResponse;
  teamId: string;
  orgId: string | null;
  teamName: string;
  orgName: string | null;
};
type ExploreResponse = {
  data: ExploreItem[];
  pagination: { hasMore: boolean; nextCursor: string | null };
  reason?: string | null;
};

export function ExploreReel({ active }: { active: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const followTeam = useFollowTeam();
  const followOrg = useFollowOrg();
  const { data: me } = useGetLoggedInUser();
  const [sport, setSport] = useState("");
  const [stateOverride, setStateOverride] = useState<string | null>(null);
  const profileState = US_STATES.find(({ code, name }) =>
    code.toLowerCase() === me?.state?.trim().toLowerCase() ||
    name.toLowerCase() === me?.state?.trim().toLowerCase(),
  )?.code ?? "";
  const state = stateOverride ?? profileState;
  const stateName = US_STATES.find((option) => option.code === state)?.name;
  const [index, setIndex] = useState(0);
  const [excludedSources, setExcludedSources] = useState<string[]>([]);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const { data, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: [...EXPLORE_QUERY_KEY, state, sport],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "8", state });
      if (sport) params.set("sport", sport);
      if (pageParam) params.set("cursor", pageParam);
      return customFetch<ExploreResponse>(`/api/v1/posts/explore?${params}`, { method: "GET" });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.pagination.hasMore ? page.pagination.nextCursor ?? undefined : undefined,
    enabled: active && !!state,
  });
  const items = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data]);
  const visibleItems = useMemo(() => items.filter(({ teamId, orgId }) =>
    !excludedSources.includes(`team:${teamId}`) && (!orgId || !excludedSources.includes(`org:${orgId}`)),
  ), [items, excludedSources]);
  const currentIndex = Math.min(index, Math.max(visibleItems.length - 1, 0));
  const current = visibleItems[currentIndex];
  const next = useCallback(() => {
    if (currentIndex + 1 < visibleItems.length) {
      setIndex(currentIndex + 1);
    } else if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage().then((result) => {
        if ((result.data?.pages.flatMap((page) => page.data).length ?? 0) > items.length) {
          setIndex(currentIndex + 1);
        }
      });
    }
  }, [currentIndex, visibleItems.length, hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);
  const previous = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable) return;
      if (event.key === "ArrowRight") { event.preventDefault(); next(); }
      if (event.key === "ArrowLeft") { event.preventDefault(); previous(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, next, previous]);

  const follow = async (kind: "team" | "org") => {
    if (!current) return;
    const source = kind === "team" ? `team:${current.teamId}` : `org:${current.orgId}`;
    try {
      if (kind === "team") await followTeam.mutateAsync({ teamId: current.teamId });
      else if (current.orgId) await followOrg.mutateAsync({ orgId: current.orgId });
      setExcludedSources((prev) => [...prev, source]);
      void Promise.all([
        qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
        qc.invalidateQueries({ queryKey: EXPLORE_QUERY_KEY }),
      ]);
      toast({ title: `Following ${kind === "team" ? current.teamName : current.orgName}` });
    } catch (err) {
      toast({ title: "Couldn't follow", description: apiErrorMessage(err) ?? "Please try again.", variant: "destructive" });
    }
  };

  const filters = <div className="app-surface rounded-xl p-4 space-y-3" aria-label="Explore filters">
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <label htmlFor="explore-sport" className="block text-xs font-bold text-muted-foreground">Sport</label>
        <select
          id="explore-sport"
          value={sport}
          onChange={(event) => {
            setSport(event.target.value);
            setIndex(0);
            setExcludedSources([]);
          }}
          className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <option value="">All sports</option>
          {SPORTS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
      <div className="min-w-0 space-y-1">
        <label htmlFor="explore-state" className="block text-xs font-bold text-muted-foreground">State</label>
        <select
          id="explore-state"
          value={state}
          onChange={(event) => {
            setStateOverride(event.target.value);
            setIndex(0);
            setExcludedSources([]);
          }}
          className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <option value="">Choose a state</option>
          {US_STATES.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
        </select>
      </div>
    </div>
    <p className="text-xs text-muted-foreground" data-testid="explore-filter-summary">
      {stateName ? `Showing ${sport || "all sports"} in ${stateName}` : "Choose a state to find public stories."}
    </p>
  </div>;

  if (!state) return <div className="space-y-3">{filters}</div>;
  if (isLoading) return <div className="space-y-3">{filters}<div aria-label="Loading Explore stories" className="space-y-3"><Skeleton className="h-12 rounded-xl" /><Skeleton className="h-96 rounded-xl" /></div></div>;
  if (isError) return <div className="space-y-3">{filters}<div role="alert" className="app-surface rounded-xl p-8 text-center space-y-3">
    <p>Explore stories couldn't load. {apiErrorMessage(error) ?? ""}</p>
    <Button variant="outline" onClick={() => void refetch()}>Try again</Button>
  </div></div>;
  if (!current) return <div className="space-y-3">{filters}<div className="app-surface rounded-xl p-8 text-center space-y-3">
    <Compass className="mx-auto h-8 w-8 text-primary" />
    <h2 className="game-day-empty-heading font-black text-xl">No stories to explore yet</h2>
    <p className="text-sm text-muted-foreground">There are no new public recaps or highlights for {sport || "any sport"} in {stateName}. Try another sport or state.</p>
  </div></div>;

  return <div className="space-y-3">{filters}<section aria-label="Explore stories" className="space-y-4">
    <div className="app-surface rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="game-day-eyebrow"><Sparkles size={13} /> Discover your next team</p>
        <h2 className="font-black text-lg mt-1">Explore <span className="text-muted-foreground font-medium text-xs ml-1">Story {currentIndex + 1}{hasNextPage ? "+" : ` of ${visibleItems.length}`}</span></h2>
      </div>
      <div className="flex gap-2">
        <Button size="icon" variant="outline" onClick={previous} disabled={currentIndex === 0} aria-label="Previous story"><ArrowLeft size={16} /></Button>
        <Button size="icon" variant="outline" onClick={next} disabled={(currentIndex >= visibleItems.length - 1 && !hasNextPage) || isFetchingNextPage} aria-label="Next story"><ArrowRight size={16} /></Button>
      </div>
    </div>
    <div className="game-day-explore-stage space-y-3" onTouchStart={(e) => { touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={(e) => {
        if (!touchStart.current) return;
        const dx = e.changedTouches[0].clientX - touchStart.current.x;
        const dy = e.changedTouches[0].clientY - touchStart.current.y;
        touchStart.current = null;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) { if (dx < 0) next(); else previous(); }
      }}>
      <div className="app-surface rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">From a team you haven't followed</p>
          <p className="font-bold text-sm truncate">{current.teamName}{current.orgName ? ` · ${current.orgName}` : ""}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={followTeam.isPending || followOrg.isPending} onClick={() => void follow("team")}>Follow team</Button>
          {current.orgId && <Button size="sm" variant="outline" disabled={followTeam.isPending || followOrg.isPending} onClick={() => void follow("org")}>Follow org</Button>}
        </div>
      </div>
      <PostCard key={current.post.id} post={current.post} />
    </div>
    <p className="text-center text-xs text-muted-foreground sm:hidden">Swipe left or right for another story. No autoplay.</p>
    {isFetchingNextPage && <p className="text-center text-sm text-muted-foreground">Loading more stories…</p>}
    {!hasNextPage && currentIndex === visibleItems.length - 1 && <p className="text-center text-sm text-muted-foreground">You're all caught up.</p>}
  </section></div>;
}