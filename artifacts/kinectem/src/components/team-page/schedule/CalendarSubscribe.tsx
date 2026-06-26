import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useToast } from "@/hooks/use-toast";
import { CalendarClock, Check, ChevronDown, Copy, RefreshCw } from "lucide-react";
import {
  fetchCalendarInfo,
  rotateCalendarToken,
  calendarInfoQueryKey,
} from "./scheduleApi";

// Members get a read-only calendar-subscription URL they can add to Google /
// Apple Calendar. Coaches/admins can rotate the link to revoke old subscribers.
export function CalendarSubscribe({ teamId }: { teamId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: calendarInfoQueryKey(teamId),
    queryFn: () => fetchCalendarInfo(teamId),
    enabled: !!teamId && open,
  });

  const rotate = useMutation({
    mutationFn: () => rotateCalendarToken(teamId),
    onSuccess: (next) => {
      qc.setQueryData(calendarInfoQueryKey(teamId), next);
      setConfirmRotate(false);
      toast({ title: "Calendar link reset", description: "Old subscriptions will stop updating." });
    },
    onError: (err) =>
      toast({
        title: "Couldn't reset the link",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      }),
  });

  const copy = async () => {
    if (!data?.feedUrl) return;
    try {
      await navigator.clipboard.writeText(data.feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "Copy failed", description: "Select and copy the link manually.", variant: "destructive" });
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-bold"
        data-testid="btn-toggle-calendar-subscribe"
      >
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        Subscribe to this schedule
        <ChevronDown
          className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Add this link to Google Calendar, Apple Calendar, or Outlook to see
            this team's events alongside your own. It updates automatically and
            stays in sync.
          </p>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading link…</p>
          ) : data ? (
            <>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={data.feedUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="text-xs"
                  data-testid="input-calendar-feed-url"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 rounded-full font-bold"
                  onClick={copy}
                  data-testid="btn-copy-calendar-url"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1.5">{copied ? "Copied" : "Copy"}</span>
                </Button>
              </div>
              {data.canManage && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Need to revoke access? Reset the link.
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full font-bold text-muted-foreground hover:text-foreground"
                    onClick={() => setConfirmRotate(true)}
                    disabled={rotate.isPending}
                    data-testid="btn-rotate-calendar-url"
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Reset link
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Couldn't load the subscription link.
            </p>
          )}
        </div>
      )}

      <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the calendar link?</AlertDialogTitle>
            <AlertDialogDescription>
              A new link is generated immediately. Anyone who already subscribed
              with the old link will stop receiving updates and will need the new
              one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel
              disabled={rotate.isPending}
              className="rounded-full font-bold"
            >
              Keep current link
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                rotate.mutate();
              }}
              disabled={rotate.isPending}
              className="rounded-full font-bold"
              data-testid="btn-confirm-rotate-calendar"
            >
              Reset link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
