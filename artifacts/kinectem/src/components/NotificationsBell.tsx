import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useGetUnreadNotificationCount,
  useListNotifications,
  useMarkAllNotificationsAsRead,
  getGetUnreadNotificationCountQueryKey,
  getListNotificationsQueryKey,
  type NotificationResponse,
} from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Bell, ShieldAlert, Users } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

function getNotificationLink(n: NotificationResponse): string | null {
  const data = n.data;
  if (data && typeof data === "object" && "link" in data) {
    const link = (data as { link?: unknown }).link;
    if (typeof link === "string") return link;
  }
  return null;
}

function getChildIdFromLink(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/childId=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getEntryIdFromLink(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/entryId=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getTeamIdFromLink(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/teamId=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getChildFirstNameFromTitle(title: string): string {
  // Notification copy is: "<Coach Name> invited <Child First Name> to join <Team Name>."
  const m = title.match(/invited\s+(.+?)\s+to join/);
  return m ? m[1] : "your child";
}

export function NotificationsBell() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: countData } = useGetUnreadNotificationCount();
  const { data: notifs, isLoading } = useListNotifications();
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [actingOnEntryId, setActingOnEntryId] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetUnreadNotificationCountQueryKey() });
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  };

  const markRead = async (notificationId: string) => {
    try {
      await customFetch(`/api/v1/notifications/${notificationId}/read`, {
        method: "POST",
      });
    } finally {
      invalidate();
    }
  };
  const markAll = useMarkAllNotificationsAsRead({
    mutation: { onSuccess: invalidate },
  });

  const unread = countData?.unreadCount ?? 0;
  const items = notifs?.data ?? [];

  const handleRowClick = (n: NotificationResponse) => {
    if (!n.isRead) void markRead(n.id);
    const link = getNotificationLink(n);
    if (n.type === "guardian_expired") {
      const childId = getChildIdFromLink(link);
      navigate(childId ? `/family?childId=${childId}` : "/family");
      return;
    }
    if (n.type === "roster_invite_for_child") {
      // Send the parent to /family so they can review the invite next to
      // the child it concerns. The Accept/Decline buttons live in the
      // notification row itself, so the click here is just navigation.
      const childId = getChildIdFromLink(link);
      navigate(childId ? `/family?childId=${childId}` : "/family");
      return;
    }
    if (link) navigate(link);
  };

  const handleRosterAction = async (
    n: NotificationResponse,
    action: "accept" | "decline",
  ) => {
    const link = getNotificationLink(n);
    const entryId = getEntryIdFromLink(link);
    const teamId = getTeamIdFromLink(link);
    const childId = getChildIdFromLink(link);
    if (!entryId || !teamId) {
      toast({
        title: "Couldn't find the roster spot to update.",
        variant: "destructive",
      });
      return;
    }
    setActingOnEntryId(entryId);
    try {
      await customFetch(
        `/api/v1/teams/${teamId}/members/${entryId}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!n.isRead) {
        await markRead(n.id);
      } else {
        invalidate();
      }
      // Refresh anything that displays the child's roster: their profile,
      // their team list, and any open team rosters. Using a predicate
      // keeps this resilient to query-key shape changes.
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey;
          if (!Array.isArray(k)) return false;
          const url = typeof k[0] === "string" ? k[0] : "";
          if (childId && url.includes(`/users/${childId}`)) return true;
          if (url.includes("/teams/") && url.endsWith("/roster")) return true;
          return false;
        },
      });
      toast({
        title:
          action === "accept"
            ? "Roster spot accepted"
            : "Roster spot declined",
      });
    } catch (e) {
      const msg = (e as Error)?.message ?? "Failed to update roster spot";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setActingOnEntryId(null);
    }
  };

  const handleResend = async (n: NotificationResponse) => {
    const childId = getChildIdFromLink(getNotificationLink(n));
    if (!childId) {
      toast({
        title: "Couldn't find which child to resend for.",
        variant: "destructive",
      });
      return;
    }
    setResendingId(n.id);
    try {
      await customFetch<{ ok: boolean }>(
        `/api/v1/users/me/children/${childId}/resend-guardian-confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!n.isRead) {
        await markRead(n.id);
      } else {
        invalidate();
      }
      toast({ title: "Confirmation link resent." });
    } catch (e) {
      const msg = (e as Error)?.message ?? "Failed to resend link";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setResendingId(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-9 px-2"
          data-testid="button-notifications"
        >
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 p-0 max-h-[480px] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h4 className="font-black tracking-tight text-sm">Notifications</h4>
          {unread > 0 && (
            <button
              onClick={() => markAll.mutate()}
              className="text-xs font-bold text-primary hover:underline"
              data-testid="button-mark-all-read"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-4">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">
              You're all caught up.
            </p>
          ) : (
            items.map((n: NotificationResponse) => {
              const isExpired = n.type === "guardian_expired";
              const isChildInvite = n.type === "roster_invite_for_child";
              const childFirst = isChildInvite
                ? getChildFirstNameFromTitle(n.title)
                : "";
              const entryId = isChildInvite
                ? getEntryIdFromLink(getNotificationLink(n))
                : null;
              const acting = entryId !== null && actingOnEntryId === entryId;
              return (
                <div
                  key={n.id}
                  className={`w-full border-b border-border/50 ${
                    isExpired
                      ? !n.isRead
                        ? "bg-amber-100/70 dark:bg-amber-500/10"
                        : "bg-amber-50/60 dark:bg-amber-500/5"
                      : !n.isRead
                        ? "bg-primary/5"
                        : ""
                  }`}
                  data-testid={`notification-${n.id}`}
                >
                  <button
                    onClick={() => handleRowClick(n)}
                    className="w-full text-left px-4 pt-3 pb-2 hover:bg-muted/60 cursor-pointer"
                  >
                    <div className="flex items-start gap-2">
                      {isExpired ? (
                        <span
                          className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center"
                          aria-hidden="true"
                        >
                          <ShieldAlert className="w-4 h-4" />
                        </span>
                      ) : isChildInvite ? (
                        <span
                          className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center"
                          aria-hidden="true"
                        >
                          <Users className="w-4 h-4" />
                        </span>
                      ) : (
                        !n.isRead && (
                          <span className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                        )
                      )}
                      <div className="flex-1 min-w-0">
                        {isExpired && (
                          <p className="text-[10px] uppercase tracking-wider font-black text-amber-700 dark:text-amber-300 mb-0.5">
                            Guardian link expired
                          </p>
                        )}
                        {isChildInvite && (
                          <p className="text-[10px] uppercase tracking-wider font-black text-primary mb-0.5">
                            Team invite for your child
                          </p>
                        )}
                        <p
                          className={`font-bold text-sm leading-tight ${
                            isExpired ? "text-amber-900 dark:text-amber-100" : ""
                          }`}
                        >
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {n.body}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-1 font-medium">
                          {timeAgo(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                  {isExpired && (
                    <div className="px-4 pb-3 -mt-1 flex justify-end">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 px-3 rounded-full text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white"
                        disabled={resendingId === n.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResend(n);
                        }}
                        data-testid={`button-resend-guardian-${n.id}`}
                      >
                        {resendingId === n.id ? "Resending…" : "Resend link"}
                      </Button>
                    </div>
                  )}
                  {isChildInvite && entryId && (
                    <div className="px-4 pb-3 -mt-1 flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-3 rounded-full text-xs font-bold"
                        disabled={acting}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRosterAction(n, "decline");
                        }}
                        data-testid={`button-decline-child-invite-${n.id}`}
                      >
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 px-3 rounded-full text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground"
                        disabled={acting}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRosterAction(n, "accept");
                        }}
                        data-testid={`button-accept-child-invite-${n.id}`}
                      >
                        {acting
                          ? "Working…"
                          : `Accept for ${childFirst}`}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
