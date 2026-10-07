import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link2, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWhoami } from "@/hooks/useWhoami";
import { namesRoughlyMatch } from "@/lib/name-match";
import type { CompetitionParticipant } from "@/pages/CompetitionPage";

export const MAX_PARTNER_ASSIGNMENTS = 100;

type PartnerPage = {
  id: string;
  slug: string;
  officialName: string;
  linked?: boolean;
  published?: boolean;
};
type TeamOption = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  city?: string | null;
  state?: string | null;
  gender?: string | null;
  ageGroup?: string | null;
  archived?: boolean;
  slotStatus: null | "linked" | "pending";
};
type LinkResult = {
  participantId: string;
  teamId: string;
  ok: boolean;
  code?: string;
  message?: string;
};
type LinkResponse = {
  ok: boolean;
  succeeded: number;
  failed: number;
  results: LinkResult[];
};
type Assignment = { team: TeamOption; ack: boolean };

function teamLabel(t: TeamOption) {
  return [t.organizationName, t.name].join(" / ");
}
function teamDetail(t: TeamOption) {
  const loc = [t.city, t.state].filter(Boolean).join(", ");
  return [
    [t.gender, t.ageGroup].filter(Boolean).join(" "),
    loc,
    `team ${t.id}`,
    `org ${t.organizationId}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
function optionUnavailable(t: TeamOption): string | null {
  if (t.archived) return "Archived team";
  if (t.slotStatus === "linked") return "Already linked to a slot";
  if (t.slotStatus === "pending") return "Has a pending slot claim";
  return null;
}
export function slotUnavailable(p: CompetitionParticipant): string | null {
  if (p.hidden) return "Hidden slot";
  if (p.pending) return "Claim pending approval";
  if (p.claimed || p.teamId) return "Already claimed";
  return null;
}

export function CompetitionPartnerLinks(props: {
  competitionId: string;
  slug: string;
  participants: CompetitionParticipant[];
}) {
  const { data: who } = useWhoami();
  const role = who?.isMasquerading ? who.viewingAs?.role : who?.realUser?.role;
  const isAdmin = !!who?.authenticated && !who.isMasquerading && role === "admin";
  const sessionKey = `${props.competitionId}:${
    who?.isMasquerading ? who.viewingAs?.id : who?.realUser?.id
  }`;
  if (!isAdmin) return null;
  return <Tool key={sessionKey} {...props} />;
}

function Tool(props: {
  competitionId: string;
  slug: string;
  participants: CompetitionParticipant[];
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="partner-links-tool"
    >
      <Button
        variant="outline"
        size="sm"
        className="font-bold border-primary/40"
        onClick={() => setOpen(true)}
        data-testid="button-link-partner-teams"
      >
        <Link2 className="w-4 h-4 mr-1.5" /> Link partner teams
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v && submitting) return;
          setOpen(v);
        }}
      >
        <DialogContent
          className="sm:max-w-4xl max-h-[90dvh] overflow-y-auto"
          data-testid="dialog-partner-links"
        >
          <DialogHeader>
            <DialogTitle>Link partner teams</DialogTitle>
            <DialogDescription>
              Admin tool. Match schedule slots to existing partner teams.
            </DialogDescription>
          </DialogHeader>
          {open && <Panel {...props} onSubmitting={setSubmitting} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Panel({
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
  const [pageId, setPageId] = useState("");
  const [slotSearch, setSlotSearch] = useState("");
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [teamQ, setTeamQ] = useState("");
  const [debQ, setDebQ] = useState("");
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});
  const [results, setResults] = useState<Record<string, LinkResult & { label: string; slot: string }>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebQ(teamQ.trim()), 250);
    return () => clearTimeout(t);
  }, [teamQ]);

  const pages = useQuery<{ data: PartnerPage[] }>({
    queryKey: ["competition-partner-pages", competitionId],
    queryFn: () => customFetch(`${base}/partner-pages`, { method: "GET" }),
    retry: false,
  });
  const options = useQuery<{ data: TeamOption[]; hasMore: boolean }>({
    queryKey: ["competition-partner-team-options", competitionId, pageId, debQ],
    queryFn: () =>
      customFetch(
        `${base}/partner-team-options?pageId=${encodeURIComponent(pageId)}${
          debQ ? `&q=${encodeURIComponent(debQ)}` : ""
        }`,
        { method: "GET" },
      ),
    enabled: !!pageId && !!activeSlot,
    retry: false,
  });

  const byId = useMemo(
    () => new Map(participants.map((p) => [p.id, p])),
    [participants],
  );
  const slots = useMemo(() => {
    const s = slotSearch.trim().toLowerCase();
    return participants.filter(
      (p) =>
        !s ||
        [p.name, p.age, p.gender, p.division, p.bracket]
          .join(" ")
          .toLowerCase()
          .includes(s),
    );
  }, [participants, slotSearch]);

  const entries = Object.entries(assignments);
  const usedTeams = new Map(entries.map(([pid, a]) => [a.team.id, pid]));
  const staleIds = entries
    .filter(([pid]) => {
      const p = byId.get(pid);
      return !p || !!slotUnavailable(p);
    })
    .map(([pid]) => pid);
  const mismatchMissing = entries.some(
    ([pid, a]) =>
      byId.get(pid) &&
      !namesRoughlyMatch(byId.get(pid)!.name, a.team.name) &&
      !a.ack,
  );
  const canSubmit =
    !submitting &&
    !!pageId &&
    entries.length > 0 &&
    entries.length <= MAX_PARTNER_ASSIGNMENTS &&
    staleIds.length === 0 &&
    !mismatchMissing &&
    confirmed;

  function changePage(id: string) {
    setPageId(id);
    setTeamQ("");
    setDebQ("");
    setAssignments({});
    setActiveSlot(null);
    setConfirmed(false);
    setResults({});
    setSubmitError(null);
  }

  function assign(pid: string, team: TeamOption) {
    setAssignments((prev) => {
      const next = { ...prev };
      next[pid] = { team, ack: false };
      return next;
    });
    setConfirmed(false);
    setActiveSlot(null);
    setTeamQ("");
    setDebQ("");
  }
  function unassign(pid: string) {
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[pid];
      return next;
    });
    setConfirmed(false);
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    onSubmitting(true);
    setSubmitError(null);
    const sent = entries.map(([pid, a]) => ({
      participantId: pid,
      teamId: a.team.id,
      nameMismatchAcknowledged:
        !namesRoughlyMatch(byId.get(pid)!.name, a.team.name) && a.ack,
    }));
    const snapshot = { ...assignments };
    try {
      const res = await customFetch<LinkResponse>(
        `${base}/partner-team-links`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageId, assignments: sent }),
        },
      );
      const okIds = new Set<string>();
      const rec: typeof results = {};
      for (const r of res.results) {
        const a = snapshot[r.participantId];
        rec[r.participantId] = {
          ...r,
          label: a ? teamLabel(a.team) : r.teamId,
          slot: byId.get(r.participantId)?.name ?? r.participantId,
        };
        if (r.ok) okIds.add(r.participantId);
      }
      setResults((prev) => ({ ...prev, ...rec }));
      setAssignments((prev) => {
        const next = { ...prev };
        okIds.forEach((id) => delete next[id]);
        return next;
      });
      setConfirmed(false);
      void qc.invalidateQueries({ queryKey: ["competition", slug] });
      void qc.invalidateQueries({ queryKey: ["competition-partner-pages", competitionId] });
      void qc.invalidateQueries({ queryKey: ["competition-partner-team-options", competitionId] });
      res.results
        .filter((r) => r.ok)
        .forEach((r) =>
          void qc.invalidateQueries({
            queryKey: ["team", r.teamId, "tournament-schedule"],
          }),
        );
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "The request failed. Nothing was assumed linked.",
      );
    } finally {
      setSubmitting(false);
      onSubmitting(false);
    }
  }

  const resultList = Object.values(results);
  const failedCount = resultList.filter((r) => !r.ok).length;

  return (
    <div className="space-y-4 text-sm" data-testid="partner-links-panel">
      <div
        className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs space-y-1"
        data-testid="text-partner-links-notice"
      >
        <p>
          Schedules are linked immediately when you submit. Team ownership is
          unchanged, and ordinary claim approvals are unchanged.
        </p>
        <p>Up to {MAX_PARTNER_ASSIGNMENTS} links per submission. Each team can be used once.</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="partner-page-select" className="font-bold text-xs">
          Partner directory page
        </label>
        {pages.isLoading ? (
          <p className="text-muted-foreground" data-testid="status-pages-loading">
            Loading directory pages...
          </p>
        ) : pages.isError ? (
          <p role="alert" className="text-destructive" data-testid="error-pages">
            Could not load directory pages.{" "}
            <Button variant="link" className="p-0 h-auto" onClick={() => pages.refetch()}>
              Retry
            </Button>
          </p>
        ) : (pages.data?.data.length ?? 0) === 0 ? (
          <p className="text-muted-foreground" data-testid="empty-pages">
            No partner directory pages exist for this competition.
          </p>
        ) : (
          <select
            id="partner-page-select"
            value={pageId}
            disabled={submitting}
            onChange={(e) => changePage(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-2"
            data-testid="select-partner-page"
          >
            <option value="">Select a directory page</option>
            {pages.data!.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.officialName} ({p.slug}){p.published ? "" : " - unpublished"}
              </option>
            ))}
          </select>
        )}
      </div>

      {pageId && (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              aria-label="Search schedule slots"
              value={slotSearch}
              disabled={submitting}
              onChange={(e) => setSlotSearch(e.target.value)}
              placeholder="Search slots by name, age, gender, division, bracket"
              className="pl-8"
              data-testid="input-slot-search"
            />
          </div>

          <ul className="max-h-80 overflow-y-auto divide-y rounded-lg border" data-testid="list-slots">
            {slots.length === 0 && (
              <li className="p-3 text-muted-foreground" data-testid="empty-slots">
                No slots match.
              </li>
            )}
            {slots.map((p) => {
              const why = slotUnavailable(p);
              const a = assignments[p.id];
              const res = results[p.id];
              const mismatch = a && !namesRoughlyMatch(p.name, a.team.name);
              return (
                <li key={p.id} className="p-2.5 space-y-1.5" data-testid={`slot-${p.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{p.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {p.age ?? "Age n/a"} · {p.gender ?? "Gender n/a"} ·{" "}
                      {p.division || "No division"} · {p.bracket || "No bracket"}
                    </Badge>
                    {why && (
                      <Badge variant="outline" data-testid={`unavailable-slot-${p.id}`}>
                        Unavailable: {why}
                      </Badge>
                    )}
                    <span className="flex-1" />
                    {!why && !a && !(res?.ok) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          submitting || entries.length >= MAX_PARTNER_ASSIGNMENTS
                        }
                        onClick={() => {
                          setActiveSlot(p.id);
                          setTeamQ("");
                        }}
                        data-testid={`button-choose-team-${p.id}`}
                      >
                        {res && !res.ok ? "Choose another team" : "Choose team"}
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
                        ? `Linked ${res.slot} to ${res.label}.`
                        : `Failed to link ${res.slot} to ${res.label}: ${
                            res.message ?? res.code ?? "unknown error"
                          }`}
                    </p>
                  )}
                  {a && (
                    <div className="rounded-md bg-muted/50 p-2 space-y-1.5" data-testid={`assignment-${p.id}`}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <p className="font-bold">{teamLabel(a.team)}</p>
                          <p className="text-xs text-muted-foreground">{teamDetail(a.team)}</p>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove match for ${p.name}`}
                          disabled={submitting}
                          onClick={() => unassign(p.id)}
                          data-testid={`button-remove-${p.id}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                      {mismatch && (
                        <label className="flex items-start gap-2 text-xs cursor-pointer">
                          <Checkbox
                            checked={a.ack}
                            disabled={submitting}
                            onCheckedChange={(v) => {
                              setAssignments((prev) => ({
                                ...prev,
                                [p.id]: { ...a, ack: v === true },
                              }));
                              setConfirmed(false);
                            }}
                            data-testid={`checkbox-mismatch-${p.id}`}
                          />
                          <span>
                            Names differ. I confirm slot "{p.name}" is team "
                            {a.team.name}".
                          </span>
                        </label>
                      )}
                      {staleIds.includes(p.id) && (
                        <p role="alert" className="text-xs text-destructive">
                          This slot changed and is no longer available. Remove the match.
                        </p>
                      )}
                    </div>
                  )}
                  {activeSlot === p.id && (
                    <div className="rounded-md border p-2 space-y-2" data-testid="team-picker">
                      <div className="flex gap-2">
                        <Input
                          aria-label="Search organizations and teams"
                          autoFocus
                          value={teamQ}
                          onChange={(e) => setTeamQ(e.target.value)}
                          placeholder="Search organization or team"
                          data-testid="input-team-search"
                        />
                        <Button size="sm" variant="ghost" onClick={() => setActiveSlot(null)} data-testid="button-close-picker">
                          Cancel
                        </Button>
                      </div>
                      {options.isLoading || options.isFetching ? (
                        <p className="text-muted-foreground flex items-center gap-2" data-testid="status-options-loading">
                          <Loader2 className="w-4 h-4 animate-spin" /> Searching teams...
                        </p>
                      ) : options.isError ? (
                        <p role="alert" className="text-destructive" data-testid="error-options">
                          Could not load teams.{" "}
                          <Button variant="link" className="p-0 h-auto" onClick={() => options.refetch()}>
                            Retry
                          </Button>
                        </p>
                      ) : (
                        <>
                          {options.data?.hasMore && (
                            <p role="status" className="text-xs text-primary" data-testid="text-has-more">
                              More teams exist than are shown. Narrow your search to see them.
                            </p>
                          )}
                          {(options.data?.data.length ?? 0) === 0 && (
                            <p className="text-muted-foreground" data-testid="empty-options">
                              No teams found.
                            </p>
                          )}
                          <ul className="max-h-56 overflow-y-auto space-y-1">
                            {options.data?.data.map((t) => {
                              const why =
                                optionUnavailable(t) ??
                                (usedTeams.has(t.id) && usedTeams.get(t.id) !== p.id
                                  ? "Already matched to another slot here"
                                  : null);
                              return (
                                <li key={t.id}>
                                  <button
                                    type="button"
                                    disabled={!!why}
                                    onClick={() => assign(p.id, t)}
                                    className="w-full text-left rounded-md border px-2 py-1.5 enabled:hover:border-primary disabled:opacity-60"
                                    data-testid={`option-team-${t.id}`}
                                  >
                                    <span className="font-bold">{teamLabel(t)}</span>
                                    <span className="block text-xs text-muted-foreground">
                                      {teamDetail(t)}
                                    </span>
                                    {why && (
                                      <span className="block text-xs text-destructive">
                                        Unavailable: {why}
                                      </span>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="rounded-lg border p-3 space-y-2" data-testid="review-section">
            <p className="font-bold">
              Review: {entries.length} of {MAX_PARTNER_ASSIGNMENTS} matches
              {failedCount > 0 ? ` (${failedCount} failed earlier, still editable)` : ""}
            </p>
            {entries.length === 0 ? (
              <p className="text-muted-foreground" data-testid="empty-review">
                No matches yet. Nothing is selected automatically.
              </p>
            ) : (
              <ul className="text-xs space-y-0.5">
                {entries.map(([pid, a]) => (
                  <li key={pid} data-testid={`review-${pid}`}>
                    {byId.get(pid)?.name ?? pid} {"->"} {teamLabel(a.team)} ({teamDetail(a.team)})
                  </li>
                ))}
              </ul>
            )}
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <Checkbox
                checked={confirmed}
                disabled={submitting || entries.length === 0}
                onCheckedChange={(v) => setConfirmed(v === true)}
                data-testid="checkbox-confirm-link"
              />
              <span>
                I reviewed every match. Schedules link immediately; ownership and
                ordinary approvals are unchanged.
              </span>
            </label>
            {submitError && (
              <p role="alert" className="text-destructive text-xs" data-testid="error-submit">
                {submitError}
              </p>
            )}
            <Button
              className="font-bold"
              disabled={!canSubmit}
              onClick={submit}
              data-testid="button-submit-links"
            >
              {submitting ? "Linking..." : `Link ${entries.length} team${entries.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
