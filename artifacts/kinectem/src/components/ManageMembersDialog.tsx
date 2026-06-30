import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  queryOpts,
  useListMembers,
  useUpdateMemberRole,
  useRemoveMember,
  useTransferOrganizationOwnership,
  useAddMember,
  useSearchUsers,
  useListOrganizationInvites,
  useCreateOrganizationInvite,
  useWithdrawOrganizationInvite,
  getListMembersQueryKey,
  getGetOrganizationByIdQueryKey,
  getListUserOrganizationsQueryKey,
  getListOrganizationInvitesQueryKey,
  type MemberResponse,
  type OrganizationInviteResponse,
  type UserSearchResult,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Crown,
  Shield,
  User,
  Loader2,
  UserPlus,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Copy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getInitials, formatOrgName } from "@/lib/format";

type Role = "owner" | "admin" | "member";

function roleBadge(role: Role) {
  if (role === "owner") {
    return (
      <Badge
        variant="default"
        className="text-[10px] font-bold gap-1 bg-amber-500 hover:bg-amber-500"
      >
        <Crown className="w-3 h-3" /> Owner
      </Badge>
    );
  }
  if (role === "admin") {
    return (
      <Badge variant="secondary" className="text-[10px] font-bold gap-1">
        <Shield className="w-3 h-3" /> Admin
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] font-bold gap-1">
      <User className="w-3 h-3" /> Member
    </Badge>
  );
}

