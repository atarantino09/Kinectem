import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Loader2, ThumbsUp, HelpCircle, ThumbsDown } from "lucide-react";

type EventType = "practice" | "game" | "scrimmage" | "tournament" | "other";
type EventStatus = "scheduled" | "canceled" | "postponed" | "completed";

type AdminScheduleEvent = {
  id: string;
  teamId: string;
  teamName: string;
  organizationId: string;
  organizationName: string | null;
  eventType: EventType;
  title: string | null;
  opponent: string | null;
  status: EventStatus;
  startAt: string;
  endAt: string | null;
  locationName: string | null;
  rsvps: { going: number; maybe: number; out: number };
};

const EVENT_TYPE_LABEL: Record<EventType, string> = {
  practice: "Practice",
  game: "Game",
  scrimmage: "Scrimmage",
  tournament: "Tournament",
  other: "Event",
};

const STATUS_VARIANT: Record<
  EventStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  scheduled: "secondary",
  completed: "default",
  postponed: "outline",
  canceled: "destructive",
};

function eventLabel(e: AdminScheduleEvent): string {
  if (e.opponent && (e.eventType === "game" || e.eventType === "scrimmage")) {
    return `vs ${e.opponent}`;
  }
  return e.title?.trim() || EVENT_TYPE_LABEL[e.eventType];
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminSchedule() {
  const { data, isLoading } = useQuery<{ data: AdminScheduleEvent[] }>({
    queryKey: ["admin", "schedule", "upcoming"],
    queryFn: () =>
      customFetch<{ data: AdminScheduleEvent[] }>(
        `/api/v1/admin/schedule/upcoming?limit=200`,
        { method: "GET" },
      ),
  });

  const events = data?.data ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Schedule oversight
          </h1>
          <p className="text-sm text-muted-foreground">
            Upcoming events across every team, with RSVP health at a glance.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-primary" />
              Upcoming events
              {!isLoading && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({events.length})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading schedule…
              </div>
            ) : events.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No upcoming events scheduled.
              </p>
            ) : (
              <div className="divide-y">
                {events.map((e) => (
                  <div
                    key={e.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                    data-testid={`admin-event-${e.id}`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{eventLabel(e)}</span>
                        <Badge variant="outline" className="text-xs">
                          {EVENT_TYPE_LABEL[e.eventType]}
                        </Badge>
                        {e.status !== "scheduled" && (
                          <Badge
                            variant={STATUS_VARIANT[e.status]}
                            className="text-xs capitalize"
                          >
                            {e.status}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-sm text-muted-foreground">
                        <Link
                          href={`/teams/${e.teamId}`}
                          className="hover:underline"
                        >
                          {e.teamName}
                        </Link>
                        {e.organizationName && (
                          <>
                            {" · "}
                            <Link
                              href={`/organizations/${e.organizationId}`}
                              className="hover:underline"
                            >
                              {e.organizationName}
                            </Link>
                          </>
                        )}
                        {" · "}
                        {formatWhen(e.startAt)}
                        {e.locationName ? ` · ${e.locationName}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-sm">
                      <span
                        className="flex items-center gap-1 text-emerald-600"
                        title="Going"
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        {e.rsvps.going}
                      </span>
                      <span
                        className="flex items-center gap-1 text-amber-600"
                        title="Maybe"
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                        {e.rsvps.maybe}
                      </span>
                      <span
                        className="flex items-center gap-1 text-muted-foreground"
                        title="Can't make it"
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                        {e.rsvps.out}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
