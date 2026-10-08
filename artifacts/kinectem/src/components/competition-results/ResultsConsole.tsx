import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetLoggedInUser } from "@workspace/api-client-react";
import { useWorkspace, snapshotSummary } from "@/lib/competition-results";
import type { Snapshot } from "@/lib/competition-results";
import { ImportCard } from "./ImportCard";
import { ResultsReview } from "./ResultsReview";
import { RecapsCard } from "./RecapsCard";
import { errMsg } from "./ResultsUiHelpers";
export { RecapEditor } from "./RecapEditor";
function ResultsSummary({ snap }: { snap: Snapshot }) {
  const m = snapshotSummary(snap);
  return (
    <div className="rounded-xl border p-4 text-sm space-y-1" data-testid="summary-results">
      <p className="font-bold">
        {m.groups} bracket group{m.groups === 1 ? "" : "s"}, {m.games} game{m.games === 1 ? "" : "s"} read
      </p>
      {m.blocked ? (
        <p className="text-destructive" data-testid="text-summary-blocked">
          This source could not be read{snap.message ? `: ${snap.message}` : ""}. Try another URL or a CSV.
        </p>
      ) : null}
      {m.allScoresMissing ? (
        <p className="text-amber-800" data-testid="text-summary-no-scores">Scores are unavailable. You can still generate recaps from the supplied matchups without entering scores.</p>
      ) : m.missingScores > 0 ? (
        <p className="text-amber-800">{m.missingScores} game{m.missingScores === 1 ? " has an" : "s have"} unavailable score; recaps will use only the known details. No score entry is required.</p>
      ) : null}
      {m.unlinked > 0 ? (
        <p className="text-muted-foreground">{snap.confirmed
          ? `${m.unlinked} team name${m.unlinked === 1 ? "" : "s"} will be written as listed without linking to a team page.`
          : "Team names will be matched automatically. Any uncertain names will stay as listed—no matching checklist."}</p>
      ) : null}
    </div>
  );
}

// ---------- Console ----------
export function ResultsConsole({ competitionId }: { competitionId: string }) {
  const { data: me } = useGetLoggedInUser({ query: { retry: false } as never });
  const q = useWorkspace(competitionId, me?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ws = q.data;
  const snap = ws ? ws.imports.find((i) => i.id === selectedId) ?? ws.imports[0] ?? null : null;

  if (!me?.id || q.isLoading) {
    return (
      <div className="space-y-4" data-testid="skeleton-results">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (q.isError || !ws) {
    return (
      <div className="rounded-xl border border-destructive/40 p-6 text-sm" data-testid="error-results">
        <p className="font-bold">Couldn't load the results workspace.</p>
        <p className="text-muted-foreground">{errMsg(q.error)} Only competition operators can open this page.</p>
        <Button variant="outline" className="mt-3" onClick={() => q.refetch()} data-testid="btn-retry-results">
          Retry
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <ImportCard cid={competitionId} onImported={(s) => setSelectedId(s.id)} />
      {ws.imports.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="list-imports">
          <span className="font-bold">Earlier imports:</span>
          {ws.imports.map((i) => (
            <Button
              key={i.id}
              size="sm"
              variant={snap?.id === i.id ? "brand" : "outline"}
              className="h-7 rounded-full text-xs"
              onClick={() => setSelectedId(i.id)}
              data-testid={`btn-import-${i.id}`}
            >
              {new Date(i.importedAt).toLocaleString()} · {i.status}
            </Button>
          ))}
        </div>
      ) : null}
      {snap ? (
        <>
          <ResultsSummary snap={snap} />
          <RecapsCard key={snap.id} cid={competitionId} snap={snap} ws={ws} />
          <details className="rounded-xl border p-4" data-testid="details-source-review">
            <summary className="cursor-pointer text-sm font-bold">Advanced: review source results</summary>
            <div className="mt-3">
              <ResultsReview cid={competitionId} snap={snap} ws={ws} onConfirmed={(s) => setSelectedId(s.id)} />
            </div>
          </details>
        </>
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground" data-testid="text-no-imports">
          Import a results page, CSV, or pasted table to begin. Nothing is published until you say so.
        </p>
      )}
    </div>
  );
}
