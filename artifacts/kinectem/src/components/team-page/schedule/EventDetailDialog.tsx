import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarArrowDown,
  CalendarX,
  Clock,
  FileText,
  MapPin,
  Newspaper,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  cancelEvent,
  deleteEvent,
  downloadEventIcs,
  scheduleQueryKey,
  eventTitle,
  formatDayHeading,
  formatTimeRange,
  isPast,
  localDateKey,
  EVENT_TYPE_LABEL,
  EVENT_TYPE_CHIP,
  type ScheduleEvent,
} from "./scheduleApi";
import { RsvpSection } from "./RsvpSection";
import { ScoreSection } from "./ScoreSection";

interface EventDetailDialogProps {
  teamId: string;
  event: ScheduleEvent | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: (e: ScheduleEvent) => void;
}

// Read-only detail for everyone, plus coach/admin actions (edit, cancel /
// postpone, delete) gated on the event's own `canManage` flag. Past games
// that still don't have a linked recap surface the "Write game recap" prompt
// that deep-links into the existing post composer.
export function EventDetailDialog({
  teamId,
  event,
  open,
  onOpenChange,
  onEdit,
}: EventDetailDialogProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [cancelMode, setCancelMode] = useState<null | "canceled" | "postponed">(
    null,
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setCancelMode(null);
      setReason("");
      setConfirmDelete(false);
    }
  }, [open, event?.id]);

  if (!event) return null;

  const canManage = event.canManage;
  const isGameLike = event.eventType === "game" || event.eventType === "scrimmage";
  const showRecapPrompt =
    canManage &&
    isGameLike &&
    isPast(event) &&
    event.status === "scheduled" &&
    !event.gameRecapId;

  const refresh = () =>
    qc.invalidateQueries({ queryKey: scheduleQueryKey(teamId) });

  const submitCancel = async () => {
    if (!cancelMode) return;
    setBusy(true);
    try {
      await cancelEvent(teamId, event.id, {
        status: cancelMode,
        reason: reason.trim() || null,
      });
      await refresh();
      toast({
        title: cancelMode === "canceled" ? "Event canceled" : "Event postponed",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Couldn't update event",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (scope?: "series") => {
    setBusy(true);
    try {
      await deleteEvent(teamId, event.id, scope);
      await refresh();
      toast({ title: "Event deleted" });
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Couldn't delete event",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const recapHref = `/posts/new?type=long&teamId=${teamId}&scheduleEventId=${
    event.id
  }&gameDate=${localDateKey(event.startAt)}${
    event.opponent ? `&opponent=${encodeURIComponent(event.opponent)}` : ""
  }&from=${encodeURIComponent(`/teams/${teamId}`)}`;

  const isCanceled = event.status === "canceled";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={`font-bold ${EVENT_TYPE_CHIP[event.eventType]}`}
            >
              {EVENT_TYPE_LABEL[event.eventType]}
            </Badge>
            {event.status === "canceled" && (
              <Badge variant="destructive" className="font-bold">
                Canceled
              </Badge>
            )}
            {event.status === "postponed" && (
              <Badge className="font-bold bg-amber-100 text-amber-900 hover:bg-amber-100">
                Postponed
              </Badge>
            )}
            {event.status === "completed" && (
              <Badge className="font-bold bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                Completed
              </Badge>
            )}
          </div>
          <DialogTitle
            className={`text-2xl font-black tracking-tight ${
              isCanceled ? "line-through text-muted-foreground" : ""
            }`}
          >
            {eventTitle(event)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <Clock className="w-4 h-4 text-muted-foreground" />
            {formatDayHeading(event.startAt)} · {formatTimeRange(event)}
          </div>
          {isGameLike && event.opponent && (
            <div className="text-muted-foreground">
              {event.homeAway === "away" ? "Away at" : event.homeAway === "neutral" ? "vs" : "Home vs"}{" "}
              <span className="font-semibold text-foreground">
                {event.opponent}
              </span>
            </div>
          )}
          {(event.locationName ||
            event.locationField ||
            event.locationAddress) && (
            <div className="flex items-start gap-2 text-muted-foreground">
              <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {(event.locationName || event.locationField) && (
                  <span className="block">
                    {[event.locationName, event.locationField]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
                {event.locationAddress && (
                  <span className="block text-xs">
                    {event.locationAddress}
                  </span>
                )}
              </span>
            </div>
          )}
          {event.statusReason && (
            <div className="rounded-lg bg-muted px-3 py-2 text-muted-foreground">
              {event.statusReason}
            </div>
          )}
          {event.notes && (
            <p className="text-muted-foreground whitespace-pre-wrap">
              {event.notes}
            </p>
          )}
          {event.gameRecapId && (
            <Link href={`/posts/${event.gameRecapId}`}>
              <Button
                variant="outline"
                size="sm"
                className="font-bold rounded-full"
                data-testid="btn-view-linked-recap"
              >
                <Newspaper className="w-3.5 h-3.5 mr-1.5" />
                View game recap
              </Button>
            </Link>
          )}
        </div>

        <div>
          <Button
            variant="outline"
            size="sm"
            className="font-bold rounded-full"
            onClick={() => downloadEventIcs(event)}
            data-testid="btn-download-event-ics"
          >
            <CalendarArrowDown className="w-3.5 h-3.5 mr-1.5" />
            Add to calendar
          </Button>
        </div>

        {!isPast(event) && event.status !== "canceled" && (
          <RsvpSection teamId={teamId} eventId={event.id} />
        )}

        {event.status !== "canceled" && (
          <ScoreSection teamId={teamId} event={event} />
        )}

        {showRecapPrompt && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 space-y-2">
            <p className="text-sm font-semibold text-blue-900">
              This game has finished. Write a recap to share how it went.
            </p>
            <Link href={recapHref}>
              <Button
                variant="brand"
                size="sm"
                onClick={() => onOpenChange(false)}
                data-testid="btn-write-game-recap"
              >
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                Write game recap
              </Button>
            </Link>
          </div>
        )}

        {canManage && cancelMode && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label
              htmlFor="cancelReason"
              className="text-xs font-black uppercase tracking-widest text-muted-foreground"
            >
              Reason (optional — shown to families)
            </Label>
            <Input
              id="cancelReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                cancelMode === "canceled"
                  ? "e.g. Weather"
                  : "e.g. Rescheduling — new date soon"
              }
              data-testid="input-cancel-reason"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="font-bold rounded-full"
                onClick={() => setCancelMode(null)}
                disabled={busy}
              >
                Back
              </Button>
              <Button
                variant="brand"
                size="sm"
                onClick={submitCancel}
                disabled={busy}
                data-testid="btn-confirm-cancel"
              >
                {cancelMode === "canceled" ? "Cancel event" : "Postpone event"}
              </Button>
            </div>
          </div>
        )}

        {canManage && !cancelMode && (
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              size="sm"
              className="font-bold rounded-full text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              data-testid="btn-delete-event"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Delete
            </Button>
            {event.status !== "canceled" && (
              <Button
                variant="outline"
                size="sm"
                className="font-bold rounded-full"
                onClick={() => setCancelMode("canceled")}
                disabled={busy}
                data-testid="btn-start-cancel"
              >
                <CalendarX className="w-3.5 h-3.5 mr-1.5" />
                Cancel / Postpone
              </Button>
            )}
            <Button
              variant="brand"
              size="sm"
              onClick={() => onEdit(event)}
              disabled={busy}
              data-testid="btn-edit-event"
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              Edit
            </Button>
          </DialogFooter>
        )}

        {/* Cancel/Postpone shortcut row when not in reason mode is above;
            postpone reuses the same reason form. */}
        {canManage && !cancelMode && event.status !== "canceled" && (
          <button
            type="button"
            className="text-xs font-bold text-muted-foreground hover:text-foreground self-center"
            onClick={() => setCancelMode("postponed")}
            data-testid="btn-start-postpone"
          >
            Mark as postponed instead
          </button>
        )}
      </DialogContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this event?</AlertDialogTitle>
            <AlertDialogDescription>
              {event.recurrenceId
                ? "This event is part of a repeating series. You can delete just this event, or this and all future events in the series."
                : "This permanently removes the event from the team schedule."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel disabled={busy} className="font-bold rounded-full">
              Keep
            </AlertDialogCancel>
            {event.recurrenceId && (
              <Button
                variant="outline"
                className="font-bold rounded-full text-destructive hover:text-destructive"
                onClick={() => onDelete("series")}
                disabled={busy}
                data-testid="btn-delete-series"
              >
                Delete series
              </Button>
            )}
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onDelete();
              }}
              disabled={busy}
              className="font-bold rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="btn-confirm-delete"
            >
              {event.recurrenceId ? "Delete this only" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
