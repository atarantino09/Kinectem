import { useEffect, useMemo, useState } from "react";
import { useParams, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTeamById,
  useListTeamMembers,
  useListTeamPosts,
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
import {
  TeamRosterTabs,
  type RosterMember,
  type RosterInvite,
} from "@/components/team-page/TeamRosterTabs";
import { TeamRosterRail } from "@/components/team-page/TeamRosterRail";
import { TeamSchedulePanel } from "@/components/team-page/schedule/TeamSchedulePanel";
import { ScheduleUpNext } from "@/components/team-page/schedule/ScheduleUpNext";
import { useIsLg } from "@/hooks/use-mobile";

export default function TeamPage() {
  const params = useParams<{ teamId: string }>();
  const teamId = params.teamId;
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  // The notifications bell appends `?roster=1[&entryId=…]` to team-invite
  // links so a click on the bell lands on the Roster panel (instead of
  // Posts) with the invitee's pending row scrolled into view. A bare
  // `/teams/:id` URL keeps the historical "open Posts" default.
  const { showRoster, highlightEntryId } = useMemo(() => {
    const sp = new URLSearchParams(search ?? "");
    const entryId = sp.get("entryId");
    return {
      showRoster: sp.get("roster") === "1" || !!entryId,
      highlightEntryId: entryId,
    };
  }, [search]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [expanded, setExpanded] = useState<TeamPanel>(
    showRoster ? "roster" : "posts",
  );
  const [followersOpen, setFollowersOpen] = useState(false);
  const isLg = useIsLg();

  // Re-evaluate when navigating between team URLs without remounting
  // the page (e.g. clicking another team-invite notification while
  // already on a team page).
  useEffect(() => {
    if (showRoster) setExpanded("roster");
  }, [showRoster, teamId]);

  const { data: team, isLoading } = useGetTeamById(teamId);
  const followTeam = useFollowTeam();
  const unfollowTeam = useUnfollowTeam();
  const { data: membersResp } = useListTeamMembers(teamId);
  const { data: org } = useGetOrganizationById(team?.organization.id ?? "", {
    query: queryOpts({ enabled: !!team?.organization.id }),
  });
  const { data: me } = useGetLoggedInUser();

  // Mirrors `canManageTeam` on the server: org admins/owners always
  // can, and so can anyone whose accepted roster entry has a coach-
  // level position. We compute this here so the invites list query is
  // only fired for managers — non-managers would get a 403 since
  // pending-invite emails are PII restricted to staff.
  const isAdmin = org?.role === "owner" || org?.role === "admin";
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

  const { data: invitesResp } = useListRosterInvites(teamId, undefined, {
    query: queryOpts({ enabled: !!teamId && canManage }),
  });

  // Use the generated hook so the new-post composer can target this
  // exact query key (`getListTeamPostsQueryKey(teamId)`) when it
  // refreshes the list after a publish/edit, instead of relying on
  // an ad-hoc key the composer doesn't know about.
  const { data: postsResp } = useListTeamPosts(teamId, undefined, {
    query: queryOpts({ enabled: !!teamId }),
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

  const allMembers = allMembersForGate;
  const players = allMembers.filter((m) => m.position === "player");
  const staff = allMembers.filter((m) => m.position !== "player");
  const invites = ((invitesResp?.data ?? []) as RosterInvite[]).filter(
    (i) => (i as { status?: string }).status === "pending" && !!i.email,
  );

  const seasonId = team.currentSeason?.id ?? team.id;
  const recentPosts = postsResp?.data ?? [];

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
        />

        <FollowListDialog
          open={followersOpen}
          onOpenChange={setFollowersOpen}
          title={`${team.name} followers`}
          variant={{ kind: "team-followers", teamId }}
        />

        {/* Roster rail: inline above sections on mobile/tablet, in
            right rail on lg+. Only one instance mounts at a time so
            test ids stay unique. */}
        {!isLg && (
          <TeamRosterRail
            players={players}
            staff={staff}
            canManage={canManage}
            onOpenInvite={() => setInviteOpen(true)}
          />
        )}

        {expanded === "posts" && (
          <>
            {canViewSchedule && (
              <ScheduleUpNext
                teamId={teamId}
                onOpenSchedule={() => setExpanded("schedule")}
              />
            )}
            <TeamPostsSection
              teamId={teamId}
              isAdmin={isAdmin}
              isTeamMember={isTeamMember}
              canPostRecap={canPostRecap}
              teamName={team.name}
              posts={recentPosts}
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
            onOpenInvite={() => setInviteOpen(true)}
          />
        )}

        {expanded === "admin" && isAdmin && (
          <TeamAdminPanel
            teamId={teamId}
            isOwner={isOwner}
            isArchived={!!team.archivedAt}
            organizationId={team.organization.id}
          />
        )}
      </div>

      {isLg && (
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <TeamRosterRail players={players} staff={staff} />
        </aside>
      )}

      <InviteRosterDialog
        teamId={teamId}
        seasonId={seasonId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />

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
    </div>
  );
}
