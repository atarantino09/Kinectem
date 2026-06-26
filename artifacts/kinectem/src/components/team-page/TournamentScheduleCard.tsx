import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, MapPin, ExternalLink, Sparkles, Clock, FileText } from "lucide-react";

// Surfaces the imported tournament schedule for a team that claimed a
// participant slot. Source of truth is the tournament import, so re-imported
// score / slot fixes appear here automatically. Renders nothing when the team
// isn't linked to any tournament.

interface TournamentMatch {
  id: string;
  matchNumber: string;
  matchDate: string | null;
  startTime: string | null;
  division: string;
  bracket: string;
  venue: string | null;
  venueState: string | null;
  field: string | null;
  isHome: boolean;
  opponentName: string | null;
  teamScore: number | null;
  opponentScore: number | null;
}

interface TournamentGroup {
  tournamentId: string;
  tournamentSlug: string;
  tournamentName: string;
  startDate: string;
  endDate: string;
  // Last calendar day (YYYY-MM-DD) free game recaps are available for this
  // team — one week after the tournament starts.
  recapFreeUntil: string;
  matches: TournamentMatch[];
}

function fmtDate(d: string | null): string {
  if (!d) return "TBD";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtTime(t: string | null): string {
  if (!t) return "";
  const [h, min] = t.split(":").map(Number);
  if (Number.isNaN(h)) return t;
  const d = new Date();
  d.setHours(h, min ?? 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function venueLine(m: TournamentMatch): string {
  return [m.venue, m.field, m.venueState].filter(Boolean).join(" · ");
}

// Today's local calendar date as YYYY-MM-DD so we can compare against a
// match's `matchDate` (also YYYY-MM-DD) — ISO date strings sort
// lexicographically, so a plain string compare is correct.
function todayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// A match is worth recapping once it's actually been played: either it has a
// recorded score, or its date is in the past. Same-day (no score yet), future,
// and TBD matches don't get the "Write recap" affordance.
function isRecappable(m: TournamentMatch): boolean {
  if (!m.opponentName) return false;
  if (m.teamScore != null && m.opponentScore != null) return true;
  return !!m.matchDate && m.matchDate < todayKey();
}

// Prefilled recap composer deep-link for a tournament match. These aren't
// schedule events, so we skip `scheduleEventId` — only the opponent + date
// carry over. Mirrors the Team Schedule "Write game recap" param shape.
function recapHrefFor(teamId: string, m: TournamentMatch): string {
  const opponent = m.opponentName
    ? `&opponent=${encodeURIComponent(m.opponentName)}`
    : "";
  const date = m.matchDate ? `&gameDate=${m.matchDate}` : "";
  return `/posts/new?type=long&teamId=${teamId}${date}${opponent}&from=${encodeURIComponent(
    `/teams/${teamId}`,
  )}`;
}

// The free recap window for a tournament is, in UTC, [startDate 00:00,
// (recapFreeUntil + 1 day) 00:00) — i.e. through the end of the recapFreeUntil
// calendar day. We work in exact UTC instants so the countdown matches the
// server-side gate (which compares UTC calendar dates) regardless of viewer TZ.
function windowBounds(g: TournamentGroup): { start: number; end: number } {
  const start = Date.parse(`${g.startDate}T00:00:00Z`);
  const end = Date.parse(`${g.recapFreeUntil}T00:00:00Z`) + 86_400_000;
  return { start, end };
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

// Note + live countdown for the team's free game recap period. Recaps are free
// for one week after a tournament starts. If a window is currently open we count
// down to when it ends; otherwise we note the next/last window.
function FreeRecapNotice({ groups }: { groups: TournamentGroup[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const wins = groups.map(windowBounds);
  if (wins.length === 0) return null;

  const active = wins.filter((w) => now >= w.start && now < w.end);
  const upcoming = wins.filter((w) => now < w.start);

  let body: ReactNode;
  let tone: "open" | "muted";
  if (active.length > 0) {
    const end = Math.max(...active.map((w) => w.end));
    tone = "open";
    body = (
      <p className="mt-0.5 flex items-center gap-1.5 text-xs">
        <Clock className="w-3 h-3 shrink-0" />
        Free for 1 week after the tournament starts. Ends {dayLabel(end)} —{" "}
        <span
          className="font-black tabular-nums"
          data-testid="free-recap-countdown"
        >
          {formatCountdown(end - now)}
        </span>{" "}
        left.
      </p>
    );
  } else if (upcoming.length > 0) {
    const start = Math.min(...upcoming.map((w) => w.start));
    tone = "open";
    body = (
      <p className="mt-0.5 text-xs">
        Free game recaps unlock when the tournament starts on {dayLabel(start)},
        then stay free for 1 week.
      </p>
    );
  } else {
    const end = Math.max(...wins.map((w) => w.end));
    tone = "muted";
    body = (
      <p className="mt-0.5 text-xs">
        The free game recap period ended on {dayLabel(end)}. Join or create an
        organization to keep publishing recaps.
      </p>
    );
  }

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-sm ${
        tone === "open"
          ? "border-blue-200 bg-blue-50 text-blue-900"
          : "border-border bg-muted text-muted-foreground"
      }`}
      data-testid="free-recap-notice"
    >
      <p className="flex items-center gap-1.5 font-bold">
        <Sparkles className="w-4 h-4 shrink-0" />
        Free game recaps
      </p>
      {body}
    </div>
  );
}

function ScoreBadge({ m }: { m: TournamentMatch }) {
  if (m.teamScore == null || m.opponentScore == null) return null;
  const result =
    m.teamScore > m.opponentScore
      ? { label: "W", cls: "bg-emerald-100 text-emerald-800" }
      : m.teamScore < m.opponentScore
        ? { label: "L", cls: "bg-red-100 text-red-800" }
        : { label: "T", cls: "bg-muted text-muted-foreground" };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-black ${result.cls}`}
      data-testid={`tournament-score-${m.id}`}
    >
      {result.label} {m.teamScore}–{m.opponentScore}
    </span>
  );
}

export function TournamentScheduleCard({
  teamId,
  canPostRecap = false,
}: {
  teamId: string;
  // When true (the viewer can author recaps for this team), played matches
  // expose a "Write recap" link into the prefilled composer.
  canPostRecap?: boolean;
}) {
  const { data } = useQuery<{ data: TournamentGroup[] }>({
    queryKey: ["team", teamId, "tournament-schedule"],
    queryFn: () =>
      customFetch<{ data: TournamentGroup[] }>(
        `/api/v1/teams/${teamId}/tournament-schedule`,
        { method: "GET" },
      ),
    enabled: !!teamId,
  });

  const groups = data?.data ?? [];
  if (groups.length === 0) return null;

  return (
    <Card data-testid="card-tournament-schedule">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="w-4 h-4" />
          Tournament schedule
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <FreeRecapNotice groups={groups} />
        {groups.map((g) => (
          <div key={g.tournamentId} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/t/${g.tournamentSlug}`}>
                <span className="text-sm font-black tracking-tight hover:underline cursor-pointer inline-flex items-center gap-1">
                  {g.tournamentName}
                  <ExternalLink className="w-3 h-3 text-muted-foreground" />
                </span>
              </Link>
            </div>
            <ul className="space-y-1.5">
              {g.matches.map((m) => (
                <li
                  key={m.id}
                  className="rounded-lg border border-border px-3 py-2 flex items-start justify-between gap-3"
                  data-testid={`tournament-match-${m.id}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">
                      <span className="text-muted-foreground font-semibold">
                        {m.isHome ? "vs" : "@"}
                      </span>{" "}
                      {m.opponentName ?? "TBD"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(m.matchDate)}
                      {m.startTime ? ` · ${fmtTime(m.startTime)}` : ""}
                    </p>
                    {venueLine(m) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{venueLine(m)}</span>
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <ScoreBadge m={m} />
                    {(m.division || m.bracket) && (
                      <Badge variant="outline" className="text-[10px]">
                        {[m.division, m.bracket].filter(Boolean).join(" · ")}
                      </Badge>
                    )}
                    {canPostRecap && isRecappable(m) && (
                      <Link href={recapHrefFor(teamId, m)}>
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100 cursor-pointer"
                          data-testid={`btn-write-recap-${m.id}`}
                        >
                          <FileText className="w-3 h-3" />
                          Write recap
                        </span>
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
