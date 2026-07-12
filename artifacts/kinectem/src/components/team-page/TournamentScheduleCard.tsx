import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Trophy,
  MapPin,
  ExternalLink,
  Sparkles,
  Clock,
  FileText,
  ChevronDown,
} from "lucide-react";

// Surfaces the imported tournament schedule for a team that claimed a
// participant slot. Source of truth is the tournament import, so re-imported
// slot fixes appear here automatically. Renders nothing when the team
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
}

interface TournamentGroup {
  tournamentId: string;
  tournamentSlug: string;
  tournamentName: string;
  startDate: string;
  endDate: string;
  // Last calendar day (YYYY-MM-DD) free game recaps are available for this
  // team — one week after the tournament starts. Null for org-backed teams,
  // which have normal recap rights (no free-window notice).
  recapFreeUntil: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  secondaryColor: string | null;
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
  // Accept both 24-hour ("17:30") and scheduling-tool exports ("5:30 PM").
  const m = t.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!m) return t;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const meridiem = m[3]?.toUpperCase();
  if (meridiem === "PM" && h < 12) h += 12;
  if (meridiem === "AM" && h === 12) h = 0;
  if (Number.isNaN(h) || Number.isNaN(min)) return t;
  const d = new Date();
  d.setHours(h, min, 0, 0);
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

// A match is worth recapping once it's actually been played: its date is in
// the past. Same-day, future, and TBD matches don't get the "Write recap"
// affordance.
function isRecappable(m: TournamentMatch): boolean {
  if (!m.opponentName) return false;
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
  const end = Date.parse(`${g.recapFreeUntil!}T00:00:00Z`) + 86_400_000;
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

  // Org-backed teams come back with recapFreeUntil = null (normal recap
  // rights) — no free-window notice for them.
  const wins = groups.filter((g) => g.recapFreeUntil != null).map(windowBounds);
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

// How many competitions show before the "Show more" toggle appears.
const VISIBLE_COMPETITIONS = 3;

// Lifecycle label derived from the competition's own dates, computed at
// render time against today's date so it advances on its own as time
// passes: before startDate → Future, after endDate → Complete, otherwise
// (including open-ended/missing endDate) → Active. A months-long league
// stays Active for its entire date range.
type CompetitionStatus = "active" | "complete" | "future";

function competitionStatus(g: TournamentGroup): CompetitionStatus {
  const today = todayKey();
  if (g.startDate && g.startDate > today) return "future";
  if (g.endDate && g.endDate < today) return "complete";
  return "active";
}

const STATUS_STYLES: Record<CompetitionStatus, { label: string; cls: string }> =
  {
    active: {
      label: "Active",
      cls: "bg-emerald-400/90 text-emerald-950",
    },
    complete: {
      label: "Complete",
      cls: "bg-white/25 text-white",
    },
    future: {
      label: "Future",
      cls: "bg-sky-300/90 text-sky-950",
    },
  };

function StatusPill({ group }: { group: TournamentGroup }) {
  const status = competitionStatus(group);
  const s = STATUS_STYLES[status];
  return (
    <span
      className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${s.cls}`}
      data-testid={`status-tournament-${group.tournamentId}`}
    >
      {s.label}
    </span>
  );
}

// A competition counts as active while today is on or before its end
// date — length doesn't matter, so a months-long league stays "active"
// for its whole season. Finished competitions sink below active ones
// and age down the list as newer ones wrap up above them.
function sortCompetitions(groups: TournamentGroup[]): TournamentGroup[] {
  const today = todayKey();
  const isActive = (g: TournamentGroup) => !g.endDate || g.endDate >= today;
  return [...groups].sort((a, b) => {
    const aActive = isActive(a);
    const bActive = isActive(b);
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (aActive) {
      // Active: most recently started first.
      return b.startDate.localeCompare(a.startDate);
    }
    // Finished: most recently ended first.
    return b.endDate.localeCompare(a.endDate);
  });
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
  const [showAll, setShowAll] = useState(false);
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

  const sorted = sortCompetitions(groups);
  const visible = showAll ? sorted : sorted.slice(0, VISIBLE_COMPETITIONS);
  const hiddenCount = sorted.length - VISIBLE_COMPETITIONS;

  return (
    <Card data-testid="card-tournament-schedule">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="w-4 h-4" />
          Competitions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <FreeRecapNotice groups={groups} />
        {visible.map((g) => (
          <Collapsible key={g.tournamentId} className="space-y-2">
            {/* Branded competition strip — same look as the banner on a
                published game recap (PostCard). The strip toggles the
                schedule; the external-link icon navigates to the
                competition's public page. */}
            <div
              className="flex items-center gap-2.5 rounded-lg px-4 py-2"
              style={{
                background: g.brandColor
                  ? g.secondaryColor
                    ? `linear-gradient(135deg, ${g.brandColor} 0%, ${g.brandColor} 60%, ${g.secondaryColor} 100%)`
                    : g.brandColor
                  : "hsl(var(--primary))",
              }}
              data-testid={`banner-tournament-${g.tournamentId}`}
            >
              <CollapsibleTrigger
                className="group flex min-w-0 flex-1 items-center gap-2.5 text-left"
                data-testid={`toggle-tournament-${g.tournamentId}`}
              >
                {g.logoUrl ? (
                  <img
                    src={g.logoUrl}
                    alt=""
                    className="h-6 w-6 rounded bg-white/90 object-contain p-0.5 shrink-0"
                  />
                ) : (
                  <Trophy className="h-4 w-4 shrink-0 text-white/90" />
                )}
                <span className="min-w-0 truncate text-xs font-black uppercase tracking-widest text-white drop-shadow-sm">
                  {g.tournamentName}
                </span>
                <StatusPill group={g} />
                <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-white/80 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <Link
                href={`/competitions/c/${encodeURIComponent(g.tournamentSlug)}`}
                aria-label={`View ${g.tournamentName} page`}
                className="shrink-0 rounded p-1 hover:bg-white/15"
                data-testid={`link-tournament-${g.tournamentId}`}
              >
                <ExternalLink className="h-3.5 w-3.5 text-white/80" />
              </Link>
            </div>
            <CollapsibleContent>
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
            </CollapsibleContent>
          </Collapsible>
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted"
            data-testid="btn-toggle-more-competitions"
          >
            {showAll ? "Show less" : `Show ${hiddenCount} more`}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showAll ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </CardContent>
    </Card>
  );
}
