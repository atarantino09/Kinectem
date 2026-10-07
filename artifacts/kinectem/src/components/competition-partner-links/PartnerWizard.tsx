import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { namesRoughlyMatch } from "@/lib/name-match";
import type { CompetitionParticipant } from "@/pages/CompetitionPage";
import { SourceList } from "./SourceList";
import { DestinationPicker } from "./DestinationPicker";
import { ReviewStep } from "./ReviewStep";
import { MatchingActionBar } from "./MatchingActionBar";
import { AssignmentOutcomes } from "./AssignmentOutcomes";
import { usePartnerTeamOptions } from "./usePartnerTeamOptions";
import { usePartnerTeamSuggestions } from "./usePartnerTeamSuggestions";
import {
  MAX_PARTNER_ASSIGNMENTS,
  slotUnavailable,
  optionUnavailable,
  teamLabel,
  type Assignment,
  type ClubRow,
  type LinkResponse,
  type PartnerPage,
  type StoredResult,
  type TeamOption,
} from "./model";

const STEPS = ["Select partner", "Match teams", "Review and assign"];

export function PartnerWizard({
  competitionId,
  slug,
  participants,
  onSubmitting,
}: {
  competitionId: string;
  slug: string;
  participants: CompetitionParticipant[];
  onSubmitting: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const base = `/api/v1/admin/competitions/${encodeURIComponent(competitionId)}`;
  const [step, setStep] = useState(1);
  const [pageId, setPageId] = useState("");
  const [slotSearch, setSlotSearch] = useState("");
  const [filter, setFilter] = useState<"unassigned" | "all">("unassigned");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [clubId, setClubId] = useState("");
  const [clubQ, setClubQ] = useState("");
  const [teamQ, setTeamQ] = useState("");
  const [debQ, setDebQ] = useState("");
  const [selected, setSelected] = useState<TeamOption | null>(null);
  const [selectedFromSuggestion, setSelectedFromSuggestion] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});
  const [results, setResults] = useState<Record<string, StoredResult>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const destinationRef = useRef<HTMLDivElement>(null);
  const scrollRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeId && step === 2 && window.matchMedia("(max-width: 767px)").matches) {
      const root = scrollRoot.current;
      const destination = destinationRef.current;
      if (root && destination) {
        const height = Number.parseFloat(root.style.getPropertyValue("--matching-action-height")) || 0;
        root.scrollTo({
          top: Math.max(0, root.scrollTop + destination.getBoundingClientRect().top - root.getBoundingClientRect().top - height - 8),
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
      }
    }
  }, [activeId, step]);

  useEffect(() => {
    const t = setTimeout(() => setDebQ(teamQ.trim()), 250);
    return () => clearTimeout(t);
  }, [teamQ]);

  const pages = useQuery<{ data: PartnerPage[] }>({
    queryKey: ["competition-partner-pages", competitionId],
    queryFn: () => customFetch(`${base}/partner-pages`, { method: "GET" }),
    retry: false,
  });
  const clubs = useQuery<{ data: ClubRow[] }>({
    queryKey: ["competition-partner-team-clubs", competitionId, pageId],
    queryFn: () => customFetch(`${base}/partner-team-clubs?pageId=${encodeURIComponent(pageId)}`, { method: "GET" }),
    enabled: !!pageId && step === 2,
    retry: false,
  });
  const options = usePartnerTeamOptions({
    competitionId, pageId, clubId, search: debQ,
    enabled: !!pageId && !!activeId && step === 2,
  });

  const byId = useMemo(() => new Map(participants.map((p) => [p.id, p])), [participants]);
  const active = activeId ? byId.get(activeId) ?? null : null;
  const suggestions = usePartnerTeamSuggestions({
    competitionId, pageId, clubId, participantId: activeId, sourceName: active?.name ?? "",
    enabled: !!active && !slotUnavailable(active) && step === 2,
  });
  const entries = Object.entries(assignments);
  const usedTeams = new Map(entries.map(([pid, a]) => [a.team.id, pid]));
  const doneTeams = new Set(Object.values(results).filter((r) => r.ok).map((r) => r.teamId));
  const stale = entries.some(([pid]) => {
    const p = byId.get(pid);
    return !p || !!slotUnavailable(p);
  });
  const mismatchMissing = entries.some(([pid, a]) => {
    const p = byId.get(pid);
    return p && !namesRoughlyMatch(p.name, a.team.name) && !a.ack;
  });
  const canSubmit =
    !submitting && !!pageId && entries.length > 0 && entries.length <= MAX_PARTNER_ASSIGNMENTS &&
    !stale && !mismatchMissing && confirmed;

  function changePage(id: string) {
    setPageId(id);
    setTeamQ(""); setDebQ(""); setClubId(""); setClubQ(""); setSelected(null);
    setAssignments({}); setActiveId(null); setConfirmed(false);
    setResults({}); setSubmitError(null);
  }
  function activate(id: string) {
    setActiveId(id);
    setSelected(null);
    setStep(2);
  }
  function useSelected() {
    if (!activeId || !currentSelected || !canUse) return;
    const selected = currentSelected;
    const participant = byId.get(activeId);
    if (!participant || slotUnavailable(participant) || optionUnavailable(selected) ||
        doneTeams.has(selected.id) || (usedTeams.has(selected.id) && usedTeams.get(selected.id) !== activeId) ||
        (!assignments[activeId] && entries.length >= MAX_PARTNER_ASSIGNMENTS)) return;
    setAssignments((p) => ({ ...p, [activeId]: { team: selected, ack: false } }));
    clearFailedResult(activeId);
    setConfirmed(false);
    setActiveId(null);
    setSelected(null);
  }
  function remove(pid: string) {
    setAssignments((p) => {
      const n = { ...p };
      delete n[pid];
      return n;
    });
    clearFailedResult(pid);
    setConfirmed(false);
  }
  function clearFailedResult(pid: string) {
    setResults((p) => {
      if (!p[pid] || p[pid].ok) return p;
      const next = { ...p };
      delete next[pid];
      return next;
    });
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    onSubmitting(true);
    setSubmitError(null);
    const sent = entries.map(([pid, a]) => ({
      participantId: pid,
      teamId: a.team.id,
      nameMismatchAcknowledged: !namesRoughlyMatch(byId.get(pid)!.name, a.team.name) && a.ack,
    }));
    const snapshot = { ...assignments };
    try {
      const res = await customFetch<LinkResponse>(`${base}/partner-team-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, assignments: sent }),
      });
      const rec: Record<string, StoredResult> = {};
      const ok = new Set<string>();
      for (const r of res.results) {
        const a = snapshot[r.participantId];
        rec[r.participantId] = {
          ...r,
          label: a ? teamLabel(a.team) : r.teamId,
          slot: byId.get(r.participantId)?.name ?? r.participantId,
        };
        if (r.ok) ok.add(r.participantId);
      }
      setResults((p) => ({ ...p, ...rec }));
      setAssignments((p) => {
        const n = { ...p };
        ok.forEach((id) => delete n[id]);
        return n;
      });
      setConfirmed(false);
      setActiveId(null);
      setSelected(null);
      setStep(2);
      if (scrollRoot.current) scrollRoot.current.scrollTop = 0;
      void qc.invalidateQueries({ queryKey: ["competition", slug] });
      void qc.invalidateQueries({ queryKey: ["competition-partner-pages", competitionId] });
      void qc.invalidateQueries({ queryKey: ["competition-partner-team-options", competitionId] });
      void qc.invalidateQueries({ queryKey: ["competition-partner-team-clubs", competitionId] });
      void qc.invalidateQueries({ queryKey: ["competition-partner-team-suggestions", competitionId] });
      res.results.filter((r) => r.ok).forEach((r) =>
        void qc.invalidateQueries({ queryKey: ["team", r.teamId, "tournament-schedule"] }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "The request failed. Nothing was assumed assigned.");
    } finally {
      setSubmitting(false);
      onSubmitting(false);
    }
  }

  const searchPending = teamQ.trim() !== debQ;
  const currentSelected = selected
    ? (selectedFromSuggestion ? suggestions.data?.data : options.data.data)?.find((t) => t.id === selected.id)
    : null;
  const canUse = !!active && !!currentSelected && !slotUnavailable(active) &&
    !optionUnavailable(currentSelected) && !doneTeams.has(currentSelected.id) &&
    (!usedTeams.has(currentSelected.id) || usedTeams.get(currentSelected.id) === active.id) &&
    (!!assignments[active.id] || entries.length < MAX_PARTNER_ASSIGNMENTS) &&
    !searchPending &&
    (selectedFromSuggestion ? !suggestions.isFetching && !suggestions.isError : !options.isRefetching && !options.isRefetchError) &&
    !submitting;

  return (
    <>
      <DialogHeader className="shrink-0 border-b px-5 pt-5 pb-3 pr-12" data-testid="partner-links-header">
        <DialogTitle>Assign team schedules</DialogTitle>
        <DialogDescription>
          Assigning connects all of a competition team's games to its existing team page. Ownership is unchanged and no
          duplicate calendar events are created. Up to {MAX_PARTNER_ASSIGNMENTS} per submission; each team page is used once.
        </DialogDescription>
        <ol className="flex flex-wrap gap-2 pt-1 text-xs" aria-label="Steps" data-testid="steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                disabled={submitting || i + 1 > step && !(pageId && (i + 1 === 2 || entries.length > 0))}
                aria-current={step === i + 1 ? "step" : undefined}
                onClick={() => setStep(i + 1)}
                className={`rounded-full border px-2.5 py-0.5 ${step === i + 1 ? "bg-primary text-primary-foreground border-primary font-bold" : "text-muted-foreground"}`}
                data-testid={`step-${i + 1}`}
              >
                {i + 1}. {s}
              </button>
            </li>
          ))}
        </ol>
      </DialogHeader>

      <div ref={scrollRoot} className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 text-sm"
        style={{ scrollPaddingTop: "calc(var(--matching-action-height, 0px) + 12px)" }} data-testid="partner-links-panel">
        {step === 1 && (
          <div className="space-y-1 max-w-md pt-4">
            <label htmlFor="partner-page-select" className="font-bold text-xs">Partner directory</label>
            {pages.isLoading ? (
              <p className="text-muted-foreground" data-testid="status-pages-loading">Loading directories...</p>
            ) : pages.isError ? (
              <p role="alert" className="text-destructive" data-testid="error-pages">
                Could not load directories.{" "}
                <Button variant="link" className="p-0 h-auto" onClick={() => pages.refetch()}>Retry</Button>
              </p>
            ) : (pages.data?.data.length ?? 0) === 0 ? (
              <p className="text-muted-foreground" data-testid="empty-pages">No partner directories exist for this competition.</p>
            ) : (
              <select
                id="partner-page-select"
                value={pageId}
                disabled={submitting}
                onChange={(e) => changePage(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-2"
                data-testid="select-partner-page"
              >
                <option value="">Select a directory</option>
                {pages.data!.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.officialName} ({p.slug}){p.published ? "" : " - unpublished"}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {step === 2 && (
          <>
          <MatchingActionBar active={active} selected={currentSelected ?? selected} canUse={canUse} onUse={useSelected} scrollRoot={scrollRoot} />
          <AssignmentOutcomes results={results} assignments={assignments} byId={byId} onChange={activate} onRemove={remove} />
          <div className="grid gap-6 md:grid-cols-2">
            <SourceList
              participants={participants}
              search={slotSearch}
              onSearch={setSlotSearch}
              filter={filter}
              onFilter={setFilter}
              activeId={activeId}
              onActivate={activate}
              assignments={assignments}
              results={results}
              onRemove={remove}
              disabled={submitting}
            />
            <div ref={destinationRef} className="min-w-0">
            <DestinationPicker
              active={active}
              clubs={clubs}
              options={options}
              scrollRoot={scrollRoot}
              searchPending={searchPending}
              clubId={clubId}
              clubQ={clubQ}
              onClubQ={setClubQ}
              onClub={(id) => { setClubId(id); setTeamQ(""); setDebQ(""); setSelected(null); }}
              teamQ={teamQ}
              onTeamQ={(v) => { setTeamQ(v); setSelected(null); }}
              usedTeams={usedTeams}
              doneTeams={doneTeams}
              selected={selected}
              onSelect={(team) => { setSelected(team); setSelectedFromSuggestion(false); }}
              suggestions={suggestions}
              onSelectSuggestion={(team) => { setSelected(team); setSelectedFromSuggestion(true); }}
            />
            </div>
          </div>
          </>
        )}
        {step === 3 && (
          <div className="pt-4"><ReviewStep
            byId={byId}
            assignments={assignments}
            results={results}
            confirmed={confirmed}
            onConfirm={setConfirmed}
            onAck={(id, v) => {
              setAssignments((p) => ({ ...p, [id]: { ...p[id], ack: v } }));
              setConfirmed(false);
            }}
            onChange={activate}
            onRemove={remove}
            submitError={submitError}
            disabled={submitting}
          /></div>
        )}
      </div>

      <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3" data-testid="partner-links-footer">
        {step > 1 && (
          <Button variant="outline" disabled={submitting} onClick={() => setStep(step - 1)} data-testid="button-back">
            Back
          </Button>
        )}
        <span className="flex-1" />
        {step === 1 && (
          <Button disabled={!pageId} onClick={() => setStep(2)} data-testid="button-next">Next: Match teams</Button>
        )}
        {step === 2 && (
          <Button disabled={entries.length === 0} onClick={() => setStep(3)} data-testid="button-review">
            Review {entries.length} choice{entries.length === 1 ? "" : "s"}
          </Button>
        )}
        {step === 3 ? (
          <Button className="font-bold" disabled={!canSubmit} onClick={submit} data-testid="button-submit-links">
            {submitting ? "Assigning..." : `Assign schedules to ${entries.length} team${entries.length === 1 ? "" : "s"}`}
          </Button>
        ) : null}
      </div>
    </>
  );
}
