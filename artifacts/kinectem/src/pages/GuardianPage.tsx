import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useGetLoggedInUser,
  type ChildNotificationItem,
  type ChildNotificationStreamResponse,
  type PrivateUserResponse,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  UserPlus,
  Search,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Mail,
  BellOff,
  Pencil,
  Inbox,
  Bell,
  MessageSquare,
  Tag as TagIcon,
  MessageCircle,
  ClipboardList,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDate, getInitials, timeAgo } from "@/lib/format";
import { EditProfileDialog } from "@/components/EditProfileDialog";

interface Child {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  role: string;
  email: string | null;
  avatarUrl: string | null;
  requireTagConsent: boolean;
  guardianEmail: string | null;
  guardianConfirmedAt: string | null;
  confirmationStatus: "none" | "confirmed" | "pending" | "expired";
  confirmedByMe: boolean;
}

interface SearchUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string | null;
  avatarUrl: string | null;
}

interface ChildNotificationsState {
  loading: boolean;
  items: ChildNotificationItem[];
  unreadCount: number;
  // When true, the next fetch (and refresh) for this child requests
  // `?includeDecided=true` so the "Recently decided" history strip is
  // populated alongside the still-undecided items. Defaults to false so
  // the dashboard stays focused on what still needs attention.
  showDecided?: boolean;
}

interface PendingTeamInvite {
  entryId: string;
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  organization: { id: string; name: string };
  role: string;
  position: string | null;
  invitedAt: string;
  invitedBy: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
}

