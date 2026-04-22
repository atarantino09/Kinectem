import { useRef, useState } from "react";
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
  getListTeamMembersQueryKey,
  getListRosterInvitesQueryKey,
  getGetTeamByIdQueryKey,
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
import { Shield, Trophy, UserPlus, X, Check, Mail } from "lucide-react";
import { formatDate, getInitials } from "@/lib/format";
import { TeamAdminPanel } from "@/components/TeamAdminPanel";
import { InviteRosterDialog } from "@/components/InviteRosterDialog";
import { useToast } from "@/hooks/use-toast";

export default function TeamPage() {
  const params = useParams<{ teamId: string }>();
  const teamId = params.teamId;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: team, isLoading } = useGetTeamById(teamId);
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

  if (isLoading || !team) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const allMembers = membersResp?.data ?? [];
  const players = allMembers.filter((m) => m.position === "player");
  const staff = allMembers.filter((m) => m.position !== "player");
  const invites = (invitesResp?.data ?? []).filter((i) => i.status === "pending");

  const isAdmin = org?.role === "owner" || org?.role === "admin";
  const seasonId = team.currentSeason?.id ?? team.id;

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

  const onPickPhoto = () => fileInputRef.current?.click();

  const onPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please pick an image file", variant: "destructive" });
      return;
    }
    if (file.size > 1_500_000) {
      toast({ title: "Image must be under 1.5 MB", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await customFetch(`/api/v1/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: dataUrl }),
      });
      await qc.invalidateQueries({ queryKey: getGetTeamByIdQueryKey(teamId) });
      toast({ title: "Team photo updated" });
    } catch {
      toast({ title: "Failed to upload photo", variant: "destructive" });
    } finally {
      setUploading(false);
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

  const renderMemberRow = (m: (typeof allMembers)[number]) => {
    const isMe = me?.id === m.userId;
    const isPending = m.status === "pending";
    return (
      <TableRow key={m.id} data-testid={`row-member-${m.id}`}>
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
        <TableCell>
          {isPending ? (
            <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-none font-bold uppercase tracking-wider text-[10px]">
              Pending
            </Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none font-bold uppercase tracking-wider text-[10px]">
              Active
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {formatDate(m.joinedAt)}
        </TableCell>
        <TableCell className="text-right">
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
        </TableCell>
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
          <div className="flex items-start gap-5 mb-3">
            <div className="relative shrink-0">
              <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-border overflow-hidden flex items-center justify-center">
                {(team.avatarUrl || (team.organization as { avatarUrl?: string | null })?.avatarUrl) ? (
                  <img
                    src={team.avatarUrl || (team.organization as { avatarUrl?: string | null })?.avatarUrl || ""}
                    alt={team.name}
                    className="w-full h-full object-cover"
                    data-testid="img-team-photo"
                  />
                ) : (
                  <span className="text-2xl font-black text-primary">
                    {team.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              {isAdmin && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onPhotoChange}
                    data-testid="input-team-photo"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-6 px-2 text-[10px] font-bold rounded-full whitespace-nowrap"
                    onClick={onPickPhoto}
                    disabled={uploading}
                    data-testid="btn-upload-team-photo"
                  >
                    {uploading
                      ? "Uploading..."
                      : team.avatarUrl
                        ? "Change"
                        : "Upload"}
                  </Button>
                </>
              )}
            </div>
            <h1 className="text-4xl font-black tracking-tight leading-tight">
              {team.name}
            </h1>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
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
            <div className="ml-auto">
              <Button className="bg-primary text-primary-foreground font-bold rounded-full px-5">
                {team.isFollowing ? "Following" : "Follow"} ({team.followerCount})
              </Button>
            </div>
          </div>
          {team.description && (
            <p className="text-sm text-muted-foreground mt-4 leading-relaxed max-w-3xl">
              {team.description}
            </p>
          )}
        </CardContent>
      </Card>

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
                      <TableHead>Player</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{players.map(renderMemberRow)}</TableBody>
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
                  <TableBody>{staff.map(renderMemberRow)}</TableBody>
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

      <InviteRosterDialog
        teamId={teamId}
        seasonId={seasonId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />

      <TeamAdminPanel teamId={teamId} />
    </div>
  );
}
