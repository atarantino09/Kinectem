import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetLoggedInUser } from "@workspace/api-client-react";
import { useWorkspace } from "@/lib/competition-results";
import { ImportCard } from "./ImportCard";
import { ResultsReview } from "./ResultsReview";
import { RecapsCard } from "./RecapsCard";
import { errMsg } from "./ResultsUiHelpers";
export { RecapEditor } from "./RecapEditor";
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
          <ResultsReview cid={competitionId} snap={snap} ws={ws} onConfirmed={(s) => setSelectedId(s.id)} />
          <RecapsCard cid={competitionId} snap={snap} ws={ws} />
        </>
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground" data-testid="text-no-imports">
          Import a results page, CSV, or pasted table to begin. Nothing is published until you say so.
        </p>
      )}
    </div>
  );
}
