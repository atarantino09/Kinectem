import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { CalendarPlus, Loader2 } from "lucide-react";
import {
  createEvent,
  updateEvent,
  scheduleQueryKey,
  EVENT_TYPE_LABEL,
  type EventType,
  type HomeAway,
  type ScheduleEvent,
  type CreateEventInput,
  type UpdateEventInput,
} from "./scheduleApi";

// Top-level choice shown to coaches. "Game" is a group that reveals a
// secondary kind selector (scrimmage / game / tournament); "Event" maps to
// the catch-all "other" type.
const PRIMARY_TYPES: { value: EventType; label: string }[] = [
  { value: "practice", label: "Practice" },
  { value: "game", label: "Game" },
  { value: "other", label: "Event" },
];

const GAME_TYPES: EventType[] = ["scrimmage", "game", "tournament"];

const HOME_AWAY: { value: HomeAway; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "away", label: "Away" },
  { value: "neutral", label: "Neutral" },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Combine a local date ("YYYY-MM-DD") + time ("HH:MM") into a UTC ISO instant.
function toIso(date: string, time: string): string {
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
  const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

// Pull the local "YYYY-MM-DD" / "HH:MM" out of a stored ISO instant.
function splitIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

interface EventFormDialogProps {
  teamId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  // When set, the dialog edits this event instead of creating a new one.
  editEvent?: ScheduleEvent | null;
}

// One adaptive dialog for both creating and editing a schedule event. The
// visible fields change with the chosen event type: games/scrimmages expose
// opponent + home/away, practices expose a "repeat weekly" block, and the
// generic "other" type requires a title. Validation mirrors the server's
// Zod rules so the user gets inline feedback before the round-trip.
export function EventFormDialog({
  teamId,
  open,
  onOpenChange,
  editEvent = null,
}: EventFormDialogProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!editEvent;
  const isRecurringEdit = isEdit && !!editEvent?.recurrenceId;

  const [eventType, setEventType] = useState<EventType>("practice");
  const [title, setTitle] = useState("");
  const [opponent, setOpponent] = useState("");
  const [homeAway, setHomeAway] = useState<HomeAway>("home");
  const [date, setDate] = useState(todayLocalDate());
  const [startTime, setStartTime] = useState("17:00");
  const [endTime, setEndTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [locationName, setLocationName] = useState("");
  const [locationField, setLocationField] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [notes, setNotes] = useState("");

  // Recurrence (practice-only, create-only).
  const [repeat, setRepeat] = useState(false);
  const [days, setDays] = useState<Set<number>>(new Set());
  const [seriesStart, setSeriesStart] = useState(todayLocalDate());
  const [seriesEnd, setSeriesEnd] = useState(todayLocalDate());

  // Recurring edit: apply to just this occurrence or the whole future series.
  const [scope, setScope] = useState<"single" | "series">("single");

  const [submitting, setSubmitting] = useState(false);

  // Seed / reset the form whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (editEvent) {
      const { date: d, time } = splitIso(editEvent.startAt);
      setEventType(editEvent.eventType);
      setTitle(editEvent.title ?? "");
      setOpponent(editEvent.opponent ?? "");
      setHomeAway(editEvent.homeAway ?? "home");
      setDate(d);
      setStartTime(time);
      setEndTime(editEvent.endAt ? splitIso(editEvent.endAt).time : "");
      setAllDay(editEvent.allDay);
      setLocationName(editEvent.locationName ?? "");
      setLocationField(editEvent.locationField ?? "");
      setLocationAddress(editEvent.locationAddress ?? "");
      setNotes(editEvent.notes ?? "");
      setRepeat(false);
      setScope("single");
    } else {
      setEventType("practice");
      setTitle("");
      setOpponent("");
      setHomeAway("home");
      setDate(todayLocalDate());
      setStartTime("17:00");
      setEndTime("");
      setAllDay(false);
      setLocationName("");
      setLocationField("");
      setLocationAddress("");
      setNotes("");
      setRepeat(false);
      setDays(new Set());
      setSeriesStart(todayLocalDate());
      setSeriesEnd(todayLocalDate());
      setScope("single");
    }
  }, [open, editEvent]);

  const isGameLike = eventType === "game" || eventType === "scrimmage";
  const isGameGroup = GAME_TYPES.includes(eventType);
  const canRepeat = !isEdit && eventType === "practice";

  const toggleDay = (d: number) => {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  const validationError = useMemo<string | null>(() => {
    if (eventType === "other" && !title.trim()) {
      return "Add a title for this event.";
    }
    if (canRepeat && repeat) {
      if (days.size === 0) return "Pick at least one day of the week.";
      if (seriesEnd < seriesStart) return "End date must be on or after the start date.";
      if (!startTime) return "Add a start time.";
      if (endTime && endTime <= startTime) return "End time must be after the start time.";
      return null;
    }
    if (!allDay && !startTime) return "Add a start time.";
    if (!allDay && endTime && endTime <= startTime) {
      return "End time must be after the start time.";
    }
    return null;
  }, [
    eventType,
    title,
    canRepeat,
    repeat,
    days,
    seriesStart,
    seriesEnd,
    startTime,
    endTime,
    allDay,
  ]);

  const onSubmit = async () => {
    if (validationError) {
      toast({ title: validationError, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      const trimmedTitle = title.trim();
      const trimmedOpponent = opponent.trim();
      const trimmedLocation = locationName.trim();
      const trimmedField = locationField.trim();
      const trimmedAddress = locationAddress.trim();
      const trimmedNotes = notes.trim();

      if (canRepeat && repeat) {
        const input: CreateEventInput = {
          eventType: "practice",
          title: trimmedTitle || null,
          locationName: trimmedLocation || null,
          locationField: trimmedField || null,
          locationAddress: trimmedAddress || null,
          notes: trimmedNotes || null,
          tzOffsetMinutes,
          recurrence: {
            daysOfWeek: Array.from(days).sort((a, b) => a - b),
            startTime,
            endTime: endTime || null,
            seriesStartDate: seriesStart,
            seriesEndDate: seriesEnd,
          },
        };
        await createEvent(teamId, input);
      } else if (isEdit && editEvent) {
        const base: UpdateEventInput = {
          title: trimmedTitle || null,
          opponent: isGameLike ? trimmedOpponent || null : null,
          homeAway: isGameLike ? homeAway : null,
          locationName: trimmedLocation || null,
          locationField: trimmedField || null,
          locationAddress: trimmedAddress || null,
          notes: trimmedNotes || null,
          allDay,
        };
        if (isRecurringEdit && scope === "series") {
          // Series edit: re-apply the wall-clock time to every future
          // occurrence (the server preserves each row's own date).
          base.scope = "series";
          base.startTime = allDay ? "00:00" : startTime;
          base.endTime = allDay ? null : endTime || null;
          base.tzOffsetMinutes = tzOffsetMinutes;
        } else {
          base.scope = "single";
          base.startAt = toIso(date, allDay ? "00:00" : startTime);
          base.endAt = allDay || !endTime ? null : toIso(date, endTime);
        }
        await updateEvent(teamId, editEvent.id, base);
      } else {
        const input: CreateEventInput = {
          eventType,
          title: trimmedTitle || null,
          opponent: isGameLike ? trimmedOpponent || null : null,
          homeAway: isGameLike ? homeAway : null,
          locationName: trimmedLocation || null,
          locationField: trimmedField || null,
          locationAddress: trimmedAddress || null,
          notes: trimmedNotes || null,
          allDay,
          startAt: toIso(date, allDay ? "00:00" : startTime),
          endAt: allDay || !endTime ? null : toIso(date, endTime),
        };
        await createEvent(teamId, input);
      }

      await qc.invalidateQueries({ queryKey: scheduleQueryKey(teamId) });
      toast({ title: isEdit ? "Event updated" : "Event added" });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: isEdit ? "Couldn't update event" : "Couldn't add event",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tight flex items-center gap-2">
            <CalendarPlus className="w-5 h-5 text-primary" />
            {isEdit ? "Edit event" : "Add event"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the details for this event."
              : "Add a practice, game, or other event to the team schedule."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Event type — locked once an event exists (changing type would
              orphan type-specific fields). */}
          {!isEdit && (
            <div>
              <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                Type
              </Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {PRIMARY_TYPES.map((t) => {
                  const active =
                    t.value === "game" ? isGameGroup : eventType === t.value;
                  return (
                    <Button
                      key={t.value}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className="font-bold rounded-full"
                      onClick={() => {
                        if (t.value === "game") {
                          if (!isGameGroup) setEventType("game");
                        } else {
                          setEventType(t.value);
                        }
                      }}
                      data-testid={`btn-event-type-${t.value}`}
                    >
                      {t.label}
                    </Button>
                  );
                })}
              </div>

              {isGameGroup && (
                <div className="mt-3">
                  <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                    Game type
                  </Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {GAME_TYPES.map((t) => (
                      <Button
                        key={t}
                        type="button"
                        size="sm"
                        variant={eventType === t ? "default" : "outline"}
                        className="font-bold rounded-full"
                        onClick={() => setEventType(t)}
                        data-testid={`btn-game-type-${t}`}
                      >
                        {EVENT_TYPE_LABEL[t]}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {isGameLike && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label
                  htmlFor="eventOpponent"
                  className="text-xs font-black uppercase tracking-widest text-muted-foreground"
                >
                  Opponent
                </Label>
                <Input
                  id="eventOpponent"
                  value={opponent}
                  onChange={(e) => setOpponent(e.target.value)}
                  placeholder="e.g. Riverside Rapids"
                  className="mt-2"
                  data-testid="input-event-opponent"
                />
              </div>
              <div>
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                  Location
                </Label>
                <div className="flex gap-2 mt-2">
                  {HOME_AWAY.map((h) => (
                    <Button
                      key={h.value}
                      type="button"
                      size="sm"
                      variant={homeAway === h.value ? "default" : "outline"}
                      className="font-bold rounded-full"
                      onClick={() => setHomeAway(h.value)}
                      data-testid={`btn-home-away-${h.value}`}
                    >
                      {h.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div>
            <Label
              htmlFor="eventTitle"
              className="text-xs font-black uppercase tracking-widest text-muted-foreground"
            >
              Title{eventType === "other" ? "" : " (optional)"}
            </Label>
            <Input
              id="eventTitle"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                eventType === "other"
                  ? "e.g. Team photo day"
                  : "Override the default title"
              }
              className="mt-2"
              data-testid="input-event-title"
            />
          </div>

          {canRepeat && (
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={repeat}
                onCheckedChange={(v) => setRepeat(v === true)}
                data-testid="checkbox-event-repeat"
              />
              <span className="text-sm font-bold">Repeat weekly</span>
            </label>
          )}

          {canRepeat && repeat ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div>
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                  Days
                </Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {WEEKDAYS.map((label, idx) => (
                    <Button
                      key={label}
                      type="button"
                      size="sm"
                      variant={days.has(idx) ? "default" : "outline"}
                      className="font-bold rounded-full w-12"
                      onClick={() => toggleDay(idx)}
                      data-testid={`btn-repeat-day-${idx}`}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label
                    htmlFor="seriesStart"
                    className="text-xs font-black uppercase tracking-widest text-muted-foreground"
                  >
                    Starts
                  </Label>
                  <Input
                    id="seriesStart"
                    type="date"
                    value={seriesStart}
                    max={seriesEnd || undefined}
                    onChange={(e) => setSeriesStart(e.target.value)}
                    className="mt-2"
                    data-testid="input-series-start"
                  />
                </div>
                <div>
                  <Label
                    htmlFor="seriesEnd"
                    className="text-xs font-black uppercase tracking-widest text-muted-foreground"
                  >
                    Ends
                  </Label>
                  <Input
                    id="seriesEnd"
                    type="date"
                    value={seriesEnd}
                    min={seriesStart || undefined}
                    onChange={(e) => setSeriesEnd(e.target.value)}
                    className="mt-2"
                    data-testid="input-series-end"
                  />
                </div>
              </div>
            </div>
          ) : (
            !(isRecurringEdit && scope === "series") && (
              <div>
                <Label
                  htmlFor="eventDate"
                  className="text-xs font-black uppercase tracking-widest text-muted-foreground"
                >
                  Date
                </Label>
                <Input
                  id="eventDate"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-2"
                  data-testid="input-event-date"
                />
              </div>
            )
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={allDay}
              onCheckedChange={(v) => setAllDay(v === true)}
              data-testid="checkbox-event-all-day"
            />
            <span className="text-sm font-bold">All day</span>
          </label>

          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label
                  htmlFor="eventStart"
                  className="text-xs font-black uppercase tracking-widest text-muted-foreground"
                >
                  Start time
                </Label>
                <Input
                  id="eventStart"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="mt-2"
                  data-testid="input-event-start-time"
                />
              </div>
              <div>
                <Label
                  htmlFor="eventEnd"
                  className="text-xs font-black uppercase tracking-widest text-muted-foreground"
                >
                  End time (optional)
                </Label>
                <Input
                  id="eventEnd"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="mt-2"
                  data-testid="input-event-end-time"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label
                htmlFor="eventLocation"
                className="text-xs font-black uppercase tracking-widest text-muted-foreground"
              >
                Location (optional)
              </Label>
              <Input
                id="eventLocation"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="e.g. Main gym"
                className="mt-2"
                data-testid="input-event-location"
              />
            </div>
            <div>
              <Label
                htmlFor="eventField"
                className="text-xs font-black uppercase tracking-widest text-muted-foreground"
              >
                Field / Court # (optional)
              </Label>
              <Input
                id="eventField"
                value={locationField}
                onChange={(e) => setLocationField(e.target.value)}
                placeholder="e.g. Field 3, Court 2"
                className="mt-2"
                data-testid="input-event-field"
              />
            </div>
          </div>

          <div>
            <Label
              htmlFor="eventAddress"
              className="text-xs font-black uppercase tracking-widest text-muted-foreground"
            >
              Address (optional)
            </Label>
            <Input
              id="eventAddress"
              value={locationAddress}
              onChange={(e) => setLocationAddress(e.target.value)}
              placeholder="e.g. 123 Main St, Springfield"
              className="mt-2"
              data-testid="input-event-address"
            />
          </div>

          <div>
            <Label
              htmlFor="eventNotes"
              className="text-xs font-black uppercase tracking-widest text-muted-foreground"
            >
              Notes (optional)
            </Label>
            <Textarea
              id="eventNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything families should know"
              className="mt-2"
              data-testid="textarea-event-notes"
            />
          </div>

          {isGameLike && !isEdit && (
            <div
              className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
              data-testid="note-recap-reminder"
            >
              <span className="font-bold">After the game,</span> come back here to
              write a game recap — you&apos;ll get a reminder a couple hours after
              kickoff.
            </div>
          )}

          {isRecurringEdit && (
            <div>
              <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                Apply to
              </Label>
              <div className="flex gap-2 mt-2">
                <Button
                  type="button"
                  size="sm"
                  variant={scope === "single" ? "default" : "outline"}
                  className="font-bold rounded-full"
                  onClick={() => setScope("single")}
                  data-testid="btn-scope-single"
                >
                  This event
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={scope === "series" ? "default" : "outline"}
                  className="font-bold rounded-full"
                  onClick={() => setScope("series")}
                  data-testid="btn-scope-series"
                >
                  This &amp; future events
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="font-bold rounded-full"
          >
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={onSubmit}
            disabled={submitting || !!validationError}
            data-testid="btn-submit-event"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : null}
            {isEdit ? "Save changes" : "Add event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
