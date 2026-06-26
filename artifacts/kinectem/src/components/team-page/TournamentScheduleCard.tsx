import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, MapPin, ExternalLink } from "lucide-react";

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

export function TournamentScheduleCard({ teamId }: { teamId: string }) {
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
