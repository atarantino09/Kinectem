import { useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTeamById,
  useListTeamMembers,
  useListRosterInvites,
  useGetOrganizationById,
  useGetLoggedInUser,
  useFollowTeam,
  useUnfollowTeam,
  getGetTeamByIdQueryKey,
  getListFeedQueryKey,
  customFetch,
  queryOpts,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamAdminPanel } from "@/components/TeamAdminPanel";
import { InviteRosterDialog } from "@/components/InviteRosterDialog";
import { EditTeamDialog } from "@/components/EditTeamDialog";
import { FollowListDialog } from "@/components/FollowListDialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import type { PostResponse } from "@workspace/api-client-react";
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

export default function TeamPage() {
  const params = useParams<{ teamId: string }>();
  const teamId = params.teamId;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [expanded, setExpanded] = useState<TeamPanel>("posts");
  const [followersOpen, setFollowersOpen] = useState(false);

  const { data: team, isLoading } = useGetTeamById(teamId);
  const followTeam = useFollowTeam();
  const unfollowTeam = useUnfollowTeam();
  const { data: membersResp } = useListTeamMembers(teamId);
  const { data: invitesResp } = useListRosterInvites(teamId);
  const { data: org } = useGetOrganizationById(team?.organization.id ?? "", {
    query: queryOpts({ enabled: !!team?.organization.id }),
  });
  const { data: me } = useGetLoggedInUser();

  const { data: postsResp } = useQuery<{ data: PostResponse[] }>({
    queryKey: ["team-posts", teamId],
    queryFn: () => customFetch(`/api/v1/teams/${teamId}/posts`),
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

  const allMembers = (membersResp?.data ?? []) as RosterMember[];
  const players = allMembers.filter((m) => m.position === "player");
  const staff = allMembers.filter((m) => m.position !== "player");
  const invites = ((invitesResp?.data ?? []) as RosterInvite[]).filter(
    (i) => (i as { status?: string }).status === "pending" && !!i.email,
  );

  const isAdmin = org?.role === "owner" || org?.role === "admin";
  const seasonId = team.currentSeason?.id ?? team.id;
  const recentPosts = postsResp?.data ?? [];

  return (
    <div className="space-y-6">
      <TeamHeaderCard
        team={team}
        isAdmin={isAdmin}
        expanded={expanded}
        playerCount={players.length}
        staffCount={staff.length}
        followPending={followTeam.isPending || unfollowTeam.isPending}
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

      {expanded === "posts" && (
        <TeamPostsSection
          teamId={teamId}
          isAdmin={isAdmin}
          posts={recentPosts}
        />
      )}

      {expanded === "roster" && (
        <TeamRosterTabs
          teamId={teamId}
          isAdmin={isAdmin}
          meId={me?.id}
          players={players}
          staff={staff}
          invites={invites}
          onOpenInvite={() => setInviteOpen(true)}
        />
      )}

      {expanded === "admin" && isAdmin && <TeamAdminPanel teamId={teamId} />}

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
          avatarUrl: team.avatarUrl,
        }}
        canManageLogo={isAdmin}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  );
}
