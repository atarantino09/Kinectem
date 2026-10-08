import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  coverageIdsOf,
  sortStories,
  storyHref,
  usePublicRecaps,
  type Coverage,
} from "@/lib/competition-results";

function CoverageList({ items, testId }: { items: Coverage[]; testId: string }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1" data-testid={testId}>
      {items.map((c) => (
        <li key={c.id} className="text-sm">
          <Link href={`/posts/${c.id}`} className="font-bold underline-offset-2 hover:underline" data-testid={`link-coverage-${c.id}`}>
            {c.title}
          </Link>{" "}
          <span className="text-xs text-muted-foreground">
            {c.teamName}
            {c.gameDate ? ` · ${c.gameDate}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Published tournament recaps + related team coverage for the public
// competition page. Independent of the organizer-curated featured rail.
export function PublishedRecaps({
  competitionId,
  brand,
}: {
  competitionId: string | undefined;
  brand: string;
}) {
  const q = usePublicRecaps(competitionId);
  if (q.isLoading) return <Skeleton className="h-32 rounded-xl" data-testid="skeleton-published-recaps" />;
  if (q.isError)
    return (
      <div className="rounded-xl border p-4 text-sm" data-testid="error-published-recaps">
        Tournament recaps couldn't load.{" "}
        <Button size="sm" variant="outline" onClick={() => q.refetch()} data-testid="btn-retry-published-recaps">
          Retry
        </Button>
      </div>
    );
  const stories = sortStories(q.data?.data ?? []);
  const loose = q.data?.unattributedCoverage ?? [];
  const shown = coverageIdsOf(stories);
  // Grouped coverage is independent of stories: brackets without a recap still
  // appear; anything already under a story is not repeated.
  const byBracket = new Map<string, Coverage[]>();
  for (const c of q.data?.coverage ?? []) {
    if (shown.has(c.id) || !c.bracketId) continue;
    byBracket.set(c.bracketId, [...(byBracket.get(c.bracketId) ?? []), c]);
  }
  const grouped = [...byBracket.entries()];
  const groupedIds = new Set(grouped.flatMap(([, v]) => v.map((c) => c.id)));
  const looseOnly = loose.filter((c) => !shown.has(c.id) && !groupedIds.has(c.id));
  if (!stories.length && !grouped.length && !looseOnly.length) return null;
  return (
    <section
      className="competition-section-surface space-y-5 rounded-xl border p-4 shadow-sm sm:p-5"
      data-testid="section-tournament-recaps"
    >
      <h2 className="flex items-center gap-2 text-xl font-black tracking-tight">
        <span aria-hidden="true" className="h-5 w-1 rounded-full" style={{ backgroundColor: brand }} />
        Tournament Recaps
      </h2>
      {stories.map((s) => (
        <article key={s.id} className="space-y-2 border-t border-border/60 pt-4 first:border-t-0 first:pt-0" data-testid={`story-${s.id}`}>
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground" data-testid={`text-story-bracket-${s.id}`}>
            {s.bracketLabel}
            {s.partial ? " · partial results" : ""}
          </p>
          <h3 className="text-lg font-black leading-tight">
            <Link href={storyHref(s.id)} className="hover:underline" data-testid={`link-story-${s.id}`}>
              {s.title}
            </Link>
          </h3>
          <p className="line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">{s.body}</p>
          <p className="text-xs text-muted-foreground" data-testid={`text-story-meta-${s.id}`}>
            Tournament recap by {s.competition.name}
            {s.resultsAsOf ? ` · Results as of ${new Date(s.resultsAsOf).toLocaleString()}` : ""}
            {s.partial ? (
              <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-900" data-testid={`badge-story-partial-${s.id}`}>
                Partial results
              </span>
            ) : null}
            {s.sourceUrl ? (
              <>
                {" · "}
                <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline" data-testid={`link-story-source-${s.id}`}>
                  Source results
                </a>
              </>
            ) : null}
          </p>
          <CoverageList items={s.coverage} testId={`list-coverage-${s.id}`} />
        </article>
      ))}
      {grouped.sort((a, b) => (a[1][0].bracketOrder ?? 9999) - (b[1][0].bracketOrder ?? 9999)).map(([bid, items]) => (
        <div key={bid} className="space-y-2 border-t border-border/60 pt-4" data-testid={`section-bracket-coverage-${bid}`}>
          <h3 className="text-sm font-black uppercase tracking-wider">{items[0].bracketLabel ?? "Bracket"} — Team coverage</h3>
          <CoverageList items={items} testId={`list-bracket-coverage-${bid}`} />
        </div>
      ))}
      {looseOnly.length > 0 ? (
        <div className="space-y-2 border-t border-border/60 pt-4" data-testid="section-unattributed-coverage">
          <h3 className="text-sm font-black uppercase tracking-wider">More team coverage</h3>
          <CoverageList items={looseOnly} testId="list-unattributed-coverage" />
        </div>
      ) : null}
    </section>
  );
}
