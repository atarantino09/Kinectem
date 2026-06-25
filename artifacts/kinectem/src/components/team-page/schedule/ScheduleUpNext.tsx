import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, ChevronRight, MapPin } from "lucide-react";
import {
  fetchUpcoming,
  scheduleUpcomingQueryKey,
  eventTitle,
  formatDayHeading,
  formatTime,
  EVENT_TYPE_CHIP,
} from "./scheduleApi";

interface ScheduleUpNextProps {
  teamId: string;
  // Switch the team page over to the full Schedule tab.
  onOpenSchedule: () => void;
}

// Compact "what's next" card shown above the posts feed on the main team
// page. Pulls the next few non-canceled events and deep-links into the
// Schedule tab. Renders nothing when there's nothing upcoming.
export function ScheduleUpNext({ teamId, onOpenSchedule }: ScheduleUpNextProps) {
  const { data: events = [] } = useQuery({
    queryKey: scheduleUpcomingQueryKey(teamId, 3),
    queryFn: () => fetchUpcoming(teamId, 3),
    enabled: !!teamId,
  });

  if (events.length === 0) return null;

  return (
    <Card className="rounded-xl border border-border" data-testid="card-up-next">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4" />
            Up Next
          </h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs font-bold"
            onClick={onOpenSchedule}
            data-testid="btn-up-next-view-all"
          >
            View schedule
            <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </Button>
        </div>
        <div className="space-y-2">
          {events.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={onOpenSchedule}
              className="w-full flex items-center gap-3 rounded-lg border border-border p-2.5 text-left hover:bg-muted/50 transition-colors"
              data-testid={`row-up-next-${e.id}`}
            >
              <span
                className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-bold ${EVENT_TYPE_CHIP[e.eventType]}`}
              >
                {formatDayHeading(e.startAt)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold truncate">
                  {eventTitle(e)}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                  {e.allDay ? "All day" : formatTime(e.startAt)}
                  {(e.locationName || e.locationField) && (
                    <>
                      <span>·</span>
                      <MapPin className="w-3 h-3 shrink-0" />
                      {[e.locationName, e.locationField]
                        .filter(Boolean)
                        .join(" · ")}
                    </>
                  )}
                </span>
              </span>
              {e.status === "postponed" && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                  Postponed
                </span>
              )}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
