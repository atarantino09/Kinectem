import { Link } from "wouter";
import {
  Bell,
  Tag as TagIcon,
  MessageCircle,
  MessageSquare,
  ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import type { ChildNotificationItem } from "@workspace/api-client-react";
import type { Child, ChildNotificationsState, DecisionInFlight } from "./types";

// The aria-label / tooltip for the per-item Remove button — varies by
// kind so screen readers and hover hints make the destructive effect
// explicit instead of a generic "Remove".
function removeAriaLabel(item: ChildNotificationItem): string {
  switch (item.kind) {
    case "tag":
      return "Remove and decline this tag";
    case "comment":
      return "Remove and hide this comment";
    case "message":
      return "Remove and hide this message from your child's view";
    case "roster":
      return "Remove and decline this roster invite";
    case "notification":
    default:
      return "Hide from your dashboard";
  }
}

interface RowProps {
  child: Child;
  item: ChildNotificationItem;
  decidingItem: DecisionInFlight;
  revertingItemKey: string | null;
  onDecide: (
    childId: string,
    item: ChildNotificationItem,
    decision: "approved" | "removed",
  ) => void;
  onRevert: (childId: string, item: ChildNotificationItem) => void;
}

function ChildNotificationRow({
  child,
  item,
  decidingItem,
  revertingItemKey,
  onDecide,
  onRevert,
}: RowProps) {
  const Icon =
    item.kind === "tag"
      ? TagIcon
      : item.kind === "comment"
        ? MessageCircle
        : item.kind === "message"
          ? MessageSquare
          : item.kind === "roster"
            ? ClipboardList
            : Bell;
  const isApproving =
    decidingItem?.itemKey === item.itemKey &&
    decidingItem.decision === "approved";
  const isRemoving =
    decidingItem?.itemKey === item.itemKey &&
    decidingItem.decision === "removed";
  const decisionInFlight = isApproving || isRemoving;
  const decided = item.decision;
  const isReverting = revertingItemKey === item.itemKey;
  return (
    <div
      data-testid={`row-child-notif-${item.itemKey}`}
      data-read={item.isRead ? "true" : "false"}
      data-decision={decided ?? "pending"}
      className={`flex items-start gap-2 p-2 rounded-md border transition-opacity ${
        decided ? "opacity-60" : ""
      } ${
        item.isRead
          ? "border-border bg-background"
          : "border-primary/30 bg-primary/5"
      }`}
    >
      <Icon className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        {item.link ? (
          <Link href={item.link}>
            <p
              className="text-xs font-bold leading-tight cursor-pointer hover:text-primary truncate"
              data-testid={`text-child-notif-title-${item.itemKey}`}
            >
              {item.title}
            </p>
          </Link>
        ) : (
          <p
            className="text-xs font-bold leading-tight truncate"
            data-testid={`text-child-notif-title-${item.itemKey}`}
          >
            {item.title}
          </p>
        )}
        {item.body && (
          <p className="text-[11px] text-muted-foreground line-clamp-2">
            {item.body}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {timeAgo(item.createdAt)}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {decided === "approved" ? (
          <>
            <Badge
              variant="outline"
              className="h-6 px-2 text-[11px] font-bold border-primary text-primary"
              data-testid={`badge-decided-${item.itemKey}`}
            >
              Approved
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px] font-bold"
              disabled={isReverting}
              onClick={() => onRevert(child.id, item)}
              aria-label="Revert this decision back to needs review"
              title="Revert this decision back to needs review"
              data-testid={`btn-undo-decision-${item.itemKey}`}
            >
              {isReverting ? "…" : "Undo"}
            </Button>
          </>
        ) : decided === "removed" ? (
          <>
            <Badge
              variant="outline"
              className="h-6 px-2 text-[11px] font-bold border-destructive text-destructive"
              data-testid={`badge-decided-${item.itemKey}`}
            >
              Removed
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px] font-bold"
              disabled={isReverting}
              onClick={() => onRevert(child.id, item)}
              aria-label="Revert this decision back to needs review"
              title="Revert this decision back to needs review"
              data-testid={`btn-undo-decision-${item.itemKey}`}
            >
              {isReverting ? "…" : "Undo"}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="brand"
              size="xs"
              className="h-6 text-[11px]"
              disabled={decisionInFlight}
              onClick={() => onDecide(child.id, item, "approved")}
              aria-label={`Approve: keep this item visible on ${child.firstName}'s account`}
              title={`Approve: keep this item visible on ${child.firstName}'s account`}
              data-testid={`btn-approve-${item.itemKey}`}
            >
              {isApproving ? "…" : "Approve"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] font-bold border-destructive text-destructive hover:bg-destructive/10"
              disabled={decisionInFlight}
              onClick={() => onDecide(child.id, item, "removed")}
              aria-label={removeAriaLabel(item)}
              title={removeAriaLabel(item)}
              data-testid={`btn-remove-${item.itemKey}`}
            >
              {isRemoving ? "…" : "Remove"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

interface SectionProps {
  child: Child;
  notifState: ChildNotificationsState | undefined;
  decidingItem: DecisionInFlight;
  revertingItemKey: string | null;
  approveAllForChild: string | null;
  onDecide: (
    childId: string,
    item: ChildNotificationItem,
    decision: "approved" | "removed",
  ) => void;
  onRevert: (childId: string, item: ChildNotificationItem) => void;
  onApproveAll: (childId: string) => void;
  onToggleShowDecided: (childId: string) => void;
}

// "[Child]'s notifications" section that hangs off a child card. Splits
// items into the actionable list (top) and an optional "Recently
// decided" history strip below, controlled by a per-child toggle.
export function ChildNotificationsSection({
  child,
  notifState,
  decidingItem,
  revertingItemKey,
  approveAllForChild,
  onDecide,
  onRevert,
  onApproveAll,
  onToggleShowDecided,
}: SectionProps) {
  const c = child;
  const items = notifState?.items ?? [];
  if (notifState?.loading && items.length === 0) {
    return (
      <div
        className="pt-2 border-t border-border space-y-2"
        data-testid={`section-child-notifs-${c.id}`}
      >
        <div className="flex items-center gap-2">
          <Bell className="w-3.5 h-3.5 text-primary" />
          <p className="text-xs font-black uppercase tracking-wider text-primary">
            {c.firstName}'s notifications
          </p>
        </div>
        <Skeleton className="h-12 rounded-lg" />
      </div>
    );
  }
  const showDecided = notifState?.showDecided ?? false;
  // Split items into "still needs review" and "already decided" so we
  // can render the optional history strip below the actionable list.
  // Pending items are always visible; decided items only render when
  // the parent has flipped the toggle on for this child.
  const pendingItems = items.filter((i) => !i.decision);
  const decidedItems = items.filter((i) => !!i.decision);
  // Once the notifs state has loaded for this child we always render
  // the section so the "Show decided" toggle stays discoverable —
  // even when there is nothing currently waiting on the parent. The
  // empty state explains what the section is for.
  const unread = notifState?.unreadCount ?? 0;
  const renderRow = (item: ChildNotificationItem) => (
    <ChildNotificationRow
      key={item.itemKey}
      child={c}
      item={item}
      decidingItem={decidingItem}
      revertingItemKey={revertingItemKey}
      onDecide={onDecide}
      onRevert={onRevert}
    />
  );
  return (
    <div
      className="pt-2 border-t border-border space-y-2"
      data-testid={`section-child-notifs-${c.id}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Bell className="w-3.5 h-3.5 text-primary" />
        <p className="text-xs font-black uppercase tracking-wider text-primary">
          {c.firstName}'s notifications
        </p>
        {unread > 0 && (
          <Badge
            variant="outline"
            className="font-bold text-[10px] h-5 px-1.5 border-primary text-primary"
            data-testid={`badge-child-notif-unread-${c.id}`}
          >
            {unread} new
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs font-bold"
            onClick={() => onToggleShowDecided(c.id)}
            aria-pressed={showDecided}
            data-testid={`btn-toggle-decided-${c.id}`}
          >
            {showDecided ? "Hide decided" : "Show decided"}
          </Button>
          {pendingItems.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs font-bold"
              disabled={approveAllForChild === c.id}
              onClick={() => onApproveAll(c.id)}
              data-testid={`btn-approve-all-${c.id}`}
            >
              {approveAllForChild === c.id ? "Approving…" : "Approve all"}
            </Button>
          )}
        </div>
      </div>
      <p
        className="text-[11px] text-muted-foreground leading-snug"
        data-testid={`text-notif-section-helper-${c.id}`}
      >
        <span className="font-semibold">Approve</span> keeps the item visible
        on {c.firstName}&apos;s account.{" "}
        <span className="font-semibold">Remove</span> dismisses it from your
        dashboard and undoes the underlying action where possible (decline
        tag, hide comment or message, decline roster invite).
      </p>
      {pendingItems.length === 0 ? (
        <p
          className="text-[11px] text-muted-foreground italic"
          data-testid={`text-no-pending-${c.id}`}
        >
          Nothing waiting on you right now.
        </p>
      ) : (
        <div className="space-y-1.5">{pendingItems.slice(0, 8).map(renderRow)}</div>
      )}
      {showDecided && (
        <div
          className="pt-2 mt-1 border-t border-dashed border-border space-y-1.5"
          data-testid={`section-decided-${c.id}`}
        >
          <div className="flex items-center gap-2">
            <p
              className="text-[11px] font-black uppercase tracking-wider text-muted-foreground"
              data-testid={`text-decided-heading-${c.id}`}
            >
              Recently decided
            </p>
            {decidedItems.length > 0 && (
              <Badge
                variant="outline"
                className="font-bold text-[10px] h-5 px-1.5"
                data-testid={`badge-decided-count-${c.id}`}
              >
                {decidedItems.length}
              </Badge>
            )}
          </div>
          {decidedItems.length === 0 ? (
            <p
              className="text-[11px] text-muted-foreground italic"
              data-testid={`text-no-decided-${c.id}`}
            >
              No decisions to review yet. Use Approve or Remove on an item to
              start your history.
            </p>
          ) : (
            decidedItems.slice(0, 12).map(renderRow)
          )}
        </div>
      )}
    </div>
  );
}
