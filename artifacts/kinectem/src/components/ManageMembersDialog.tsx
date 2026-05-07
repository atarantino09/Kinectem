import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  queryOpts,
  useListMembers,
  useUpdateMemberRole,
  useRemoveMember,
  useTransferOrganizationOwnership,
  getListMembersQueryKey,
  getGetOrganizationByIdQueryKey,
  getListUserOrganizationsQueryKey,
  type MemberResponse,
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
import { Crown, Shield, User, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/format";

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

  const updateRole = useUpdateMemberRole({
    mutation: { onSuccess: invalidate },
  });
  const removeMember = useRemoveMember({
    mutation: { onSuccess: invalidate },
  });
  const transferOwnership = useTransferOrganizationOwnership({
    mutation: { onSuccess: invalidate },
  });

  // Per-row pending action UI state. We track the targeted user + the
  // pending action separately so the dialogs work for whichever member
  // the admin clicked, even when the list re-renders mid-mutation.
  const [removeTarget, setRemoveTarget] = useState<MemberResponse | null>(null);
  const [transferTarget, setTransferTarget] = useState<MemberResponse | null>(
    null,
  );

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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-lg sm:max-h-[80vh]"
          data-testid="dialog-manage-members"
        >
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              Manage members
            </DialogTitle>
            <DialogDescription>
              {orgName} has {members.length}{" "}
              {members.length === 1 ? "member" : "members"}. Only the owner can
              transfer ownership.
            </DialogDescription>
          </DialogHeader>

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
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(v) => !v && setRemoveTarget(null)}
      >
        <AlertDialogContent data-testid="dialog-confirm-remove-member">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removeTarget?.displayName} from {orgName}?
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
              Transfer ownership of {orgName} to {transferTarget?.displayName}?
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
