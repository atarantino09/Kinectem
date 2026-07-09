import { useRoute, Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useGetLoggedInUser,
  listUserTeams,
} from "@workspace/api-client-react";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

// Competitions §9a — PUBLIC branded competition page (`/c/<slug>`). Distinct
// from org/team pages on purpose: the hero is themed with the operator's
// brand_color and shows their logo/banner, with Kinectem as a small credit.
// Legacy `/t/<slug>` links redirect here. Hand-written customFetch — these
// endpoints have no openapi.yaml entry (file is locked).

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
  scoreState?: "official" | "confirmed" | "disputed" | "reported" | "none";
  homeTeamId?: string | null;
  awayTeamId?: string | null;
};

export type CompetitionMeta = {
  id: string;
  slug: string;
  name: string;
  type: "tournament" | "league";
  startDate: string;
  endDate: string;
  location: string | null;
  description: string | null;
  isActive: boolean;
  isEnded: boolean;
  autoApproveClaims: boolean;
  logoUrl: string | null;
  brandColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  claimedCount: number;
  participantCount: number;
};

type FeaturedRecap = {
  id: string;
  title: string;
  summary: string | null;
  coverImageUrl: string | null;
  gameDate: string | null;
  opponentName: string | null;
  teamScore: number | null;
  opponentScore: number | null;
  teamId: string;
  teamName: string;
  publishedAt: string | null;
};

type CompetitionResponse = {
  competition: CompetitionMeta;
  participants: Participant[];
  matches: Match[];
  featuredRecaps?: FeaturedRecap[];
};

function groupLabel(division: string, bracket: string): string {
  const parts = [division, bracket].filter((p) => p && p.trim() !== "");
  return parts.length ? parts.join(" · ") : "General";
}

// Pick a readable text color for the brand band (simple luminance check).
function contrastText(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 160 ? "#111111" : "#ffffff";
}

const DEFAULT_BRAND = "#1e293b";

// §6 — inline self-report control shown to a coach/manager of a claimed team
// in this game while no public (official/confirmed) score exists. The server
// enforces permissions; this is just the entry point.
function ReportScoreControl({
  match,
  slug,
}: {
  match: Match;
  slug: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");

  const report = useMutation({
    mutationFn: () =>
      customFetch<{ ok: true; scoreState: string }>(
        `/api/v1/competitions/games/${match.id}/report-score`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            homeScore: Number(home),
            awayScore: Number(away),
          }),
        },
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["competition", slug] });
      setOpen(false);
      toast({
        title:
          r.scoreState === "confirmed"
            ? "Score confirmed — both teams agree"
            : r.scoreState === "disputed"
              ? "Score recorded — the other team reported a different result"
              : "Score reported",
      });
    },
    onError: (err) =>
      toast({
        title: "Couldn't report that score",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  const valid =
    /^\d{1,3}$/.test(home.trim()) && /^\d{1,3}$/.test(away.trim());

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0 font-bold text-muted-foreground"
        onClick={() => setOpen(true)}
        data-testid={`btn-report-score-${match.id}`}
      >
        Report score
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Input
        value={home}
        onChange={(e) => setHome(e.target.value)}
        placeholder="H"
        inputMode="numeric"
        className="h-8 w-12 text-center"
        data-testid={`input-report-home-${match.id}`}
      />
      <span className="text-xs text-muted-foreground">–</span>
      <Input
        value={away}
        onChange={(e) => setAway(e.target.value)}
        placeholder="A"
        inputMode="numeric"
        className="h-8 w-12 text-center"
        data-testid={`input-report-away-${match.id}`}
      />
      <Button
        size="sm"
        className="font-bold"
        disabled={!valid || report.isPending}
        onClick={() => report.mutate()}
        data-testid={`btn-report-submit-${match.id}`}
      >
        Save
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
    </div>
  );
}

