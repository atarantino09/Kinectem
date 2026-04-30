import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  type ChildNotificationItem,
  type ChildNotificationStreamResponse,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import type { ChildNotificationsState, DecisionInFlight } from "./types";

// Approve / Remove flips the row into a "decided" badge state for this
// many ms before the section refetches and the row falls away. Long
// enough to register, short enough to not feel sticky.
const DECIDED_BADGE_MS = 1500;

// State + actions for the per-child notifications strip on the family
// dashboard. Hoisted out of GuardianPage so the page can stay focused
// on layout while this hook owns optimistic updates, refetches, and
// the busy-state bookkeeping for each in-flight Approve/Remove/Undo.
export function useChildNotifications() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [notifsByChild, setNotifsByChild] = useState<
    Record<string, ChildNotificationsState>
  >({});
  // Tracks which item is currently being approved/removed and which verb
  // was clicked, so the row can flip the right button into a busy state
  // without spinners on the other action.
  const [decidingItem, setDecidingItem] = useState<DecisionInFlight>(null);
  const [revertingItemKey, setRevertingItemKey] = useState<string | null>(
    null,
  );
  const [approveAllForChild, setApproveAllForChild] = useState<string | null>(
    null,
  );

  // Also bust the cached child profile + child posts list so a Remove
  // / Undo on an authored article or highlight (which flips
  // `articles.hiddenAt` / `highlights.hiddenAt` server-side) is
  // reflected immediately on the child's public page — without that
  // the post would linger in the parent's preview tab until React
  // Query's natural refetch kicks in.
  const invalidateNotificationsAndChildren = (childId?: string) => {
    qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey;
        if (!Array.isArray(k)) return false;
        const url = typeof k[0] === "string" ? k[0] : "";
        if (url.includes("/notifications") || url.includes("/children")) {
          return true;
        }
        // /api/v1/users/<childId> and /api/v1/users/<childId>/posts —
        // both use this exact childId in the path, so a substring match
        // is enough and won't accidentally bust other users' profiles.
        if (childId && url.includes(`/users/${childId}`)) {
          return true;
        }
        return false;
      },
    });
  };

  const fetchNotificationsForChild = async (
    childId: string,
    opts: { includeDecided?: boolean } = {},
  ) => {
    // Fall back to the per-child saved preference when the caller doesn't
    // override — so a refresh after the parent flipped the toggle keeps
    // the decided history strip populated.
    const includeDecided =
      opts.includeDecided ?? notifsByChild[childId]?.showDecided ?? false;
    setNotifsByChild((prev) => ({
      ...prev,
      [childId]: {
        loading: true,
        items: prev[childId]?.items ?? [],
        unreadCount: prev[childId]?.unreadCount ?? 0,
        showDecided: includeDecided,
      },
    }));
    try {
      const url = includeDecided
        ? `/api/v1/users/me/children/${childId}/notifications?includeDecided=true`
        : `/api/v1/users/me/children/${childId}/notifications`;
      const r = await customFetch<ChildNotificationStreamResponse>(url);
      const items = r.data ?? [];
      setNotifsByChild((prev) => ({
        ...prev,
        [childId]: {
          loading: false,
          items,
          unreadCount:
            typeof r.unreadCount === "number"
              ? r.unreadCount
              : items.filter((i) => !i.isRead && !i.decision).length,
          showDecided: includeDecided,
        },
      }));
    } catch {
      setNotifsByChild((prev) => ({
        ...prev,
        [childId]: {
          loading: false,
          items: [],
          unreadCount: 0,
          showDecided: includeDecided,
        },
      }));
    }
  };

  const toggleShowDecided = async (childId: string) => {
    const next = !(notifsByChild[childId]?.showDecided ?? false);
    await fetchNotificationsForChild(childId, { includeDecided: next });
  };

  // Revert a previous Approve/Remove decision back to "needs review".
  // Optimistically clear the decision locally so the row jumps back into
  // the still-undecided list, then refetch with the same includeDecided
  // setting so the badge / undo button updates from the server's truth.
  const revertChildDecision = async (
    childId: string,
    item: ChildNotificationItem,
  ) => {
    if (!item.decision) return;
    setRevertingItemKey(item.itemKey);
    const previousDecision = item.decision;
    setNotifsByChild((prev) => {
      const cur = prev[childId];
      if (!cur) return prev;
      return {
        ...prev,
        [childId]: {
          ...cur,
          items: cur.items.map((i) =>
            i.itemKey === item.itemKey
              ? { ...i, decision: null, isRead: false }
              : i,
          ),
          unreadCount: cur.unreadCount + 1,
        },
      };
    });
    try {
      await customFetch(
        `/api/v1/users/me/children/${childId}/notifications/unset-decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemKey: item.itemKey }),
        },
      );
      invalidateNotificationsAndChildren(childId);
      // Re-fetch with the parent's currently-selected toggle so the
      // strip reflects the server's view (the underlying source row may
      // have been restored by the unset action).
      await fetchNotificationsForChild(childId);
    } catch {
      // Roll back on failure so the badge/buttons return to the prior state.
      setNotifsByChild((prev) => {
        const cur = prev[childId];
        if (!cur) return prev;
        return {
          ...prev,
          [childId]: {
            ...cur,
            items: cur.items.map((i) =>
              i.itemKey === item.itemKey
                ? { ...i, decision: previousDecision }
                : i,
            ),
            unreadCount: Math.max(0, cur.unreadCount - 1),
          },
        };
      });
      toast({
        title: "Couldn't undo decision",
        description: "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setRevertingItemKey(null);
    }
  };

  // Per-item Approve / Remove. Approve just records the verdict; Remove
  // additionally fires the kind-specific destructive action server-side
  // (decline tag, hide comment, etc.). The row stays in the list with a
  // brief Approved/Removed badge so the parent sees the outcome of their
  // click before it disappears on the next refresh.
  const decideChildItem = async (
    childId: string,
    item: ChildNotificationItem,
    decision: "approved" | "removed",
  ) => {
    if (item.decision) return; // already decided — guard against double-click
    setDecidingItem({ itemKey: item.itemKey, decision });
    // Optimistically stamp the decision on the local item so the
    // Approved/Removed badge renders immediately and the unread count
    // drops by one — but keep the row on screen for a moment so the
    // parent can register what happened.
    setNotifsByChild((prev) => {
      const cur = prev[childId];
      if (!cur) return prev;
      return {
        ...prev,
        [childId]: {
          ...cur,
          items: cur.items.map((i) =>
            i.itemKey === item.itemKey ? { ...i, decision } : i,
          ),
          unreadCount: item.isRead
            ? cur.unreadCount
            : Math.max(0, cur.unreadCount - 1),
        },
      };
    });
    try {
      await customFetch(
        `/api/v1/users/me/children/${childId}/notifications/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemKey: item.itemKey, decision }),
        },
      );
      // Bust the child profile + child posts caches IMMEDIATELY so a
      // Remove on an authored post is reflected on the next view of
      // the child's page, not deferred behind the badge animation.
      // The notifications/inbox refetch is also deferred below so the
      // local badge has time to register before the row falls away,
      // but the user-visible takedown is what matters most for trust.
      invalidateNotificationsAndChildren(childId);
      // Wait for the badge to be visible long enough to register, THEN
      // collapse the local row so the section visually settles even if
      // the server-side refetch has not landed yet.
      window.setTimeout(() => {
        setNotifsByChild((prev) => {
          const cur = prev[childId];
          if (!cur) return prev;
          return {
            ...prev,
            [childId]: {
              ...cur,
              items: cur.items.filter((i) => i.itemKey !== item.itemKey),
            },
          };
        });
      }, DECIDED_BADGE_MS);
    } catch {
      // Roll back the optimistic decision on failure.
      setNotifsByChild((prev) => {
        const cur = prev[childId];
        if (!cur) return prev;
        return {
          ...prev,
          [childId]: {
            ...cur,
            items: cur.items.map((i) =>
              i.itemKey === item.itemKey ? { ...i, decision: null } : i,
            ),
            unreadCount: item.isRead ? cur.unreadCount : cur.unreadCount + 1,
          },
        };
      });
      toast({
        title:
          decision === "approved"
            ? "Couldn't approve"
            : "Couldn't remove",
        description: "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setDecidingItem(null);
    }
  };

  const approveAllChildItems = async (childId: string) => {
    setApproveAllForChild(childId);
    // Snapshot current items in case we need to roll back.
    const prevItems = notifsByChild[childId]?.items ?? [];
    setNotifsByChild((prev) => {
      const cur = prev[childId];
      if (!cur) return prev;
      return {
        ...prev,
        [childId]: { ...cur, items: [], unreadCount: 0 },
      };
    });
    try {
      await customFetch(
        `/api/v1/users/me/children/${childId}/notifications/approve-all`,
        { method: "POST" },
      );
      invalidateNotificationsAndChildren(childId);
    } catch {
      // Restore on failure so the parent can retry.
      setNotifsByChild((prev) => {
        const cur = prev[childId];
        if (!cur) return prev;
        return {
          ...prev,
          [childId]: {
            ...cur,
            items: prevItems,
            unreadCount: prevItems.filter((i) => !i.isRead).length,
          },
        };
      });
      toast({
        title: "Couldn't approve all",
        description: "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setApproveAllForChild(null);
    }
  };

  return {
    notifsByChild,
    decidingItem,
    revertingItemKey,
    approveAllForChild,
    fetchNotificationsForChild,
    toggleShowDecided,
    revertChildDecision,
    decideChildItem,
    approveAllChildItems,
  };
}
