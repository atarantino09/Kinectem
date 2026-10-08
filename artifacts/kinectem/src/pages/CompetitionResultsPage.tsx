import { Link, useRoute } from "wouter";
import { ArrowLeft } from "lucide-react";
import { ResultsConsole } from "@/components/competition-results/ResultsConsole";

// Organizer console for results imports and tournament recaps. Server
// enforces operator access on the workspace endpoint.
export default function CompetitionResultsPage() {
  const [, params] = useRoute("/competitions/:id/results");
  const id = params?.id ?? "";
  return (
    <div className="mx-auto max-w-4xl space-y-5" data-testid="page-competition-results">
      <Link
        href={`/competitions/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground"
        data-testid="link-back-console"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Competition console
      </Link>
      <div>
        <h1 className="text-2xl font-black tracking-tight">Results and tournament recaps</h1>
        <p className="text-sm text-muted-foreground">
          Import real results, confirm who is who, then publish one factual story per bracket. Teams choose to display
          that same story on their pages.
        </p>
      </div>
      <ResultsConsole competitionId={id} />
    </div>
  );
}
