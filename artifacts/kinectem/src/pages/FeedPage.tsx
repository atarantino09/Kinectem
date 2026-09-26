import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatOrgName } from "@/lib/format";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, ChevronDown, Pin, PinOff, Medal, Building2, Sparkles } from "lucide-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  customFetch,
  useGetLoggedInUser,
  listFeed,
  useListUserOrganizations,
  useListUserTeams,
  queryOpts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UserAvatar, TeamAvatar } from "@/components/UserAvatar";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { PostCard } from "@/components/PostCard";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import { BrandPageHeader } from "@/components/BrandPageHeader";
import { ExploreReel } from "@/components/ExploreReel";
import { GameDaySpotlight } from "@/components/GameDaySpotlight";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import "./GameDayFeed.css";
import { usePinnedOrgs } from "@/hooks/usePinnedOrgs";
import { usePinnedTeams } from "@/hooks/usePinnedTeams";

type SidebarTeam = {
  id: string;
  name: string;
  logoUrl: string | null;
  orgName: string | null;
  // Real org id (null for independent/solo teams). Used to scope the per-org
  // pin cap even for orphan teams that aren't in the viewer's own org list.
  orgId: string | null;
};

type SidebarOrg = {
  id: string;
  name: string;
  logoUrl: string | null;
  teams: SidebarTeam[];
};

