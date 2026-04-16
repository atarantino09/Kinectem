import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUnreadNotificationCount,
  useListNotifications,
  useMarkNotificationAsRead,
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
import { Bell } from "lucide-react";
import { timeAgo } from "@/lib/format";

export function NotificationsBell() {
  const qc = useQueryClient();
  const { data: countData } = useGetUnreadNotificationCount();
  const { data: notifs, isLoading } = useListNotifications();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetUnreadNotificationCountQueryKey() });
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  };

  const markOne = useMarkNotificationAsRead({
    mutation: { onSuccess: invalidate },
  });
  const markAll = useMarkAllNotificationsAsRead({
    mutation: { onSuccess: invalidate },
  });

  const unread = countData?.unreadCount ?? 0;
  const items = notifs?.data ?? [];

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
            items.map((n: NotificationResponse) => (
              <button
                key={n.id}
                onClick={() =>
                  !n.isRead && markOne.mutate({ notificationId: n.id })
                }
                className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted/60 cursor-pointer ${
                  !n.isRead ? "bg-primary/5" : ""
                }`}
                data-testid={`notification-${n.id}`}
              >
                <div className="flex items-start gap-2">
                  {!n.isRead && (
                    <span className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm leading-tight">{n.title}</p>
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
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
