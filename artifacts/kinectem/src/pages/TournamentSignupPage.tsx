import { useRoute, useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

// Task #628 — Solo-team signup + participant claim (`/t/<slug>/signup`). A
// signed-in visiting coach picks an unclaimed team-name slot, names their
// SOLO team (no organization), and claims it. On success they land on the new
// temporary team page. Hand-written customFetch — no openapi.yaml entry.

type Participant = {
  id: string;
  name: string;
  division: string;
  bracket: string;
  claimed: boolean;
};

type TournamentResponse = {
  tournament: {
    id: string;
    slug: string;
    name: string;
    startDate: string;
    endDate: string;
    isActive: boolean;
  };
  participants: Participant[];
};

function groupLabel(division: string, bracket: string): string {
  const parts = [division, bracket].filter((p) => p && p.trim() !== "");
  return parts.length ? parts.join(" · ") : "General";
}

export default function TournamentSignupPage() {
  const [, params] = useRoute("/t/:slug/signup");
  const slug = params?.slug ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: me, isLoading: meLoading } = useGetLoggedInUser();

  const [selectedId, setSelectedId] = useState<string>("");
  const [teamName, setTeamName] = useState<string>("");
  const [sport, setSport] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

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

  // Redirect anonymous visitors to signup/login, returning here afterward.
  useEffect(() => {
    if (!meLoading && !me) {
      navigate(
        `/login?signup=1&returnTo=${encodeURIComponent(`/t/${slug}/signup`)}`,
      );
    }
  }, [meLoading, me, navigate, slug]);

  const unclaimed = useMemo(
    () => (q.data?.participants ?? []).filter((p) => !p.claimed),
    [q.data],
  );

  // Default the team name to the slot name once a slot is picked (coach can
  // still override it).
  function pick(p: Participant) {
    setSelectedId(p.id);
    if (!teamName.trim()) setTeamName(p.name);
  }

  async function submit() {
    if (!selectedId) {
      toast({ title: "Pick a team name to claim first.", variant: "destructive" });
      return;
    }
    if (!teamName.trim()) {
      toast({ title: "Give your team a name.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await customFetch<{ ok: boolean; teamId: string }>(
        `/api/v1/tournaments/${encodeURIComponent(slug)}/claim`,
        {
          method: "POST",
          body: JSON.stringify({
            participantId: selectedId,
            teamName: teamName.trim(),
            sport: sport.trim() || null,
          }),
        },
      );
      toast({ title: "Your team is in! Welcome to the tournament." });
      navigate(`/teams/${res.teamId}`);
    } catch (err) {
      toast({
        title: (err as Error)?.message ?? "Couldn't claim that slot",
        variant: "destructive",
      });
      void q.refetch();
    } finally {
      setSubmitting(false);
    }
  }

  if (q.isLoading || meLoading || !me) {
    return (
      <div className="min-h-screen max-w-2xl mx-auto p-6 space-y-4">
        <Skeleton className="h-24 rounded-xl" />
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

  const { tournament: t } = q.data;

  return (
    <div className="min-h-screen max-w-2xl mx-auto p-6 space-y-6">
      <div className="space-y-1">
        <Link href={`/t/${slug}`}>
          <span className="text-xs text-muted-foreground hover:underline cursor-pointer">
            ← Back to {t.name}
          </span>
        </Link>
        <h1 className="text-2xl font-black tracking-tight">Sign up your team</h1>
        <p className="text-sm text-muted-foreground">
          Claim your team name to get a free temporary team page so you can
          write game recaps during the tournament.
        </p>
      </div>

      <Card className="rounded-xl border-border" data-testid="card-pick-slot">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-lg font-black tracking-tight">
            1. Pick your team name
          </h2>
          {unclaimed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every team name in this tournament has already been claimed.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {unclaimed.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pick(p)}
                  className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                    selectedId === p.id
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-primary/50"
                  }`}
                  data-testid={`btn-pick-${p.id}`}
                >
                  <p className="text-sm font-bold truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {groupLabel(p.division, p.bracket)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border" data-testid="card-team-details">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-lg font-black tracking-tight">2. Team details</h2>
          <div className="space-y-2">
            <Label htmlFor="teamName">Team name</Label>
            <Input
              id="teamName"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Riverside United 14U"
              maxLength={120}
              data-testid="input-team-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sport">Sport (optional)</Label>
            <Input
              id="sport"
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              placeholder="e.g. Soccer"
              maxLength={100}
              data-testid="input-sport"
            />
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            This is a <span className="font-bold">temporary team</span> with no
            organization. You can write recaps while the tournament is active.
            After it ends, create or join a real organization to keep full
            access.
          </div>
          <Button
            className="font-bold w-full"
            disabled={submitting || !selectedId}
            onClick={submit}
            data-testid="btn-submit-signup"
          >
            {submitting ? "Setting up your team…" : "Create team & claim slot"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