export default function FeedPage() {
  const [feedMode, setFeedMode] = useState<"following" | "explore">("following");
  const { data: me } = useGetLoggedInUser();
  const { data: myOrgs } = useListUserOrganizations(me?.id ?? "", undefined, {
    query: queryOpts({ enabled: !!me?.id }),
  });
  const { data: myTeams } = useListUserTeams(me?.id ?? "", undefined, {
    query: queryOpts({ enabled: !!me?.id }),
  });

  const {
    pinnedIds,
    isPinned: isOrgPinned,
    togglePin: toggleOrgPin,
  } = usePinnedOrgs();
  const {
    pinnedIds: pinnedTeamIds,
    isPinned: isTeamPinned,
    togglePin: toggleTeamPin,
  } = usePinnedTeams();

  // Followed competitions — quick-access sidebar links only. Intentionally
  // NOT a feed source (the home feed stays teams/orgs). Hand-written
  // customFetch route (openapi.yaml is locked).
  const followedCompsQ = useQuery({
    queryKey: ["my-followed-competitions"],
    queryFn: () =>
      customFetch<{
        data: Array<{
          id: string;
          slug: string;
          name: string;
          type: string;
          logoUrl: string | null;
        }>;
      }>("/api/v1/my/followed-competitions", { method: "GET" }),
    enabled: !!me?.id,
  });
  const followedComps = followedCompsQ.data?.data ?? [];

  // Followed organizer hubs — same quick-access-only semantics.
  const followedHubsQ = useQuery({
    queryKey: ["my-followed-organizers"],
    queryFn: () =>
      customFetch<{
        data: Array<{
          id: string;
          slug: string;
          name: string;
          logoUrl: string | null;
        }>;
      }>("/api/v1/my/followed-organizers", { method: "GET" }),
    enabled: !!me?.id,
  });
  const followedHubs = followedHubsQ.data?.data ?? [];

  const { orgGroups, orphanTeams } = useMemo(() => {
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    // Pinned teams float to the top of their group in the user's chosen pin
    // order; the rest stay A→Z.
    const teamPinRank = new Map(pinnedTeamIds.map((id, i) => [id, i]));
    const sortTeams = (arr: SidebarTeam[]) =>
      arr.slice().sort((a, b) => {
        const ra = teamPinRank.get(a.id);
        const rb = teamPinRank.get(b.id);
        if (ra !== undefined && rb !== undefined) return ra - rb;
        if (ra !== undefined) return -1;
        if (rb !== undefined) return 1;
        return byName(a, b);
      });
    const teamsByOrg = new Map<string, SidebarTeam[]>();
    // Task #628 — solo teams (tournament funnel) have no org; collect them
    // separately so they render in the org-less "orphan teams" group.
    const soloTeams: SidebarTeam[] = [];
    for (const t of myTeams?.data ?? []) {
      if (!t.organization) {
        soloTeams.push({
          id: t.teamId,
          name: t.teamName,
          logoUrl: t.teamAvatarUrl ?? null,
          orgName: null,
          orgId: null,
        });
        continue;
      }
      const arr = teamsByOrg.get(t.organization.id) ?? [];
      arr.push({
        id: t.teamId,
        name: t.teamName,
        logoUrl: t.teamAvatarUrl ?? null,
        orgName: t.organization.name,
        orgId: t.organization.id,
      });
      teamsByOrg.set(t.organization.id, arr);
    }
    const orgIds = new Set<string>();
    const orgGroups: SidebarOrg[] = (myOrgs?.data ?? []).map((org) => {
      orgIds.add(org.id);
      return {
        id: org.id,
        name: org.name,
        logoUrl: org.logoUrl ?? null,
        // Teams within each org: pinned first (pin order), rest A→Z.
        teams: sortTeams(teamsByOrg.get(org.id) ?? []),
      };
    });
    // Pinned orgs float to the top in the user's chosen pin order; the rest
    // follow alphabetically by name.
    const pinRank = new Map(pinnedIds.map((id, i) => [id, i]));
    orgGroups.sort((a, b) => {
      const ra = pinRank.get(a.id);
      const rb = pinRank.get(b.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return byName(a, b);
    });
    const orphanTeams: SidebarTeam[] = [];
    for (const [orgId, teams] of teamsByOrg) {
      if (!orgIds.has(orgId)) orphanTeams.push(...teams);
    }
    // Independent / orphan teams (incl. solo teams): pinned first, rest A→Z.
    const allOrphans = sortTeams([...orphanTeams, ...soloTeams]);
    return { orgGroups, orphanTeams: allOrphans };
  }, [myOrgs, myTeams, pinnedIds, pinnedTeamIds]);

  const hasSidebarItems = orgGroups.length > 0 || orphanTeams.length > 0;
  const [expandedOrgs, setExpandedOrgs] = useState<Record<string, boolean>>({});
  const toggleOrg = (orgId: string) =>
    setExpandedOrgs((prev) => ({ ...prev, [orgId]: !prev[orgId] }));
  // CODE_REVIEW F2 — cursor pagination. The /feed endpoint already
  // accepts cursor + limit, so consume it with useInfiniteQuery and
  // flatten the pages into one list. No generated infinite hook exists,
  // so build it on the raw `listFeed` fetcher.
  const FEED_PAGE_SIZE = 20;
  const {
    data: feedPages,
    isLoading: feedLoading,
    isError: feedError,
    refetch: retryFeed,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["/api/v1/feed", "infinite"] as const,
    queryFn: ({ pageParam }) =>
      listFeed({
        limit: FEED_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.nextCursor ?? undefined
        : undefined,
  });

  const posts = useMemo(
    () => feedPages?.pages.flatMap((p) => p.data) ?? [],
    [feedPages],
  );

  // CODE_REVIEW F1 — windowed feed. The page itself (not a nested
  // element) is the scroll container and the rails are sticky, so use
  // the window virtualizer offset by the list's distance from the top
  // of the document. A callback ref measures that offset the moment the
  // list mounts (it only renders once posts have loaded) and on resize.
  const heroRef = useRef<HTMLElement | null>(null);
  const listElRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const recomputeMargin = useCallback(() => {
    const node = listElRef.current;
    if (node) {
      setScrollMargin(node.getBoundingClientRect().top + window.scrollY);
    }
  }, []);
  const attachList = useCallback(
    (node: HTMLDivElement | null) => {
      listElRef.current = node;
      if (node) recomputeMargin();
    },
    [recomputeMargin],
  );
  useEffect(() => {
    window.addEventListener("resize", recomputeMargin);
    return () => window.removeEventListener("resize", recomputeMargin);
  }, [recomputeMargin]);
  useEffect(() => {
    if (!heroRef.current) return;
    const observer = new ResizeObserver(recomputeMargin);
    observer.observe(heroRef.current);
    return () => observer.disconnect();
  }, [recomputeMargin]);

  const virtualizer = useWindowVirtualizer({
    count: posts.length,
    estimateSize: () => 420,
    overscan: 4,
    scrollMargin,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // CODE_REVIEW F2 — infinite scroll: when the last windowed row is the
  // last loaded post, pull the next cursor page.
  const lastItemIndex = virtualItems.length
    ? virtualItems[virtualItems.length - 1].index
    : -1;
  useEffect(() => {
    if (
      lastItemIndex >= posts.length - 1 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage();
    }
  }, [
    lastItemIndex,
    posts.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);

  const displayName = me ? `${me.firstName} ${me.lastName}` : "";
  const [selectedSpotlightId, setSelectedSpotlightId] = useState<string | null>(null);
  const spotlightIndex = selectedSpotlightId && posts.some((post) => post.id === selectedSpotlightId)
    ? posts.findIndex((post) => post.id === selectedSpotlightId)
    : Math.max(0, posts.findIndex((post) => post.postType === "long" && post.assets?.some((asset) => asset.fileType?.startsWith("image/"))));
  const spotlight = posts[spotlightIndex];
  useEffect(() => {
    recomputeMargin();
  }, [spotlight?.id, recomputeMargin]);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousSpotlight = () => {
    if (spotlightIndex > 0) setSelectedSpotlightId(posts[spotlightIndex - 1].id);
  };
  const nextSpotlight = async () => {
    if (spotlightIndex + 1 < posts.length) {
      setSelectedSpotlightId(posts[spotlightIndex + 1].id);
    } else if (hasNextPage && !isFetchingNextPage) {
      const result = await fetchNextPage();
      const nextPosts = result.data?.pages.flatMap((page) => page.data) ?? [];
      if (nextPosts[spotlightIndex + 1]) setSelectedSpotlightId(nextPosts[spotlightIndex + 1].id);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[228px_minmax(0,1fr)_240px] gap-5">
      {/* Left sidebar */}
      <aside className="hidden lg:block lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100vh-4rem-1.5rem)] lg:overflow-y-auto space-y-4">
        {me && (
          <Card className="app-surface overflow-hidden">
            <div className="h-16 brand-gradient-cover relative">
              <div
                aria-hidden="true"
                className="brand-banner-pattern absolute inset-0 pointer-events-none"
              />
            </div>
            <CardContent className="p-4 -mt-8">
              <Link href={`/users/${me.id}`}>
                <UserAvatar
                  avatarUrl={me.avatarUrl}
                  displayName={displayName}
                  size="2xl"
                  className="border-4 border-card cursor-pointer"
                  fallbackClassName="bg-slate-100 text-slate-800"
                />
              </Link>
              <h3 className="font-black text-base tracking-tight mt-3">
                {displayName}
              </h3>
              {me.bio && (
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-3">
                  {me.bio}
                </p>
              )}
              <Link href={`/users/${me.id}`}>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-4 font-bold"
                >
                  View Profile
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {hasSidebarItems && (
          <Card className="app-surface">
            <CardContent className="p-4">
              <h4 className="app-section-heading mb-3 text-muted-foreground">
                Your Orgs and Teams
              </h4>
              <div className="space-y-1">
                {orgGroups.map((org) => {
                  const hasTeams = org.teams.length > 0;
                  const isExpanded = !!expandedOrgs[org.id];
                  return (
                    <div key={org.id}>
                      <OrgLinkRow
                        orgId={org.id}
                        orgName={org.name}
                        orgLogoUrl={org.logoUrl}
                        hasTeams={hasTeams}
                        isExpanded={isExpanded}
                        onToggle={() => toggleOrg(org.id)}
                        isPinned={isOrgPinned(org.id)}
                        onTogglePin={() => toggleOrgPin(org.id)}
                      />
                      {hasTeams && isExpanded && (
                        <div className="ml-5 mt-1 mb-2 border-l-2 border-border pl-3 space-y-0.5">
                          {org.teams.map((t) => (
                            <TeamLinkRow
                              key={t.id}
                              teamId={t.id}
                              teamName={t.name}
                              teamLogoUrl={t.logoUrl}
                              hideAvatar
                              isPinned={isTeamPinned(t.id)}
                              onTogglePin={() =>
                                toggleTeamPin(
                                  t.id,
                                  org.teams.map((x) => x.id),
                                )
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {orphanTeams.length > 0 && (
                  <div className="space-y-0.5">
                    {orphanTeams.map((t) => (
                      <TeamLinkRow
                        key={t.id}
                        teamId={t.id}
                        teamName={t.name}
                        teamLogoUrl={t.logoUrl}
                        subtitle={
                          t.orgName ? formatOrgName(t.orgName) : "Independent team"
                        }
                        isPinned={isTeamPinned(t.id)}
                        onTogglePin={() =>
                          toggleTeamPin(
                            t.id,
                            orphanTeams
                              .filter((x) => x.orgId === t.orgId)
                              .map((x) => x.id),
                          )
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {followedComps.length > 0 && (
          <Card className="app-surface">
            <CardContent className="p-4">
              <h4 className="app-section-heading mb-3 text-muted-foreground">
                Competitions You Follow
              </h4>
              <div className="space-y-0.5">
                {followedComps.map((comp) => (
                  <Link
                    key={comp.id}
                    href={`/competitions/c/${encodeURIComponent(comp.slug)}`}
                  >
                    <div
                      className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-muted/60 cursor-pointer"
                      data-testid={`link-sidebar-competition-${comp.id}`}
                    >
                      {comp.logoUrl ? (
                        <img
                          src={comp.logoUrl}
                          alt=""
                          className="w-7 h-7 rounded-md object-contain bg-muted shrink-0"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                          <Medal className="w-4 h-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{comp.name}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          {comp.type === "league" ? "League" : "Tournament"}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {followedHubs.length > 0 && (
          <Card className="app-surface">
            <CardContent className="p-4">
              <h4 className="app-section-heading mb-3 text-muted-foreground">
                Hubs You Follow
              </h4>
              <div className="space-y-0.5">
                {followedHubs.map((hub) => (
                  <Link
                    key={hub.id}
                    href={`/competitions/o/${encodeURIComponent(hub.slug)}`}
                  >
                    <div
                      className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-muted/60 cursor-pointer"
                      data-testid={`link-sidebar-organizer-${hub.id}`}
                    >
                      {hub.logoUrl ? (
                        <img
                          src={hub.logoUrl}
                          alt=""
                          className="w-7 h-7 rounded-md object-contain bg-muted shrink-0"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                          <Building2 className="w-4 h-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{hub.name}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          Competition hub
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </aside>

      {/* Center feed */}
      <div className="space-y-4 min-w-0">
        <section ref={heroRef} className="game-day-hero" aria-label="Game day together">
        <div className="game-day-intro">
          <div>
            <span className="game-day-eyebrow"><Sparkles size={13} /> Your community pulse</span>
            <h1>Game day, <span>together.</span></h1>
            <p>Recaps, highlights, and the moments your teams will talk about all week.</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0 gap-1 font-bold" aria-label={`Feed view: ${feedMode === "following" ? "Following" : "Explore"}`}>
                {feedMode === "following" ? "Following" : "Explore"} <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setFeedMode("following")}>Following · Latest</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFeedMode("explore")}>Explore · Stories</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {feedMode === "explore" ? <ExploreReel active /> : spotlight && <>
          {(posts.length > 1 || hasNextPage) && (
            <nav className="game-day-spotlight-nav" aria-label="Spotlight posts">
              <span data-testid="text-spotlight-position">Post {spotlightIndex + 1} of {posts.length}{hasNextPage ? "+" : ""}</span>
              <div className="game-day-spotlight-actions">
                <Button variant="outline" size="sm" onClick={previousSpotlight} disabled={spotlightIndex === 0} aria-label="Previous post" data-testid="button-previous-spotlight"><ChevronLeft size={16} /> Previous</Button>
                <Button variant="outline" size="sm" onClick={() => void nextSpotlight()} disabled={(spotlightIndex === posts.length - 1 && !hasNextPage) || isFetchingNextPage} aria-label="Next post" data-testid="button-next-spotlight">Next post <ChevronRight size={16} /></Button>
              </div>
            </nav>
          )}
          <div className="game-day-spotlight-stage"
            onTouchStart={(event) => { touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
            onTouchEnd={(event) => {
              if (!touchStart.current) return;
              const dx = event.changedTouches[0].clientX - touchStart.current.x;
              const dy = event.changedTouches[0].clientY - touchStart.current.y;
              touchStart.current = null;
              if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
                if (dx < 0) void nextSpotlight();
                else previousSpotlight();
              }
            }}>
            <GameDaySpotlight key={spotlight.id} post={spotlight} />
          </div>
        </>}
        </section>
        <div className="game-day-feed-heading">
          <div><span className="game-day-eyebrow">Keep up with your teams</span><h2>Latest activity</h2></div>
        </div>
        {feedError ? (
          <div role="alert" className="app-surface rounded-xl p-6 text-center space-y-3">
            <p>Couldn't load your feed.</p>
            <Button variant="outline" onClick={() => void retryFeed()}>Try again</Button>
          </div>
        ) : feedLoading ? (
          <>
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </>
        ) : posts.length === 0 ? (
          <SuggestionsPanel />
        ) : (
          <>
            <div
              ref={attachList}
              style={{
                height: virtualizer.getTotalSize(),
                position: "relative",
                width: "100%",
              }}
            >
              {virtualItems.map((item) => {
                const post = posts[item.index];
                return (
                  <div
                    key={post.id}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start - scrollMargin}px)`,
                    }}
                  >
                    <div className="pb-4">
                      <PostCard post={post} />
                    </div>
                  </div>
                );
              })}
            </div>
            {isFetchingNextPage && <Skeleton className="h-48 rounded-xl" />}
          </>
        )}
      </div>

      {/* Right sidebar: three single-type "to follow" cards */}
      <aside className="hidden lg:block lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100vh-4rem-1.5rem)] lg:overflow-y-auto space-y-4">
        <SuggestionsPanel
          variant="compact"
          section="users"
          heading="People to follow"
          perSectionLimit={3}
          hideWhenEmpty
        />
        <SuggestionsPanel
          variant="compact"
          section="organizations"
          heading="Organizations to follow"
          perSectionLimit={3}
          hideWhenEmpty
        />
        <SuggestionsPanel
          variant="compact"
          section="teams"
          heading="Teams to follow"
          perSectionLimit={3}
          hideWhenEmpty
        />
        <SuggestionsPanel
          variant="compact"
          section="competitions"
          heading="Competitions to follow"
          perSectionLimit={3}
          hideWhenEmpty
        />
      </aside>
    </div>
  );
}

function OrgLinkRow({
  orgId,
  orgName,
  orgLogoUrl,
  hasTeams,
  isExpanded,
  onToggle,
  isPinned,
  onTogglePin,
}: {
  orgId: string;
  orgName: string;
  orgLogoUrl: string | null;
  hasTeams: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}) {
  return (
    <div className="group w-full flex items-center gap-1 py-1.5 px-1 rounded-md hover:bg-muted/50">
      {hasTeams ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={isExpanded ? `Collapse ${orgName}` : `Expand ${orgName}`}
          aria-expanded={isExpanded}
          data-testid={`toggle-org-${orgId}`}
          className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground"
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>
      ) : (
        <span className="shrink-0 w-[18px]" aria-hidden="true" />
      )}
      <Link
        href={`/organizations/${orgId}`}
        data-testid={`link-org-${orgId}`}
        className="flex-1 min-w-0"
      >
        <div className="flex items-center gap-2 text-sm font-semibold hover:text-primary cursor-pointer">
          <OrgLogo
            logoUrl={orgLogoUrl}
            name={orgName}
            className="w-5 h-5 rounded-lg shrink-0"
            imgClassName="w-5 h-5 rounded-lg object-cover shrink-0"
          />
          <span className="truncate flex-1">{formatOrgName(orgName)}</span>
        </div>
      </Link>
      {onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={isPinned ? `Unpin ${orgName}` : `Pin ${orgName}`}
          aria-pressed={isPinned}
          data-testid={`pin-org-${orgId}`}
          className={
            isPinned
              ? "shrink-0 p-0.5 rounded text-primary hover:bg-muted"
              : "shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted opacity-0 group-hover:opacity-100 focus:opacity-100"
          }
        >
          {isPinned ? (
            <PinOff className="w-3.5 h-3.5" />
          ) : (
            <Pin className="w-3.5 h-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

function TeamLinkRow({
  teamId,
  teamName,
  teamLogoUrl,
  subtitle,
  hideAvatar,
  isPinned,
  onTogglePin,
}: {
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  subtitle?: string;
  hideAvatar?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
}) {
  return (
    <div className="group flex items-center gap-1 py-1.5 px-1.5 rounded-md hover:bg-muted/50">
      <Link
        href={`/teams/${teamId}`}
        data-testid={`link-team-${teamId}`}
        className="flex-1 min-w-0"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary cursor-pointer">
          {!hideAvatar && (
            <TeamAvatar
              avatarUrl={teamLogoUrl}
              displayName={teamName}
              size="xs"
              rounded="lg"
              className="w-5 h-5 shrink-0"
              fallbackClassName="bg-muted text-muted-foreground"
            />
          )}
          <span className="truncate flex-1 min-w-0">
            <span className="truncate">{teamName}</span>
            {subtitle && (
              <span className="ml-1 text-[10px] font-medium text-muted-foreground/80">
                · {subtitle}
              </span>
            )}
          </span>
        </div>
      </Link>
      {onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={isPinned ? `Unpin ${teamName}` : `Pin ${teamName}`}
          aria-pressed={isPinned}
          data-testid={`pin-team-${teamId}`}
          className={
            isPinned
              ? "shrink-0 p-0.5 rounded text-primary hover:bg-muted"
              : "shrink-0 p-0.5 rounded text-muted-foreground hover:bg-muted opacity-0 group-hover:opacity-100 focus:opacity-100"
          }
        >
          {isPinned ? (
            <PinOff className="w-3.5 h-3.5" />
          ) : (
            <Pin className="w-3.5 h-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

