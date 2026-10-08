import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
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
import { CompetitionScheduleRemovalDialog, type AssignmentSnapshot, type ScheduleRemovalTarget } from "./CompetitionScheduleRemovalDialog";
import {
  Trophy,
  MapPin,
  ExternalLink,
  Sparkles,
  Clock,
  FileText,
  ChevronDown,
  Eye,
  EyeOff,
  Newspaper,
  Unlink,
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
  // Task #746 — earliest published recap explicitly linked to this
  // game (null/absent when none). Drives the "Game recap" pill.
  recapPostId?: string | null;
  // Task #746 — present (true) only for team admins: this game is
  // hidden from public view on the team page. Public responses simply
  // omit hidden games.
  hidden?: boolean;
  // Task #765 — organizer-set game status (+ optional public reason).
  status?: "scheduled" | "postponed" | "canceled";
  statusReason?: string | null;
}

interface TournamentGroup {
  tournamentId: string;
  tournamentSlug: string;
  tournamentName: string;
  startDate: string;
  endDate: string;
  // Last calendar day (YYYY-MM-DD) free game recaps are available for this
  // team — the competition end date. Null for org-backed teams,
  // which have normal recap rights (no free-window notice).
  recapFreeUntil: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  secondaryColor: string | null;
  assignmentSnapshot?: AssignmentSnapshot[];
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
// Task #746 — also carries `competitionId` + `matchId` so the composer
// pre-selects the competition AND the specific game.
function recapHrefFor(
  teamId: string,
  tournamentId: string,
  m: TournamentMatch,
): string {
  const opponent = m.opponentName
    ? `&opponent=${encodeURIComponent(m.opponentName)}`
    : "";
  const date = m.matchDate ? `&gameDate=${m.matchDate}` : "";
  return `/posts/new?type=long&teamId=${teamId}${date}${opponent}&competitionId=${tournamentId}&matchId=${m.id}&from=${encodeURIComponent(
    `/teams/${teamId}`,
  )}`;
}

function competitionRecapHref(teamId: string, competitionId: string): string {
  const params = new URLSearchParams({
    type: "long",
    teamId,
    competitionId,
    from: `/teams/${teamId}`,
  });
  return `/posts/new?${params}`;
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

// Note + live countdown for the team's free game recap period. If a competition
// is active we count down to its end; otherwise we note the next/last window.
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
        Your standalone team can publish game recaps while this competition is
        active. Access ends{" "}
        {dayLabel(end - 1)} —{" "}
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
    const next = upcoming.reduce((earliest, w) =>
      w.start < earliest.start ? w : earliest,
    );
    tone = "open";
    body = (
      <p className="mt-0.5 text-xs">
        Free game recaps unlock when the next competition starts on{" "}
        {dayLabel(next.start)} and remain available through{" "}
        {dayLabel(next.end - 1)}. Outside an active competition, your standalone
        team must join or create an organization to keep publishing.
      </p>
    );
  } else {
    const end = Math.max(...wins.map((w) => w.end));
    tone = "muted";
    body = (
      <p className="mt-0.5 text-xs">
        Your team's competition recap access ended on {dayLabel(end - 1)}. Join or
        create an organization to keep publishing recaps — creating an
        organization starts a 90-day free period, so your team keeps going
        without interruption.
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
      label: "Upcoming",
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

// Ordering mirrors the lifecycle pills (same competitionStatus helper,
// so the two can't drift): Active competitions first — a months-long
// league stays Active (and on top) for its whole season — then Future
// ones, then Complete ones, which age down the list as newer
// competitions wrap up above them.
const STATUS_ORDER: Record<CompetitionStatus, number> = {
  active: 0,
  future: 1,
  complete: 2,
};

function sortCompetitions(groups: TournamentGroup[]): TournamentGroup[] {
  return [...groups].sort((a, b) => {
    const aStatus = competitionStatus(a);
    const bStatus = competitionStatus(b);
    if (aStatus !== bStatus) {
      return STATUS_ORDER[aStatus] - STATUS_ORDER[bStatus];
    }
    switch (aStatus) {
      case "active":
        // Most recently started first.
        return b.startDate.localeCompare(a.startDate);
      case "future":
        // Starting soonest first.
        return a.startDate.localeCompare(b.startDate);
      case "complete":
        // Most recently ended first.
        return b.endDate.localeCompare(a.endDate);
    }
  });
}

export function TournamentScheduleCard({
  teamId,
  canPostRecap = false,
  canManage = false,
  viewerId = "current",
  teamName = "This team",
}: {
  teamId: string;
  // When true (the viewer can author recaps for this team), played matches
  // expose a "Write recap" link into the prefilled composer.
  canPostRecap?: boolean;
  // Task #746 — when true (team admin), games expose Hide/Unhide
  // controls and hidden games render greyed-out with a "Hidden"
  // notice instead of being omitted.
  canManage?: boolean;
  viewerId?: string;
  teamName?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  // Keep the panel open by default so this adds a way to declutter the team
  // page without changing what existing visitors see on first load.
  const [competitionsOpen, setCompetitionsOpen] = useState(true);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [removalTarget, setRemovalTarget] = useState<ScheduleRemovalTarget | null>(null);
  // Pending hide-confirmation target (null = dialog closed). Unhide
  // is immediate — restoring visibility is safe to do without asking.
  const [confirmHide, setConfirmHide] = useState<{
    matchId: string;
    opponentName: string | null;
  } | null>(null);
  const { data } = useQuery<{ data: TournamentGroup[] }>({
    queryKey: ["team", teamId, "tournament-schedule", viewerId, canManage],
    queryFn: () =>
      customFetch<{ data: TournamentGroup[] }>(
        `/api/v1/teams/${teamId}/tournament-schedule`,
        { method: "GET" },
      ),
    enabled: !!teamId,
    refetchInterval: 30_000,
  });

  // Task #746 — hide/unhide a single game from the public team page.
  // Both endpoints are idempotent; on success we refetch the schedule
  // (the admin view re-renders the game greyed-out / restored).
  const hideMutation = useMutation({
    mutationFn: ({ matchId, hide }: { matchId: string; hide: boolean }) =>
      customFetch(`/api/v1/teams/${teamId}/competition-games/${matchId}/hide`, {
        method: hide ? "POST" : "DELETE",
      }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: ["team", teamId, "tournament-schedule"],
      });
      toast({
        title: vars.hide ? "Game hidden" : "Game restored",
        description: vars.hide
          ? "This game no longer appears on the public team page."
          : "This game is visible on the team page again.",
      });
    },
    onError: () => {
      toast({
        title: "Couldn't update the game",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    },
  });

  const groups = data?.data ?? [];
  if (groups.length === 0) return null;

  const sorted = sortCompetitions(groups);
  const visible = showAll ? sorted : sorted.slice(0, VISIBLE_COMPETITIONS);
  const hiddenCount = sorted.length - VISIBLE_COMPETITIONS;

  return (
    <Card data-testid="card-tournament-schedule">
      <Collapsible open={competitionsOpen} onOpenChange={setCompetitionsOpen}>
        <CardHeader className="py-3">
          <CollapsibleTrigger
            className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="toggle-competitions-panel"
          >
            <Trophy className="h-4 w-4 shrink-0" />
            <span className="text-base font-semibold">Competitions</span>
            <span
              className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground group-hover:bg-background"
              data-testid="competition-count"
            >
              {groups.length} {groups.length === 1 ? "competition" : "competitions"}
            </span>
            <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent data-testid="content-competitions-panel">
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
                {/* The server emits snapshots only for canManageTeam actors,
                    including coaches with custom position labels. */}
                {!!g.assignmentSnapshot?.length && (
                  <div className="flex justify-end">
                    <button type="button" className="inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-xs font-semibold text-destructive hover:bg-destructive/5"
                      data-testid={`btn-remove-competition-${g.tournamentId}`}
                      onClick={() => setRemovalTarget({
                        competitionId: g.tournamentId, competitionSlug: g.tournamentSlug, competitionName: g.tournamentName,
                        teamName, assignments: g.assignmentSnapshot!,
                      })}>
                      <Unlink className="h-3 w-3" /> Remove competition from team page
                    </button>
                  </div>
                )}
                <CollapsibleContent className="space-y-2">
                  {canPostRecap && (
                    <div className="min-w-0 space-y-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2">
                      <Link
                        href={competitionRecapHref(teamId, g.tournamentId)}
                        className={`${buttonVariants({ variant: "outline", size: "sm" })} max-w-full gap-1.5 whitespace-normal text-left`}
                        aria-describedby={`competition-recap-help-${g.tournamentId}`}
                        data-testid={`button-competition-recap-${g.tournamentId}`}
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        Competition Game Recap
                      </Link>
                      <p
                        id={`competition-recap-help-${g.tournamentId}`}
                        className="text-[11px] text-muted-foreground"
                      >
                        Playoff or extra game? Add a branded recap to this competition.
                      </p>
                    </div>
                  )}
                  {g.matches.length === 0 && <p className="text-xs text-muted-foreground">No games are currently shown on this team page.</p>}
                  <ul className="space-y-1.5">
                    {g.matches.map((m) => (
                      <li
                        key={m.id}
                        className={`rounded-lg border border-border px-3 py-2 flex items-start justify-between gap-3 ${
                          m.hidden ? "opacity-60 bg-muted/40" : ""
                        }`}
                        data-testid={`tournament-match-${m.id}`}
                      >
                        <div className="min-w-0">
                          <p
                            className={`text-sm font-bold truncate ${
                              m.status === "canceled"
                                ? "line-through text-muted-foreground"
                                : ""
                            }`}
                          >
                            <span className="text-muted-foreground font-semibold">
                              {m.isHome ? "vs" : "@"}
                            </span>{" "}
                            {m.opponentName ?? "TBD"}
                          </p>
                          {/* Task #765 — organizer-set postponed/canceled
                              status (+ optional public reason). */}
                          {(m.status === "postponed" ||
                            m.status === "canceled") && (
                            <p
                              className={`text-[11px] font-black uppercase tracking-wider ${
                                m.status === "postponed"
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-red-600 dark:text-red-400"
                              }`}
                              data-testid={`status-game-${m.id}`}
                            >
                              {m.status === "postponed" ? "Postponed" : "Canceled"}
                              {m.statusReason ? (
                                <span className="normal-case font-semibold text-muted-foreground tracking-normal">
                                  {" "}
                                  — {m.statusReason}
                                </span>
                              ) : null}
                            </p>
                          )}
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
                          {/* Task #746 — admin-only notice on hidden games
                              (public viewers never receive them). */}
                          {m.hidden && (
                            <p
                              className="text-[11px] font-bold text-muted-foreground flex items-center gap-1 mt-1"
                              data-testid={`notice-hidden-game-${m.id}`}
                            >
                              <EyeOff className="w-3 h-3 shrink-0" />
                              Hidden — only team admins can see this game.
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          {(m.division || m.bracket) && (
                            <Badge variant="outline" className="text-[10px]">
                              {[m.division, m.bracket].filter(Boolean).join(" · ")}
                            </Badge>
                          )}
                          {/* Task #746 — published recap linked to this game.
                              Takes the place of "Write recap" (the game already
                              has one). */}
                          {m.recapPostId ? (
                            <Link href={`/posts/${m.recapPostId}`}>
                              <span
                                className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                                data-testid={`pill-game-recap-${m.id}`}
                              >
                                <Newspaper className="w-3 h-3" />
                                Game recap
                              </span>
                            </Link>
                          ) : (
                            canPostRecap &&
                            isRecappable(m) && (
                              <Link href={recapHrefFor(teamId, g.tournamentId, m)}>
                                <span
                                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100 cursor-pointer"
                                  data-testid={`btn-write-recap-${m.id}`}
                                >
                                  <FileText className="w-3 h-3" />
                                  Write recap
                                </span>
                              </Link>
                            )
                          )}
                          {/* Task #746 — admin hide/unhide controls. Hide asks
                              for confirmation; unhide is immediate. */}
                          {canManage &&
                            (m.hidden ? (
                              <button
                                type="button"
                                disabled={hideMutation.isPending}
                                onClick={() =>
                                  hideMutation.mutate({
                                    matchId: m.id,
                                    hide: false,
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-bold text-muted-foreground hover:bg-muted disabled:opacity-50"
                                data-testid={`btn-unhide-game-${m.id}`}
                              >
                                <Eye className="w-3 h-3" />
                                Unhide
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={hideMutation.isPending}
                                onClick={() =>
                                  setConfirmHide({
                                    matchId: m.id,
                                    opponentName: m.opponentName,
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-bold text-muted-foreground hover:bg-muted disabled:opacity-50"
                                data-testid={`btn-hide-game-${m.id}`}
                              >
                                <EyeOff className="w-3 h-3" />
                                Hide
                              </button>
                            ))}
                          {!!g.assignmentSnapshot?.length && (
                            <button type="button" className="inline-flex items-center gap-1 rounded-full border border-destructive/30 px-2 py-0.5 text-[11px] font-bold text-destructive hover:bg-destructive/5"
                              data-testid={`btn-remove-game-${m.id}`}
                              onClick={() => setRemovalTarget({
                                competitionId: g.tournamentId, competitionSlug: g.tournamentSlug, competitionName: g.tournamentName,
                                teamName, assignments: g.assignmentSnapshot!,
                                match: { id: m.id, label: `${m.opponentName ? `Against ${m.opponentName}` : "Opponent TBD"} · ${fmtDate(m.matchDate)} ${fmtTime(m.startTime)}` },
                              })}>
                              <Unlink className="h-3 w-3" /> Remove game
                            </button>
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
        </CollapsibleContent>
      </Collapsible>

      {/* Task #746 — hide-game confirmation. Scoped to the team page:
          the game stays in the competition's own schedule and imports,
          it just stops showing to non-admin visitors here. */}
      <AlertDialog
        open={confirmHide !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmHide(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-hide-game-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Hide this game?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmHide?.opponentName
                ? `The game against ${confirmHide.opponentName} will no longer appear on the public team page. `
                : "This game will no longer appear on the public team page. "}
              Team admins will still see it greyed out and can unhide it at
              any time. The competition's own page is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-hide-game-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={hideMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!confirmHide) return;
                hideMutation.mutate(
                  { matchId: confirmHide.matchId, hide: true },
                  { onSettled: () => setConfirmHide(null) },
                );
              }}
              data-testid="button-hide-game-confirm"
            >
              {hideMutation.isPending ? "Hiding…" : "Hide game"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {removalTarget && (
        <CompetitionScheduleRemovalDialog teamId={teamId} target={removalTarget} onClose={() => setRemovalTarget(null)} />
      )}
    </Card>
  );
}
