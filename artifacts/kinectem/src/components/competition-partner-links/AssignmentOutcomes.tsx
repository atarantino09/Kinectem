import { Button } from "@/components/ui/button";
import type { CompetitionParticipant } from "@/pages/CompetitionPage";
import { slotUnavailable, type Assignment, type StoredResult } from "./model";

export function AssignmentOutcomes({ results, assignments, byId, onChange, onRemove }: {
  results: Record<string, StoredResult>;
  assignments: Record<string, Assignment>;
  byId: Map<string, CompetitionParticipant>;
  onChange: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const rows = Object.values(results);
  if (!rows.length) return null;
  const success = rows.filter((r) => r.ok);
  const failures = rows.filter((r) => !r.ok);
  return (
    <section className="mb-4 space-y-2 rounded-lg border bg-muted/30 p-3" aria-label="Assignment results"
      data-testid="assignment-outcomes">
      <p role="status" className="font-bold">
        Assigned {success.length} team{success.length === 1 ? "" : "s"}.
        {failures.length > 0 && ` ${failures.length} could not be assigned.`} Continue matching below.
      </p>
      {success.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold">View assigned teams</summary>
          <ul className="mt-1 space-y-1">
            {success.map((r) => <li key={r.participantId} data-testid={`assigned-${r.participantId}`}>
              Assigned: {r.slot} → {r.label}
            </li>)}
          </ul>
        </details>
      )}
      {failures.map((r) => {
        const participant = byId.get(r.participantId);
        return (
          <div key={r.participantId} className="rounded-md border border-destructive/30 p-2 text-xs"
            data-testid={`outcome-error-${r.participantId}`}>
            <p role="alert" className="text-destructive">
              {r.slot} → {r.label}: {r.message ?? r.code ?? "Could not assign this team."}
            </p>
            {assignments[r.participantId] ? (
              <div className="mt-1 flex gap-2">
                <Button size="sm" variant="outline" disabled={!participant || !!slotUnavailable(participant)}
                  onClick={() => onChange(r.participantId)}>Change team page</Button>
                <Button size="sm" variant="ghost" onClick={() => onRemove(r.participantId)}>Remove choice</Button>
              </div>
            ) : <p className="text-muted-foreground">Not queued for retry.</p>}
          </div>
        );
      })}
    </section>
  );
}
