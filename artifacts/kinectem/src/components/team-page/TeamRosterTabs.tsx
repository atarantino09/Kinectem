import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useAcceptTeamInvite,
  useDeclineTeamInvite,
  useWithdrawRosterInvite,
  getListTeamMembersQueryKey,
  getListRosterInvitesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/UserAvatar";
import { useToast } from "@/hooks/use-toast";
import { useIsLg } from "@/hooks/use-mobile";
import { formatDate } from "@/lib/format";
import {
  Shield,
  UserPlus,
  Pencil,
  Check,
  Mail,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { EditRosterMemberDialog } from "./EditRosterMemberDialog";

export type ParentRef = {
  id: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
};

export type RosterMember = {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  position?: string | null;
  jerseyNumber?: number | null;
  status?: string | null;
  joinedAt?: string | null;
  parents?: ParentRef[];
};

export type RosterInvite = {
  id: string;
  email?: string | null;
  position?: string | null;
  invitedBy?: { displayName: string } | null;
  createdAt?: string | null;
};

interface TeamRosterTabsProps {
  teamId: string;
  isAdmin: boolean;
  meId: string | undefined;
  players: RosterMember[];
  staff: RosterMember[];
  invites: RosterInvite[];
  highlightEntryId?: string | null;
  onOpenInvite: () => void;
}

export function TeamRosterTabs({
  teamId,
  isAdmin,
  meId,
  players,
  staff,
  invites,
  highlightEntryId,
  onOpenInvite,
}: TeamRosterTabsProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isLg = useIsLg();
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [editingMember, setEditingMember] = useState<RosterMember | null>(null);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListTeamMembersQueryKey(teamId) }),
      qc.invalidateQueries({ queryKey: getListRosterInvitesQueryKey(teamId) }),
    ]);
  };

  // After accept/decline, the viewer's recap-authoring rights may have
  // changed (e.g. accepting an invite where their position is "author"
  // unlocks the global Create-menu's "Game Recap" item). Refresh the
  // cached `whoami` so the Layout re-evaluates `canAuthorRecap`
  // without requiring a hard reload.
  const invalidateRoster = async () => {
    await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ["whoami"] })]);
  };

  const acceptInvite = useAcceptTeamInvite({
    mutation: { onSuccess: () => invalidateRoster() },
  });
  const declineInvite = useDeclineTeamInvite({
    mutation: { onSuccess: () => invalidateRoster() },
  });
  const withdrawInvite = useWithdrawRosterInvite({
    mutation: { onSuccess: () => invalidate() },
  });

  // Determine the only-Admin scenario from the rosters we already have:
  // an "Admin" is a roster entry with position === "admin" and an active
  // (accepted) status. The dialog uses this flag to pre-disable demote/
  // remove with a clear explanation rather than waiting for a 422 from
  // the server.
  const acceptedAdminIds = useMemo(() => {
    const ids: string[] = [];
    for (const m of [...players, ...staff]) {
      if (m.position === "admin" && m.status !== "pending") {
        ids.push(m.id);
      }
    }
    return ids;
  }, [players, staff]);
  const isLastAdmin =
    !!editingMember &&
    acceptedAdminIds.length === 1 &&
    acceptedAdminIds[0] === editingMember.id;

  // Mirrors `canManageTeam` on the server exactly: org admins/owners
  // can manage (passed in via `isAdmin`), and so can anyone whose
  // accepted roster entry has a coach-level position — i.e. db role
  // "coach", which the spec encodes as positions "coach",
  // "assistant_coach", or "admin". Crucially this excludes other
  // non-player staff positions ("manager", "parent", "author") that
  // also live in the Staff tab but are NOT authorized by the server,
  // so the Edit affordance must stay hidden for them.
  const COACH_LEVEL_POSITIONS = new Set(["coach", "assistant_coach", "admin"]);
  const canManage = useMemo(() => {
    if (isAdmin) return true;
    if (!meId) return false;
    return staff.some(
      (m) =>
        m.userId === meId &&
        m.status !== "pending" &&
        COACH_LEVEL_POSITIONS.has((m.position ?? "").toLowerCase()),
    );
  }, [isAdmin, meId, staff]);

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

  const onRevoke = async (inviteId: string, label: string) => {
    if (
      !window.confirm(
        `Revoke the invitation for ${label}? They won't be able to join with this link.`,
      )
    ) {
      return;
    }
    try {
      await withdrawInvite.mutateAsync({ teamId, inviteId });
      toast({ title: "Invitation revoked" });
    } catch {
      toast({ title: "Failed to revoke invite", variant: "destructive" });
    }
  };

  // Task #655 — re-send an invite whose email didn't arrive (bounced or
  // landed in spam). The endpoint reuses the existing token (no new invite
  // row), so we call it directly via customFetch — it's intentionally not
  // in the locked openapi.yaml, like the other invite extras. The 200 body
  // carries `emailSent` (true/false/null), appended outside the spec.
  const [resendingId, setResendingId] = useState<string | null>(null);
  const onResend = async (inviteId: string, label: string) => {
    setResendingId(inviteId);
    try {
      const resp = await customFetch<{ emailSent?: boolean | null }>(
        `/api/v1/teams/${teamId}/invites/${inviteId}/resend`,
        { method: "POST" },
      );
      if (resp.emailSent === false) {
        toast({
          title: "Couldn't re-send the email",
          description: `The invite for ${label} is still active — copy its link and share it directly.`,
          variant: "destructive",
        });
      } else if (resp.emailSent === null) {
        toast({
          title: "Notification re-sent",
          description: `${label} already has an account — we nudged them in-app.`,
        });
      } else {
        toast({ title: `Invite re-sent to ${label}` });
      }
      await invalidate();
    } catch {
      toast({ title: "Failed to re-send invite", variant: "destructive" });
    } finally {
      setResendingId(null);
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

  // Pick the right tab to land on when the team page was opened from a
  // notification deep link. Defaults to "roster" when we don't know yet
  // (e.g. the highlight target is a stale id) so the user still sees the
  // Roster panel they expected, not the Posts panel.
  const targetTab = useMemo<"roster" | "staff" | "invites">(() => {
    if (!highlightEntryId) return "roster";
    if (players.some((p) => p.id === highlightEntryId)) return "roster";
    if (staff.some((s) => s.id === highlightEntryId)) return "staff";
    if (invites.some((i) => i.id === highlightEntryId)) return "invites";
    return "roster";
  }, [highlightEntryId, players, staff, invites]);

  const [tab, setTab] = useState<string>(targetTab);
  // Resync once the data loads. The first render before the API
  // resolves picks "roster" by default; this effect promotes the tab
  // to the correct one as soon as we can identify which list the
  // highlighted entry actually lives in.
  useEffect(() => {
    setTab(targetTab);
  }, [targetTab]);

  // Scroll the highlighted row into view and apply the same brief ring
  // treatment used on /family so the user immediately sees their Accept /
  // Decline buttons. We re-run on every render where the highlight target
  // changes so subsequent notification clicks (without a remount) still
  // animate.
  const lastHighlightedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightEntryId) return;
    if (lastHighlightedRef.current === highlightEntryId) return;
    // Wait one tick so the just-switched tab has mounted its rows.
    const t = window.setTimeout(() => {
      const row = document.querySelector(
        `[data-roster-entry-id="${highlightEntryId}"]`,
      );
      if (!row) return;
      lastHighlightedRef.current = highlightEntryId;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      const ringClasses = [
        "ring-2",
        "ring-primary",
        "ring-offset-2",
        "ring-offset-background",
      ];
      row.classList.add(...ringClasses);
      window.setTimeout(() => {
        row.classList.remove(...ringClasses);
      }, 2400);
    }, 120);
    return () => window.clearTimeout(t);
  }, [highlightEntryId, tab, players, staff, invites]);

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

  const renderActions = (m: RosterMember) => {
    const isMe = meId === m.userId;
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
        {canManage && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setEditingMember(m)}
            data-testid={`btn-edit-${m.id}`}
            aria-label={`Edit ${m.displayName}`}
          >
            <Pencil className="w-4 h-4" />
          </Button>
        )}
      </div>
    );
  };

  const renderParentList = (parents: ParentRef[]) => (
    <div className="space-y-1.5">
      {parents.map((p) => (
        <Link key={p.id} href={`/users/${p.id}`}>
          <div className="flex items-center gap-3 cursor-pointer hover:text-primary text-sm">
            <UserAvatar
              avatarUrl={p.avatarUrl}
              displayName={p.displayName}
              size="xs"
              fallbackClassName="bg-blue-100 text-blue-700"
            />
            <span className="font-semibold">{p.displayName}</span>
            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none font-bold uppercase tracking-wider text-[10px]">
              Parent
            </Badge>
            {p.email && (
              <span className="text-xs text-muted-foreground truncate">
                {p.email}
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );

  const renderPlayerCard = (m: RosterMember) => {
    const parents = m.parents ?? [];
    const isExpanded = expandedPlayers.has(m.id);
    const hasParents = parents.length > 0;
    return (
      <div
        key={m.id}
        data-testid={`row-player-${m.id}`}
        data-roster-entry-id={m.id}
        className="px-4 py-3 border-b border-border last:border-b-0"
      >
        <div className="flex items-start gap-3">
          <Link href={`/users/${m.userId}`}>
            <div className="cursor-pointer">
              <UserAvatar
                avatarUrl={m.avatarUrl}
                displayName={m.displayName}
                size="sm"
                fallbackClassName="bg-slate-900 text-primary-foreground"
              />
            </div>
          </Link>
          <div className="flex-1 min-w-0">
            <Link href={`/users/${m.userId}`}>
              <div className="font-semibold cursor-pointer hover:text-primary truncate">
                {m.displayName}
              </div>
            </Link>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <span
                className="font-bold tabular-nums"
                data-testid={`text-jersey-${m.id}`}
              >
                {m.jerseyNumber == null ? (
                  <span className="text-muted-foreground font-normal">—</span>
                ) : (
                  `#${m.jerseyNumber}`
                )}
              </span>
              {renderStatusBadge(m.status === "pending")}
              {hasParents && (
                <button
                  type="button"
                  onClick={() => togglePlayerExpand(m.id)}
                  className="ml-1 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  data-testid={`btn-expand-${m.id}`}
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <span>
                    {parents.length} parent{parents.length > 1 ? "s" : ""}
                  </span>
                </button>
              )}
            </div>
          </div>
          <div className="shrink-0">{renderActions(m)}</div>
        </div>
        {isExpanded && hasParents && (
          <div
            className="mt-3 ml-11 rounded-md bg-muted/30 p-2"
            data-testid={`row-parents-${m.id}`}
          >
            {renderParentList(parents)}
          </div>
        )}
      </div>
    );
  };

  const renderStaffCard = (m: RosterMember) => (
    <div
      key={m.id}
      data-testid={`row-staff-${m.id}`}
      data-roster-entry-id={m.id}
      className="px-4 py-3 border-b border-border last:border-b-0"
    >
      <div className="flex items-start gap-3">
        <Link href={`/users/${m.userId}`}>
          <div className="cursor-pointer">
            <UserAvatar
              avatarUrl={m.avatarUrl}
              displayName={m.displayName}
              size="sm"
              fallbackClassName="bg-slate-900 text-primary-foreground"
            />
          </div>
        </Link>
        <div className="flex-1 min-w-0">
          <Link href={`/users/${m.userId}`}>
            <div className="font-semibold cursor-pointer hover:text-primary truncate">
              {m.displayName}
            </div>
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="capitalize">
              {m.position?.replace(/_/g, " ") ?? "—"}
            </span>
            {renderStatusBadge(m.status === "pending")}
            {m.joinedAt && (
              <span className="text-muted-foreground">
                Joined {formatDate(m.joinedAt)}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0">{renderActions(m)}</div>
      </div>
    </div>
  );

  const renderInviteCard = (i: RosterInvite) => {
    const label = i.email ?? "this person";
    return (
      <div
        key={i.id}
        data-testid={`row-invite-${i.id}`}
        data-roster-entry-id={i.id}
        className="px-4 py-3 border-b border-border last:border-b-0"
      >
        <div className="flex items-start gap-3">
          <Mail className="w-4 h-4 mt-1 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{i.email ?? "—"}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="capitalize">
                {i.position?.replace(/_/g, " ") ?? "—"}
              </span>
              {i.invitedBy?.displayName && (
                <span>· Invited by {i.invitedBy.displayName}</span>
              )}
              {i.createdAt && <span>· {formatDate(i.createdAt)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 font-bold rounded-full"
              onClick={() => onResend(i.id, label)}
              disabled={resendingId === i.id}
              data-testid={`btn-resend-${i.id}`}
            >
              <Mail className="w-3 h-3 mr-1" />
              {resendingId === i.id ? "Sending…" : "Resend"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 font-bold rounded-full text-destructive hover:text-destructive"
              onClick={() => onRevoke(i.id, label)}
              disabled={withdrawInvite.isPending}
              data-testid={`btn-revoke-${i.id}`}
            >
              <X className="w-3 h-3 mr-1" /> Revoke
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderPlayerRow = (m: RosterMember) => {
    const parents = m.parents ?? [];
    const isExpanded = expandedPlayers.has(m.id);
    const hasParents = parents.length > 0;
    return (
      <Fragment key={m.id}>
        <TableRow
          data-testid={`row-player-${m.id}`}
          data-roster-entry-id={m.id}
        >
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
                <UserAvatar
                  avatarUrl={m.avatarUrl}
                  displayName={m.displayName}
                  size="sm"
                  fallbackClassName="bg-slate-900 text-primary-foreground"
                />
                <span className="font-semibold">{m.displayName}</span>
              </div>
            </Link>
          </TableCell>
          <TableCell
            className="text-center font-bold tabular-nums"
            data-testid={`text-jersey-${m.id}`}
          >
            {m.jerseyNumber == null ? (
              <span className="text-muted-foreground font-normal">—</span>
            ) : (
              `#${m.jerseyNumber}`
            )}
          </TableCell>
          <TableCell className="text-xs text-muted-foreground">
            {hasParents
              ? `${parents.length} parent${parents.length > 1 ? "s" : ""}`
              : "—"}
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
            <TableCell colSpan={5} className="py-2">
              {renderParentList(parents)}
            </TableCell>
          </TableRow>
        )}
      </Fragment>
    );
  };

  const renderStaffRow = (m: RosterMember) => (
    <TableRow
      key={m.id}
      data-testid={`row-staff-${m.id}`}
      data-roster-entry-id={m.id}
    >
      <TableCell>
        <Link href={`/users/${m.userId}`}>
          <div className="flex items-center gap-3 cursor-pointer hover:text-primary">
            <UserAvatar
              avatarUrl={m.avatarUrl}
              displayName={m.displayName}
              size="sm"
              fallbackClassName="bg-slate-900 text-primary-foreground"
            />
            <span className="font-semibold">{m.displayName}</span>
          </div>
        </Link>
      </TableCell>
      <TableCell className="text-sm capitalize">
        {m.position?.replace(/_/g, " ") ?? "—"}
      </TableCell>
      <TableCell>{renderStatusBadge(m.status === "pending")}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatDate(m.joinedAt ?? "")}
      </TableCell>
      <TableCell className="text-right">{renderActions(m)}</TableCell>
    </TableRow>
  );

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="roster" className="font-bold">
          Roster
        </TabsTrigger>
        <TabsTrigger value="staff" className="font-bold">
          Staff
        </TabsTrigger>
        {canManage && (
          <TabsTrigger
            value="invites"
            className="font-bold"
            data-testid="tab-invites"
          >
            Pending
            {invites.length > 0 && (
              <Badge className="ml-1.5 h-5">{invites.length}</Badge>
            )}
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="roster" className="mt-4">
        <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-black text-sm uppercase tracking-wider">
              Players ({players.length})
            </h3>
            {canManage && (
              <Button
                size="sm"
                className="font-bold"
                onClick={onOpenInvite}
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
            ) : isLg ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Player</TableHead>
                    <TableHead className="w-16 text-center">#</TableHead>
                    <TableHead>Parents</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{players.map(renderPlayerRow)}</TableBody>
              </Table>
            ) : (
              <div>{players.map(renderPlayerCard)}</div>
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
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="font-bold"
                onClick={onOpenInvite}
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
            ) : isLg ? (
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
            ) : (
              <div>{staff.map(renderStaffCard)}</div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {canManage && (
        <TabsContent value="invites" className="mt-4">
          <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-black text-sm uppercase tracking-wider">
                Pending Invitations ({invites.length})
              </h3>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  className="font-bold"
                  onClick={onOpenInvite}
                  data-testid="btn-invite-pending"
                >
                  <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Invite
                </Button>
              )}
            </div>
            <CardContent className="p-0">
              {invites.length === 0 ? (
                <div
                  className="px-5 py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground"
                  data-testid="empty-invites"
                >
                  <Mail className="w-4 h-4" />
                  No invitations are waiting on a response.
                </div>
              ) : !isLg ? (
                <div>{invites.map(renderInviteCard)}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invitee</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Invited by</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((i) => {
                      const label = i.email ?? "this person";
                      return (
                        <TableRow
                          key={i.id}
                          data-testid={`row-invite-${i.id}`}
                          data-roster-entry-id={i.id}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2 font-semibold">
                              <Mail className="w-4 h-4 text-muted-foreground" />
                              {i.email ?? "—"}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm capitalize">
                            {i.position?.replace(/_/g, " ") ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {i.invitedBy?.displayName ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(i.createdAt ?? "")}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-3 font-bold rounded-full"
                                onClick={() => onResend(i.id, label)}
                                disabled={resendingId === i.id}
                                data-testid={`btn-resend-${i.id}`}
                              >
                                {resendingId === i.id ? "Sending…" : "Resend"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-3 font-bold rounded-full text-destructive hover:text-destructive"
                                onClick={() => onRevoke(i.id, label)}
                                disabled={withdrawInvite.isPending}
                                data-testid={`btn-revoke-${i.id}`}
                              >
                                <X className="w-3 h-3 mr-1" /> Revoke
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      )}

      <EditRosterMemberDialog
        teamId={teamId}
        member={editingMember}
        isLastAdmin={isLastAdmin}
        open={!!editingMember}
        onOpenChange={(v) => {
          if (!v) setEditingMember(null);
        }}
      />
    </Tabs>
  );
}
