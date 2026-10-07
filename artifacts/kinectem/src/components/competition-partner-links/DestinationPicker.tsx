import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CompetitionParticipant } from "@/pages/CompetitionPage";
import {
  optionUnavailable,
  slotUnavailable,
  sourceMeta,
  teamMeta,
  type ClubRow,
  type TeamOption,
} from "./model";
import { ListPages, LIST_PAGE_SIZE } from "./ListPages";

type Q<T> = { isLoading: boolean; isFetching: boolean; isError: boolean; data?: T; refetch: () => unknown };

export function DestinationPicker(props: {
  active: CompetitionParticipant | null;
  clubs: Q<{ data: ClubRow[] }>;
  options: Q<{ data: TeamOption[]; hasMore: boolean }>;
  clubId: string;
  onClub: (id: string) => void;
  teamQ: string;
  onTeamQ: (v: string) => void;
  usedTeams: Map<string, string>;
  doneTeams: Set<string>;
  selected: TeamOption | null;
  onSelect: (t: TeamOption) => void;
  onUse: () => void;
}) {
  const { active, options, clubs, usedTeams } = props;
  const [clubQ, setClubQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [props.clubId, props.teamQ]);
  const allOptions = options.data?.data ?? [];
  const currentPage = Math.min(page, Math.max(1, Math.ceil(allOptions.length / LIST_PAGE_SIZE)));
  const pageRows = allOptions.slice((currentPage - 1) * LIST_PAGE_SIZE, currentPage * LIST_PAGE_SIZE);
  const cq = clubQ.trim().toLowerCase();
  const clubRows = (clubs.data?.data ?? []).filter(
    (c) => c.id === props.clubId || !cq || `${c.name} ${c.city ?? ""} ${c.state ?? ""}`.toLowerCase().includes(cq),
  );
  return (
    <section aria-labelledby="dst-h" className="space-y-2 md:border-l md:pl-4" data-testid="destination-column">
      <h3 id="dst-h" className="font-bold">Existing team page</h3>
      {!active ? (
        <p className="rounded-lg border border-dashed p-3 text-muted-foreground" data-testid="empty-active">
          Select a competition team first.
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-2.5" data-testid="active-source">
            <p className="text-xs text-muted-foreground">Assigning games for</p>
            <p className="font-bold break-words">{active.name}</p>
            <p className="text-xs text-muted-foreground">{sourceMeta(active)}</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="club-find" className="text-xs font-bold">Club</label>
            {clubs.isError ? (
              <p role="alert" className="text-destructive text-xs" data-testid="error-clubs">
                Could not load clubs.{" "}
                <Button variant="link" className="p-0 h-auto" onClick={() => clubs.refetch()}>Retry</Button>
              </p>
            ) : (
              <>
                <Input
                  id="club-find"
                  value={clubQ}
                  onChange={(e) => setClubQ(e.target.value)}
                  placeholder="Find a club"
                  data-testid="input-club-search"
                />
                <select
                  aria-label="Club filter"
                  value={props.clubId}
                  onChange={(e) => props.onClub(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-2"
                  data-testid="select-club"
                >
                  <option value="">All clubs</option>
                  {clubRows.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {[c.city, c.state].filter(Boolean).length ? ` · ${[c.city, c.state].filter(Boolean).join(", ")}` : ""} ({c.teamCount})
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              aria-label="Search club or team names"
              value={props.teamQ}
              onChange={(e) => props.onTeamQ(e.target.value)}
              placeholder="Search club or team"
              className="pl-8"
              data-testid="input-team-search"
            />
          </div>
           <div className="rounded-lg border bg-muted/30 p-2.5 space-y-2">
             {props.selected && (
               <p className="text-xs" data-testid="selected-destination">
                 Team page: <strong>{props.selected.organizationName} / {props.selected.name}</strong>
               </p>
             )}
             {slotUnavailable(active) && (
               <p role="alert" className="text-xs text-destructive">
                 This competition team is no longer available. Select another team.
               </p>
             )}
             <Button className="font-bold w-full"
               disabled={!props.selected || !!slotUnavailable(active) || options.isFetching}
               onClick={props.onUse} data-testid="button-use-team">
               Use this team page
             </Button>
           </div>
          {options.isLoading || options.isFetching ? (
            <p className="text-muted-foreground flex items-center gap-2" data-testid="status-options-loading">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching team pages...
            </p>
          ) : options.isError ? (
            <p role="alert" className="text-destructive" data-testid="error-options">
              Could not load team pages.{" "}
              <Button variant="link" className="p-0 h-auto" onClick={() => options.refetch()}>Retry</Button>
            </p>
          ) : (
            <>
              {options.data?.hasMore && (
                <p role="status" className="text-xs text-primary" data-testid="text-has-more">
                  More team pages exist than are shown. Pick a club or narrow your search.
                </p>
              )}
              {(options.data?.data.length ?? 0) === 0 && (
                <p className="text-muted-foreground" data-testid="empty-options">No team pages found.</p>
              )}
              <ul className="space-y-1" data-testid="list-options">
                 {pageRows.map((t) => {
                  const why =
                    optionUnavailable(t) ??
                    (props.doneTeams.has(t.id)
                      ? "Just assigned"
                      : usedTeams.has(t.id) && usedTeams.get(t.id) !== active.id
                        ? "Already chosen for another competition team"
                        : null);
                  const sel = props.selected?.id === t.id;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        disabled={!!why}
                        aria-pressed={sel}
                        onClick={() => props.onSelect(t)}
                        className={`w-full text-left rounded-md border px-2 py-1.5 enabled:hover:border-primary disabled:opacity-60 ${sel ? "border-primary bg-primary/10" : ""}`}
                        data-testid={`option-team-${t.id}`}
                      >
                        <span className="block text-xs text-muted-foreground">{t.organizationName}</span>
                        <span className="block font-bold">{t.name}</span>
                        <span className="block text-xs text-muted-foreground">{teamMeta(t) || "No details"}</span>
                        {why && <span className="block text-xs text-destructive">{why}</span>}
                      </button>
                      <details className="text-[11px] text-muted-foreground px-2">
                        <summary className="cursor-pointer">Details</summary>
                        <p className="break-all">Team {t.id}</p>
                        <p className="break-all">Club {t.organizationId}</p>
                      </details>
                    </li>
                  );
                })}
              </ul>
               <ListPages total={allOptions.length} page={currentPage} onPage={setPage} label="team pages" />
            </>
          )}
        </>
      )}
    </section>
  );
}
