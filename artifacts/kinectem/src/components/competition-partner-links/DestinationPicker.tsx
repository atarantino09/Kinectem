import { useEffect, useRef, type RefObject } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CompetitionParticipant } from "@/pages/CompetitionPage";
import {
  optionUnavailable,
  teamMeta,
  type ClubRow,
  type TeamOption,
} from "./model";
import type { usePartnerTeamOptions } from "./usePartnerTeamOptions";
import type { usePartnerTeamSuggestions } from "./usePartnerTeamSuggestions";
import { SuggestedMatches } from "./SuggestedMatches";

type Q<T> = { isLoading: boolean; isFetching: boolean; isError: boolean; data?: T; refetch: () => unknown };

export function DestinationPicker(props: {
  active: CompetitionParticipant | null;
  clubs: Q<{ data: ClubRow[] }>;
  options: ReturnType<typeof usePartnerTeamOptions>;
  scrollRoot: RefObject<HTMLDivElement | null>;
  searchPending: boolean;
  clubId: string;
  clubQ: string;
  onClubQ: (value: string) => void;
  onClub: (id: string) => void;
  teamQ: string;
  onTeamQ: (v: string) => void;
  usedTeams: Map<string, string>;
  doneTeams: Set<string>;
  selected: TeamOption | null;
  onSelect: (t: TeamOption) => void;
  suggestions: ReturnType<typeof usePartnerTeamSuggestions>;
  onSelectSuggestion: (t: TeamOption) => void;
}) {
  const { active, options, clubs, usedTeams } = props;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const allOptions = options.data?.data ?? [];
  useEffect(() => {
    const target = loadMoreRef.current;
    const root = props.scrollRoot.current;
    if (!target || !root || !active || !options.hasNextPage || options.isFetching ||
        options.isFetchNextPageError || props.searchPending || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void options.fetchNextPage({ cancelRefetch: false });
    }, { root, rootMargin: "160px 0px", threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [active?.id, props.scrollRoot, props.searchPending, options.hasNextPage, options.isFetching,
    options.isFetchNextPageError, options.fetchNextPage, allOptions.length]);
  const cq = props.clubQ.trim().toLowerCase();
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
                  value={props.clubQ}
                  onChange={(e) => props.onClubQ(e.target.value)}
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
          <SuggestedMatches query={props.suggestions} activeId={active.id}
            usedTeams={usedTeams} doneTeams={props.doneTeams} selected={props.selected}
            onSelect={props.onSelectSuggestion} />
          {options.isRefetchError && allOptions.length > 0 && (
            <p role="alert" className="text-xs text-destructive" data-testid="error-refresh-options">
              Could not refresh team pages. Your choices are unchanged. Refresh before using a team.{" "}
              <Button variant="link" className="h-auto p-0" onClick={() => options.refetch()}>Retry refresh</Button>
            </p>
          )}
          {options.isLoading ? (
            <p className="text-muted-foreground flex items-center gap-2" data-testid="status-options-loading">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching team pages...
            </p>
          ) : options.isError && allOptions.length === 0 ? (
            <p role="alert" className="text-destructive" data-testid="error-options">
              Could not load team pages.{" "}
              <Button variant="link" className="p-0 h-auto" onClick={() => options.refetch()}>Retry</Button>
            </p>
          ) : (
            <>
              {options.hasNextPage && (
                <p role="status" className="text-xs text-primary" data-testid="text-has-more">
                  More team pages load as you scroll.
                </p>
              )}
              {(options.data?.data.length ?? 0) === 0 && (
                <p className="text-muted-foreground" data-testid="empty-options">No team pages found.</p>
              )}
              <ul className="space-y-1" data-testid="list-options">
                 {allOptions.map((t) => {
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
                        disabled={!!why || props.searchPending}
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
              <div ref={loadMoreRef} className="min-h-4" data-testid="team-options-sentinel">
                {options.isFetchingNextPage ? (
                  <p role="status" className="text-xs text-muted-foreground" data-testid="status-more-loading">
                    Loading more team pages...
                  </p>
                ) : options.isFetchNextPageError ? (
                  <p role="alert" className="text-xs text-destructive" data-testid="error-more-options">
                    Could not load more teams. Your choices are unchanged.{" "}
                    <Button variant="link" className="p-0 h-auto" onClick={() => options.fetchNextPage({ cancelRefetch: false })}>
                      Retry loading more
                    </Button>
                  </p>
                ) : options.hasNextPage && typeof IntersectionObserver === "undefined" ? (
                  <Button variant="outline" onClick={() => options.fetchNextPage({ cancelRefetch: false })}>Load more teams</Button>
                ) : <p className="text-xs text-muted-foreground">
                  {allOptions.length} team pages loaded{options.hasNextPage ? "" : " · End of list"}
                </p>}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
