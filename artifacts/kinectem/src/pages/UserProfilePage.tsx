import { useState, useMemo, type ReactNode } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import {
  useGetUserById,
  useGetUserSports,
  getGetUserSportsQueryKey,
  useGetLoggedInUser,
  useListUserChildren,
  getListUserChildrenQueryKey,
  listUserPosts,
  getListUserPostsQueryKey,
  useListUserOrganizations,
  useListUserTeams,
  useFollowUser,
  useUnfollowUser,
  useCreateConversation,
  getGetUserByIdQueryKey,
  getListFeedQueryKey,
  getListConversationsQueryKey,
  getGetUnreadMessageCountQueryKey,
  type PrivateUserResponse,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { linkify } from "@/lib/linkify";
import { friendlyAgeLabel, formatOrgName } from "@/lib/format";
import { useIsLg } from "@/hooks/use-mobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar, TeamAvatar } from "@/components/UserAvatar";
import { usePinnedTeams } from "@/hooks/usePinnedTeams";
import { PinTeamButton, PinnedSectionLabel } from "@/components/PinTeamButton";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { NoIndex } from "@/components/NoIndex";
import {
  Building2,
  Cake,
  ChevronDown,
  FileText,
  MapPin,
  MessageSquare,
  Play,
  Shield,
  Tag,
  Trophy,
  Users,
} from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { FollowListDialog } from "@/components/FollowListDialog";
import { AvatarLightbox } from "@/components/AvatarLightbox";
import { useInfiniteScrollSentinel } from "@/hooks/useInfiniteScrollSentinel";
import { EmptyState } from "@/components/EmptyState";
import { InviteFamilyContactDialog } from "@/components/guardian-page/InviteFamilyContactDialog";

export default function UserProfilePage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const [followersOpen, setFollowersOpen] = useState(false);
  const [followingOpen, setFollowingOpen] = useState(false);
  const [familyInviteOpen, setFamilyInviteOpen] = useState(false);
  const isLg = useIsLg();
  const { data: user, isLoading } = useGetUserById(userId);
  const { data: me } = useGetLoggedInUser();
  const { data: myChildren } = useListUserChildren(me?.id ?? "", {
    query: { enabled: !!me?.id, queryKey: getListUserChildrenQueryKey(me?.id ?? "") },
  });
  // Task #500 — sports list. The endpoint is self-only (returns 403 for
  // strangers), so we only enable the query when viewing your own
  // profile to avoid a guaranteed-failed request. If product later wants
  // sports public to anyone who can see the profile, the spec needs to
  // open this endpoint up — out of scope here.
  const { data: sportsResp } = useGetUserSports(userId, {
    query: {
      queryKey: getGetUserSportsQueryKey(userId),
      enabled: !!userId && user?.isOwnProfile === true,
    },
  });
  const userSports = sportsResp?.sports ?? [];
  // Task #785 — infinite scroll. The endpoint now honors cursor +
  // limit, so consume it with useInfiniteQuery (no generated infinite
  // hook exists — build on the raw `listUserPosts` fetcher). The key
  // extends the generated one so existing invalidations still hit it.
  const USER_POSTS_PAGE_SIZE = 20;
  const {
    data: postPages,
    fetchNextPage: fetchMorePosts,
    hasNextPage: hasMorePosts,
    isFetchingNextPage: isFetchingMorePosts,
    isFetchNextPageError: fetchMorePostsFailed,
  } = useInfiniteQuery({
    queryKey: [...getListUserPostsQueryKey(userId), "infinite"] as const,
    queryFn: ({ pageParam }) =>
      listUserPosts(userId, {
        limit: USER_POSTS_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? (lastPage.pagination.nextCursor ?? undefined)
        : undefined,
    enabled: !!userId,
  });
  const postsSentinelRef = useInfiniteScrollSentinel({
    hasMore: !!hasMorePosts,
    isLoading: isFetchingMorePosts,
    hasError: fetchMorePostsFailed,
    onLoadMore: fetchMorePosts,
  });
  const { data: orgsResp } = useListUserOrganizations(userId);
  const { data: teamsResp } = useListUserTeams(userId);
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const followUser = useFollowUser();
  const unfollowUser = useUnfollowUser();
  const startConversation = useCreateConversation();
  const {
    pinnedSet,
    pinnedIds,
    togglePin,
    enabled: pinEnabled,
  } = usePinnedTeams();
  const onToggleFollow = async () => {
    if (!user) return;
    try {
      // Task #520 — `followRequestPending` means we already have a
      // pending row on a private account. Unfollow deletes any row
      // regardless of moderationStatus, so reuse it as the "cancel
      // request" action.
      const hasEdge =
        user.isFollowing ||
        Boolean(
          (user as { followRequestPending?: boolean }).followRequestPending,
        );
      if (hasEdge) {
        await unfollowUser.mutateAsync({ userId });
      } else {
        await followUser.mutateAsync({ userId });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetUserByIdQueryKey(userId) }),
        qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
      ]);
    } catch {
      toast({ title: "Couldn't update follow", variant: "destructive" });
    }
  };
  const onMessage = async () => {
    try {
      const conv = await startConversation.mutateAsync({
        data: { recipientType: "user", recipientId: userId },
      });
      qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetUnreadMessageCountQueryKey() });
      setLocation(`/messages/${conv.id}`);
    } catch {
      toast({
        title: "Couldn't open conversation",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    }
  };

  const allPosts = useMemo(
    () => postPages?.pages.flatMap((p) => p.data) ?? [],
    [postPages],
  );
  // The team filter stays client-side (the locked spec has no team
  // param on this endpoint); it filters whatever pages are loaded, and
  // the sentinel keeps pulling older pages so matches keep appearing.
  const posts = useMemo(() => {
    if (teamFilter === "all") return allPosts;
    return allPosts.filter(
      (p) => p.context?.type === "team" && p.context.id === teamFilter,
    );
  }, [allPosts, teamFilter]);

  if (isLoading || !user) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const displayName = `${user.firstName} ${user.lastName}`;
  // `isOwnProfile` is server-derived from the authenticated session. Keep
  // the id check here as an extra guard so a linked guardian viewing a
  // child's profile never receives the child's authoring action.
  const canPostProfileHighlight =
    user.isOwnProfile === true && me?.id === userId;
  const orgs = orgsResp?.data ?? [];
  const teams = teamsResp?.data ?? [];
  // Pinned teams (the viewer's own personalization) float to the top, in
  // pin order. Toggles only show on the viewer's own profile.
  const canTogglePins = user.isOwnProfile === true && pinEnabled;
  const pinnedOrder = new Map(pinnedIds.map((id, i) => [id, i] as const));
  const teamsSorted = [...teams].sort((a, b) => {
    const ap = pinnedSet.has(a.teamId);
    const bp = pinnedSet.has(b.teamId);
    if (ap && bp) {
      return (
        (pinnedOrder.get(a.teamId) ?? 0) - (pinnedOrder.get(b.teamId) ?? 0)
      );
    }
    if (ap) return -1;
    if (bp) return 1;
    return 0;
  });
  const pinnedTeamCount = teamsSorted.filter((t) =>
    pinnedSet.has(t.teamId),
  ).length;
  // Server returns the private response (with `parentId`) when the viewer
  // is the linked parent, so the simple comparison below is sufficient.
  const isParentOfThisUser =
    !!me && "parentId" in user && !!user.parentId && user.parentId === me.id;
  const isActiveGuardianOfThisUser = (myChildren?.data ?? []).some(
    (link) => link.child.id === userId && link.status === "active",
  );

  // Pre-render the per-section item arrays so the same content can be
  // dropped into the right rail (lg+) or inline below the hero (mobile).
  const linked = (
    user as {
      linkedAccounts?: {
        parents?: Array<{
          id: string;
          firstName: string;
          lastName: string;
          role: string;
          avatarUrl: string | null;
        }>;
        children?: Array<{
          id: string;
          firstName: string;
          lastName: string;
          role: string;
          avatarUrl: string | null;
        }>;
      };
    }
  ).linkedAccounts;
  const parents = linked?.parents ?? [];
  const childAccounts = linked?.children ?? [];
  const family = [
    ...parents.map((p) => ({ ...p, relation: "Parent / Guardian" as const })),
    ...childAccounts.map((c) => ({ ...c, relation: "Child" as const })),
  ];

  const orgItems: ReactNode[] = orgs.map((org) => (
    <Link key={org.id} href={`/organizations/${org.id}`}>
      <Card className="app-surface app-surface-interactive cursor-pointer">
        <CardContent className="p-4 flex items-center gap-3">
          <OrgLogo
            logoUrl={org.logoUrl}
            name={org.name}
            className="w-10 h-10 rounded-lg shrink-0"
            imgClassName="w-10 h-10 rounded-lg object-cover bg-muted shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm truncate">
              {formatOrgName(org.name)}
            </p>
            {org.role && (
              <Badge
                variant="outline"
                className="mt-1 text-[10px] uppercase tracking-wider font-bold"
              >
                {org.role}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  ));

  // Team ids grouped by org (independent/solo teams share one bucket) so the
  // per-org pin cap can be scoped when toggling.
  const teamIdsByBucket = new Map<string, string[]>();
  for (const t of teams) {
    const bucket = t.organization?.id ?? "__independent__";
    const arr = teamIdsByBucket.get(bucket) ?? [];
    arr.push(t.teamId);
    teamIdsByBucket.set(bucket, arr);
  }
  const teamItems: ReactNode[] = teamsSorted.map((t) => {
    const isPending = t.status === "pending";
    return (
      <Link key={t.id} href={`/teams/${t.teamId}`}>
        <Card
          className="app-surface app-surface-interactive cursor-pointer"
          data-testid={`card-team-${t.teamId}`}
        >
          <CardContent className="p-4 flex items-center gap-3">
            {/* Square team avatar: shows the team's editable banner when set
                and falls back to the team's initials — mirrors the
                Organizations/Family cards and avoids an empty placeholder. */}
            <TeamAvatar
              avatarUrl={t.teamBannerUrl}
              displayName={t.teamName}
              size="xl"
              rounded="lg"
              className="shrink-0"
              data-testid={`img-profile-team-banner-${t.teamId}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 min-w-0">
                <p className="font-bold text-sm truncate">{t.teamName}</p>
                <span
                  className="text-xs font-bold text-muted-foreground shrink-0"
                  data-testid={`text-team-jersey-${t.teamId}`}
                >
                  {t.jerseyNumber ? `#${t.jerseyNumber}` : "—"}
                </span>
              </div>
              <p
                className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground truncate mt-0.5"
                data-testid={`text-team-org-${t.teamId}`}
              >
                {t.organization
                  ? formatOrgName(t.organization.name)
                  : "Independent team"}
              </p>
              {(t.position === "parent" || isPending) && (
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {t.position === "parent" && (
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase tracking-wider font-bold"
                      data-testid={`badge-team-parent-${t.teamId}`}
                    >
                      Parent
                    </Badge>
                  )}
                  {isPending && (
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase tracking-wider font-bold border-amber-500 text-amber-700 dark:text-amber-400"
                      data-testid={`badge-team-pending-${t.teamId}`}
                    >
                      Pending
                    </Badge>
                  )}
                </div>
              )}
            </div>
            {canTogglePins && (
              <PinTeamButton
                teamId={t.teamId}
                pinned={pinnedSet.has(t.teamId)}
                onToggle={(id) =>
                  togglePin(
                    id,
                    teamIdsByBucket.get(
                      t.organization?.id ?? "__independent__",
                    ) ?? [],
                  )
                }
              />
            )}
          </CardContent>
        </Card>
      </Link>
    );
  });

  const familyItems: ReactNode[] = family.map((m) => {
    const name = `${m.firstName} ${m.lastName}`.trim();
    return (
      <Link key={`${m.relation}-${m.id}`} href={`/users/${m.id}`}>
        <Card
          className="app-surface app-surface-interactive cursor-pointer"
          data-testid={`card-linked-${m.id}`}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <UserAvatar
              avatarUrl={m.avatarUrl}
              displayName={name}
              size="lg"
              fallbackClassName="bg-slate-900 text-primary-foreground font-black"
            />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm truncate">{name}</p>
              <Badge
                variant="outline"
                className="mt-1 text-[10px] uppercase tracking-wider font-bold"
              >
                {m.relation}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  });

  const hasAnyAffiliation =
    orgItems.length > 0 || teamItems.length > 0 || familyItems.length > 0;

  const affiliationsStack = hasAnyAffiliation ? (
    <div className="flex flex-col gap-4">
      {orgItems.length > 0 && (
        <AffiliationColumn
          title="Organizations"
          icon={<Building2 className="w-5 h-5 text-primary" />}
          testId="orgs"
          items={orgItems}
          previewCount={7}
        />
      )}
      {teamItems.length > 0 && (
        <AffiliationColumn
          title="Teams"
          icon={<Shield className="w-5 h-5 text-primary" />}
          testId="teams"
          items={teamItems}
          pinnedCount={canTogglePins ? pinnedTeamCount : 0}
        />
      )}
      {familyItems.length > 0 && (
        <AffiliationColumn
          title="Family"
          icon={<Users className="w-5 h-5 text-primary" />}
          testId="family"
          items={familyItems}
        />
      )}
    </div>
  ) : null;

  return (
    <div
      className={`grid min-w-0 grid-cols-1 ${
        hasAnyAffiliation ? "lg:grid-cols-[minmax(0,1fr)_340px]" : ""
      } gap-6 lg:gap-8 items-start`}
    >
      {/* Task #367 — minor profile pages must not be search-indexed.
          The API also sets X-Robots-Tag, but the SPA shell may render
          the page from the static index.html before the API call
          completes. */}
      {(user as { isMinor?: boolean }).isMinor ? <NoIndex /> : null}
      {isActiveGuardianOfThisUser && <InviteFamilyContactDialog childId={userId} childName={user.firstName} open={familyInviteOpen} onOpenChange={setFamilyInviteOpen} />}
      <div className="space-y-6 lg:space-y-8 min-w-0">
        {/* Hero */}
        <div className="app-surface overflow-hidden">
          <div className="h-32 brand-gradient-cover relative">
            {user.coverPhotoUrl ? (
              <img
                src={user.coverPhotoUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="brand-banner-pattern absolute inset-0 pointer-events-none"
              />
            )}
          </div>
          <div className="px-4 pb-5 sm:px-6 sm:pb-6 -mt-16">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <AvatarLightbox
                avatarUrl={user.avatarUrl}
                displayName={displayName}
                triggerTestId="btn-open-avatar-lightbox"
                dialogTestId="dialog-avatar-lightbox"
                imageTestId="img-avatar-lightbox"
              >
                <UserAvatar
                  avatarUrl={user.avatarUrl}
                  displayName={displayName}
                  size="4xl"
                  className={`border-4 border-card shadow-lg ${user.avatarUrl ? "cursor-pointer" : ""}`}
                  fallbackClassName="bg-slate-900 text-primary-foreground font-black"
                />
              </AvatarLightbox>
              {user.isOwnProfile && "email" in user ? (
                <div className="mt-24 flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
                  <Link href="/me/tags">
                    <Button
                      variant="outline"
                      className="font-bold rounded-full"
                      data-testid="link-manage-tags"
                    >
                      <Tag className="w-4 h-4 mr-1.5" />
                      Manage Tags
                    </Button>
                  </Link>
                  <EditProfileDialog user={user as PrivateUserResponse} />
                </div>
              ) : isActiveGuardianOfThisUser || isParentOfThisUser ? (
                <div
                  className="mt-24 flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap"
                  data-testid="parent-actions"
                >
                  {isParentOfThisUser && <EditProfileDialog user={user as PrivateUserResponse} />}
                  {isActiveGuardianOfThisUser && <Button variant="outline" className="font-bold rounded-full" onClick={() => setFamilyInviteOpen(true)} data-testid={`button-invite-family-profile-${userId}`}>Invite family contact</Button>}
                </div>
              ) : (
                <div className="mt-24 flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
                  <Button
                    variant="outline"
                    className="font-bold rounded-full"
                    onClick={onMessage}
                    disabled={startConversation.isPending}
                    data-testid="btn-message-user"
                  >
                    <MessageSquare className="w-4 h-4 mr-1.5" />
                    Message
                  </Button>
                  <Button
                    variant="brand"
                    onClick={onToggleFollow}
                    disabled={followUser.isPending || unfollowUser.isPending}
                    data-testid="btn-follow-user"
                  >
                    {user.isFollowing
                      ? "Following"
                      : (user as { followRequestPending?: boolean })
                            .followRequestPending
                        ? "Requested"
                        : "Follow"}
                  </Button>
                </div>
              )}
            </div>
            <div className="mt-2 min-w-0">
              <h1 className="text-3xl sm:text-4xl font-black tracking-tight leading-[1.05] [overflow-wrap:anywhere]">
                {displayName}
              </h1>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2">
                <button
                  type="button"
                  onClick={() => setFollowersOpen(true)}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground"
                  data-testid="btn-view-user-followers"
                >
                  <span className="font-black text-foreground">
                    {(user as { followerCount?: number }).followerCount ?? 0}
                  </span>{" "}
                  Followers
                </button>
                <button
                  type="button"
                  onClick={() => setFollowingOpen(true)}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground"
                  data-testid="btn-view-user-following"
                >
                  <span className="font-black text-foreground">
                    {(user as { followingCount?: number }).followingCount ?? 0}
                  </span>{" "}
                  Following
                </button>
              </div>
            </div>
          </div>
          <FollowListDialog
            open={followersOpen}
            onOpenChange={setFollowersOpen}
            title={`${displayName}'s followers`}
            variant={{ kind: "user-followers", userId }}
          />
          <FollowListDialog
            open={followingOpen}
            onOpenChange={setFollowingOpen}
            title={`${displayName} follows`}
            variant={{ kind: "user-following", userId }}
          />
          {(() => {
            // Task #422 — `dateOfBirth` only appears on the private response
            // (self / linked guardian), so reading it here automatically
            // respects the visibility rule: strangers never receive the
            // field and therefore never see the row.
            const dobRaw = (user as { dateOfBirth?: string | Date | null })
              .dateOfBirth;
            const dobDate =
              dobRaw instanceof Date
                ? dobRaw
                : typeof dobRaw === "string" && dobRaw
                  ? new Date(dobRaw)
                  : null;
            const dobValid = dobDate && !Number.isNaN(dobDate.getTime());
            const dobLabel = dobValid ? friendlyAgeLabel(dobDate) : null;
            const showInfo =
              user.bio ||
              user.city ||
              user.state ||
              dobLabel ||
              userSports.length > 0;
            if (!showInfo) return null;
            return (
              <div className="border-t border-border/60 bg-muted/20 px-4 py-4 sm:px-6 sm:py-5 space-y-3" data-testid="user-profile-about">
                {user.bio && (
                  <div className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed max-w-2xl">
                    <FileText
                      className="h-4 w-4 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <p className="whitespace-pre-wrap break-words min-w-0">
                      {linkify(user.bio)}
                    </p>
                  </div>
                )}
                {(dobLabel || userSports.length > 0 || user.city || user.state) && (
                  <div className="flex flex-wrap items-stretch gap-2.5" data-testid="user-profile-facts">
                    {dobLabel && (
                      <div
                        className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-sm font-medium text-foreground/80"
                        data-testid="text-user-birthday"
                      >
                        <Cake className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{dobLabel}</span>
                      </div>
                    )}
                    {/* Task #500 — Sports are self-only until the endpoint is public. */}
                    {userSports.length > 0 && (
                      <div
                        className="flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-sm font-medium text-foreground/80"
                        data-testid="text-user-sports"
                      >
                        <Trophy className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <div className="flex flex-wrap gap-1.5">
                          {userSports.map((s) => (
                            <Badge
                              key={s}
                              variant="secondary"
                              className="font-medium"
                              data-testid={`badge-user-sport-${s}`}
                            >
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Task #349 — Show only the location fields the user has set. */}
                    {(user.city || user.state) && (
                      <div
                        className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-sm font-medium text-foreground/80"
                        data-testid="text-user-location"
                      >
                        <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          {user.city && user.state
                            ? `${user.city}, ${user.state}`
                            : (user.city ?? user.state)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Affiliations stack: inline on mobile (between hero and posts),
          rendered in the right rail on lg+. Only one copy mounts at a
          time so testids stay unique. */}
        {!isLg && affiliationsStack}

        {/* Posts (authored + tagged) */}
        <section>
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="text-2xl font-black tracking-tight">
              {user.isOwnProfile ? "Posts" : "Posts & tagged in"}
            </h2>
            <div className="flex w-full sm:w-auto items-center justify-end gap-2 flex-wrap">
              {canPostProfileHighlight && (
                <Link
                  href={`/posts/new?type=short&profileOnly=1&from=${encodeURIComponent(`/users/${userId}`)}`}
                >
                  <Button
                    variant="brand"
                    className="font-bold rounded-full shrink-0"
                    data-testid="btn-post-profile-highlight"
                  >
                    <Play className="w-4 h-4 mr-1.5" />
                    Post highlight
                  </Button>
                </Link>
              )}
              {teams.length > 0 && (
                <Select value={teamFilter} onValueChange={setTeamFilter}>
                  <SelectTrigger
                    className="w-56 max-w-full font-bold"
                    data-testid="select-team-filter"
                  >
                    <SelectValue placeholder="All teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All teams</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t.teamId} value={t.teamId}>
                        {t.teamName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div className="space-y-3">
            {posts.length > 0 ? (
              posts.map((p) => <PostCard key={p.id} post={p} />)
            ) : hasMorePosts ? null : (
              <Card className="app-surface">
                <CardContent className="p-0">
                  <EmptyState
                    icon={<Building2 className="h-5 w-5" />}
                    title="No posts yet."
                    description="Highlights, recaps, and tagged moments will appear here."
                  />
                </CardContent>
              </Card>
            )}
            {/* Task #785 — auto-load older posts on scroll. Rendered even
              when the team filter empties the visible list so older
              pages keep loading until a match (or the end) is found.
              On fetch failure, pause and offer a manual retry. */}
            {hasMorePosts &&
              (fetchMorePostsFailed ? (
                <div className="flex flex-col items-center gap-2 py-3">
                  <span className="text-xs text-muted-foreground">
                    Couldn't load older posts.
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchMorePosts()}
                    disabled={isFetchingMorePosts}
                    data-testid="btn-retry-load-more-user-posts"
                  >
                    Retry loading older posts
                  </Button>
                </div>
              ) : (
                <div
                  ref={postsSentinelRef}
                  className="flex justify-center py-3"
                  data-testid="sentinel-load-more-user-posts"
                >
                  {isFetchingMorePosts && (
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Loading older posts…
                    </span>
                  )}
                </div>
              ))}
          </div>
        </section>
      </div>

      {/* Right rail (lg+ only — on mobile this renders inline above) */}
      {isLg && hasAnyAffiliation && (
        <aside className="lg:sticky lg:top-20 lg:self-start">
          {affiliationsStack}
        </aside>
      )}
    </div>
  );
}

function AffiliationColumn({
  title,
  icon,
  testId,
  items,
  pinnedCount,
  previewCount = 1,
}: {
  title: string;
  icon: ReactNode;
  testId: string;
  items: ReactNode[];
  pinnedCount?: number;
  previewCount?: number;
}) {
  const [open, setOpen] = useState(false);
  // Caller must skip rendering this card when items is empty.
  if (items.length === 0) return null;
  const hasMore = items.length > previewCount;
  const pinnedN = pinnedCount ?? 0;
  return (
    <div
      className="rounded-xl border border-border bg-card shadow-sm"
      data-testid={`affiliation-column-${testId}`}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <h2 className="text-base font-black tracking-tight truncate">
            {title}
          </h2>
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wider font-bold"
            data-testid={`affiliation-count-${testId}`}
            numeric
          >
            {items.length}
          </Badge>
        </div>
        {hasMore && previewCount === 1 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-full p-1 hover:bg-muted/40 transition-colors shrink-0"
            data-testid={`affiliation-toggle-${testId}`}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            aria-expanded={open}
          >
            <ChevronDown
              className={`w-4 h-4 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
              aria-hidden
            />
          </button>
        )}
      </div>
      <div id={`affiliation-content-${testId}`} className="px-3 pb-3" data-testid={`affiliation-content-${testId}`}>
        <div className="flex flex-col gap-3">
          {!open ? (
            items.slice(0, previewCount)
          ) : pinnedN > 0 ? (
            <>
              <PinnedSectionLabel
                label="Pinned"
                showStar
                testId={`pinned-divider-${testId}`}
              />
              {items.slice(0, pinnedN)}
              {pinnedN < items.length && (
                <PinnedSectionLabel label="All teams" />
              )}
              {items.slice(pinnedN)}
            </>
          ) : (
            items
          )}
        </div>
        {hasMore && previewCount > 1 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-3 w-full rounded-lg px-2 py-2 text-sm font-bold text-primary hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid={`affiliation-toggle-${testId}`}
            aria-expanded={open}
            aria-controls={`affiliation-content-${testId}`}
          >
            {open ? "See less" : `See more (${items.length - previewCount})`}
          </button>
        )}
      </div>
    </div>
  );
}
