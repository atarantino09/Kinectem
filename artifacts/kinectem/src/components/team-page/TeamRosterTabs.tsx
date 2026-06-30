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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  Copy,
  Link2,
  AlertTriangle,
  MoreHorizontal,
  Info,
  Send,
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
  // Task #666 — plaintext accept token (roster tokens are NOT hashed at
  // rest) plus SendGrid delivery state, both appended outside the locked
  // openapi.yaml and read here via the generated type's index signature.
  token?: string | null;
  deliveryStatus?: string | null;
  deliveryReason?: string | null;
};

interface TeamRosterTabsProps {
  teamId: string;
  isAdmin: boolean;
  meId: string | undefined;
  players: RosterMember[];
  staff: RosterMember[];
  invites: RosterInvite[];
  highlightEntryId?: string | null;
  teamName?: string;
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
  teamName,
  onOpenInvite,
}: TeamRosterTabsProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isLg = useIsLg();
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [editingMember, setEditingMember] = useState<RosterMember | null>(null);
  // The invite whose "Share link" dialog is open (null = closed). Task #673.
  const [shareInvite, setShareInvite] = useState<RosterInvite | null>(null);

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

  // Task #666 — roster invite tokens are stored in plaintext, so the public
  // accept link can be reconstructed on the client without a round-trip.
  const inviteLink = (i: RosterInvite) =>
    i.token
      ? `${window.location.origin}${import.meta.env.BASE_URL}invites/${i.token}`
      : null;

  const shortInviteMessage = (link: string) =>
    teamName
      ? `You've been invited to join ${teamName} on Kinectem — accept here: ${link}`
      : `You've been invited to join a team on Kinectem — accept here: ${link}`;

  const copyToClipboard = (text: string, label: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast({ title: `${label} copied` }))
      .catch(() =>
        toast({
          title: `Couldn't copy ${label.toLowerCase()}`,
          variant: "destructive",
        }),
      );

  const onCopyMessage = (i: RosterInvite) => {
    const link = inviteLink(i);
    if (!link) {
      toast({ title: "No link available for this invite", variant: "destructive" });
      return;
    }
    copyToClipboard(shortInviteMessage(link), "Message");
  };

  // Task #666 — surface a delivery problem flagged by the SendGrid Event
  // Webhook so an admin knows the email never landed and should share the
  // copied link directly. `delivered`/`sent`/`unknown` aren't problems.
  const deliveryProblem = (
    status?: string | null,
  ): { label: string; hint: string } | null => {
    switch (status) {
      case "bounced":
        return { label: "Bounced", hint: "The email bounced — share the link directly." };
      case "dropped":
        return { label: "Not delivered", hint: "SendGrid dropped the email — share the link directly." };
      case "deferred":
        return { label: "Delayed", hint: "Delivery is delayed — you can share the link directly." };
      case "spam":
        return { label: "Marked spam", hint: "Recipient marked it spam — share the link directly." };
      default:
        return null;
    }
  };

  // Task #673 — one primary "Share link" button plus an overflow menu for the
  // rest, shared by the desktop table and the mobile card so the two layouts
  // stay in lockstep. Share link opens a dialog; the destructive Revoke is
  // separated and marked destructive in the menu.
  const renderInviteActions = (i: RosterInvite) => {
    const label = i.email ?? "this person";
    const hasLink = !!i.token;
    const isResending = resendingId === i.id;
    return (
      <div className="flex items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-3 font-bold rounded-full"
          onClick={() => setShareInvite(i)}
          disabled={!hasLink}
          title={
            hasLink
              ? "Show the join link and a ready-to-paste message so you can send the invite yourself"
              : "No join link is available for this invite yet"
          }
          data-testid={`btn-share-link-${i.id}`}
        >
          <Link2 className="w-3 h-3 mr-1" /> Share link
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0 rounded-full"
              aria-label="More invite actions"
              title="More actions"
              data-testid={`btn-invite-more-${i.id}`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="font-bold w-56">
            <DropdownMenuItem
              onSelect={() => onCopyMessage(i)}
              disabled={!hasLink}
              data-testid={`btn-copy-message-${i.id}`}
            >
              <Copy className="w-3.5 h-3.5 mr-2" /> Copy invite message
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                // Keep the menu's focus from firing the resend twice and let
                // the async handler run; closing is fine.
                e.preventDefault();
                onResend(i.id, label);
              }}
              disabled={isResending}
              data-testid={`btn-resend-${i.id}`}
            >
              <Send className="w-3.5 h-3.5 mr-2" />
              {isResending ? "Sending…" : "Resend invite email"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onRevoke(i.id, label)}
              disabled={withdrawInvite.isPending}
              className="text-destructive focus:text-destructive"
              data-testid={`btn-revoke-${i.id}`}
            >
              <X className="w-3.5 h-3.5 mr-2" /> Revoke invitation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
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
    const problem = deliveryProblem(i.deliveryStatus);
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
            <div className="flex items-center gap-2">
              <span className="font-semibold truncate">{i.email ?? "—"}</span>
              {problem && (
                <Badge
                  variant="destructive"
                  className="gap-1 text-[10px]"
                  title={problem.hint}
                  data-testid={`invite-delivery-${i.id}`}
                >
                  <AlertTriangle className="w-3 h-3" />
                  {problem.label}
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="capitalize">
                {i.position?.replace(/_/g, " ") ?? "—"}
              </span>
              {i.invitedBy?.displayName && (
                <span>· Invited by {i.invitedBy.displayName}</span>
              )}
              {i.createdAt && <span>· {formatDate(i.createdAt)}</span>}
            </div>
            {problem && (
              <p className="mt-1 text-xs text-destructive">{problem.hint}</p>
            )}
          </div>
          <div className="shrink-0">{renderInviteActions(i)}</div>
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
              {invites.length > 0 && (
                <div
                  className="m-4 flex items-start gap-2.5 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-xs text-muted-foreground"
                  data-testid="invite-delivery-note"
                >
                  <Info className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <p className="leading-relaxed">
                    Emailed invites occasionally bounce or land in a spam folder.
                    If an invite stays pending for a while, use{" "}
                    <span className="font-semibold text-foreground">Share link</span>{" "}
                    to copy the join link and send it yourself by text, your own
                    email, or any chat.
                  </p>
                </div>
              )}
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
                              {(() => {
                                const problem = deliveryProblem(i.deliveryStatus);
                                return problem ? (
                                  <Badge
                                    variant="destructive"
                                    className="gap-1 text-[10px]"
                                    title={problem.hint}
                                    data-testid={`invite-delivery-${i.id}`}
                                  >
                                    <AlertTriangle className="w-3 h-3" />
                                    {problem.label}
                                  </Badge>
                                ) : null;
                              })()}
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
                            {renderInviteActions(i)}
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

      {/* Task #673 — "Share link" dialog. Surfaces the join link and a
          ready-to-paste invite message with one-click copy buttons so a coach
          can send the invite outside Kinectem when the email never lands. */}
      <Dialog
        open={!!shareInvite}
        onOpenChange={(v) => {
          if (!v) setShareInvite(null);
        }}
      >
        <DialogContent data-testid="dialog-share-invite">
          <DialogHeader>
            <DialogTitle>Share the invite link</DialogTitle>
            <DialogDescription>
              {shareInvite?.email
                ? `Send this to ${shareInvite.email} yourself — by text, your own email, or any chat. They can join Kinectem with the link below.`
                : "Send this yourself — by text, your own email, or any chat. They can join Kinectem with the link below."}
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const link = shareInvite ? inviteLink(shareInvite) : null;
            if (!link) {
              return (
                <p className="text-sm text-muted-foreground">
                  No join link is available for this invite yet.
                </p>
              );
            }
            const message = shortInviteMessage(link);
            return (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Join link
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={link}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 min-w-0 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
                      data-testid="input-share-link"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 font-bold"
                      onClick={() => copyToClipboard(link, "Link")}
                      data-testid="btn-dialog-copy-link"
                    >
                      <Link2 className="w-3.5 h-3.5 mr-1.5" /> Copy
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Ready-to-paste message
                  </p>
                  <div className="flex items-start gap-2">
                    <textarea
                      readOnly
                      value={message}
                      onFocus={(e) => e.currentTarget.select()}
                      rows={3}
                      className="flex-1 min-w-0 resize-none rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
                      data-testid="textarea-share-message"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 font-bold"
                      onClick={() => copyToClipboard(message, "Message")}
                      data-testid="btn-dialog-copy-message"
                    >
                      <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
