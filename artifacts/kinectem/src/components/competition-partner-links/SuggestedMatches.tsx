import { Button } from "@/components/ui/button";
import { optionUnavailable, teamMeta, type TeamOption } from "./model";
import type { usePartnerTeamSuggestions } from "./usePartnerTeamOptions";

export function SuggestedMatches(props: {
  query: ReturnType<typeof usePartnerTeamSuggestions>;
  activeId: string;
  usedTeams: Map<string, string>;
  doneTeams: Set<string>;
  selected: TeamOption | null;
  onSelect: (team: TeamOption) => void;
  searchPending: boolean;
}) {
  const { query } = props;
  return (
    <section className="rounded-lg border bg-primary/5 p-3 space-y-2" aria-label="Suggested matches" data-testid="suggested-matches">
      <h4 className="font-bold text-sm">Suggested matches</h4>
      <p className="text-xs text-muted-foreground">
        Name matches across this directory, not verified identities. Check the club and team details, then choose a page. Nothing is assigned automatically.
      </p>
      {query.isFetching && <p role="status" className="text-xs">Checking the directory for matches...</p>}
      {query.isError ? (
        <p role="alert" className="text-xs text-destructive">
          Could not check suggestions. You can still search team pages below.{" "}
          <Button variant="link" className="h-auto p-0" onClick={() => query.refetch()}>Retry suggestions</Button>
        </p>
      ) : !query.isFetching && (
        <>
          {query.data?.data.length === 0 && <p className="text-xs text-muted-foreground">No likely name matches. Search team pages below.</p>}
          <ul className="space-y-2">
            {query.data?.data.map((team) => {
              const why = optionUnavailable(team) ??
                (props.doneTeams.has(team.id) ? "Just assigned" :
                  props.usedTeams.has(team.id) && props.usedTeams.get(team.id) !== props.activeId
                    ? "Already chosen for another competition team" : null);
              return (
                <li key={team.id}>
                  <button type="button" disabled={!!why || props.searchPending}
                    aria-pressed={props.selected?.id === team.id}
                    onClick={() => props.onSelect(team)}
                    className={`w-full rounded-md border bg-background p-2 text-left enabled:hover:border-primary disabled:opacity-60 ${props.selected?.id === team.id ? "border-primary" : ""}`}
                    data-testid={`suggestion-team-${team.id}`}>
                    <span className="block text-xs text-muted-foreground">{team.organizationName}</span>
                    <span className="block font-bold">{team.name}</span>
                    <span className="block text-xs text-muted-foreground">{teamMeta(team) || "No details"}</span>
                    <span className={`block text-xs ${why ? "text-destructive" : "text-primary"}`}>{why ?? "Choose this suggestion"}</span>
                  </button>
                  <details className="text-[11px] text-muted-foreground px-2">
                    <summary className="cursor-pointer">Details</summary>
                    <p className="break-all">Team {team.id}</p>
                    <p className="break-all">Club {team.organizationId}</p>
                  </details>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
