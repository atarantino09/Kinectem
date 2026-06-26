import { useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Newspaper, Trophy } from "lucide-react";
import {
  hasScore,
  scoreResult,
  formatDayHeading,
  isPast,
  type ScheduleEvent,
} from "./scheduleApi";

const OUTCOME_CLASS: Record<"W" | "L" | "T", string> = {
  W: "bg-emerald-100 text-emerald-800",
  L: "bg-red-100 text-red-800",
  T: "bg-slate-100 text-slate-700",
};

// Members-only season scoreboard: every game-type event with a recorded score,
// most recent first. Renders nothing until at least one score exists.
export function SeasonResults({ events }: { events: ScheduleEvent[] }) {
  const results = useMemo(() => {
    const isGameType = (e: ScheduleEvent) =>
      e.eventType === "game" ||
      e.eventType === "scrimmage" ||
      e.eventType === "tournament";
    return events
      .filter(
        (e) =>
          isGameType(e) &&
          hasScore(e) &&
          e.status !== "canceled" &&
          (e.status === "completed" || isPast(e)),
      )
      .sort(
        (a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime(),
      );
  }, [events]);

  const record = useMemo(() => {
    let w = 0;
    let l = 0;
    let t = 0;
    for (const e of results) {
      const r = scoreResult(e);
      if (r?.outcome === "W") w++;
      else if (r?.outcome === "L") l++;
      else if (r?.outcome === "T") t++;
    }
    return { w, l, t };
  }, [results]);

  if (results.length === 0) return null;

  return (
    <section className="space-y-3 pt-2" data-testid="section-season-results">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
          <Trophy className="w-5 h-5" />
          Season Results
        </h2>
        <span className="text-sm font-black text-muted-foreground">
          {record.w}–{record.l}
          {record.t > 0 ? `–${record.t}` : ""}
        </span>
      </div>

      <Card className="rounded-xl border border-border">
        <CardContent className="p-2 sm:p-3 divide-y divide-border">
          {results.map((e) => {
            const r = scoreResult(e)!;
            const vs =
              e.homeAway === "away" ? "at" : e.homeAway === "neutral" ? "vs" : "vs";
            return (
              <div
                key={e.id}
                className="flex items-center gap-3 py-2.5"
                data-testid={`row-result-${e.id}`}
              >
                <span
                  className={`shrink-0 w-7 text-center rounded-md px-1 py-0.5 text-xs font-black ${OUTCOME_CLASS[r.outcome]}`}
                >
                  {r.outcome}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold truncate">
                    {vs} {e.opponent || "Opponent"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDayHeading(e.startAt)}
                    {e.homeAway ? ` · ${e.homeAway}` : ""}
                  </div>
                </div>
                <span className="shrink-0 font-black tabular-nums">{r.text}</span>
                {e.gameRecapId && (
                  <Link href={`/posts/${e.gameRecapId}`}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 rounded-full font-bold"
                      data-testid={`btn-result-recap-${e.id}`}
                    >
                      <Newspaper className="w-3.5 h-3.5" />
                      <span className="ml-1 hidden sm:inline">Recap</span>
                    </Button>
                  </Link>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
}
