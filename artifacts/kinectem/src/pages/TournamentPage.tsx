import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// Task #628 — PUBLIC tournament funnel page (`/t/<slug>`). Shows the imported
// schedule grouped by division / bracket, the participant list with
// claimed/unclaimed state, and a prominent "Sign up your team" CTA. Outside
// coaches sign up, create a SOLO team (no organization), and claim an
// unclaimed team-name slot. Hand-written customFetch — these endpoints have
// no openapi.yaml entry.

type Participant = {
  id: string;
  name: string;
  division: string;
  bracket: string;
  age: string | null;
  gender: string | null;
  claimed: boolean;
  teamId: string | null;
};

type Match = {
  id: string;
  matchNumber: string;
  matchDate: string | null;
  startTime: string | null;
  age: string | null;
  gender: string | null;
  division: string;
  bracket: string;
  venue: string | null;
  venueState: string | null;
  field: string | null;
  homeName: string | null;
  awayName: string | null;
  homeParticipantId: string | null;
  awayParticipantId: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

type TournamentResponse = {
  tournament: {
    id: string;
    slug: string;
    name: string;
    startDate: string;
    endDate: string;
    location: string | null;
    description: string | null;
    isActive: boolean;
  };
  participants: Participant[];
  matches: Match[];
};

function groupLabel(division: string, bracket: string): string {
  const parts = [division, bracket].filter((p) => p && p.trim() !== "");
  return parts.length ? parts.join(" · ") : "General";
}

export default function TournamentPage() {
  const [, params] = useRoute("/t/:slug");
  const slug = params?.slug ?? "";
  const { data: me } = useGetLoggedInUser();

  const q = useQuery<TournamentResponse>({
    queryKey: ["tournament", slug],
    queryFn: () =>
      customFetch<TournamentResponse>(
        `/api/v1/tournaments/${encodeURIComponent(slug)}`,
        { method: "GET" },
      ),
    enabled: !!slug,
    retry: false,
  });

  // Group matches by division/bracket for display.
  const matchGroups = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of q.data?.matches ?? []) {
      const key = groupLabel(m.division, m.bracket);
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [q.data]);

  const claimedCount = (q.data?.participants ?? []).filter((p) => p.claimed)
    .length;
  const totalParticipants = (q.data?.participants ?? []).length;

  if (q.isLoading) {
    return (
      <div className="min-h-screen max-w-4xl mx-auto p-6 space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    const message =
      (q.error as Error | null)?.message ??
      "This tournament link is invalid or no longer available.";
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6">
        <Card className="rounded-xl border-border">
          <CardContent className="p-6 text-center space-y-2">
            <h1 className="text-xl font-black tracking-tight">
              Tournament unavailable
            </h1>
            <p className="text-sm text-muted-foreground">{message}</p>
            <Link href="/">
              <Button variant="outline" className="font-bold mt-2">
                Go home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { tournament: t, participants } = q.data;
  const dateRange =
    t.startDate === t.endDate ? t.startDate : `${t.startDate} – ${t.endDate}`;

  const signupHref = me
    ? `/t/${encodeURIComponent(slug)}/signup`
    : `/login?signup=1&returnTo=${encodeURIComponent(`/t/${slug}/signup`)}`;

  return (
    <div className="min-h-screen max-w-4xl mx-auto p-6 space-y-6">
      {/* Hero */}
      <Card className="rounded-xl border-border" data-testid="card-tournament-hero">
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center gap-2">
            <Badge
              variant={t.isActive ? "default" : "secondary"}
              data-testid="badge-tournament-status"
            >
              {t.isActive ? "Active" : "Ended"}
            </Badge>
            <span className="text-xs text-muted-foreground">{dateRange}</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight" data-testid="text-tournament-name">
            {t.name}
          </h1>
          {t.location ? (
            <p className="text-sm text-muted-foreground">{t.location}</p>
          ) : null}
          {t.description ? (
            <p className="text-sm">{t.description}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link href={signupHref}>
              <Button className="font-bold" data-testid="btn-signup-team">
                Sign up your team
              </Button>
            </Link>
            <span className="text-xs text-muted-foreground">
              {claimedCount}/{totalParticipants} teams claimed
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Participants */}
      <Card className="rounded-xl border-border" data-testid="card-participants">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-lg font-black tracking-tight">Teams</h2>
          <p className="text-xs text-muted-foreground">
            Unclaimed names are open — sign up to claim yours and unlock a
            temporary team page for game recaps.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {participants.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                data-testid={`row-participant-${p.id}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {groupLabel(p.division, p.bracket)}
                  </p>
                </div>
                {p.claimed ? (
                  <Badge variant="secondary" className="shrink-0">
                    Taken
                  </Badge>
                ) : (
                  <Link href={signupHref}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-bold shrink-0"
                      data-testid={`btn-claim-${p.id}`}
                    >
                      Claim
                    </Button>
                  </Link>
                )}
              </div>
            ))}
            {participants.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No teams have been added to this tournament yet.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card className="rounded-xl border-border" data-testid="card-schedule">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-lg font-black tracking-tight">Schedule</h2>
          {matchGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No matches have been scheduled yet.
            </p>
          ) : (
            matchGroups.map(([label, matches]) => (
              <div key={label} className="space-y-2">
                <h3 className="text-sm font-black uppercase tracking-wide text-muted-foreground">
                  {label}
                </h3>
                <div className="space-y-1">
                  {matches.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                      data-testid={`row-match-${m.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>#{m.matchNumber}</span>
                          {m.matchDate ? <span>{m.matchDate}</span> : null}
                          {m.startTime ? <span>{m.startTime}</span> : null}
                          {m.field ? <span>{m.field}</span> : null}
                        </div>
                        <div className="truncate font-medium">
                          {m.homeName ?? "TBD"}{" "}
                          <span className="text-muted-foreground">vs</span>{" "}
                          {m.awayName ?? "TBD"}
                        </div>
                      </div>
                      {m.homeScore != null || m.awayScore != null ? (
                        <span className="shrink-0 font-bold tabular-nums">
                          {m.homeScore ?? "-"}–{m.awayScore ?? "-"}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
