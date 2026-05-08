import { useState } from "react";
import { Link } from "wouter";
import type { ChildNotificationItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/UserAvatar";
import { Pencil, Unlink2 } from "lucide-react";
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
import { ChildConfirmationStatus } from "./ChildConfirmationStatus";
import { ChildNotificationsSection } from "./ChildNotificationsSection";
import { ChildPendingInvites } from "./ChildPendingInvites";
import type {
  Child,
  ChildNotificationsState,
  DecisionInFlight,
  PendingTeamInvite,
} from "./types";

interface Props {
  child: Child;
  loadingEditFor: string | null;
  resending: string | null;
  actingOnEntryId: string | null;
  pendingInvites: PendingTeamInvite[];
  notifState: ChildNotificationsState | undefined;
  decidingItem: DecisionInFlight;
  revertingItemKey: string | null;
  approveAllForChild: string | null;
  unlinking: string | null;
  refSetter: (el: HTMLDivElement | null) => void;
  onEdit: (child: Child) => void;
  onConsentChange: (child: Child, value: boolean) => void;
  onResend: (child: Child) => void;
  onUnlink: (child: Child) => void | Promise<void>;
  onPendingAction: (
    child: Child,
    invite: PendingTeamInvite,
    action: "accept" | "decline",
  ) => void;
  onDecide: (
    childId: string,
    item: ChildNotificationItem,
    decision: "approved" | "removed",
  ) => void;
  onRevertDecision: (childId: string, item: ChildNotificationItem) => void;
  onApproveAll: (childId: string) => void;
  onToggleShowDecided: (childId: string) => void;
}

// One linked-child card on the family dashboard. Composes the avatar +
// edit + consent header with the confirmation status, notifications
// strip, and pending team invites — each extracted into its own
// component so this file stays focused on layout.
export function ChildRow({
  child,
  loadingEditFor,
  resending,
  actingOnEntryId,
  pendingInvites,
  notifState,
  decidingItem,
  revertingItemKey,
  approveAllForChild,
  unlinking,
  refSetter,
  onEdit,
  onConsentChange,
  onResend,
  onUnlink,
  onPendingAction,
  onDecide,
  onRevertDecision,
  onApproveAll,
  onToggleShowDecided,
}: Props) {
  const c = child;
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const isUnlinking = unlinking === c.id;
  return (
    <div
      ref={refSetter}
      className="flex flex-col gap-3 p-3 rounded-lg border border-border scroll-mt-4"
      data-testid={`row-child-${c.id}`}
    >
      <div className="flex items-center gap-3">
        <UserAvatar
          avatarUrl={c.avatarUrl}
          displayName={`${c.firstName} ${c.lastName}`}
          size="lg"
          className="border border-border shrink-0"
          fallbackClassName="bg-slate-900 text-white"
        />
        <div className="flex-1 min-w-0">
          <Link href={`/users/${c.id}`}>
            <p className="font-bold text-sm cursor-pointer hover:text-primary truncate">
              {c.firstName} {c.lastName}
            </p>
          </Link>
          <p className="text-xs text-muted-foreground truncate">
            {c.email ?? "No email on file"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="font-bold rounded-full gap-1.5"
            disabled={loadingEditFor === c.id}
            onClick={() => onEdit(c)}
            data-testid={`btn-edit-child-${c.id}`}
          >
            <Pencil className="w-3.5 h-3.5" />
            {loadingEditFor === c.id ? "Loading…" : "Edit profile"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="font-bold rounded-full gap-1.5 text-destructive hover:text-destructive"
            disabled={isUnlinking}
            onClick={() => setConfirmUnlink(true)}
            data-testid={`btn-unlink-child-${c.id}`}
          >
            <Unlink2 className="w-3.5 h-3.5" />
            {isUnlinking ? "Unlinking…" : "Unlink"}
          </Button>
          <div className="text-right text-xs">
            <p className="font-bold">Require tag consent</p>
            <p className="text-muted-foreground">
              {c.requireTagConsent
                ? "Coaches must ask first"
                : "Anyone may tag"}
            </p>
            <p
              className="text-[10px] text-muted-foreground mt-0.5"
              data-testid={`text-consent-helper-${c.id}`}
            >
              {c.requireTagConsent
                ? "New tags will arrive as Pending and require your Approve to be visible."
                : "New tags appear automatically. You can still Remove anything you don't want."}
            </p>
          </div>
          <Switch
            checked={c.requireTagConsent}
            onCheckedChange={(v) => onConsentChange(c, v)}
            data-testid={`switch-consent-${c.id}`}
          />
        </div>
      </div>

      <ChildConfirmationStatus
        child={c}
        resending={resending}
        onResend={onResend}
      />

      <ChildNotificationsSection
        child={c}
        notifState={notifState}
        decidingItem={decidingItem}
        revertingItemKey={revertingItemKey}
        approveAllForChild={approveAllForChild}
        onDecide={onDecide}
        onRevert={onRevertDecision}
        onApproveAll={onApproveAll}
        onToggleShowDecided={onToggleShowDecided}
      />

      <ChildPendingInvites
        child={c}
        invites={pendingInvites}
        actingOnEntryId={actingOnEntryId}
        onAction={onPendingAction}
      />

      <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <AlertDialogContent data-testid={`dialog-unlink-child-${c.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Unlink {c.firstName} {c.lastName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You'll stop seeing their pending follow requests, DMs,
              comments, and tags here, and you'll no longer be able to
              act on their behalf. Their teams will be removed from your
              profile. This does not delete the child's account, and you
              can re-link them later by searching their name below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`btn-unlink-cancel-${c.id}`}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmUnlink(false);
                void onUnlink(c);
              }}
              data-testid={`btn-unlink-confirm-${c.id}`}
            >
              Unlink
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
