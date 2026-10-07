import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { namesRoughlyMatch } from "@/lib/name-match";
import type { CompetitionParticipant } from "@/pages/CompetitionPage";
import { slotUnavailable, teamMeta, type Assignment, type StoredResult } from "./model";

export function ReviewStep(props: {
  byId: Map<string, CompetitionParticipant>;
  assignments: Record<string, Assignment>;
  results: Record<string, StoredResult>;
  confirmed: boolean;
  onConfirm: (v: boolean) => void;
  onAck: (id: string, v: boolean) => void;
  onChange: (id: string) => void;
  onRemove: (id: string) => void;
  submitError: string | null;
  disabled: boolean;
}) {
  const entries = Object.entries(props.assignments);
  const done = Object.values(props.results).filter((r) => r.ok);
  return (
    <div className="space-y-3" data-testid="review-section">
      <p className="font-bold" data-testid="text-review-count">
        {entries.length} schedule{entries.length === 1 ? "" : "s"} to assign
      </p>
      {done.length > 0 && (
        <ul className="text-xs space-y-0.5" data-testid="list-assigned">
          {done.map((r) => (
            <li key={r.participantId} className="text-primary" data-testid={`assigned-${r.participantId}`}>
              Assigned: {r.slot} → {r.label}
            </li>
          ))}
        </ul>
      )}
      {entries.length === 0 && done.length === 0 && (
        <p className="text-muted-foreground" data-testid="empty-review">No choices yet. Nothing is selected automatically.</p>
      )}
      <ul className="divide-y rounded-lg border">
        {entries.map(([pid, a]) => {
          const p = props.byId.get(pid);
          const stale = !p || !!slotUnavailable(p);
          const mismatch = p && !namesRoughlyMatch(p.name, a.team.name);
          const res = props.results[pid];
          return (
            <li key={pid} className="p-2.5 space-y-1.5" data-testid={`review-${pid}`}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold break-words">{p?.name ?? "Unknown team"}</p>
                  <p className="text-sm break-words">
                    {"→ "}{a.team.organizationName} / {a.team.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{teamMeta(a.team)}</p>
                </div>
                <Button size="sm" variant="outline" disabled={props.disabled || stale} onClick={() => props.onChange(pid)} data-testid={`button-change-${pid}`}>
                  Change
                </Button>
                <Button size="sm" variant="ghost" disabled={props.disabled} onClick={() => props.onRemove(pid)} data-testid={`button-review-remove-${pid}`}>
                  Remove
                </Button>
              </div>
              {res && !res.ok && (
                <p role="alert" className="text-xs text-destructive" data-testid={`review-error-${pid}`}>
                  {res.message ?? res.code ?? "Could not assign this team."}
                </p>
              )}
              {stale && (
                <p role="alert" className="text-xs text-destructive" data-testid={`stale-${pid}`}>
                  This competition team changed and is no longer available. Remove this choice.
                </p>
              )}
              {mismatch && (
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <Checkbox
                    checked={a.ack}
                    disabled={props.disabled}
                    onCheckedChange={(v) => props.onAck(pid, v === true)}
                    data-testid={`checkbox-mismatch-${pid}`}
                  />
                  <span>Names differ. I confirm "{p?.name}" is "{a.team.name}".</span>
                </label>
              )}
            </li>
          );
        })}
      </ul>
      {entries.length > 0 && (
        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <Checkbox
            checked={props.confirmed}
            disabled={props.disabled}
            onCheckedChange={(v) => props.onConfirm(v === true)}
            data-testid="checkbox-confirm-link"
          />
          <span>
            I reviewed every assignment. Games connect immediately; team ownership and normal approvals are unchanged.
          </span>
        </label>
      )}
      {props.submitError && (
        <p role="alert" className="text-destructive text-xs" data-testid="error-submit">{props.submitError}</p>
      )}
    </div>
  );
}
