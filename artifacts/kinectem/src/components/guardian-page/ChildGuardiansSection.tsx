import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUserGuardians,
  getListUserGuardiansQueryKey,
  useRemoveGuardianLink,
  useTransferPrimaryGuardian,
  type GuardianLinkResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
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
import { UserAvatar } from "@/components/UserAvatar";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, UserPlus, Star, Trash2, Mail } from "lucide-react";
import { InviteFamilyContactDialog } from "./InviteFamilyContactDialog";
import { useFamilyContacts, useRemoveFamilyContact } from "@/hooks/useFamilyContacts";
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
  const contacts = useFamilyContacts(child.id, !!myLink);
  const removeContact = useRemoveFamilyContact(child.id);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmContactRemove, setConfirmContactRemove] = useState<{ id: string; name: string } | null>(null);
  const [confirmRemove, setConfirmRemove] =
    useState<GuardianLinkResponse | null>(null);
  const [confirmTransfer, setConfirmTransfer] =
    useState<GuardianLinkResponse | null>(null);

  const errMsg = (err: unknown, fallback: string) => {
    const e = err as { error?: string; message?: string } | undefined;
    return e?.error ?? e?.message ?? fallback;
  };

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
            Invite family contact
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

      {myLink && <div className="pt-2 border-t border-border space-y-2">
        <p className="text-xs font-black uppercase tracking-wider text-primary flex items-center gap-2"><Mail className="h-3.5 w-3.5" />Updates-only contacts</p>
        {contacts.isLoading ? <p className="text-xs text-muted-foreground">Loading contacts…</p> : contacts.isError ? (
          <Button size="sm" variant="outline" onClick={() => void contacts.refetch()} data-testid={`button-retry-contacts-${child.id}`}>Couldn't load contacts. Retry</Button>
        ) : (contacts.data?.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No updates-only contacts yet.</p>
        ) : contacts.data?.data.map((contact) => (
          <div key={contact.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2.5" data-testid={`row-family-contact-${contact.id}`}>
            <div className="min-w-0 flex-1"><p className="font-bold text-sm">{contact.firstName} {contact.lastName}</p><p className="text-xs text-muted-foreground break-all">{contact.email}</p></div>
            <span className="text-xs font-semibold capitalize text-muted-foreground" data-testid={`status-family-contact-${contact.id}`}>{contact.status}</span>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label={`Remove ${contact.firstName} ${contact.lastName}`} onClick={() => setConfirmContactRemove({ id: contact.id, name: `${contact.firstName} ${contact.lastName}` })} data-testid={`button-remove-family-contact-${contact.id}`}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>}
      <InviteFamilyContactDialog childId={child.id} childName={child.firstName} open={inviteOpen} onOpenChange={setInviteOpen} />
      <AlertDialog open={!!confirmContactRemove} onOpenChange={(open) => { if (!open) setConfirmContactRemove(null); }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove updates-only contact?</AlertDialogTitle><AlertDialogDescription>{confirmContactRemove?.name} will no longer receive updates about {child.firstName}.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={removeContact.isPending} className="bg-destructive text-destructive-foreground" onClick={async (e) => { e.preventDefault(); if (!confirmContactRemove) return; try { await removeContact.mutateAsync(confirmContactRemove.id); toast({ title: "Contact removed" }); setConfirmContactRemove(null); } catch (err) { toast({ title: errMsg(err, "Couldn't remove contact"), variant: "destructive" }); } }} data-testid="button-confirm-remove-family-contact">{removeContact.isPending ? "Removing…" : "Remove"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
