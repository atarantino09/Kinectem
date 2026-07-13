import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUserGuardians,
  getListUserGuardiansQueryKey,
  useInviteGuardian,
  useRemoveGuardianLink,
  useTransferPrimaryGuardian,
  type GuardianLinkResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/UserAvatar";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, UserPlus, Star, Trash2 } from "lucide-react";
import type { Child } from "./types";

interface Props {
  child: Child;
  myUserId: string;
}

const REL_LABEL: Record<string, string> = {
  parent: "Parent",
  legal_guardian: "Legal guardian",
};

// Task #755 — "Guardians" subsection on a child card. Lists every guardian
// link for the child (active + pending email invites), lets any active
// guardian invite the other parent, and lets the primary guardian remove a
// co-guardian or hand over the primary role. The server enforces all
// permissions; buttons here are only shown where they can plausibly succeed.
export function ChildGuardiansSection({ child, myUserId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useListUserGuardians(child.id);
  const links: GuardianLinkResponse[] = data?.data ?? [];

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListUserGuardiansQueryKey(child.id),
    });

  const myLink = links.find(
    (l) => l.status === "active" && l.guardian.id === myUserId,
  );
  const iAmPrimary = myLink?.isPrimary === true;
  const activeCount = links.filter((l) => l.status === "active").length;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRel, setInviteRel] = useState<"parent" | "legal_guardian">(
    "parent",
  );
  const [confirmRemove, setConfirmRemove] =
    useState<GuardianLinkResponse | null>(null);
  const [confirmTransfer, setConfirmTransfer] =
    useState<GuardianLinkResponse | null>(null);

  const errMsg = (err: unknown, fallback: string) => {
    const e = err as { error?: string; message?: string } | undefined;
    return e?.error ?? e?.message ?? fallback;
  };

  const invite = useInviteGuardian({
    mutation: {
      onSuccess: (res) => {
        void refresh();
        setInviteOpen(false);
        setInviteEmail("");
        toast({
          title:
            "message" in res
              ? res.message
              : "Invitation sent. They'll get an email with the next steps.",
        });
      },
      onError: (err) =>
        toast({
          title: errMsg(err, "Couldn't send the invitation"),
          variant: "destructive",
        }),
    },
  });

  const remove = useRemoveGuardianLink({
    mutation: {
      onSuccess: () => {
        void refresh();
        setConfirmRemove(null);
        toast({ title: "Guardian removed" });
      },
      onError: (err) => {
        setConfirmRemove(null);
        toast({
          title: errMsg(err, "Couldn't remove this guardian"),
          variant: "destructive",
        });
      },
    },
  });

  const transfer = useTransferPrimaryGuardian({
    mutation: {
      onSuccess: () => {
        void refresh();
        setConfirmTransfer(null);
        toast({ title: "Primary guardian updated" });
      },
      onError: (err) => {
        setConfirmTransfer(null);
        toast({
          title: errMsg(err, "Couldn't transfer the primary role"),
          variant: "destructive",
        });
      },
    },
  });

  if (isLoading) return null;

  return (
    <div
      className="pt-2 border-t border-border space-y-2"
      data-testid={`section-guardians-${child.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          <p className="text-xs font-black uppercase tracking-wider text-primary">
            Guardians
          </p>
        </div>
        {myLink != null && (
          <Button
            size="sm"
            variant="outline"
            className="font-bold rounded-full h-7 px-3 text-xs"
            onClick={() => setInviteOpen(true)}
            data-testid={`btn-invite-guardian-${child.id}`}
          >
            <UserPlus className="w-3.5 h-3.5 mr-1" />
            Invite co-parent
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {links.map((l) => {
          const isMe = l.guardian.id === myUserId;
          const pending = l.status === "pending";
          return (
            <div
              key={l.id}
              className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-muted/30"
              data-testid={`row-guardian-${l.id}`}
            >
              <UserAvatar
                avatarUrl={l.guardian.avatarUrl}
                displayName={l.guardian.displayName}
                size="sm"
                className="border border-border shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate [overflow-wrap:anywhere]">
                  {l.guardian.displayName}
                  {isMe && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      (you)
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {REL_LABEL[l.relationshipType] ?? l.relationshipType}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {l.isPrimary && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-bold"
                    data-testid={`badge-primary-${l.id}`}
                  >
                    <Star className="w-3 h-3" />
                    Primary
                  </span>
                )}
                {pending && (
                  <span
                    className="inline-flex items-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 text-[11px] font-bold"
                    data-testid={`badge-pending-${l.id}`}
                  >
                    Pending
                  </span>
                )}
                {iAmPrimary && !l.isPrimary && l.status === "active" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs font-bold"
                    onClick={() => setConfirmTransfer(l)}
                    data-testid={`btn-transfer-primary-${l.id}`}
                  >
                    Make primary
                  </Button>
                )}
                {((iAmPrimary && !l.isPrimary) ||
                  (isMe && !l.isPrimary && activeCount > 1)) && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmRemove(l)}
                    data-testid={`btn-remove-guardian-${l.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent data-testid={`dialog-invite-guardian-${child.id}`}>
          <DialogHeader>
            <DialogTitle>Invite the other parent</DialogTitle>
            <DialogDescription>
              They'll get an email inviting them to become a guardian of{" "}
              {child.firstName}. Once they accept, they'll see everything you
              see on this dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`invite-email-${child.id}`}>Their email</Label>
              <Input
                id={`invite-email-${child.id}`}
                type="email"
                placeholder="parent@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                data-testid={`input-invite-email-${child.id}`}
              />
            </div>
            <div className="space-y-2">
              <Label>Relationship to {child.firstName}</Label>
              <Select
                value={inviteRel}
                onValueChange={(v) =>
                  setInviteRel(v as "parent" | "legal_guardian")
                }
              >
                <SelectTrigger
                  data-testid={`select-invite-relationship-${child.id}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parent">Parent</SelectItem>
                  <SelectItem value="legal_guardian">
                    Legal guardian
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInviteOpen(false)}
              data-testid={`btn-cancel-invite-${child.id}`}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={
                invite.isPending || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail)
              }
              onClick={() =>
                invite.mutate({
                  userId: child.id,
                  data: {
                    email: inviteEmail.trim(),
                    relationshipType: inviteRel,
                  },
                })
              }
              data-testid={`btn-send-invite-${child.id}`}
            >
              {invite.isPending ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmRemove != null}
        onOpenChange={(open) => {
          if (!open) setConfirmRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this guardian?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRemove?.guardian.displayName} will no longer be able to
              manage {child.firstName}'s account or see their activity. You can
              invite them again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-remove-guardian">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={() => {
                if (confirmRemove)
                  remove.mutate({ linkId: confirmRemove.id });
              }}
              data-testid="btn-confirm-remove-guardian"
            >
              {remove.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmTransfer != null}
        onOpenChange={(open) => {
          if (!open) setConfirmTransfer(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer the primary role?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTransfer?.guardian.displayName} will become{" "}
              {child.firstName}'s primary guardian — the main contact for
              consent decisions. You'll stay linked as a guardian.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-transfer-primary">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={transfer.isPending}
              onClick={() => {
                if (confirmTransfer)
                  transfer.mutate({ linkId: confirmTransfer.id });
              }}
              data-testid="btn-confirm-transfer-primary"
            >
              {transfer.isPending ? "Transferring…" : "Transfer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