export default function CompetitionPage() {
  // Matched both as the standalone public page (`/c/<slug>`) and as the
  // in-app view inside the AppShell (`/competitions/c/<slug>`), so
  // logged-in users can browse a competition without leaving the app.
  const [, publicParams] = useRoute("/c/:slug");
  const [, appParams] = useRoute("/competitions/c/:slug");
  const slug = publicParams?.slug ?? appParams?.slug ?? "";
  const { data: me } = useGetLoggedInUser();

  // §6 — teams I coach/manage, used only to decide whether to show the
  // "Report score" entry point on a claimed game (server re-checks).
  const myTeamsQ = useQuery({
    queryKey: ["users", me?.id, "teams"],
    queryFn: () => listUserTeams(me?.id ?? ""),
    enabled: !!me?.id,
  });
  const myManagedTeamIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of myTeamsQ.data?.data ?? []) {
      // Mirror the server's canManageTeam gate: this endpoint only ever emits
      // position "coach" (roster role coach), "admin" (org owner/admin),
      // "player", or the synthetic "parent" — only the first two can report.
      if (m.position === "coach" || m.position === "admin") {
        ids.add(m.teamId);
      }
    }
    return ids;
  }, [myTeamsQ.data]);

  const q = useQuery<CompetitionResponse>({
    queryKey: ["competition", slug],
    queryFn: () =>
      customFetch<CompetitionResponse>(
        `/api/v1/competitions/${encodeURIComponent(slug)}`,
        { method: "GET" },
      ),
    enabled: !!slug,
    retry: false,
  });

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

  if (q.isLoading) {
    return (
      <div className="min-h-screen max-w-4xl mx-auto p-6 space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    const message =
      (q.error as Error | null)?.message ??
      "This competition link is invalid or no longer available.";
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6">
        <Card className="rounded-xl border-border">
          <CardContent className="p-6 text-center space-y-2">
            <h1 className="text-xl font-black tracking-tight">
              Competition unavailable
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

  const { competition: c, participants } = q.data;
  const brand = c.brandColor ?? DEFAULT_BRAND;
  const heroText = contrastText(brand);
  // Secondary tints the hero as a subtle gradient; tertiary accents the
  // status badge. Both degrade to primary-only when unset.
  const heroBackground = c.secondaryColor
    ? `linear-gradient(135deg, ${brand} 0%, ${brand} 55%, ${c.secondaryColor} 100%)`
    : brand;
  const accent = c.tertiaryColor ?? null;
  const dateRange =
    c.startDate === c.endDate ? c.startDate : `${c.startDate} – ${c.endDate}`;
  const typeLabel = c.type === "league" ? "League" : "Tournament";
  const statusLabel =
    c.type === "league"
      ? c.isEnded
        ? "Season ended"
        : "Season"
      : c.isActive
        ? "Live"
        : c.isEnded
          ? "Ended"
          : "Upcoming";

  const signupHref = me
    ? `/c/${encodeURIComponent(slug)}/signup`
    : `/login?signup=1&returnTo=${encodeURIComponent(`/c/${slug}/signup`)}`;

  return (
    <div className="min-h-screen">
      {/* Branded hero (§9a/§10) — brand_color band, logo-forward */}
      <div
        style={{ background: heroBackground, color: heroText }}
        data-testid="hero-competition"
      >
        {c.bannerUrl ? (
          <div className="h-40 sm:h-56 w-full overflow-hidden">
            <img
              src={c.bannerUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-3">
          <div className="flex items-start gap-4">
            {c.logoUrl ? (
              <img
                src={c.logoUrl}
                alt={`${c.name} logo`}
                className="h-16 w-16 sm:h-20 sm:w-20 rounded-xl object-contain bg-white/90 p-1.5 shrink-0"
                data-testid="img-competition-logo"
              />
            ) : null}
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="rounded-full border px-2 py-0.5 text-[11px] font-black uppercase tracking-widest"
                  style={{ borderColor: heroText, opacity: 0.9 }}
                  data-testid="badge-competition-type"
                >
                  {typeLabel}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-widest"
                  style={
                    accent
                      ? {
                          backgroundColor: accent,
                          color: contrastText(accent),
                        }
                      : undefined
                  }
                  data-testid="badge-competition-status"
                >
                  {statusLabel}
                </span>
                <span className="text-xs opacity-80">{dateRange}</span>
              </div>
              <h1
                className="text-3xl sm:text-4xl font-black tracking-tight"
                data-testid="text-competition-name"
              >
                {c.name}
              </h1>
              {c.location ? (
                <p className="text-sm opacity-85">{c.location}</p>
              ) : null}
            </div>
          </div>
          {c.description ? (
            <p className="text-sm max-w-2xl opacity-90">{c.description}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link href={signupHref}>
              <Button
                className="font-bold bg-white text-black hover:bg-white/90"
                data-testid="btn-signup-team"
              >
                Sign up your team
              </Button>
            </Link>
            <span className="text-xs font-bold opacity-90">
              {c.claimedCount} / {c.participantCount} teams telling their story
            </span>
            {c.websiteUrl ? (
              <a
                href={c.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline opacity-85"
                data-testid="link-competition-website"
              >
                Official website
              </a>
            ) : null}
          </div>
          <p className="text-[11px] opacity-70 pt-2">Powered by Kinectem</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Featured game recaps rail (§7) — the visual centerpiece; hidden
            entirely until the operator features at least one recap. Each
            card carries the authoring team's identity inside the
            competition-branded page. */}
        {(q.data.featuredRecaps?.length ?? 0) > 0 && (
          <section className="space-y-3" data-testid="rail-featured-recaps">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-black tracking-tight">
                Featured game recaps
              </h2>
              <span
                className="text-[11px] font-black uppercase tracking-widest"
                style={{ color: brand }}
              >
                Curated by {c.name}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {q.data.featuredRecaps!.map((r) => (
                <Link key={r.id} href={`/posts/${r.id}`}>
                  <Card
                    className="rounded-xl border-border overflow-hidden cursor-pointer transition-shadow hover:shadow-md h-full"
                    style={{ borderTopColor: brand, borderTopWidth: 3 }}
                    data-testid={`card-featured-recap-${r.id}`}
                  >
                    {r.coverImageUrl ? (
                      <div className="h-32 w-full overflow-hidden">
                        <img
                          src={r.coverImageUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : null}
                    <CardContent className="p-4 space-y-1.5">
                      <p className="text-xs font-bold text-muted-foreground truncate">
                        {r.teamName}
                        {r.opponentName ? ` vs ${r.opponentName}` : ""}
                        {r.teamScore != null && r.opponentScore != null
                          ? ` · ${r.teamScore}-${r.opponentScore}`
                          : ""}
                      </p>
                      <p className="text-sm font-black tracking-tight line-clamp-2">
                        {r.title}
                      </p>
                      {r.summary ? (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {r.summary}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Teams / claim grid */}
        <Card className="rounded-xl border-border" data-testid="card-participants">
          <CardContent className="p-6 space-y-3">
            <h2 className="text-lg font-black tracking-tight">Teams</h2>
            <p className="text-xs text-muted-foreground">
              Unclaimed names are open — sign up to claim yours and start
              telling your team&apos;s story with game recaps.
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
                  No teams have been added to this {typeLabel.toLowerCase()}{" "}
                  yet.
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
                No games have been scheduled yet.
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
                        {m.homeScore != null && m.awayScore != null ? (
                          <span
                            className="shrink-0 font-bold tabular-nums flex items-center gap-1.5"
                            data-testid={`score-${m.id}`}
                          >
                            {m.homeScore}–{m.awayScore}
                            {m.scoreState === "confirmed" ? (
                              <Badge variant="secondary" className="text-[10px]">
                                Confirmed
                              </Badge>
                            ) : null}
                          </span>
                        ) : (m.homeTeamId && myManagedTeamIds.has(m.homeTeamId)) ||
                          (m.awayTeamId && myManagedTeamIds.has(m.awayTeamId)) ? (
                          <ReportScoreControl match={m} slug={slug} />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground pb-4">
          Powered by <span className="font-bold">Kinectem</span>
        </p>
      </div>
    </div>
  );
}
