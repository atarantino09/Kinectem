import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  type PrivateUserResponse,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useChildNotifications } from "./useChildNotifications";
import type { Child, PendingTeamInvite } from "./types";

// All page-level state + handlers for the family dashboard. Splits the
// "list of linked children" plumbing out of GuardianPage so the page
// itself can stay focused on layout. The notifications hook is owned
// here too so the refresh fan-out can call its fetch helper.
export function useGuardianDashboard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const search = useSearch();

  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<string | null>(null);
  const [editingChild, setEditingChild] =
    useState<PrivateUserResponse | null>(null);
  const [loadingEditFor, setLoadingEditFor] = useState<string | null>(null);
  const [pendingByChild, setPendingByChild] = useState<
    Record<string, PendingTeamInvite[]>
  >({});
  const [actingOnEntryId, setActingOnEntryId] = useState<string | null>(null);
  const childRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const notifs = useChildNotifications();

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
          notifs.fetchNotificationsForChild(c.id),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resendConfirmation = async (child: Child) => {
    setResending(child.id);
    try {
      const r = await customFetch<{
        ok: boolean;
        guardianEmail: string;
        guardianConfirmUrl: string;
      }>(`/api/v1/users/me/children/${child.id}/resend-guardian-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
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
      await customFetch(`/api/v1/users/me/children/${child.id}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireTagConsent: value }),
      });
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

  return {
    children,
    loading,
    resending,
    editingChild,
    loadingEditFor,
    pendingByChild,
    actingOnEntryId,
    childRefs,
    notifs,
    setEditingChild,
    refresh,
    openEditDialog,
    resendConfirmation,
    handlePendingAction,
    toggleConsent,
  };
}
