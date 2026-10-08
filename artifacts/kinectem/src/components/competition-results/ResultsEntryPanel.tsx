import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ImportCard } from "./ImportCard";

export function ResultsEntryPanel({ competitionId }: { competitionId: string }) {
  const [, navigate] = useLocation();
  const resultsPath = `/competitions/${competitionId}/results`;
  return (
    <section
      aria-labelledby={`post-results-heading-${competitionId}`}
      className="min-w-0 space-y-4 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-violet-50 p-4 dark:border-purple-800 dark:from-purple-950/30 dark:to-violet-950/20"
      data-testid="section-post-competition-results"
    >
      <div className="space-y-1">
        <h2 id={`post-results-heading-${competitionId}`} className="text-lg font-black text-purple-800 dark:text-purple-200">
          Post-competition results &amp; bracket recaps
        </h2>
        <p className="text-sm text-muted-foreground">
          After your tournament or league, paste the results page URL below or upload a results CSV.
          This is separate from importing the game schedule.
        </p>
        <p className="text-sm text-muted-foreground">
          Review the imported scores and team matches, then draft and publish recaps for each bracket.
          Importing results does not publish anything automatically.
        </p>
      </div>
      <ImportCard cid={competitionId} onImported={() => navigate(resultsPath)} />
      <Link href={resultsPath}>
        <Button variant="outline" className="h-auto min-h-9 whitespace-normal" data-testid="btn-review-results-recaps">
          Review saved results &amp; manage bracket recaps
        </Button>
      </Link>
    </section>
  );
}
