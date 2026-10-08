import { Link, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetLoggedInUser } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { api, resultsKeys, useStory } from "@/lib/competition-results";

// Canonical public bracket story. Registered outside the Layout so it loads
// for anonymous visitors without a login redirect.
function Placements({ storyId, uid }: { storyId: string; uid: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({
    queryKey: resultsKeys.placements(storyId, uid),
    gcTime: 0,
    queryFn: () => api.placementOptions(storyId),
    retry: false,
    staleTime: 15_000,
  });
  const toggle = useMutation({
    mutationFn: (o: { teamId: string; placed: boolean }) =>
      o.placed ? api.unplace(storyId, o.teamId) : api.place(storyId, o.teamId),
    onSuccess: (_r, o) => {
      qc.invalidateQueries({ queryKey: resultsKeys.placements(storyId) });
      qc.invalidateQueries({ queryKey: resultsKeys.team(o.teamId) });
    },
    onError: (e) =>
      toast({ title: "Couldn't update", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
  });
  const opts = q.data?.data ?? [];
  if (!opts.length) return null;
  return (
    <div className="space-y-2 rounded-xl border border-border p-4" data-testid="panel-placements">
      <p className="text-sm font-bold">Show this story on your team page</p>
      {opts.map((o) => (
        <div key={o.teamId} className="flex items-center justify-between gap-2 text-sm">
          <span>{o.teamName}</span>
          <Button
            size="sm"
            variant={o.placed ? "outline" : "brand"}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(o)}
            data-testid={`btn-placement-${o.teamId}`}
          >
            {o.placed ? "Remove" : "Display"}
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function CompetitionStoryPage() {
  const [, params] = useRoute("/competitions/stories/:id");
  const id = params?.id ?? "";
  const q = useStory(id);
  const { data: me } = useGetLoggedInUser({ query: { retry: false } as never });
  const s = q.data;
  const brand = s?.competition.brandColor ?? "#1e293b";
  return (
    <div className="min-h-[100dvh] bg-background text-foreground" data-testid="page-competition-story">
      <header className="border-b border-border px-4 py-3 text-xs font-bold">
        <Link href="/" className="tracking-wide">
          Kinectem
        </Link>
      </header>
      <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        {q.isLoading ? (
          <div className="space-y-3" data-testid="skeleton-story">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-48" />
          </div>
        ) : q.isError || !s ? (
          <div className="space-y-3 rounded-xl border p-6" data-testid="error-story">
            <p className="font-bold">This story isn't available.</p>
            <p className="text-sm text-muted-foreground">It may have been unpublished or removed.</p>
            <Button variant="outline" onClick={() => q.refetch()} data-testid="btn-retry-story">
              Retry
            </Button>
          </div>
        ) : (
          <>
            <Link
              href={`/c/${encodeURIComponent(s.competition.slug)}`}
              className="flex items-center gap-2 text-sm font-bold"
              style={{ color: brand }}
              data-testid="link-story-competition"
            >
              {s.competition.logoUrl ? <img src={s.competition.logoUrl} alt="" className="h-6 w-6 rounded object-cover" /> : null}
              {s.competition.name}
            </Link>
            <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              {s.bracketLabel}
              {s.partial ? " · partial results" : ""}
            </p>
            <h1 className="text-3xl font-black leading-tight" data-testid="text-story-title">
              {s.title}
            </h1>
            <p className="text-sm font-bold text-muted-foreground" data-testid="text-story-byline">
              Tournament recap by {s.competition.name}
            </p>
            <div className="whitespace-pre-line text-base leading-relaxed" data-testid="text-story-body">
              {s.body}
            </div>
            <p className="text-xs text-muted-foreground" data-testid="text-story-provenance">
              {s.resultsAsOf ? `Results as of ${new Date(s.resultsAsOf).toLocaleString()}. ` : ""}
              {s.sourceUrl ? (
                <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  Source results
                </a>
              ) : null}
            </p>
            {s.coverage.length > 0 ? (
              <div className="space-y-2 border-t pt-4" data-testid="list-story-coverage">
                <h2 className="text-sm font-black uppercase tracking-wider">Team coverage</h2>
                {s.coverage.map((c) => (
                  <p key={c.id} className="text-sm">
                    <Link href={`/posts/${c.id}`} className="font-bold hover:underline">
                      {c.title}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">{c.teamName}</span>
                  </p>
                ))}
              </div>
            ) : null}
            {me?.id ? <Placements storyId={s.id} uid={me.id} /> : null}
          </>
        )}
      </main>
    </div>
  );
}