export default function GuardianPage() {
  const { data: me } = useGetLoggedInUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const search = useSearch();
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [emailOptOut, setEmailOptOut] = useState(false);
  const [emailPrefLoading, setEmailPrefLoading] = useState(true);
  const [savingEmailPref, setSavingEmailPref] = useState(false);
  const [editingChild, setEditingChild] =
    useState<PrivateUserResponse | null>(null);
  const [loadingEditFor, setLoadingEditFor] = useState<string | null>(null);
  const [pendingByChild, setPendingByChild] = useState<
    Record<string, PendingTeamInvite[]>
  >({});
  const [actingOnEntryId, setActingOnEntryId] = useState<string | null>(null);
  const [notifsByChild, setNotifsByChild] = useState<
    Record<string, ChildNotificationsState>
  >({});
  // Tracks which item is currently being approved/removed and which verb
  // was clicked, so the row can flip the right button into a busy state
  // without spinners on the other action.
  const [decidingItem, setDecidingItem] = useState<{
    itemKey: string;
    decision: "approved" | "removed";
  } | null>(null);
  const [approveAllForChild, setApproveAllForChild] = useState<string | null>(
    null,
  );
  const childRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const deepLink = useMemo(() => {
    const params = new URLSearchParams(search ?? "");
    return {
      childId: params.get("childId"),
      entryId: params.get("entryId"),
      teamId: params.get("teamId"),
    };
  }, [search]);

  const openEditDialog = async (child: Child) => {
    setLoadingEditFor(child.id);
    try {
      const full = await customFetch<PrivateUserResponse>(
        `/api/v1/users/${child.id}`,
      );
      setEditingChild(full);
    } catch {
      toast({
        title: "Could not open editor",
        description: "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setLoadingEditFor(null);
    }
  };

  const fetchPendingForChild = async (childId: string) => {
    try {
      const r = await customFetch<{ data: PendingTeamInvite[] }>(
        `/api/v1/users/me/children/${childId}/pending-team-invites`,
      );
      setPendingByChild((prev) => ({ ...prev, [childId]: r.data ?? [] }));
    } catch {
      setPendingByChild((prev) => ({ ...prev, [childId]: [] }));
    }
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
  const [revertingItemKey, setRevertingItemKey] = useState<string | null>(
    null,
  );
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
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey;
          if (!Array.isArray(k)) return false;
          const url = typeof k[0] === "string" ? k[0] : "";
          return url.includes("/notifications") || url.includes("/children");
        },
      });
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
  const DECIDED_BADGE_MS = 1500;
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
      // The bell across the app cares about this child's unread count;
      // refetch so it stays honest. Wait for the badge to be visible
      // long enough to register, THEN refetch (which will exclude the
      // decided item server-side).
      window.setTimeout(() => {
        qc.invalidateQueries({
          predicate: (q) => {
            const k = q.queryKey;
            if (!Array.isArray(k)) return false;
            const url = typeof k[0] === "string" ? k[0] : "";
            return (
              url.includes("/notifications") || url.includes("/children")
            );
          },
        });
        // Also clear the locally-marked item so the section collapses
        // even if the server-side refetch has not landed yet.
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

  // The aria-label / tooltip for the per-item Remove button — varies by
  // kind so screen readers and hover hints make the destructive effect
  // explicit instead of a generic "Remove".
  const removeAriaLabel = (item: ChildNotificationItem): string => {
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
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey;
          if (!Array.isArray(k)) return false;
          const url = typeof k[0] === "string" ? k[0] : "";
          return url.includes("/notifications") || url.includes("/children");
        },
      });
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

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await customFetch<{ data: Child[] }>(
        "/api/v1/users/me/children",
      );
      setChildren(r.data);
      // Fan out the pending-invite and notification lookups so each card
      // has its data ready by the time the user looks at it. Failures are
      // swallowed per-child so one slow child can't hide the rest.
      await Promise.all(
        (r.data ?? []).flatMap((c) => [
          fetchPendingForChild(c.id),
          fetchNotificationsForChild(c.id),
        ]),
      );
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!me || me.role !== "parent") {
      setEmailPrefLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setEmailPrefLoading(true);
      try {
        const r = await customFetch<{ emailOptOut: boolean }>(
          "/api/v1/notifications/email-preference",
        );
        if (!cancelled) setEmailOptOut(!!r.emailOptOut);
      } catch {
        // ignore — leave the toggle in its default state
      } finally {
        if (!cancelled) setEmailPrefLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me]);

  const toggleExpiredEmail = async (silenced: boolean) => {
    // The switch represents "Email me" — when it is OFF the parent is
    // opting out of the expired-confirmation email.
    const optOut = !silenced;
    setSavingEmailPref(true);
    setEmailOptOut(optOut);
    try {
      const r = await customFetch<{ emailOptOut: boolean }>(
        "/api/v1/notifications/email-preference",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emailOptOut: optOut }),
        },
      );
      setEmailOptOut(!!r.emailOptOut);
      toast({
        title: r.emailOptOut
          ? "Expired-confirmation emails turned off"
          : "Expired-confirmation emails turned on",
      });
    } catch {
      // revert on failure
      setEmailOptOut(!optOut);
      toast({
        title: "Failed to update email preference",
        variant: "destructive",
      });
    } finally {
      setSavingEmailPref(false);
    }
  };

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await customFetch<{ data: SearchUser[] }>(
          `/api/v1/users?role=athlete&q=${encodeURIComponent(query.trim())}`,
        );
        setResults(r.data ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const linkChild = async (childId: string) => {
    setLinking(childId);
    try {
      await customFetch("/api/v1/users/me/children", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId }),
      });
      toast({ title: "Child linked to your guardian account" });
      setQuery("");
      setResults([]);
      await refresh();
    } catch (e) {
      const msg = (e as Error)?.message ?? "Failed to link child";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setLinking(null);
    }
  };

  const resendConfirmation = async (child: Child) => {
    setResending(child.id);
    try {
      const r = await customFetch<{
        ok: boolean;
        guardianEmail: string;
        guardianConfirmUrl: string;
      }>(
        `/api/v1/users/me/children/${child.id}/resend-guardian-confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      toast({
        title: `New confirmation link sent to ${r.guardianEmail}`,
        description: r.guardianConfirmUrl,
      });
      await refresh();
    } catch (e) {
      const msg = (e as Error)?.message ?? "Failed to resend link";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setResending(null);
    }
  };

  const handlePendingAction = async (
    child: Child,
    invite: PendingTeamInvite,
    action: "accept" | "decline",
  ) => {
    setActingOnEntryId(invite.entryId);
    try {
      await customFetch(
        `/api/v1/teams/${invite.teamId}/members/${invite.entryId}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      // Optimistically drop the row from local state, then refresh anything
      // that depends on this child's roster (their profile, their team list,
      // any open team rosters) using the same predicate the bell uses.
      setPendingByChild((prev) => ({
        ...prev,
        [child.id]: (prev[child.id] ?? []).filter(
          (i) => i.entryId !== invite.entryId,
        ),
      }));
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey;
          if (!Array.isArray(k)) return false;
          const url = typeof k[0] === "string" ? k[0] : "";
          if (url.includes(`/users/${child.id}`)) return true;
          if (url.includes("/teams/") && url.endsWith("/roster")) return true;
          return false;
        },
      });
      // Re-fetch the parent's bell so the matching notification clears its
      // unread state alongside the row removal.
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey;
          if (!Array.isArray(k)) return false;
          const url = typeof k[0] === "string" ? k[0] : "";
          return url.includes("/notifications");
        },
      });
      toast({
        title:
          action === "accept"
            ? `Accepted ${invite.teamName} for ${child.firstName}`
            : `Declined ${invite.teamName} for ${child.firstName}`,
      });
    } catch (e) {
      const msg = (e as Error)?.message ?? "Failed to update roster spot";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setActingOnEntryId(null);
    }
  };

  // Deep-link from the notifications bell: /family?childId=…&entryId=…&teamId=…
  // Scroll the matching child card into view and briefly highlight the
  // matching pending-invite row so the parent lands directly on what the
  // notification was about.
  useEffect(() => {
    const { childId, entryId } = deepLink;
    if (!childId) return;
    if (loading) return;
    const node = childRefs.current[childId];
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (!entryId) return;
    // Small delay so the row is mounted by the time we run query-selector.
    const t = window.setTimeout(() => {
      const row = document.querySelector(
        `[data-pending-entry-id="${entryId}"]`,
      );
      if (row) {
        row.classList.add(
          "ring-2",
          "ring-primary",
          "ring-offset-2",
          "ring-offset-background",
        );
        window.setTimeout(() => {
          row.classList.remove(
            "ring-2",
            "ring-primary",
            "ring-offset-2",
            "ring-offset-background",
          );
        }, 2400);
      }
    }, 120);
    return () => window.clearTimeout(t);
  }, [deepLink, loading, pendingByChild]);

  const toggleConsent = async (child: Child, value: boolean) => {
    try {
      await customFetch(
        `/api/v1/users/me/children/${child.id}/visibility`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requireTagConsent: value }),
        },
      );
      setChildren((prev) =>
        prev.map((c) =>
          c.id === child.id ? { ...c, requireTagConsent: value } : c,
        ),
      );
      toast({
        title: value
          ? `Tag consent now required for ${child.firstName}`
          : `Tag consent no longer required for ${child.firstName}`,
      });
    } catch {
      toast({ title: "Failed to update setting", variant: "destructive" });
    }
  };

  if (me && me.role !== "parent") {
    return (
      <Card className="rounded-xl border-border">
        <CardContent className="p-8 text-center space-y-2">
          <Shield className="w-10 h-10 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-black tracking-tight">
            Guardian dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            This page is only available to parent or guardian accounts.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-black tracking-tight">Family</h1>
          <p className="text-sm text-muted-foreground">
            Link your children's accounts and control how they appear on
            Kinectem.
          </p>
        </div>
      </div>

      {/* Notification preferences */}
      <Card className="rounded-xl border-border" data-testid="card-email-pref">
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center gap-2">
            <BellOff className="w-4 h-4 text-primary" />
            <h2 className="font-black tracking-tight">
              Notification preferences
            </h2>
          </div>
          {emailPrefLoading ? (
            <Skeleton className="h-12 rounded-lg" />
          ) : (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-border">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">
                  Email me when a confirmation link expires
                </p>
                <p className="text-xs text-muted-foreground">
                  You'll always see expired links in your in-app notifications.
                  Turn this off if those reminders are enough.
                </p>
              </div>
              <Switch
                checked={!emailOptOut}
                disabled={savingEmailPref}
                onCheckedChange={toggleExpiredEmail}
                data-testid="switch-expired-email"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked children */}
      <Card className="rounded-xl border-border">
        <CardContent className="p-6 space-y-4">
          <h2 className="font-black tracking-tight">Linked children</h2>
          {loading ? (
            <Skeleton className="h-20 rounded-lg" />
          ) : children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You haven't linked any children yet. Find an athlete below to get
              started.
            </p>
          ) : (
            <div className="space-y-3">
              {children.map((c) => (
                <div
                  key={c.id}
                  ref={(el) => {
                    childRefs.current[c.id] = el;
                  }}
                  className="flex flex-col gap-3 p-3 rounded-lg border border-border scroll-mt-4"
                  data-testid={`row-child-${c.id}`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10 border border-border shrink-0">
                      {c.avatarUrl && <AvatarImage src={c.avatarUrl} />}
                      <AvatarFallback className="bg-slate-900 text-white font-bold text-xs">
                        {getInitials(`${c.firstName} ${c.lastName}`)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <Link href={`/users/${c.id}`}>
                        <p className="font-bold text-sm cursor-pointer hover:text-primary truncate">
                          {c.firstName} {c.lastName}
                        </p>
                      </Link>
                      {c.nickname && (
                        <p
                          className="text-xs font-bold text-primary uppercase tracking-wider truncate"
                          data-testid={`text-child-nickname-${c.id}`}
                        >
                          @{c.nickname}
                        </p>
                      )}
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
                        onClick={() => openEditDialog(c)}
                        data-testid={`btn-edit-child-${c.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        {loadingEditFor === c.id ? "Loading…" : "Edit profile"}
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
                        onCheckedChange={(v) => toggleConsent(c, v)}
                        data-testid={`switch-consent-${c.id}`}
                      />
                    </div>
                  </div>

                  {c.confirmationStatus !== "none" && (
                    <div
                      className="flex flex-wrap items-center gap-2 pt-2 border-t border-border"
                      data-testid={`status-confirmation-${c.id}`}
                    >
                      {c.confirmationStatus === "confirmed" && (
                        <>
                          <Badge
                            variant="outline"
                            className="font-bold gap-1 border-green-600 text-green-700 dark:text-green-400"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {c.confirmedByMe
                              ? "Confirmed by you"
                              : "Confirmed"}
                          </Badge>
                          {c.guardianConfirmedAt && (
                            <span
                              className="text-xs text-muted-foreground"
                              data-testid={`text-confirmed-on-${c.id}`}
                            >
                              Confirmed on {formatDate(c.guardianConfirmedAt)}
                            </span>
                          )}
                        </>
                      )}
                      {c.confirmationStatus === "pending" && (
                        <Badge
                          variant="outline"
                          className="font-bold gap-1 border-amber-500 text-amber-700 dark:text-amber-400"
                        >
                          <Clock className="w-3 h-3" />
                          Pending guardian confirmation
                        </Badge>
                      )}
                      {c.confirmationStatus === "expired" && (
                        <Badge
                          variant="outline"
                          className="font-bold gap-1 border-red-500 text-red-700 dark:text-red-400"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          Confirmation link expired
                        </Badge>
                      )}
                      {c.guardianEmail && (
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {c.guardianEmail}
                        </span>
                      )}
                      {(c.confirmationStatus === "pending" ||
                        c.confirmationStatus === "expired") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto font-bold rounded-full"
                          disabled={resending === c.id}
                          onClick={() => resendConfirmation(c)}
                          data-testid={`btn-resend-${c.id}`}
                        >
                          {resending === c.id
                            ? "Sending..."
                            : "Resend confirmation link"}
                        </Button>
                      )}
                    </div>
                  )}

                  {(() => {
                    const notifState = notifsByChild[c.id];
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
                    // Split items into "still needs review" and "already
                    // decided" so we can render the optional history strip
                    // below the actionable list. Pending items are always
                    // visible; decided items only render when the parent
                    // has flipped the toggle on for this child.
                    const pendingItems = items.filter((i) => !i.decision);
                    const decidedItems = items.filter((i) => !!i.decision);
                    // Once the notifs state has loaded for this child we
                    // always render the section so the "Show decided"
                    // toggle stays discoverable — even when there is
                    // nothing currently waiting on the parent. The empty
                    // state explains what the section is for.
                    const unread = notifState?.unreadCount ?? 0;
                    const renderRow = (item: ChildNotificationItem) => {
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
                      const isReverting =
                        revertingItemKey === item.itemKey;
                      return (
                        <div
                          key={item.itemKey}
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
                                  onClick={() =>
                                    void revertChildDecision(c.id, item)
                                  }
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
                                  onClick={() =>
                                    void revertChildDecision(c.id, item)
                                  }
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
                                  size="sm"
                                  variant="default"
                                  className="h-6 px-2 text-[11px] font-bold"
                                  disabled={decisionInFlight}
                                  onClick={() =>
                                    void decideChildItem(
                                      c.id,
                                      item,
                                      "approved",
                                    )
                                  }
                                  aria-label={`Approve: keep this item visible on ${c.firstName}'s account`}
                                  title={`Approve: keep this item visible on ${c.firstName}'s account`}
                                  data-testid={`btn-approve-${item.itemKey}`}
                                >
                                  {isApproving ? "…" : "Approve"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-[11px] font-bold border-destructive text-destructive hover:bg-destructive/10"
                                  disabled={decisionInFlight}
                                  onClick={() =>
                                    void decideChildItem(
                                      c.id,
                                      item,
                                      "removed",
                                    )
                                  }
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
                    };
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
                              onClick={() => void toggleShowDecided(c.id)}
                              aria-pressed={showDecided}
                              data-testid={`btn-toggle-decided-${c.id}`}
                            >
                              {showDecided
                                ? "Hide decided"
                                : "Show decided"}
                            </Button>
                            {pendingItems.length > 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs font-bold"
                                disabled={approveAllForChild === c.id}
                                onClick={() =>
                                  void approveAllChildItems(c.id)
                                }
                                data-testid={`btn-approve-all-${c.id}`}
                              >
                                {approveAllForChild === c.id
                                  ? "Approving…"
                                  : "Approve all"}
                              </Button>
                            )}
                          </div>
                        </div>
                        <p
                          className="text-[11px] text-muted-foreground leading-snug"
                          data-testid={`text-notif-section-helper-${c.id}`}
                        >
                          <span className="font-semibold">Approve</span>{" "}
                          keeps the item visible on{" "}
                          {c.firstName}&apos;s account.{" "}
                          <span className="font-semibold">Remove</span>{" "}
                          dismisses it from your dashboard and undoes the
                          underlying action where possible (decline tag,
                          hide comment or message, decline roster invite).
                        </p>
                        {pendingItems.length === 0 ? (
                          <p
                            className="text-[11px] text-muted-foreground italic"
                            data-testid={`text-no-pending-${c.id}`}
                          >
                            Nothing waiting on you right now.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {pendingItems.slice(0, 8).map(renderRow)}
                          </div>
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
                                No decisions to review yet. Use Approve or
                                Remove on an item to start your history.
                              </p>
                            ) : (
                              decidedItems.slice(0, 12).map(renderRow)
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {(pendingByChild[c.id] ?? []).length > 0 && (
                    <div
                      className="pt-2 border-t border-border space-y-2"
                      data-testid={`section-pending-invites-${c.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <Inbox className="w-3.5 h-3.5 text-primary" />
                        <p className="text-xs font-black uppercase tracking-wider text-primary">
                          Pending team invites
                        </p>
                      </div>
                      {(pendingByChild[c.id] ?? []).map((inv) => {
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
                            <Avatar className="w-9 h-9 border border-border shrink-0">
                              {inv.teamLogoUrl && (
                                <AvatarImage src={inv.teamLogoUrl} />
                              )}
                              <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                                {getInitials(inv.teamName)}
                              </AvatarFallback>
                            </Avatar>
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
                                onClick={() =>
                                  void handlePendingAction(c, inv, "decline")
                                }
                                data-testid={`btn-decline-pending-${inv.entryId}`}
                              >
                                Decline
                              </Button>
                              <Button
                                size="sm"
                                className="font-bold rounded-full h-7 px-3 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                                disabled={acting}
                                onClick={() =>
                                  void handlePendingAction(c, inv, "accept")
                                }
                                data-testid={`btn-accept-pending-${inv.entryId}`}
                              >
                                {acting ? "Working…" : "Accept"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {editingChild && (
        <EditProfileDialog
          user={editingChild}
          open={true}
          onOpenChange={(next) => {
            if (!next) setEditingChild(null);
          }}
          onSaved={() => {
            setEditingChild(null);
            void refresh();
          }}
        />
      )}

      {/* Link a new child */}
      <Card className="rounded-xl border-border">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            <h2 className="font-black tracking-tight">Link a child</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Search for your child's athlete account by name. We'll attach it to
            your guardian profile.
          </p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a child's name..."
              className="pl-9"
              data-testid="input-search-child"
            />
          </div>
          {query.trim().length >= 2 && (
            <div className="space-y-2">
              {searching ? (
                <Skeleton className="h-12 rounded-lg" />
              ) : results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No matching athlete accounts found.
                </p>
              ) : (
                results.map((u) => {
                  const alreadyLinked = children.some((c) => c.id === u.id);
                  return (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border"
                    >
                      <Avatar className="w-9 h-9 border border-border shrink-0">
                        {u.avatarUrl && <AvatarImage src={u.avatarUrl} />}
                        <AvatarFallback className="bg-slate-900 text-white font-bold text-xs">
                          {getInitials(`${u.firstName} ${u.lastName}`)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">
                          {u.firstName} {u.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {u.email ?? "No email"}
                        </p>
                      </div>
                      {alreadyLinked ? (
                        <Badge variant="outline" className="font-bold">
                          Linked
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          className="font-bold rounded-full"
                          disabled={linking === u.id}
                          onClick={() => linkChild(u.id)}
                          data-testid={`btn-link-${u.id}`}
                        >
                          {linking === u.id ? "Linking..." : "Link"}
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
