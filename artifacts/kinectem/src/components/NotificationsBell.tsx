import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  markAllChildNotificationsRead,
  useGetUnreadNotificationCount,
  useGetChildrenNotificationsSummary,
  useListNotifications,
  useMarkAllNotificationsAsRead,
  getGetUnreadNotificationCountQueryKey,
  getGetChildrenNotificationsSummaryQueryKey,
  getListNotificationsQueryKey,
  type GetChildrenNotificationsSummary200,
  type NotificationUnreadCount,
  type NotificationResponse,
  type PaginatedNotifications,
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

// ---------------------------------------------------------------------------
// Notification deep-link policy
// ---------------------------------------------------------------------------
// Every server-side `db.insert(notifications)` call should either set a
// `link` that resolves to a real page, or accept that the notification
// will be rendered as plain (non-clickable) text in this dropdown.
//
// Today's kinds and where they go (audited against every insert site):
//
//   like                     -> `/posts/<prefixed postId>`  (post page)
//                               source: routes/posts.ts (POST /posts/:postId/reactions)
//   mention (co-author)      -> `/posts/<articlePostId>`    (article page)
//                               source: routes/drafts.ts (POST /posts/:postId/co-authors)
//   post_tag                 -> `/posts/<articlePostId>`    (article page)
//                               source: lib/article-tagging.ts (notifyNewlyTaggedInRecap)
//   follow                   -> `/users/<actorUserId>`      (new follower's profile)
//                               source: routes/organizations.ts (POST /users/:userId/follow)
//   follow_request           -> `/follow-requests`          (Task #520 — adult
//                               private-account inbox). Inserted by the same
//                               route when the followed adult has
//                               `requires_follow_approval = true`.
//   roster_invite            -> `/teams/<teamId>?roster=1&entryId=<entryId>`
//                               source: routes/teams.ts (member add + invite redeem)
//                               Task #645 — also used for *player* email
//                               invites to an existing account, where the
//                               link is `/invites/<token>` instead (no
//                               roster entry exists yet; the recipient picks
//                               the real player via the chooser). Rendered as
//                               a plain clickable link either way.
//   roster_invite_for_child  -> `/family?childId=...&entryId=...&teamId=...`
//                               source: routes/teams.ts; also handled inline below
//                               (Accept / Decline buttons on the row).
//   roster_role_changed      -> `/teams/<teamId>?roster=1&entryId=<entryId>`
//                               source: routes/teams.ts (PATCH /teams/:teamId/members/:memberId).
//                               Plain link click — Task #536.
//   roster_role_changed_for_child
//                            -> `/family?childId=...&entryId=...&teamId=...`
//                               source: routes/teams.ts (PATCH /teams/:teamId/members/:memberId).
//                               Plain link click — no inline Accept/Decline,
//                               since role changes are not pending invites.
//   recap_approved           -> `/posts/<articlePostId>` (the published recap)
//                               source: routes/organizations.ts
//                               (POST /organizations/:orgId/post-approvals/:id/approve)
//   recap_declined           -> `/posts/new?editId=<articlePostId>`
//                               (the recap composer with the declined draft loaded)
//                               source: routes/organizations.ts
//                               (POST /organizations/:orgId/post-approvals/:id/decline)
//   team_archived            -> `/teams/<teamId>` (the team page now
//                               shows the archived banner)
//                               source: lib/notifications.ts
//                               (notifyTeamArchived, called from
//                               routes/teams.ts archive route).
//   team_unarchived          -> `/teams/<teamId>` (team page is
//                               active again)
//                               source: lib/notifications.ts
//                               (notifyTeamUnarchived).
//   org_claim_approved       -> `/organizations/<orgId>` (the page the
//                               claimer now owns)
//                               source: routes/admin.ts
//                               (POST /admin/org-claims/:id/approve)
//   org_claim_declined       -> `/organizations/<orgId>` (the page whose
//                               claim was declined)
//                               source: routes/admin.ts
//                               (POST /admin/org-claims/:id/decline)
//   guardian_expired         -> `/family?childId=<childId>` (NOT the
//                               inserted `/guardian?childId=...` link).
//                               The bell intentionally rewrites this to
//                               /family by `n.type` in handleRowClick so
//                               the parent lands next to the affected
//                               child with the Resend button visible.
//                               The childId is parsed off the inserted
//                               link, so it must remain populated.
//                               source: lib/guardian-confirmations.ts.
//
// Rules of thumb when adding a new kind:
//   * If you can name a single page that answers "what should I look at?",
//     set `link` to that page. URL params (childId, entryId, teamId,
//     etc.) are fine — the helpers below pick them out.
//   * Prefer the prefixed post id (`article-<uuid>`, `highlight-<uuid>`,
//     `orgpost-<uuid>`) in `/posts/<id>` links. Bare uuids 404.
//   * If the destination genuinely depends on user state (parent flows
//     are the canonical example), add a branch to `handleRowClick` /
//     `isClickable` instead of inventing a fake link.
//   * If there is honestly nowhere useful to send the user, leave `link`
//     null. The row renders as static text — readable, but it won't
//     pretend to be a button.
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
  const { data: childrenSummary } = useGetChildrenNotificationsSummary();
  const { data: notifs, isLoading } = useListNotifications();
  const [open, setOpen] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [actingOnEntryId, setActingOnEntryId] = useState<string | null>(null);
  // Guard so the auto-clear fires at most once per dropdown-open. Reset on close.
  const clearedThisOpenRef = useRef(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetUnreadNotificationCountQueryKey() });
    qc.invalidateQueries({
      queryKey: getGetChildrenNotificationsSummaryQueryKey(),
    });
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  };

  // Optimistically drop a row from the cached notifications list so it
  // disappears from the dropdown the instant the user's action succeeds.
  // Cancels any in-flight list refetches first — otherwise a response
  // that started before the action (e.g. the refetch fired by
  // `markAll.mutate()` on dropdown-open) can land after our setQueryData
  // call and transiently re-add the row before the final `invalidate()`
  // reconciles with the server.
  const removeFromList = async (notificationId: string) => {
    await qc.cancelQueries({ queryKey: getListNotificationsQueryKey() });
    qc.setQueryData<PaginatedNotifications | undefined>(
      getListNotificationsQueryKey(),
      (prev) =>
        prev
          ? { ...prev, data: prev.data.filter((x) => x.id !== notificationId) }
          : prev,
    );
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

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      clearedThisOpenRef.current = false;
      return;
    }
    if (clearedThisOpenRef.current) return;
    clearedThisOpenRef.current = true;

    // Optimistically zero the badges so the dot disappears the instant
    // the dropdown opens. The mutations below reconcile via invalidate().
    qc.setQueryData<NotificationUnreadCount | undefined>(
      getGetUnreadNotificationCountQueryKey(),
      (prev) => (prev ? { ...prev, unreadCount: 0 } : prev),
    );
    qc.setQueryData<GetChildrenNotificationsSummary200 | undefined>(
      getGetChildrenNotificationsSummaryQueryKey(),
      (prev) =>
        prev
          ? {
              ...prev,
              totalUnreadCount: 0,
              data: prev.data.map((d) => ({ ...d, unreadCount: 0 })),
            }
          : prev,
    );

    // Fire mark-all for the user's own notifications unconditionally —
    // the endpoint is idempotent and a no-op when nothing's unread, so
    // we don't need to wait for the unread-count query to populate.
    markAll.mutate();

    // For the COPPA / children stream we need the per-child IDs to call
    // the per-child mark-all endpoint. If the summary isn't cached yet,
    // refetch it first and then mark each child's stream read.
    const fireChildren = (rows: GetChildrenNotificationsSummary200["data"]) => {
      if (rows.length === 0) return Promise.resolve();
      return Promise.all(
        rows.map((c) =>
          markAllChildNotificationsRead(c.childId).catch(() => undefined),
        ),
      ).then(() => undefined);
    };
    const cached = qc.getQueryData<GetChildrenNotificationsSummary200>(
      getGetChildrenNotificationsSummaryQueryKey(),
    );
    const ensureRows = cached?.data
      ? Promise.resolve(cached.data)
      : qc
          .fetchQuery<GetChildrenNotificationsSummary200>({
            queryKey: getGetChildrenNotificationsSummaryQueryKey(),
          })
          .then((r) => r?.data ?? [])
          .catch(() => []);
    void ensureRows.then(fireChildren).then(() => {
      qc.invalidateQueries({
        queryKey: getGetChildrenNotificationsSummaryQueryKey(),
      });
    });
  };

  const ownUnread = countData?.unreadCount ?? 0;
  const childrenUnread = childrenSummary?.totalUnreadCount ?? 0;
  const unread = ownUnread + childrenUnread;
  const items = notifs?.data ?? [];

  // Notifications are clickable only when we know where to send the
  // user. The two parent flows (`guardian_expired`, `roster_invite_for_child`)
  // always route to /family, even with no `link`, so they're treated as
  // clickable. Everything else is clickable iff it carries a `link`.
  const isClickable = (n: NotificationResponse): boolean => {
    if (n.type === "guardian_expired") return true;
    if (n.type === "roster_invite_for_child") return true;
    return getNotificationLink(n) !== null;
  };

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
      await removeFromList(n.id);
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
      await removeFromList(n.id);
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
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-9 px-2"
          data-testid="button-notifications"
        >
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span
              className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center"
              data-testid="badge-bell-unread"
            >
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
        </div>
        {childrenUnread > 0 && (
          <button
            onClick={() => navigate("/family")}
            className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-primary/5 hover:bg-primary/10 text-left"
            data-testid="button-family-unread-hint"
          >
            <span className="flex items-center gap-2 text-xs font-bold text-primary">
              <Users className="w-3.5 h-3.5" />
              {childrenUnread} new in your family
            </span>
            <span className="text-[11px] font-bold text-primary/80">
              View →
            </span>
          </button>
        )}
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
              const clickable = isClickable(n);
              // Render as a real <button> only when there's somewhere to
              // go. Unlinked notifications stay readable in the dropdown
              // but don't pretend they're interactive (no pointer cursor,
              // no hover state, no silent click).
              const innerClass = clickable
                ? "w-full text-left px-4 pt-3 pb-2 hover:bg-muted/60 cursor-pointer"
                : "w-full text-left px-4 pt-3 pb-2 cursor-default";
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
                  {(() => {
                    const body = (
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
                    );
                    return clickable ? (
                      <button
                        onClick={() => handleRowClick(n)}
                        className={innerClass}
                      >
                        {body}
                      </button>
                    ) : (
                      <div
                        className={innerClass}
                        data-testid={`notification-static-${n.id}`}
                      >
                        {body}
                      </div>
                    );
                  })()}
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
                        variant="brand"
                        size="xs"
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
