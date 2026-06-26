import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  List,
  Lock,
  MapPin,
  Upload,
} from "lucide-react";
import {
  fetchSchedule,
  scheduleQueryKey,
  groupByDay,
  eventTitle,
  formatDayHeading,
  formatTimeRange,
  isPast,
  localDateKey,
  EVENT_TYPE_CHIP,
  type ScheduleEvent,
} from "./scheduleApi";
import { EventFormDialog } from "./EventFormDialog";
import { EventDetailDialog } from "./EventDetailDialog";
import { CalendarSubscribe } from "./CalendarSubscribe";
import { CsvImportDialog } from "./CsvImportDialog";
import { SeasonResults } from "./SeasonResults";

interface TeamSchedulePanelProps {
  teamId: string;
  canManage: boolean;
}

type View = "agenda" | "calendar";

function EventRow({
  event,
  onClick,
}: {
  event: ScheduleEvent;
  onClick: () => void;
}) {
  const canceled = event.status === "canceled";
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left hover:bg-muted/50 transition-colors"
      data-testid={`row-schedule-event-${event.id}`}
    >
      <span
        className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-bold ${EVENT_TYPE_CHIP[event.eventType]}`}
      >
        {formatTimeRange(event)}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block font-bold truncate ${
            canceled ? "line-through text-muted-foreground" : ""
          }`}
        >
          {eventTitle(event)}
        </span>
        {(event.locationName || event.locationField) && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
            <MapPin className="w-3 h-3 shrink-0" />
            {[event.locationName, event.locationField]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </span>
      {canceled && (
        <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive">
          Canceled
        </span>
      )}
      {event.status === "postponed" && (
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
          Postponed
        </span>
      )}
    </button>
  );
}

function MonthCalendar({
  events,
  onSelect,
}: {
  events: ScheduleEvent[];
  onSelect: (e: ScheduleEvent) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>();
    for (const e of events) {
      const key = localDateKey(e.startAt);
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = localDateKey(new Date().toISOString());

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = firstDay.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          data-testid="btn-calendar-prev"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="font-black tracking-tight">{monthLabel}</span>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          data-testid="btn-calendar-next"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} className="min-h-16" />;
          const key = localDateKey(cell.toISOString());
          const dayEvents = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div
              key={i}
              className={`min-h-16 rounded-lg border p-1 text-left ${
                isToday ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <div
                className={`text-xs font-bold mb-0.5 ${
                  isToday ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {cell.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onSelect(e)}
                    className={`block w-full truncate rounded border px-1 py-0.5 text-[10px] font-bold leading-tight ${EVENT_TYPE_CHIP[e.eventType]} ${
                      e.status === "canceled" ? "line-through opacity-60" : ""
                    }`}
                    data-testid={`cal-event-${e.id}`}
                  >
                    {eventTitle(e)}
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] font-bold text-muted-foreground">
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TeamSchedulePanel({ teamId, canManage }: TeamSchedulePanelProps) {
  const [view, setView] = useState<View>("agenda");
  const [formOpen, setFormOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<ScheduleEvent | null>(null);
  const [detail, setDetail] = useState<ScheduleEvent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data: events = [], isLoading } = useQuery({
    queryKey: scheduleQueryKey(teamId),
    queryFn: () => fetchSchedule(teamId),
    enabled: !!teamId,
  });

  const { upcoming, past } = useMemo(() => {
    const up: ScheduleEvent[] = [];
    const pa: ScheduleEvent[] = [];
    for (const e of events) (isPast(e) ? pa : up).push(e);
    pa.reverse(); // most recent first
    return { upcoming: up, past: pa };
  }, [events]);

  const upcomingGroups = useMemo(() => groupByDay(upcoming), [upcoming]);
  const pastGroups = useMemo(() => groupByDay(past), [past]);

  const openDetail = (e: ScheduleEvent) => {
    setDetail(e);
    setDetailOpen(true);
  };

  const openCreate = () => {
    setEditEvent(null);
    setFormOpen(true);
  };

  const openEdit = (e: ScheduleEvent) => {
    setDetailOpen(false);
    setEditEvent(e);
    setFormOpen(true);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
          <CalendarDays className="w-5 h-5" />
          Schedule
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant={view === "agenda" ? "default" : "outline"}
            className="font-bold rounded-full"
            onClick={() => setView("agenda")}
            data-testid="btn-view-agenda"
          >
            <List className="w-3.5 h-3.5 mr-1.5" />
            Agenda
          </Button>
          <Button
            size="sm"
            variant={view === "calendar" ? "default" : "outline"}
            className="font-bold rounded-full"
            onClick={() => setView("calendar")}
            data-testid="btn-view-calendar"
          >
            <CalendarDays className="w-3.5 h-3.5 mr-1.5" />
            Calendar
          </Button>
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="font-bold rounded-full"
              onClick={() => setImportOpen(true)}
              data-testid="btn-import-csv"
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Import CSV
            </Button>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="brand"
              onClick={openCreate}
              data-testid="btn-add-event"
            >
              <CalendarPlus className="w-3.5 h-3.5 mr-1.5" />
              Add Event
            </Button>
          )}
        </div>
      </div>

      <div
        className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
        data-testid="schedule-visibility-note"
      >
        <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Only this team's coaches, admins, players, and their parents can see
          this schedule. It's never shown to other team followers or the public.
        </span>
      </div>

      <CalendarSubscribe teamId={teamId} />

      {isLoading ? (
        <Card className="rounded-xl border border-border">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Loading schedule…
          </CardContent>
        </Card>
      ) : events.length === 0 ? (
        <Card className="rounded-xl border border-dashed border-border">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nothing on the schedule yet.
            {canManage && (
              <span className="block mt-1">
                Add the team's first practice or game.
              </span>
            )}
          </CardContent>
        </Card>
      ) : view === "calendar" ? (
        <Card className="rounded-xl border border-border">
          <CardContent className="p-4">
            <MonthCalendar events={events} onSelect={openDetail} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {upcoming.length === 0 ? (
            <Card className="rounded-xl border border-dashed border-border">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No upcoming events.
              </CardContent>
            </Card>
          ) : (
            upcomingGroups.map((g) => (
              <div key={g.key} className="space-y-2">
                <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                  {formatDayHeading(g.iso)}
                </h3>
                <div className="space-y-2">
                  {g.events.map((e) => (
                    <EventRow
                      key={e.id}
                      event={e}
                      onClick={() => openDetail(e)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}

          {past.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowPast((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground"
                data-testid="btn-toggle-past-events"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    showPast ? "" : "-rotate-90"
                  }`}
                />
                Past events ({past.length})
              </button>
              {showPast && (
                <div className="mt-3 space-y-4">
                  {pastGroups.map((g) => (
                    <div key={g.key} className="space-y-2">
                      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                        {formatDayHeading(g.iso)}
                      </h3>
                      <div className="space-y-2">
                        {g.events.map((e) => (
                          <EventRow
                            key={e.id}
                            event={e}
                            onClick={() => openDetail(e)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <SeasonResults events={events} />

      <EventFormDialog
        teamId={teamId}
        open={formOpen}
        onOpenChange={setFormOpen}
        editEvent={editEvent}
      />
      {canManage && (
        <CsvImportDialog
          teamId={teamId}
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      )}
      <EventDetailDialog
        teamId={teamId}
        event={detail}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={openEdit}
      />
    </section>
  );
}