export function ManageMembersDialog({
  open,
  onOpenChange,
  orgId,
  orgName,
  myUserId,
  myRole,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  orgName: string;
  myUserId: string;
  // The viewer's role in this org. Only owner/admin should ever open
  // this dialog; we still defensively gate write actions below.
  myRole: Role;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: membersResp, isLoading } = useListMembers(orgId, undefined, {
    query: queryOpts({ enabled: open }),
  });
  const members = membersResp?.data ?? [];

  // Task #541 — pending invites alongside the members list.
  const { data: invitesResp } = useListOrganizationInvites(
    orgId,
    { status: "pending" },
    { query: queryOpts({ enabled: open }) },
  );
  const pendingInvites = invitesResp?.data ?? [];

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListMembersQueryKey(orgId) }),
      qc.invalidateQueries({
        queryKey: getGetOrganizationByIdQueryKey(orgId),
      }),
      qc.invalidateQueries({
        queryKey: getListUserOrganizationsQueryKey(myUserId),
      }),
    ]);
  };

  const invalidateInvites = () =>
    qc.invalidateQueries({
      queryKey: getListOrganizationInvitesQueryKey(orgId),
    });

  const updateRole = useUpdateMemberRole({
    mutation: { onSuccess: invalidate },
  });
  const removeMember = useRemoveMember({
    mutation: { onSuccess: invalidate },
  });
  const transferOwnership = useTransferOrganizationOwnership({
    mutation: { onSuccess: invalidate },
  });
  const addMember = useAddMember({
    mutation: {
      onSuccess: async () => {
        await invalidate();
      },
    },
  });
  const createInvite = useCreateOrganizationInvite({
    mutation: { onSuccess: invalidateInvites },
  });
  const withdrawInvite = useWithdrawOrganizationInvite({
    mutation: { onSuccess: invalidateInvites },
  });

  // Per-row pending action UI state. We track the targeted user + the
  // pending action separately so the dialogs work for whichever member
  // the admin clicked, even when the list re-renders mid-mutation.
  const [removeTarget, setRemoveTarget] = useState<MemberResponse | null>(null);
  const [transferTarget, setTransferTarget] = useState<MemberResponse | null>(
    null,
  );

  // Task #541 — Add-admin picker state.
  const [addOpen, setAddOpen] = useState(false);

  const isOwner = myRole === "owner";

  const onPromoteDemote = (m: MemberResponse, next: "admin" | "member") => {
    updateRole.mutate(
      { orgId, userId: m.userId, data: { role: next } },
      {
        onSuccess: () =>
          toast({
            title:
              next === "admin"
                ? `${m.displayName} is now an admin`
                : `${m.displayName} is now a member`,
          }),
        onError: () =>
          toast({
            title: "Couldn't update role",
            variant: "destructive",
          }),
      },
    );
  };

  const onConfirmRemove = () => {
    if (!removeTarget) return;
    const target = removeTarget;
    removeMember.mutate(
      { orgId, userId: target.userId },
      {
        onSuccess: () => {
          toast({ title: `${target.displayName} removed` });
          setRemoveTarget(null);
        },
        onError: () => {
          toast({
            title: "Couldn't remove member",
            variant: "destructive",
          });
          setRemoveTarget(null);
        },
      },
    );
  };

  const onConfirmTransfer = () => {
    if (!transferTarget) return;
    const target = transferTarget;
    transferOwnership.mutate(
      { orgId, userId: target.userId },
      {
        onSuccess: () => {
          toast({
            title: `${target.displayName} is now the owner`,
            description: "You've been kept on as an admin.",
          });
          setTransferTarget(null);
        },
        onError: () => {
          toast({
            title: "Couldn't transfer ownership",
            variant: "destructive",
          });
          setTransferTarget(null);
        },
      },
    );
  };

  const onWithdrawInvite = (i: OrganizationInviteResponse) => {
    withdrawInvite.mutate(
      { orgId, inviteId: i.id },
      {
        onSuccess: () => toast({ title: `Invite to ${i.invitedEmail} withdrawn` }),
        onError: () =>
          toast({ title: "Couldn't withdraw invite", variant: "destructive" }),
      },
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-lg sm:max-h-[80vh] overflow-y-auto"
          data-testid="dialog-manage-members"
        >
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              Manage admins & members
            </DialogTitle>
            <DialogDescription>
              {formatOrgName(orgName)} has {members.length}{" "}
              {members.length === 1 ? "member" : "members"}. Promote a member
              to admin to let them manage teams, members, and posts on behalf
              of the org. Only the owner can transfer ownership.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end">
            <Button
              size="sm"
              className="font-bold h-8 gap-1"
              onClick={() => setAddOpen(true)}
              data-testid="btn-open-add-admin"
            >
              <UserPlus className="w-3 h-3" />
              Add admin
            </Button>
          </div>

          {isLoading ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading members…
            </div>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => {
                const isMe = m.userId === myUserId;
                const isTargetOwner = m.role === "owner";
                // Anyone with manage permission can promote/demote/remove
                // anyone except the owner. The owner row only ever shows
                // a "you" / "owner" badge — no role controls — and is
                // never removable. To replace the owner, use Transfer.
                const canEditThisRow = !isTargetOwner;
                return (
                  <li
                    key={m.userId}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card"
                    data-testid={`member-row-${m.userId}`}
                  >
                    <Avatar className="w-9 h-9 shrink-0">
                      {m.avatarUrl ? (
                        <AvatarImage src={m.avatarUrl} alt={m.displayName} />
                      ) : null}
                      <AvatarFallback className="bg-slate-900 text-primary-foreground text-xs font-bold">
                        {getInitials(m.displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">
                        {m.displayName}
                        {isMe && (
                          <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </p>
                      <div className="mt-0.5">{roleBadge(m.role as Role)}</div>
                    </div>
                    {canEditThisRow && (
                      <div className="flex flex-wrap gap-1 justify-end">
                        {m.role === "member" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="font-bold h-8"
                            onClick={() => onPromoteDemote(m, "admin")}
                            disabled={updateRole.isPending}
                            data-testid={`btn-promote-${m.userId}`}
                          >
                            Make admin
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="font-bold h-8"
                            onClick={() => onPromoteDemote(m, "member")}
                            disabled={updateRole.isPending}
                            data-testid={`btn-demote-${m.userId}`}
                          >
                            Demote to member
                          </Button>
                        )}
                        {isOwner && !isMe && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="font-bold h-8 text-amber-700 hover:text-amber-700 border-amber-400"
                            onClick={() => setTransferTarget(m)}
                            disabled={transferOwnership.isPending}
                            data-testid={`btn-transfer-${m.userId}`}
                          >
                            <Crown className="w-3 h-3 mr-1" />
                            Transfer ownership
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="font-bold h-8 text-destructive hover:text-destructive"
                          onClick={() => setRemoveTarget(m)}
                          disabled={removeMember.isPending}
                          data-testid={`btn-remove-${m.userId}`}
                        >
                          Remove
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {pendingInvites.length > 0 && (
            <div className="space-y-2" data-testid="section-pending-invites">
              <h3 className="text-xs uppercase tracking-wide font-bold text-muted-foreground mt-2">
                Pending invites
              </h3>
              <ul className="space-y-2">
                {pendingInvites.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-border bg-muted/30"
                    data-testid={`invite-row-${i.id}`}
                  >
                    <Avatar className="w-9 h-9 shrink-0">
                      <AvatarFallback className="bg-slate-200 text-slate-700 text-xs font-bold">
                        <Mail className="w-4 h-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">
                        {i.invitedEmail}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1">
                        {roleBadge(i.role as Role)}
                        <span className="text-[11px] text-muted-foreground">
                          Invited by {i.invitedBy.displayName}
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-bold h-8"
                      onClick={() => onWithdrawInvite(i)}
                      disabled={withdrawInvite.isPending}
                      data-testid={`btn-withdraw-invite-${i.id}`}
                    >
                      Withdraw
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AddAdminDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        orgId={orgId}
        members={members}
        pendingInvites={pendingInvites}
        addMemberPending={addMember.isPending}
        onAddExistingUser={(u, role) => {
          addMember.mutate(
            { orgId, data: { userId: u.id, role } },
            {
              onSuccess: () => {
                toast({ title: `${u.displayName} added as ${role}` });
                setAddOpen(false);
              },
              onError: (err: unknown) =>
                toast({
                  title:
                    (err as Error)?.message ?? "Couldn't add member",
                  variant: "destructive",
                }),
            },
          );
        }}
        onInviteByEmail={async (email, role, note) => {
          // Task #656 — return the email-send outcome + accept URL so the
          // dialog can surface a "couldn't send automatically" fallback with
          // a copyable link (mirrors the team-invite flow). The server
          // appends `emailSent`/`acceptUrl` outside the locked openapi.yaml,
          // read via a narrow cast.
          const resp = await createInvite.mutateAsync({
            orgId,
            data: { email, role, note: note || undefined },
          });
          const extra = resp as {
            emailSent?: boolean | null;
            acceptUrl?: string;
            token?: string;
          };
          return {
            emailSent: extra.emailSent ?? null,
            acceptUrl:
              extra.acceptUrl ??
              `${window.location.origin}${import.meta.env.BASE_URL}org-invites/${extra.token ?? ""}`,
          };
        }}
      />

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(v) => !v && setRemoveTarget(null)}
      >
        <AlertDialogContent data-testid="dialog-confirm-remove-member">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removeTarget?.displayName} from {formatOrgName(orgName)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They'll lose access to anything restricted to organization
              members. They can rejoin later by sending a new join request.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMember.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmRemove}
              disabled={removeMember.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="btn-confirm-remove-member"
            >
              {removeMember.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!transferTarget}
        onOpenChange={(v) => !v && setTransferTarget(null)}
      >
        <AlertDialogContent data-testid="dialog-confirm-transfer-ownership">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Transfer ownership of {formatOrgName(orgName)} to {transferTarget?.displayName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {transferTarget?.displayName} will become the owner and gain full
              control of the organization. You'll be kept on as an admin so you
              can still manage day-to-day. This can't be undone unless the new
              owner transfers it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transferOwnership.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmTransfer}
              disabled={transferOwnership.isPending}
              className="bg-amber-600 text-white hover:bg-amber-700"
              data-testid="btn-confirm-transfer-ownership"
            >
              {transferOwnership.isPending ? "Transferring…" : "Transfer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Task #541 — Add-admin picker. Two tabs:
//   1. Find existing Kinectem user → POST /organizations/:orgId/members
//   2. Invite by email          → POST /organizations/:orgId/invites
// ---------------------------------------------------------------------------

function AddAdminDialog({
  open,
  onOpenChange,
  members,
  pendingInvites,
  addMemberPending,
  onAddExistingUser,
  onInviteByEmail,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  members: MemberResponse[];
  pendingInvites: OrganizationInviteResponse[];
  addMemberPending: boolean;
  onAddExistingUser: (u: UserSearchResult, role: "admin" | "member") => void;
  onInviteByEmail: (
    email: string,
    role: "admin" | "member",
    note: string,
  ) => Promise<{ emailSent: boolean | null; acceptUrl: string }>;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"find" | "email">("find");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"admin" | "member">("admin");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");

  // Task #656 — once an invite is created we show a result panel instead of
  // the form, surfacing whether the email actually sent plus a copyable
  // accept link + message (mirrors InviteRosterDialog).
  const [inviteResult, setInviteResult] = useState<{
    email: string;
    emailSent: boolean | null;
    acceptUrl: string;
  } | null>(null);
  const [resultCopied, setResultCopied] = useState(false);
  const [resultMsgCopied, setResultMsgCopied] = useState(false);
  const [sending, setSending] = useState(false);

  // Reset state every time the dialog closes so the next open is fresh.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setEmail("");
      setNote("");
      setRole("admin");
      setTab("find");
      setInviteResult(null);
      setResultCopied(false);
      setResultMsgCopied(false);
      setSending(false);
    }
  }, [open]);

  const shortInviteMessage = (link: string) =>
    `You've been invited to join an organization on Kinectem — accept here: ${link}`;

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

  const onSubmitInvite = async () => {
    const trimmed = email.trim();
    setSending(true);
    try {
      const { emailSent, acceptUrl } = await onInviteByEmail(
        trimmed,
        role,
        note.trim(),
      );
      setResultCopied(false);
      setResultMsgCopied(false);
      setInviteResult({ email: trimmed, emailSent, acceptUrl });
    } catch (err: unknown) {
      toast({
        title: (err as Error)?.message ?? "Couldn't send invite",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const memberIds = new Set(members.map((m) => m.userId));
  const pendingEmails = new Set(
    pendingInvites.map((i) => i.invitedEmail.toLowerCase()),
  );

  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const enabledSearch = debouncedQuery.length >= 2;
  const search = useSearchUsers(
    { search: debouncedQuery, limit: 10 },
    { query: queryOpts({ enabled: enabledSearch && tab === "find" && open }) },
  );
  const results = (search.data?.data ?? []).filter(
    (u) => !memberIds.has(u.id),
  );

  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailAlreadyPending = pendingEmails.has(email.trim().toLowerCase());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-add-admin"
      >
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            Add admin
          </DialogTitle>
          <DialogDescription>
            Find someone already on Kinectem, or invite them by email to join
            this organization.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs font-bold">Role</Label>
            <div className="flex gap-2 mt-1">
              <Button
                size="sm"
                variant={role === "admin" ? "default" : "outline"}
                className="font-bold h-8"
                onClick={() => setRole("admin")}
                data-testid="btn-role-admin"
              >
                <Shield className="w-3 h-3 mr-1" /> Admin
              </Button>
              <Button
                size="sm"
                variant={role === "member" ? "default" : "outline"}
                className="font-bold h-8"
                onClick={() => setRole("member")}
                data-testid="btn-role-member"
              >
                <User className="w-3 h-3 mr-1" /> Member
              </Button>
            </div>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "find" | "email")}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="find" data-testid="tab-find-user">
                Find user
              </TabsTrigger>
              <TabsTrigger value="email" data-testid="tab-invite-email">
                Invite by email
              </TabsTrigger>
            </TabsList>

            <TabsContent value="find" className="space-y-2 mt-3">
              <Input
                placeholder="Search by name (min 2 characters)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="input-search-user"
              />
              {enabledSearch && search.isLoading ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-1" />
                  Searching…
                </div>
              ) : enabledSearch && results.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  No users found. Try inviting them by email instead.
                </p>
              ) : null}
              {!enabledSearch && (
                <p className="py-1 text-xs text-muted-foreground">
                  Start typing to search for existing Kinectem users.
                </p>
              )}
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {results.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-muted"
                    data-testid={`search-result-${u.id}`}
                  >
                    <Avatar className="w-8 h-8">
                      {u.avatarUrl ? (
                        <AvatarImage src={u.avatarUrl} alt={u.displayName} />
                      ) : null}
                      <AvatarFallback className="bg-slate-900 text-primary-foreground text-[10px] font-bold">
                        {getInitials(u.displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-bold flex-1 min-w-0 truncate">
                      {u.displayName}
                    </span>
                    <Button
                      size="sm"
                      className="font-bold h-8"
                      onClick={() => onAddExistingUser(u, role)}
                      disabled={addMemberPending}
                      data-testid={`btn-add-user-${u.id}`}
                    >
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            </TabsContent>

            <TabsContent value="email" className="space-y-2 mt-3">
              {inviteResult ? (
                <div className="space-y-3" data-testid="invite-result-panel">
                  {inviteResult.emailSent === true && (
                    <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                      <p>
                        <span className="font-bold">
                          Invite emailed to {inviteResult.email}.
                        </span>{" "}
                        They'll get a link to accept. You can also share the
                        link below as a backup.
                      </p>
                    </div>
                  )}
                  {inviteResult.emailSent === false && (
                    <div
                      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
                      data-testid="invite-email-failed"
                    >
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <p>
                        <span className="font-bold">
                          We couldn't send the email automatically.
                        </span>{" "}
                        The invite is still active — copy the link below and send
                        it to {inviteResult.email} yourself.
                      </p>
                    </div>
                  )}
                  {inviteResult.emailSent === null && (
                    <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                      <Mail className="w-4 h-4 mt-0.5 shrink-0" />
                      <p>
                        <span className="font-bold">
                          Invite created for {inviteResult.email}.
                        </span>{" "}
                        Share the link below so they can accept.
                      </p>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label className="font-bold text-xs">Invite link</Label>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center min-w-0">
                      <code
                        className="block sm:flex-1 min-w-0 max-w-full text-xs bg-muted px-3 py-2 rounded-lg truncate"
                        data-testid="text-invite-accept-link"
                      >
                        {inviteResult.acceptUrl}
                      </code>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          copyToClipboard(inviteResult.acceptUrl, "Link");
                          setResultCopied(true);
                          setTimeout(() => setResultCopied(false), 2000);
                        }}
                        className="gap-1 font-bold self-start sm:self-auto shrink-0"
                        data-testid="button-copy-invite-accept-link"
                      >
                        {resultCopied ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="font-bold text-xs">Message to send</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          copyToClipboard(
                            shortInviteMessage(inviteResult.acceptUrl),
                            "Message",
                          );
                          setResultMsgCopied(true);
                          setTimeout(() => setResultMsgCopied(false), 2000);
                        }}
                        className="gap-1 font-bold shrink-0"
                        data-testid="button-copy-invite-accept-message"
                      >
                        {resultMsgCopied ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                    <pre
                      className="whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 text-xs font-sans leading-5"
                      data-testid="text-invite-accept-message"
                    >
                      {shortInviteMessage(inviteResult.acceptUrl)}
                    </pre>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    className="font-bold w-full"
                    onClick={() => {
                      setInviteResult(null);
                      setEmail("");
                      setNote("");
                    }}
                    data-testid="btn-invite-another"
                  >
                    Invite someone else
                  </Button>
                </div>
              ) : (
                <>
                  <div>
                    <Label htmlFor="invite-email" className="text-xs font-bold">
                      Email address
                    </Label>
                    <Input
                      id="invite-email"
                      type="email"
                      placeholder="coach@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      data-testid="input-invite-email"
                    />
                    {emailAlreadyPending && (
                      <p className="text-xs text-amber-700 mt-1">
                        An invite is already pending for this email.
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="invite-note" className="text-xs font-bold">
                      Personal note (optional)
                    </Label>
                    <Textarea
                      id="invite-note"
                      rows={3}
                      maxLength={500}
                      placeholder="Hi! Joining our staff?"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      data-testid="input-invite-note"
                    />
                  </div>
                  <Button
                    className="font-bold w-full"
                    disabled={!emailLooksValid || emailAlreadyPending || sending}
                    onClick={onSubmitInvite}
                    data-testid="btn-send-invite"
                  >
                    {sending ? "Sending…" : "Send invite"}
                  </Button>
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
