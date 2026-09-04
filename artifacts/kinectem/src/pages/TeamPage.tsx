import { useEffect, useMemo, useState } from "react";
import { useParams, useSearch, useLocation } from "wouter";
import { useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import {
  customFetch,
  useGetTeamById,
  useListTeamMembers,
  listTeamPosts,
  getListTeamPostsQueryKey,
  useListRosterInvites,
  useGetOrganizationById,
  useGetLoggedInUser,
  useFollowTeam,
  useUnfollowTeam,
  getGetTeamByIdQueryKey,
  getListFeedQueryKey,
  queryOpts,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { NoIndex } from "@/components/NoIndex";
import { TeamAdminPanel } from "@/components/TeamAdminPanel";
import { InviteRosterDialog } from "@/components/InviteRosterDialog";
import { EditTeamDialog } from "@/components/EditTeamDialog";
import { FollowListDialog } from "@/components/FollowListDialog";
import { useToast } from "@/hooks/use-toast";
import {
  TeamHeaderCard,
  type TeamPanel,
} from "@/components/team-page/TeamHeaderCard";
import { TeamPostsSection } from "@/components/team-page/TeamPostsSection";
import { PracticePlansSection } from "@/components/team-page/PracticePlansSection";
import {
  TeamRosterTabs,
  type RosterMember,
  type RosterInvite,
} from "@/components/team-page/TeamRosterTabs";
import { TeamRosterRail } from "@/components/team-page/TeamRosterRail";
import { useWhoami } from "@/hooks/useWhoami";
import { AdoptTeamDialog } from "@/components/team-page/AdoptTeamDialog";
import { AdoptLinkCard } from "@/components/team-page/AdoptLinkCard";
import { CreateOrgDialog } from "@/components/CreateOrgDialog";
import { TeamWelcomeDialog } from "@/components/team-page/TeamWelcomeDialog";
import {
  SpotlightTour,
} from "@/components/team-page/SpotlightTour";
import { buildTeamTourSteps } from "@/components/team-page/teamTourSteps";
import { TournamentScheduleCard } from "@/components/team-page/TournamentScheduleCard";
import { ClaimCompetitionDialog } from "@/components/team-page/ClaimCompetitionDialog";
import { TeamSchedulePanel } from "@/components/team-page/schedule/TeamSchedulePanel";
import { ScheduleUpNext } from "@/components/team-page/schedule/ScheduleUpNext";
import { BroadcastComposeDialog } from "@/components/broadcasts/BroadcastComposeDialog";
import { useIsLg } from "@/hooks/use-mobile";

// First-run walkthrough is shown ONCE per user, per browser (the OpenAPI
// contract is locked, so there's no server-side "seen onboarding" flag). The
// first time a manager (coach or org admin) opens any team page they get the
// walkthrough, and never again on any other team. Bump the key to re-show the
// tour to everyone after a revision.
const TEAM_TOUR_KEY = "kinectem:team-tour-v1";

function teamTourStorageKey(userId: string) {
  return `${TEAM_TOUR_KEY}:${userId}`;
}

function hasSeenTeamTour(storageKey: string) {
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    // storage blocked (private mode etc.) — treat as not seen
    return false;
  }
}

function markTeamTourSeen(storageKey: string) {
  try {
    localStorage.setItem(storageKey, "1");
  } catch {
    // Ignore storage failures (private mode etc.) — the tour can still show.
  }
}

export default function TeamPage() {
  const params = useParams<{ teamId: string }>();
  const teamId = params.teamId;
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const [, navigate] = useLocation();
  // The notifications bell appends `?roster=1[&entryId=…]` to team-invite
  // links so a click on the bell lands on the Roster panel (instead of
  // Posts) with the invitee's pending row scrolled into view. A bare
  // `/teams/:id` URL keeps the historical "open Posts" default.
  const { showRoster, highlightEntryId, wantsWelcome, wantsTour } = useMemo(() => {
    const sp = new URLSearchParams(search ?? "");
    const entryId = sp.get("entryId");
    return {
      showRoster: sp.get("roster") === "1" || !!entryId,
      highlightEntryId: entryId,
      wantsWelcome: sp.get("welcome") === "1",
      wantsTour: sp.get("showAround") === "1",
    };
  }, [search]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [claimCompOpen, setClaimCompOpen] = useState(false);
  const [expanded, setExpanded] = useState<TeamPanel>(
    showRoster ? "roster" : "posts",
  );
  const [followersOpen, setFollowersOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourRequested, setTourRequested] = useState(wantsTour);
  const isLg = useIsLg();

  // Re-evaluate when navigating between team URLs without remounting
  // the page (e.g. clicking another team-invite notification while
  // already on a team page).
  useEffect(() => {
    if (showRoster) setExpanded("roster");
  }, [showRoster, teamId]);

  useEffect(() => {
    if (wantsTour) setTourRequested(true);
  }, [wantsTour, teamId]);

  // Team links from the organization tour carry a one-shot tour signal.
  // Preserve any other query parameters while removing it from the URL.
  useEffect(() => {
    if (!wantsTour || typeof window === "undefined") return;
    const sp = new URLSearchParams(search ?? "");
    sp.delete("showAround");
    const qs = sp.toString();
    navigate(`/teams/${teamId}${qs ? `?${qs}` : ""}`, { replace: true });
  }, [wantsTour, search, teamId, navigate]);

  // Right after a coach claims their team, `submit()` lands them here with
  // `?welcome=1`. Pop the first-run rundown once their manage role resolves so
  // only the owner/coach sees it. Closing strips the flag so a refresh or
  // shared link doesn't re-open it.
  function closeWelcome() {
    setWelcomeOpen(false);
    if (!wantsWelcome) return;
    const sp = new URLSearchParams(search ?? "");
    sp.delete("welcome");
    const qs = sp.toString();
    navigate(`/teams/${teamId}${qs ? `?${qs}` : ""}`, { replace: true });
  }

  const { data: team, isLoading } = useGetTeamById(teamId);
  const followTeam = useFollowTeam();
  const unfollowTeam = useUnfollowTeam();
  const { data: membersResp } = useListTeamMembers(teamId);
  // Task #628 — solo teams (created via the tournament signup funnel) have no
  // parent organization. The generated TeamResponse type still types
  // `organization` as non-null (openapi.yaml is locked), but the server
  // returns null at runtime for solo teams, so read it through a narrow cast.
  const orgRef = (team as { organization?: { id?: string } | null } | undefined)
    ?.organization;
  const isSoloTeam = !!team && !orgRef?.id;
  const { data: org } = useGetOrganizationById(orgRef?.id ?? "", {
    query: queryOpts({ enabled: !!orgRef?.id }),
  });
  const { data: me } = useGetLoggedInUser();
  const { data: who } = useWhoami();

  // Mirrors `canManageTeam` on the server: org admins/owners always
  // can, and so can anyone whose accepted roster entry has a coach-
  // level position. We compute this here so the invites list query is
  // only fired for managers — non-managers would get a 403 since
  // pending-invite emails are PII restricted to staff.
  // Platform admins manage every team; the server's canManageTeam /
  // canManageOrganization grant them the same powers, so mirror it here.
  // During masquerade the effective (session) user is the viewed user,
  // matching the server's sessionUser-based check.
  const isPlatformAdmin =
    (who?.isMasquerading ? who?.viewingAs?.role : who?.realUser?.role) ===
    "admin";
  const isAdmin =
    org?.role === "owner" || org?.role === "admin" || isPlatformAdmin;
  const isOwner = org?.role === "owner";
  const COACH_LEVEL_POSITIONS = ["coach", "assistant_coach", "admin"];
  const allMembersForGate = (membersResp?.data ?? []) as RosterMember[];
  const canManage =
    isAdmin ||
    (!!me?.id &&
      allMembersForGate.some(
        (m) =>
          m.userId === me.id &&
          m.status !== "pending" &&
          COACH_LEVEL_POSITIONS.includes((m.position ?? "").toLowerCase()),
      ));

  // Who can send a team broadcast: same as `canManage` (org admins + coach-
  // level staff) plus the team's accepted `manager`-position staff. Mirrors
  // the server's `canSendTeamBroadcast`.
  const canBroadcast =
    canManage ||
    (!!me?.id &&
      allMembersForGate.some(
        (m) =>
          m.userId === me.id &&
          m.status !== "pending" &&
          (m.position ?? "").toLowerCase() === "manager",
      ));

  // Open the welcome rundown only once the viewer is confirmed a manager, so a
  // shared `?welcome=1` link never shows the coach-facing onboarding to a
  // visitor who can't act on it.
  useEffect(() => {
    if (wantsWelcome && canManage) setWelcomeOpen(true);
  }, [wantsWelcome, canManage]);
  // Broader gate than `canManage`: any accepted roster entry on this
  // team (player, coach, staff, author, etc.) — used to expose the
  // "Post Highlight" CTA to ordinary team members. Mirrors the
  // server-side check on POST /api/v1/posts for `postType=short`,
  // which requires DB status === "accepted". Note: the API surface
  // remaps roster statuses to "active" | "pending" — declined entries
  // come back as "pending" — so checking `status === "active"` here
  // correctly excludes pending AND declined entries.
  const isTeamMember =
    !!me?.id &&
    allMembersForGate.some(
      (m) => m.userId === me.id && m.status === "active",
    );
  // Mirrors the server's `canViewTeamSchedule`: the schedule is
  // members-only, where "members" also includes the parent of an
  // accepted (status === "active") roster athlete via the `users.parentId`
  // link. The roster API exposes each minor's linked parents as
  // `parents[]` with the parent's user id, so a parent qualifies when any
  // active member lists them. Without this, parents — who are read-only by
  // design — would be locked out of the Schedule tab client-side even
  // though the server would serve them.
  const isParentOfActiveMember =
    !!me?.id &&
    allMembersForGate.some(
      (m) =>
        m.status === "active" &&
        Array.isArray(m.parents) &&
        m.parents.some((p) => p.id === me.id),
    );
  const canViewSchedule = isTeamMember || canManage || isParentOfActiveMember;
  // Server-derived authoring capability for this team — single source
  // of truth for both the "Create Game Recap" CTA and the "Waiting
  // for approval" pending-recaps section in TeamPostsSection. Mirrors
  // the server's `canCreateRecap` rule (org owner/admin, team coach,
  // or accepted roster member with `position = "author"`).
  const canPostRecap = !!team?.canAuthorRecaps;
  // Mirrors TeamPostsSection's own gate for the "Post Highlight" CTA.
  const canPostHighlight = isAdmin || isTeamMember;

  // First-run guided walkthrough. Built only from the buttons this viewer can
  // actually see (org admins get "Edit team"; coaches get the manage steps),
  // so nobody is pointed at a control that isn't there.
  const tourSteps = useMemo(
    () =>
      buildTeamTourSteps({
        isAdmin,
        canManage,
        canViewSchedule,
        canPostHighlight,
        canPostRecap,
        onExpand: setExpanded,
      }),
    [isAdmin, canManage, canViewSchedule, canPostHighlight, canPostRecap],
  );

  // Open the walkthrough once per account (per browser), the first time a
  // manager lands on any team. Suppressed when `?welcome=1` is present so it
  // never stacks on the post-claim rundown dialog.
  // The "seen" flag is scoped per user id — a bare per-browser key meant a
  // brand-new coach signing in on a browser where ANY other account had
  // already dismissed the tour would never see it.
  const tourStorageKey = me?.id ? teamTourStorageKey(me.id) : null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!canManage || wantsWelcome || wantsTour || tourRequested) return;
    if (tourSteps.length === 0) return;
    if (!teamId || !tourStorageKey) return;
    if (hasSeenTeamTour(tourStorageKey)) return;
    // Mark on open, not only after the last step. Leaving a walkthrough early
    // should not make it reappear on every later team visit.
    markTeamTourSeen(tourStorageKey);
    setTourOpen(true);
  }, [
    canManage,
    wantsWelcome,
    wantsTour,
    tourRequested,
    tourSteps.length,
    teamId,
    tourStorageKey,
  ]);

  // Delay the existing team walkthrough so the team page is visible first
  // after a visitor selects a team from the organization page.
  useEffect(() => {
    if (
      !tourRequested ||
      !team ||
      !teamId ||
      !canManage ||
      wantsWelcome ||
      tourSteps.length === 0
    ) {
      return;
    }
    if (!tourStorageKey) return;
    // Organization-page links carry showAround=1 as a one-shot handoff. It
    // must still obey the per-user first-run rule, otherwise every visit from
    // an organization page reopens the walkthrough.
    if (hasSeenTeamTour(tourStorageKey)) {
      setTourRequested(false);
      return;
    }
    const timer = window.setTimeout(() => {
      markTeamTourSeen(tourStorageKey);
      setTourOpen(true);
      setTourRequested(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [
    tourRequested,
    team,
    teamId,
    canManage,
    wantsWelcome,
    tourSteps.length,
    tourStorageKey,
  ]);

  const finishTour = () => {
    if (tourStorageKey) markTeamTourSeen(tourStorageKey);
    setTourOpen(false);
    setExpanded("posts");
  };

  const { data: invitesResp } = useListRosterInvites(teamId, undefined, {
    query: queryOpts({ enabled: !!teamId && canManage }),
  });

  // Task #782 — cursor-paginated team posts. Key extends the
  // generated `getListTeamPostsQueryKey(teamId)` so the composer's
  // prefix-matched invalidation after a publish/edit still refreshes
  // this infinite list.
  const TEAM_POSTS_PAGE_SIZE = 20;
  const {
    data: postPages,
    fetchNextPage: fetchMorePosts,
    hasNextPage: hasMorePosts,
    isFetchingNextPage: isFetchingMorePosts,
    isFetchNextPageError: fetchMorePostsFailed,
  } = useInfiniteQuery({
    queryKey: [...getListTeamPostsQueryKey(teamId), "infinite"] as const,
    queryFn: ({ pageParam }) =>
      listTeamPosts(teamId, {
        limit: TEAM_POSTS_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.nextCursor ?? undefined
        : undefined,
    enabled: !!teamId,
  });

  const onToggleFollow = async () => {
    if (!team) return;
    try {
      if (team.isFollowing) {
        await unfollowTeam.mutateAsync({ teamId });
      } else {
        await followTeam.mutateAsync({ teamId });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetTeamByIdQueryKey(teamId) }),
        qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
      ]);
    } catch {
      toast({ title: "Couldn't update follow", variant: "destructive" });
    }
  };

  if (isLoading || !team) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  // Server returns rosters ordered alphabetically by first name (with
  // nameless rows last); this keeps that order as a render-time safety net
  // after the players/staff partition in case the source order changes.
  const byFirstName = (a?: string | null, b?: string | null) => {
    const an = (a ?? "").trim();
    const bn = (b ?? "").trim();
    if (!an && !bn) return 0;
    if (!an) return 1;
    if (!bn) return -1;
    return an.localeCompare(bn, undefined, { sensitivity: "base" });
  };

  const allMembers = allMembersForGate;
  const players = allMembers
    .filter((m) => m.position === "player")
    .sort((a, b) => byFirstName(a.displayName, b.displayName));
  const staff = allMembers
    .filter((m) => m.position !== "player")
    .sort((a, b) => byFirstName(a.displayName, b.displayName));
  const invites = ((invitesResp?.data ?? []) as RosterInvite[])
    .filter((i) => (i as { status?: string }).status === "pending" && !!i.email)
    .sort((a, b) =>
      byFirstName(
        (a as { invitedName?: string | null }).invitedName,
        (b as { invitedName?: string | null }).invitedName,
      ),
    );

  const seasonId = team.currentSeason?.id ?? team.id;
  const recentPosts = postPages?.pages.flatMap((p) => p.data) ?? [];

  // Task #367 — team pages with any minor roster member must not be
  // search-indexed. We treat any roster row with at least one linked
  // parent as a minor (the Phase 1 schema only ever populates
  // `parents[]` on under-13 accounts), which gives us a usable signal
  // without exposing `isMinor` on the public roster API. Youth-sports
  // teams typically have many minors on roster, so this is a strong
  // default — adult-only club teams (rare on Kinectem) get the more
  // permissive default automatically.
  const teamHasMinorMembers = allMembersForGate.some(
    (m) => Array.isArray(m.parents) && m.parents.length > 0,
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
      {teamHasMinorMembers ? <NoIndex /> : null}
      <div className="space-y-6 min-w-0">
        {team.archivedAt && (
          <div
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900"
            data-testid="banner-team-archived"
          >
            This team is archived. It is hidden from members and discovery, and
            new posts, follows, and roster changes are blocked.
          </div>
        )}
        {isSoloTeam && (
          <div
            className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900 space-y-2"
            data-testid="banner-team-temporary"
          >
            <p>
              <span className="font-bold">Temporary tournament team.</span> This
              team was created for a tournament and has no organization yet. Game
              recaps can be posted while the tournament is active. To keep posting
              after it ends, adopt this team into an organization.
            </p>
            {canManage && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setAdoptOpen(true)}
                  className="block text-xs font-bold uppercase tracking-wider text-sky-700 hover:underline"
                  data-testid="button-open-adopt-team"
                >
                  Adopt into your organization →
                </button>
                <button
                  type="button"
                  onClick={() => setCreateOrgOpen(true)}
                  className="block text-xs font-bold uppercase tracking-wider text-sky-700 hover:underline"
                  data-testid="button-create-org-adopt-team"
                >
                  Create a new organization for this team →
                </button>
                <AdoptLinkCard teamId={teamId} />
              </div>
            )}
          </div>
        )}
        <TeamHeaderCard
          team={team}
          isAdmin={isAdmin}
          expanded={expanded}
          playerCount={players.length}
          staffCount={staff.length}
          followPending={followTeam.isPending || unfollowTeam.isPending}
          canViewSchedule={canViewSchedule}
          onSetExpanded={setExpanded}
          onToggleFollow={onToggleFollow}
          onEdit={() => setEditOpen(true)}
          onOpenFollowers={() => setFollowersOpen(true)}
          onClaimCompetition={
            canManage ? () => setClaimCompOpen(true) : undefined
          }
          onMessageTeam={canBroadcast ? () => setBroadcastOpen(true) : undefined}
          onReplayTour={
            canManage && tourSteps.length > 0
              ? () => setTourOpen(true)
              : undefined
          }
        />

        <FollowListDialog
          open={followersOpen}
          onOpenChange={setFollowersOpen}
          title={`${team.name} followers`}
          variant={{ kind: "team-followers", teamId }}
          canManageFollowers={canManage}
        />

        {/* Roster rail: inline above sections on mobile/tablet, in
            right rail on lg+. Only one instance mounts at a time so
            test ids stay unique. */}
        {!isLg && (
          <>
            <TeamRosterRail
              players={players}
              staff={staff}
              canManage={canManage}
              onOpenInvite={() => setInviteOpen(true)}
              defaultOpen={false}
            />
            {canViewSchedule && (
              <ScheduleUpNext
                teamId={teamId}
                onOpenSchedule={() => setExpanded("schedule")}
              />
            )}
          </>
        )}

        {expanded === "posts" && (
          <>
            <TournamentScheduleCard
              teamId={teamId}
              canPostRecap={canPostRecap}
              canManage={isAdmin}
            />
            <TeamPostsSection
              teamId={teamId}
              isAdmin={isAdmin}
              canManage={canManage}
              isTeamMember={isTeamMember}
              canPostRecap={canPostRecap}
              teamName={team.name}
              posts={recentPosts}
              hasMorePosts={!!hasMorePosts}
              isLoadingMorePosts={isFetchingMorePosts}
              loadMorePostsFailed={fetchMorePostsFailed}
              onLoadMorePosts={() => fetchMorePosts()}
            />
            <PracticePlansSection
              teamId={teamId}
              canManage={canManage}
              canView={canViewSchedule}
            />
          </>
        )}

        {expanded === "schedule" && canViewSchedule && (
          <TeamSchedulePanel teamId={teamId} canManage={canManage} />
        )}

        {expanded === "roster" && (
          <TeamRosterTabs
            teamId={teamId}
            isAdmin={isAdmin}
            meId={me?.id}
            players={players}
            staff={staff}
            invites={invites}
            highlightEntryId={highlightEntryId}
            teamName={team.name}
            onOpenInvite={() => setInviteOpen(true)}
          />
        )}

        {expanded === "admin" && isAdmin && (
          <TeamAdminPanel
            teamId={teamId}
            isOwner={isOwner}
            isArchived={!!team.archivedAt}
            organizationId={orgRef?.id ?? ""}
          />
        )}
      </div>

      {isLg && (
        <aside className="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto space-y-6">
          <TeamRosterRail players={players} staff={staff} />
          {canViewSchedule && (
            <ScheduleUpNext
              teamId={teamId}
              onOpenSchedule={() => setExpanded("schedule")}
            />
          )}
        </aside>
      )}

      <InviteRosterDialog
        teamId={teamId}
        seasonId={seasonId}
        teamName={team.name}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />

      {canBroadcast && (
        <BroadcastComposeDialog
          open={broadcastOpen}
          onOpenChange={setBroadcastOpen}
          target={{ kind: "team", id: teamId, name: team.name }}
        />
      )}

      {canManage && (
        <ClaimCompetitionDialog
          open={claimCompOpen}
          onOpenChange={setClaimCompOpen}
          teamId={teamId}
          teamName={team.name}
        />
      )}

      <EditTeamDialog
        team={{
          id: team.id,
          name: team.name,
          description: team.description,
          sport: team.sport,
          level: team.level,
          gender: team.gender,
          bannerUrl: team.bannerUrl,
        }}
        canManagePhoto={isAdmin}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      {isSoloTeam && (
        <AdoptTeamDialog
          teamId={teamId}
          open={adoptOpen}
          onOpenChange={setAdoptOpen}
          onAdopted={() => {
            qc.invalidateQueries({ queryKey: getGetTeamByIdQueryKey(teamId) });
            qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
          }}
        />
      )}

      {isSoloTeam && (
        <CreateOrgDialog
          open={createOrgOpen}
          onOpenChange={setCreateOrgOpen}
          // Third continuation path: the coach creates a brand-new org and
          // this temporary team is adopted into it immediately, so they can
          // keep posting recaps without waiting on an existing org admin.
          onCreated={async (org) => {
            try {
              await customFetch<{ ok: boolean; teamId: string }>(
                `/api/v1/teams/${teamId}/adopt`,
                {
                  method: "POST",
                  body: JSON.stringify({ organizationId: org.id }),
                },
              );
              toast({
                title: "Team added to your new organization",
                description: `${team?.name ?? "This team"} is now part of ${org.name} with full features — keep the story going.`,
              });
              qc.invalidateQueries({
                queryKey: getGetTeamByIdQueryKey(teamId),
              });
              qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
              // Same as the normal org-creation flow: the new owner picks a
              // plan first, then lands back on their (now org-backed) team.
              navigate(`/organizations/${org.id}/subscribe`);
              return;
            } catch (err) {
              // Org creation succeeded but the adopt step failed (e.g. the
              // team was adopted elsewhere in a race). The org still exists;
              // the user can retry from "Adopt into your organization".
              toast({
                variant: "destructive",
                title: "Organization created, but the team couldn't be added",
                description: `${
                  err instanceof Error ? `${err.message} ` : ""
                }Your new organization still exists — use "Adopt into your organization" to add this team.`,
              });
            }
            qc.invalidateQueries({ queryKey: getGetTeamByIdQueryKey(teamId) });
            qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
          }}
        />
      )}

      {canManage && (
        <TeamWelcomeDialog
          teamName={team.name}
          open={welcomeOpen}
          onOpenChange={(open) => {
            if (!open) closeWelcome();
            else setWelcomeOpen(true);
          }}
          onAddPlayers={() => {
            closeWelcome();
            setExpanded("roster");
            setInviteOpen(true);
          }}
        />
      )}

      {tourOpen && tourSteps.length > 0 && (
        <SpotlightTour steps={tourSteps} onFinish={finishTour} />
      )}
    </div>
  );
}
