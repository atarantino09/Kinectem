import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTeamById,
  useListTeamMembers,
  useListRosterInvites,
  useRemoveTeamMember,
  useAcceptTeamInvite,
  useDeclineTeamInvite,
  useGetOrganizationById,
  useGetLoggedInUser,
  useFollowTeam,
  useUnfollowTeam,
  getListTeamMembersQueryKey,
  getListRosterInvitesQueryKey,
  getGetTeamByIdQueryKey,
  getListFeedQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Shield, Trophy, UserPlus, X, Check, Mail, FileText, Newspaper, Users, Pencil, ChevronDown, ChevronRight } from "lucide-react";
import { formatDate, getInitials } from "@/lib/format";
import { TeamAdminPanel } from "@/components/TeamAdminPanel";
import { InviteRosterDialog } from "@/components/InviteRosterDialog";
import { EditTeamDialog } from "@/components/EditTeamDialog";
import { PostCard } from "@/components/PostCard";
import { FollowListDialog } from "@/components/FollowListDialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import type { PostResponse } from "@workspace/api-client-react";

export default function TeamPage() {
  const params = useParams<{ teamId: string }>();
  const teamId = params.teamId;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [expanded, setExpanded] = useState<"posts" | "roster" | "admin">(
    "posts",
  );
  const [followersOpen, setFollowersOpen] = useState(false);

  const { data: team, isLoading } = useGetTeamById(teamId);
  const followTeam = useFollowTeam();
  const unfollowTeam = useUnfollowTeam();
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
  const { data: membersResp } = useListTeamMembers(teamId);
  const { data: invitesResp } = useListRosterInvites(teamId);
  const { data: org } = useGetOrganizationById(team?.organization.id ?? "", {
    query: { enabled: !!team?.organization.id } as never,
  });
  const { data: me } = useGetLoggedInUser();

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListTeamMembersQueryKey(teamId) }),
      qc.invalidateQueries({ queryKey: getListRosterInvitesQueryKey(teamId) }),
    ]);
  };

  const removeMember = useRemoveTeamMember({
    mutation: { onSuccess: () => invalidate() },
  });
  const acceptInvite = useAcceptTeamInvite({
    mutation: { onSuccess: () => invalidate() },
  });
  const declineInvite = useDeclineTeamInvite({
    mutation: { onSuccess: () => invalidate() },
  });

  const { data: postsResp } = useQuery<{ data: PostResponse[] }>({
    queryKey: ["team-posts", teamId],
    queryFn: () => customFetch(`/api/v1/teams/${teamId}/posts`),
    enabled: !!teamId,
  });

  if (isLoading || !team) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  type ParentRef = {
    id: string;
    displayName: string;
    email?: string | null;
    avatarUrl?: string | null;
  };
  const rawMembers = membersResp?.data ?? [];
  const allMembers = rawMembers as Array<
    (typeof rawMembers)[number] & { parents?: ParentRef[] }
  >;
  const players = allMembers.filter((m) => m.position === "player");
  const staff = allMembers.filter((m) => m.position !== "player");
  const invites = (invitesResp?.data ?? []).filter(
    (i) => i.status === "pending" && !!i.email,
  );

  const isAdmin = org?.role === "owner" || org?.role === "admin";
  const seasonId = team.currentSeason?.id ?? team.id;
  const recentPosts = postsResp?.data ?? [];

  const onRemove = async (memberId: string, name: string) => {
    if (!confirm(`Remove ${name} from the roster?`)) return;
    try {
      await removeMember.mutateAsync({ teamId, memberId });
      toast({ title: `Removed ${name}` });
    } catch {
      toast({ title: "Failed to remove member", variant: "destructive" });
    }
  };

  const onAccept = async (memberId: string) => {
    try {
      await acceptInvite.mutateAsync({ teamId, memberId });
      toast({ title: "Welcome to the team!" });
    } catch {
      toast({ title: "Failed to accept", variant: "destructive" });
    }
  };

  const onDecline = async (memberId: string) => {
    try {
      await declineInvite.mutateAsync({ teamId, memberId });
      toast({ title: "Invite declined" });
    } catch {
      toast({ title: "Failed to decline", variant: "destructive" });
    }
  };

  const togglePlayerExpand = (id: string) => {
    setExpandedPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderStatusBadge = (isPending: boolean) =>
    isPending ? (
      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-none font-bold uppercase tracking-wider text-[10px]">
        Pending
      </Badge>
    ) : (
      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none font-bold uppercase tracking-wider text-[10px]">
        Active
      </Badge>
    );

  const renderActions = (m: (typeof allMembers)[number]) => {
    const isMe = me?.id === m.userId;
    const isPending = m.status === "pending";
    return (
      <div className="flex items-center justify-end gap-2">
        {isPending && isMe && (
          <>
            <Button
              size="sm"
              className="h-7 px-3 font-bold rounded-full"
              onClick={() => onAccept(m.id)}
              data-testid={`btn-accept-${m.id}`}
            >
              <Check className="w-3 h-3 mr-1" /> Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 font-bold rounded-full"
              onClick={() => onDecline(m.id)}
              data-testid={`btn-decline-${m.id}`}
            >
              Decline
            </Button>
          </>
        )}
        {isAdmin && !isMe && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(m.id, m.displayName)}
            data-testid={`btn-remove-${m.id}`}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    );
  };

  const renderPlayerRow = (m: (typeof allMembers)[number]) => {
    const parents = m.parents ?? [];
    const isExpanded = expandedPlayers.has(m.id);
    const hasParents = parents.length > 0;
    return (
      <Fragment key={m.id}>
        <TableRow data-testid={`row-player-${m.id}`}>
          <TableCell className="w-8 pr-0">
            {hasParents ? (
              <button
                type="button"
                onClick={() => togglePlayerExpand(m.id)}
                className="text-muted-foreground hover:text-foreground p-1"
                data-testid={`btn-expand-${m.id}`}
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
            ) : (
              <span className="inline-block w-4 h-4" />
            )}
          </TableCell>
          <TableCell>
            <Link href={`/users/${m.userId}`}>
              <div className="flex items-center gap-3 cursor-pointer hover:text-primary">
                <div className="w-8 h-8 rounded-full bg-slate-900 text-primary-foreground flex items-center justify-center text-[10px] font-bold">
                  {getInitials(m.displayName)}
                </div>
                <span className="font-semibold">{m.displayName}</span>
              </div>
            </Link>
          </TableCell>
          <TableCell className="text-xs text-muted-foreground">
            {hasParents ? `${parents.length} parent${parents.length > 1 ? "s" : ""}` : "—"}
          </TableCell>
          <TableCell>{renderStatusBadge(m.status === "pending")}</TableCell>
          <TableCell className="text-right">{renderActions(m)}</TableCell>
        </TableRow>
        {isExpanded && hasParents && (
          <TableRow
            key={`${m.id}-parents`}
            className="bg-muted/30"
            data-testid={`row-parents-${m.id}`}
          >
            <TableCell />
            <TableCell colSpan={4} className="py-2">
              <div className="space-y-1.5">
                {parents.map((p) => (
                  <Link key={p.id} href={`/users/${p.id}`}>
                    <div className="flex items-center gap-3 cursor-pointer hover:text-primary text-sm">
                      <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">
                        {getInitials(p.displayName)}
                      </div>
                      <span className="font-semibold">{p.displayName}</span>
                      <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none font-bold uppercase tracking-wider text-[10px]">
                        Parent
                      </Badge>
                      {p.email && (
                        <span className="text-xs text-muted-foreground">
                          {p.email}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </TableCell>
          </TableRow>
        )}
      </Fragment>
    );
  };

  const renderStaffRow = (m: (typeof allMembers)[number]) => {
    return (
      <TableRow key={m.id} data-testid={`row-staff-${m.id}`}>
        <TableCell>
          <Link href={`/users/${m.userId}`}>
            <div className="flex items-center gap-3 cursor-pointer hover:text-primary">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-primary-foreground flex items-center justify-center text-[10px] font-bold">
                {getInitials(m.displayName)}
              </div>
              <span className="font-semibold">{m.displayName}</span>
            </div>
          </Link>
        </TableCell>
        <TableCell className="text-sm capitalize">
          {m.position?.replace(/_/g, " ") ?? "—"}
        </TableCell>
        <TableCell>{renderStatusBadge(m.status === "pending")}</TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {formatDate(m.joinedAt)}
        </TableCell>
        <TableCell className="text-right">{renderActions(m)}</TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="rounded-xl border border-border shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
            <Link href={`/organizations/${team.organization.id}`}>
              <Badge
                variant="outline"
                className="bg-muted text-muted-foreground border-border font-bold px-2 py-0.5 text-xs uppercase tracking-wider cursor-pointer hover:bg-muted/80"
              >
                {team.organization.name}
              </Badge>
            </Link>
            {team.currentSeason && (
              <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-none font-bold">
                {team.currentSeason.name}
              </Badge>
            )}
          </div>
          <div className="flex items-start gap-6 mb-3">
            <div className="shrink-0">
              <div className="w-36 h-36 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-border overflow-hidden flex items-center justify-center">
                {(team.avatarUrl || (team.organization as { avatarUrl?: string | null })?.avatarUrl) ? (
                  <img
                    src={team.avatarUrl || (team.organization as { avatarUrl?: string | null })?.avatarUrl || ""}
                    alt={team.name}
                    className="w-full h-full object-cover"
                    data-testid="img-team-photo"
                  />
                ) : (
                  <span className="text-5xl font-black text-primary">
                    {team.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-3 flex-wrap">
                <h1 className="text-5xl font-black tracking-tight leading-[1.05]">
                  {team.name}
                </h1>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 font-bold rounded-full mt-2"
                    onClick={() => setEditOpen(true)}
                    data-testid="btn-edit-team"
                  >
                    <Pencil className="w-3.5 h-3.5 mr-1.5" />
                    Edit
                  </Button>
                )}
              </div>
              {team.description && (
                <TeamDescription
                  description={team.description}
                  teamName={team.name}
                />
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {team.sport && (
              <div className="font-bold text-foreground flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-md text-sm">
                <Trophy className="w-4 h-4 text-amber-500" />
                {team.sport}
              </div>
            )}
            {team.level && (
              <div className="font-bold text-muted-foreground text-sm uppercase tracking-wider">
                {team.level}
              </div>
            )}
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant={expanded === "posts" ? "default" : "outline"}
                className="font-bold rounded-full"
                onClick={() => setExpanded("posts")}
                data-testid="btn-toggle-posts"
              >
                <Newspaper className="w-3.5 h-3.5 mr-1.5" />
                Recent Posts
              </Button>
              <Button
                size="sm"
                variant={expanded === "roster" ? "default" : "outline"}
                className="font-bold rounded-full"
                onClick={() => setExpanded("roster")}
                data-testid="btn-toggle-roster"
              >
                <Users className="w-3.5 h-3.5 mr-1.5" />
                Roster ({players.length}
                {staff.length > 0 ? ` · ${staff.length}` : ""})
              </Button>
              {isAdmin && (
                <Button
                  size="sm"
                  variant={expanded === "admin" ? "default" : "outline"}
                  className="font-bold rounded-full"
                  onClick={() => setExpanded("admin")}
                  data-testid="btn-toggle-admin"
                >
                  <Shield className="w-3.5 h-3.5 mr-1.5" />
                  Admin Tools
                </Button>
              )}
              <Button
                className="bg-primary text-primary-foreground font-bold rounded-full px-5"
                onClick={onToggleFollow}
                disabled={followTeam.isPending || unfollowTeam.isPending}
                data-testid="btn-follow-team"
              >
                {team.isFollowing ? "Following" : "Follow"}
              </Button>
              <Button
                variant="outline"
                className="font-bold rounded-full"
                onClick={() => setFollowersOpen(true)}
                data-testid="btn-view-team-followers"
              >
                <Users className="w-4 h-4 mr-1.5" />
                {team.followerCount} Followers
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <FollowListDialog
        open={followersOpen}
        onOpenChange={setFollowersOpen}
        title={`${team.name} followers`}
        variant={{ kind: "team-followers", teamId }}
      />

      {expanded === "posts" && (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
            <Newspaper className="w-5 h-5" />
            Recent Posts
          </h2>
          {isAdmin && (
            <Link href={`/posts/new?type=long&teamId=${teamId}`}>
              <Button
                size="sm"
                className="font-bold rounded-full"
                data-testid="btn-create-recap"
              >
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                Create Game Recap
              </Button>
            </Link>
          )}
        </div>
        {recentPosts.length === 0 ? (
          <Card className="rounded-xl border border-dashed border-border">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No posts for this team yet.
              {isAdmin && (
                <span className="block mt-1">
                  Be the first to write a game recap.
                </span>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {recentPosts.slice(0, 5).map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        )}
      </section>
      )}

      {expanded === "roster" && (
      <Tabs defaultValue="roster">
        <TabsList>
          <TabsTrigger value="roster" className="font-bold">
            Roster
          </TabsTrigger>
          <TabsTrigger value="staff" className="font-bold">
            Staff
          </TabsTrigger>
          {isAdmin && invites.length > 0 && (
            <TabsTrigger value="invites" className="font-bold">
              Invites <Badge className="ml-1.5 h-5">{invites.length}</Badge>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="roster" className="mt-4">
          <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-black text-sm uppercase tracking-wider">
                Players ({players.length})
              </h3>
              {isAdmin && (
                <Button
                  size="sm"
                  className="font-bold"
                  onClick={() => setInviteOpen(true)}
                  data-testid="btn-invite-roster"
                >
                  <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Invite
                </Button>
              )}
            </div>
            <CardContent className="p-0">
              {players.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No players on the roster yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Player</TableHead>
                      <TableHead>Parents</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{players.map(renderPlayerRow)}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="staff" className="mt-4">
          <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-black text-sm uppercase tracking-wider">
                Staff ({staff.length})
              </h3>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="font-bold"
                  onClick={() => setInviteOpen(true)}
                >
                  <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Invite
                </Button>
              )}
            </div>
            <CardContent className="p-0">
              {staff.length === 0 ? (
                <div className="px-5 py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Shield className="w-4 h-4" />
                  No coaches or staff listed.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{staff.map(renderStaffRow)}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && invites.length > 0 && (
          <TabsContent value="invites" className="mt-4">
            <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h3 className="font-black text-sm uppercase tracking-wider">
                  Pending Email Invites
                </h3>
              </div>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Invited by</TableHead>
                      <TableHead>Sent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          <div className="flex items-center gap-2 font-semibold">
                            <Mail className="w-4 h-4 text-muted-foreground" />
                            {i.email}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm capitalize">
                          {i.position?.replace(/_/g, " ") ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {i.invitedBy?.displayName ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(i.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
      )}

      {expanded === "admin" && isAdmin && (
        <TeamAdminPanel teamId={teamId} />
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
          avatarUrl: team.avatarUrl,
        }}
        canManageLogo={isAdmin}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

    </div>
  );
}

function TeamDescription({
  description,
  teamName,
}: {
  description: string;
  teamName: string;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      setOverflow(el.scrollHeight - 1 > el.clientHeight);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [description]);

  useEffect(() => {
    setOverflow((prev) => prev);
  }, []);

  return (
    <div className="mt-3 max-w-md">
      <p
        ref={ref}
        className="text-sm text-muted-foreground leading-relaxed line-clamp-5 whitespace-pre-wrap"
        data-testid="text-team-description"
      >
        {description}
      </p>
      {overflow && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1 text-xs font-bold text-primary hover:underline"
          data-testid="btn-team-description-more"
        >
          See more
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              About {teamName}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {description}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
