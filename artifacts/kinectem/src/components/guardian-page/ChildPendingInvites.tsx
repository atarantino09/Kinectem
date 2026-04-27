import { Button } from "@/components/ui/button";
import { TeamAvatar } from "@/components/UserAvatar";
import { Inbox } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { Child, PendingTeamInvite } from "./types";

interface Props {
  child: Child;
  invites: PendingTeamInvite[];
  actingOnEntryId: string | null;
  onAction: (
    child: Child,
    invite: PendingTeamInvite,
    action: "accept" | "decline",
  ) => void;
}

// "Pending team invites" subsection on a child card. The deep-link
// glow (ring around a specific row) is keyed off `data-pending-entry-id`
// so the GuardianPage scroll-into-view effect can find the row.
export function ChildPendingInvites({
  child,
  invites,
  actingOnEntryId,
  onAction,
}: Props) {
  if (invites.length === 0) return null;
  return (
    <div
      className="pt-2 border-t border-border space-y-2"
      data-testid={`section-pending-invites-${child.id}`}
    >
      <div className="flex items-center gap-2">
        <Inbox className="w-3.5 h-3.5 text-primary" />
        <p className="text-xs font-black uppercase tracking-wider text-primary">
          Pending team invites
        </p>
      </div>
      {invites.map((inv) => {
        const acting = actingOnEntryId === inv.entryId;
        const positionLabel =
          inv.position && inv.position.length > 0
            ? inv.position.charAt(0).toUpperCase() +
              inv.position.slice(1).replace(/_/g, " ")
            : inv.role === "coach"
              ? "Coach"
              : "Player";
        return (
          <div
            key={inv.entryId}
            data-pending-entry-id={inv.entryId}
            data-testid={`row-pending-invite-${inv.entryId}`}
            className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30 transition-shadow"
          >
            <TeamAvatar
              avatarUrl={inv.teamLogoUrl}
              displayName={inv.teamName}
              size="md"
              rounded="full"
              className="border border-border shrink-0"
              fallbackClassName="bg-primary/10 text-primary"
            />
            <div className="flex-1 min-w-0">
              <p
                className="font-bold text-sm truncate"
                data-testid={`text-pending-team-${inv.entryId}`}
              >
                {inv.teamName}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {inv.organization.name} · {positionLabel}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {inv.invitedBy
                  ? `Invited by ${inv.invitedBy.displayName}`
                  : "Invited"}{" "}
                · {timeAgo(inv.invitedAt)}
              </p>
            </div>
            <div className="flex flex-col gap-2 shrink-0 sm:flex-row">
              <Button
                size="sm"
                variant="outline"
                className="font-bold rounded-full h-7 px-3 text-xs"
                disabled={acting}
                onClick={() => onAction(child, inv, "decline")}
                data-testid={`btn-decline-pending-${inv.entryId}`}
              >
                Decline
              </Button>
              <Button
                variant="brand"
                size="xs"
                disabled={acting}
                onClick={() => onAction(child, inv, "accept")}
                data-testid={`btn-accept-pending-${inv.entryId}`}
              >
                {acting ? "Working…" : "Accept"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
