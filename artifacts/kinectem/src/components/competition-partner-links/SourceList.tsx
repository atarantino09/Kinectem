import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { namesRoughlyMatch } from "@/lib/name-match";
import type { CompetitionParticipant } from "@/pages/CompetitionPage";
import {
  MAX_PARTNER_ASSIGNMENTS,
  slotUnavailable,
  sourceMeta,
  teamLabel,
  type Assignment,
  type StoredResult,
} from "./model";
import { ListPages, LIST_PAGE_SIZE } from "./ListPages";

export function SourceList(props: {
  participants: CompetitionParticipant[];
  search: string;
  onSearch: (v: string) => void;
  filter: "unassigned" | "all";
  onFilter: (v: "unassigned" | "all") => void;
  activeId: string | null;
  onActivate: (id: string) => void;
  assignments: Record<string, Assignment>;
  results: Record<string, StoredResult>;
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  const { participants, assignments, results, activeId, disabled } = props;
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [props.search, props.filter]);
  const q = props.search.trim().toLowerCase();
  const shown = participants.filter((p) => {
    if (q && ![p.name, sourceMeta(p), p.gender].join(" ").toLowerCase().includes(q)) return false;
    if (props.filter === "unassigned") {
      return !slotUnavailable(p) && !results[p.id]?.ok;
    }
    return true;
  });
  const queued = Object.keys(assignments).length;
  const assignedIds = new Set(participants.filter((p) => p.claimed || p.teamId).map((p) => p.id));
  Object.values(results).filter((r) => r.ok).forEach((r) => assignedIds.add(r.participantId));
  const done = assignedIds.size;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(shown.length / LIST_PAGE_SIZE)));
  const pageRows = shown.slice((currentPage - 1) * LIST_PAGE_SIZE, currentPage * LIST_PAGE_SIZE);
  return (
    <section aria-labelledby="src-h" className="space-y-2" data-testid="source-column">
      <h3 id="src-h" className="font-bold">Competition team</h3>
      <p className="text-xs text-muted-foreground" data-testid="text-progress">
        {queued} queued · {done} assigned · max {MAX_PARTNER_ASSIGNMENTS} per submission
      </p>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input
          aria-label="Search competition teams"
          value={props.search}
          disabled={disabled}
          onChange={(e) => props.onSearch(e.target.value)}
          placeholder="Search name, age, gender, group"
          className="pl-8"
          data-testid="input-slot-search"
        />
      </div>
      <div className="flex gap-1.5" role="group" aria-label="Competition team view">
        {(["unassigned", "all"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={props.filter === f ? "default" : "outline"}
            aria-pressed={props.filter === f}
            onClick={() => props.onFilter(f)}
            data-testid={`filter-${f}`}
          >
            {f === "unassigned" ? "Unassigned" : "All"}
          </Button>
        ))}
      </div>
      <ul className="divide-y rounded-lg border" data-testid="list-slots">
        {shown.length === 0 && (
          <li className="p-3 text-muted-foreground" data-testid="empty-slots">
             {q ? "No competition teams match your search." : props.filter === "unassigned"
               ? "Nothing left to assign here. Switch to All to see everything." : "No competition teams match."}
          </li>
        )}
        {pageRows.map((p) => {
          const why = slotUnavailable(p);
          const a = assignments[p.id];
          const res = results[p.id];
          const ok = !!res?.ok;
          const active = activeId === p.id;
          const mismatch = a && !namesRoughlyMatch(p.name, a.team.name);
          return (
            <li
              key={p.id}
              className={`p-2.5 space-y-1 ${active ? "bg-primary/10 ring-1 ring-primary/40" : ""}`}
              data-testid={`slot-${p.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold break-words">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{sourceMeta(p) || "No details"}</p>
                </div>
                {ok ? (
                  <Badge data-testid={`assigned-slot-${p.id}`}>Assigned</Badge>
                ) : why ? (
                  <Badge variant="outline" data-testid={`unavailable-slot-${p.id}`}>
                    {why}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant={active ? "default" : "outline"}
                    aria-pressed={active}
                    disabled={disabled || (!a && Object.keys(assignments).length >= MAX_PARTNER_ASSIGNMENTS)}
                    onClick={() => props.onActivate(p.id)}
                    data-testid={`button-choose-team-${p.id}`}
                  >
                     {active ? "Selected" : a ? "Change" : "Select"}
                  </Button>
                )}
              </div>
              {res && (
                <p
                  role={res.ok ? "status" : "alert"}
                  className={res.ok ? "text-xs text-primary" : "text-xs text-destructive"}
                  data-testid={`result-${p.id}`}
                >
                  {res.ok
                    ? `Assigned ${res.slot} to ${res.label}.`
                    : `Could not assign ${res.slot} to ${res.label}: ${res.message ?? res.code ?? "unknown error"}`}
                </p>
              )}
              {a && !ok && (
                <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs" data-testid={`assignment-${p.id}`}>
                  <span className="flex-1 break-words">
                    {"→ "}{teamLabel(a.team)}
                    {mismatch ? " (names differ)" : ""}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove choice for ${p.name}`}
                    disabled={disabled}
                    onClick={() => props.onRemove(p.id)}
                    data-testid={`button-remove-${p.id}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ListPages total={shown.length} page={currentPage} onPage={setPage} label="competition teams" />
    </section>
  );
}
