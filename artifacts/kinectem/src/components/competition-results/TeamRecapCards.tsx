import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { api, resultsKeys, storyHref, useTeamRecaps } from "@/lib/competition-results";

// Placement cards: the team displays the organizer's canonical story. Cards
// link to it; the team never edits it. Fed by a separate endpoint so ordinary
// post cursor pagination is untouched; sorted newest-first by publish time.
export function TeamRecapCards({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const q = useTeamRecaps(teamId);
  const qc = useQueryClient();
  const { toast } = useToast();
  const remove = useMutation({
    mutationFn: (storyId: string) => api.unplace(storyId, teamId),
    onSuccess: (_r, storyId) => {
      qc.invalidateQueries({ queryKey: resultsKeys.team(teamId) });
      qc.invalidateQueries({ queryKey: resultsKeys.placements(storyId) });
      toast({ title: "Removed from this team page" });
    },
    onError: (e) =>
      toast({ title: "Couldn't remove", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
  });
  const items = [...(q.data?.data ?? [])].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  if (q.isLoading) return <Skeleton className="h-16 rounded-xl" data-testid="skeleton-team-recaps" />;
  if (q.isError)
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border p-4 text-sm" data-testid="error-team-recaps">
        Tournament recaps couldn't load.
        <Button size="sm" variant="outline" onClick={() => q.refetch()} data-testid="btn-retry-team-recaps">
          Retry
        </Button>
      </div>
    );
  if (!items.length) return null;
  return (
    <section className="space-y-3" data-testid="section-team-recaps">
      <h3 className="text-sm font-black">Tournament recaps</h3>
      {items.map((s) => (
        <div
          key={s.id}
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
          style={s.competition.brandColor ? { borderLeft: `4px solid ${s.competition.brandColor}` } : undefined}
          data-testid={`card-team-recap-${s.id}`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              Tournament recap by {s.competition.name}
            </p>
            <Link href={storyHref(s.id)} className="block text-base font-black leading-snug hover:underline" data-testid={`link-team-recap-${s.id}`}>
              {s.title}
            </Link>
            <p className="text-xs text-muted-foreground">{s.bracketLabel} · Published {new Date(s.publishedAt).toLocaleDateString()}</p>
          </div>
          {canManage ? (
            <Button
              size="sm"
              variant="outline"
              disabled={remove.isPending}
              onClick={() => remove.mutate(s.id)}
              data-testid={`btn-remove-team-recap-${s.id}`}
            >
              Remove
            </Button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
