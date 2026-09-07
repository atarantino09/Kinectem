import { useRoute, useLocation, useSearch, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  namesRoughlyMatch,
  suggestDistinctNameMatches,
} from "@/lib/name-match";

// Task #628 — Solo-team signup + participant claim (`/t/<slug>/signup`). A
// signed-in visiting coach picks an unclaimed team-name slot, then EITHER
// claims it to an existing Kinectem team they manage (no duplicate team
// created) OR names a new SOLO team (no organization). Hand-written
// customFetch — no openapi.yaml entry.

type Participant = {
  id: string;
  name: string;
  division: string;
  bracket: string;
  claimed: boolean;
  pending: boolean;
};

type TournamentResponse = {
  tournament: {
    id: string;
    slug: string;
    name: string;
    startDate: string;
    endDate: string;
    isActive: boolean;
    autoApproveClaims: boolean;
  };
  participants: Participant[];
};

type ManageableTeam = {
  id: string;
  name: string;
  sport: string | null;
  organizationId: string | null;
  organizationName: string | null;
  canManageOrganization: boolean;
};

type BulkClaimResult = {
  participantId: string;
  teamId: string;
  ok: boolean;
  pendingApproval?: boolean;
  code?: string;
  error?: string;
};

function groupLabel(division: string, bracket: string): string {
  const parts = [division, bracket].filter((p) => p && p.trim() !== "");
  return parts.length ? parts.join(" · ") : "General";
}

export default function TournamentSignupPage() {
  const [, params] = useRoute("/c/:slug/signup");
  const slug = params?.slug ?? "";
  const [, navigate] = useLocation();
  // Deep-linked slot from the competition page's "Claim" button — when
  // present, the pick-a-slot step is skipped entirely.
  const search = useSearch();
  const preselectedId = useMemo(
    () => new URLSearchParams(search).get("participant"),
    [search],
  );
  const { toast } = useToast();
  const { data: me, isLoading: meLoading } = useGetLoggedInUser();

  const [selectedId, setSelectedId] = useState<string>("");
  const [teamName, setTeamName] = useState<string>("");
  const [sport, setSport] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // "existing" = claim to a team I already manage; "new" = create a solo team.
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [existingTeamId, setExistingTeamId] = useState<string>("");
  // Coach-confirmed name-mismatch gate: when the slot name and the chosen
  // team's name don't roughly match, an explicit acknowledgement is required.
  const [mismatchConfirmed, setMismatchConfirmed] = useState(false);
  const [bulkOrganizationId, setBulkOrganizationId] = useState("");
  const [bulkAssignments, setBulkAssignments] = useState<Record<string, string>>(
    {},
  );
  const [bulkMismatchConfirmed, setBulkMismatchConfirmed] = useState<
    Record<string, boolean>
  >({});
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkClaimResult[]>([]);

  const q = useQuery<TournamentResponse>({
    queryKey: ["tournament", slug],
    queryFn: () =>
      customFetch<TournamentResponse>(
        `/api/v1/competitions/${encodeURIComponent(slug)}`,
        { method: "GET" },
      ),
    enabled: !!slug,
    retry: false,
  });

  const myTeamsQ = useQuery<{ data: ManageableTeam[] }>({
    queryKey: ["my-manageable-teams"],
    queryFn: () =>
      customFetch<{ data: ManageableTeam[] }>(`/api/v1/my/manageable-teams`),
    enabled: !!me,
    retry: false,
  });
  const myTeams = myTeamsQ.data?.data ?? [];

  // Default to the existing-team branch for anyone who already manages a team.
  useEffect(() => {
    if (myTeams.length > 0) setMode("existing");
  }, [myTeams.length]);

  // Redirect anonymous visitors to signup/login, returning here afterward
  // (keeping the deep-linked slot, if any).
  useEffect(() => {
    if (!meLoading && !me) {
      const returnTo = preselectedId
        ? `/c/${slug}/signup?participant=${preselectedId}`
        : `/c/${slug}/signup`;
      navigate(`/login?signup=1&returnTo=${encodeURIComponent(returnTo)}`);
    }
  }, [meLoading, me, navigate, slug, preselectedId]);

  const unclaimed = useMemo(
    () =>
      (q.data?.participants ?? []).filter((p) => !p.claimed && !p.pending),
    [q.data],
  );

  // Apply the deep-linked slot once participants load. A stale link to an
  // already-claimed slot falls back to the manual picker with a notice.
  const preselectedTaken = useMemo(() => {
    if (!preselectedId || !q.data) return false;
    const row = q.data.participants.find((p) => p.id === preselectedId);
    return !!row && (row.claimed || row.pending);
  }, [preselectedId, q.data]);
  const preselectedSlot = useMemo(
    () => unclaimed.find((p) => p.id === preselectedId) ?? null,
    [unclaimed, preselectedId],
  );
  useEffect(() => {
    if (!preselectedId || !q.data) return;
    const row = unclaimed.find((p) => p.id === preselectedId);
    if (row) {
      setSelectedId(row.id);
      setTeamName((prev) => (prev ? prev : row.name));
    }
  }, [preselectedId, q.data, unclaimed]);

  const selectedSlot = useMemo(
    () => unclaimed.find((p) => p.id === selectedId) ?? null,
    [unclaimed, selectedId],
  );
  const chosenTeam = useMemo(
    () => myTeams.find((t) => t.id === existingTeamId) ?? null,
    [myTeams, existingTeamId],
  );
  const teamsByOrganization = useMemo(() => {
    const groups = new Map<string, { label: string; teams: ManageableTeam[] }>();
    for (const team of myTeams) {
      const key = team.organizationId ?? `solo:${team.id}`;
      const label = team.organizationName ?? "Independent teams";
      const existing = groups.get(key);
      if (existing) existing.teams.push(team);
      else groups.set(key, { label, teams: [team] });
    }
    return Array.from(groups.entries())
      .map(([key, group]) => ({ key, ...group }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [myTeams]);
  const clubOrganizations = useMemo(
    () =>
      teamsByOrganization.filter(
        (group) =>
          !group.key.startsWith("solo:") &&
          group.teams.some((team) => team.canManageOrganization),
      ),
    [teamsByOrganization],
  );
  const bulkClub = useMemo(
    () =>
      clubOrganizations.find((group) => group.key === bulkOrganizationId) ??
      null,
    [clubOrganizations, bulkOrganizationId],
  );
  const bulkRows = useMemo(
    () =>
      (bulkClub?.teams ?? [])
        .map((team) => {
          const participantId = bulkAssignments[team.id];
          const participant =
            unclaimed.find((slot) => slot.id === participantId) ?? null;
          return {
            team,
            participant,
            mismatch:
              !!participant &&
              !namesRoughlyMatch(participant.name, team.name),
          };
        })
        .filter((row) => row.participant != null),
    [bulkClub, bulkAssignments, unclaimed],
  );
  const bulkHasUnconfirmedMismatch = bulkRows.some(
    (row) => row.mismatch && !bulkMismatchConfirmed[row.team.id],
  );
  const nameMismatch =
    !!selectedSlot &&
    !!chosenTeam &&
    !namesRoughlyMatch(selectedSlot.name, chosenTeam.name);

  // Any change of slot or team resets the acknowledgement.
  useEffect(() => {
    setMismatchConfirmed(false);
  }, [selectedId, existingTeamId]);

  // The picked slot name IS the team name from the uploaded schedule — sync it
  // on every pick (unless the coach has manually typed a different name).
  const [nameEdited, setNameEdited] = useState(false);
  function pick(p: Participant) {
    setSelectedId(p.id);
    if (!nameEdited) setTeamName(p.name);
  }

  async function submit() {
    if (!selectedId) {
      toast({ title: "Pick a team name to claim first.", variant: "destructive" });
      return;
    }
    if (mode === "existing" && !existingTeamId) {
      toast({ title: "Pick which of your teams is claiming this slot.", variant: "destructive" });
      return;
    }
    if (mode === "existing" && nameMismatch && !mismatchConfirmed) {
      toast({
        title: "The names don't match — confirm this is your team's slot first.",
        variant: "destructive",
      });
      return;
    }
    if (mode === "new" && !teamName.trim()) {
      toast({ title: "Give your team a name.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await customFetch<{
        ok: boolean;
        teamId: string;
        pendingApproval?: boolean;
      }>(
        `/api/v1/competitions/${encodeURIComponent(slug)}/claim`,
        {
          method: "POST",
          body: JSON.stringify(
            mode === "existing"
              ? { participantId: selectedId, existingTeamId }
              : {
                  participantId: selectedId,
                  teamName: teamName.trim(),
                  sport: sport.trim() || null,
                },
          ),
        },
      );
      toast({
        title: res.pendingApproval
          ? "Claim submitted — the organizer will review it shortly."
          : "Your team is in! Welcome to the competition.",
      });
      navigate(
        mode === "existing"
          ? `/teams/${res.teamId}`
          : `/teams/${res.teamId}?welcome=1`,
      );
    } catch (err) {
      toast({
        title: (err as Error)?.message ?? "Couldn't claim that slot",
        variant: "destructive",
      });
      void q.refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitBulkClaims() {
    if (!bulkOrganizationId || bulkRows.length === 0) {
      toast({
        title: "Match at least one club team to a competition slot.",
        variant: "destructive",
      });
      return;
    }
    if (bulkHasUnconfirmedMismatch) {
      toast({
        title: "Confirm every name mismatch before submitting.",
        variant: "destructive",
      });
      return;
    }
    setBulkSubmitting(true);
    setBulkResults([]);
    try {
      const response = await customFetch<{
        ok: boolean;
        succeeded: number;
        failed: number;
        results: BulkClaimResult[];
      }>(`/api/v1/competitions/${encodeURIComponent(slug)}/claims/bulk`, {
        method: "POST",
        body: JSON.stringify({
          organizationId: bulkOrganizationId,
          assignments: bulkRows.map((row) => ({
            participantId: row.participant!.id,
            teamId: row.team.id,
            nameMismatchAcknowledged:
              bulkMismatchConfirmed[row.team.id] === true,
          })),
        }),
      });
      setBulkResults(response.results);
      const successfulTeamIds = new Set(
        response.results
          .filter((result) => result.ok)
          .map((result) => result.teamId),
      );
      if (successfulTeamIds.size > 0) {
        setBulkAssignments((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([teamId]) => !successfulTeamIds.has(teamId),
            ),
          ),
        );
      }
      toast({
        title:
          response.failed === 0
            ? `${response.succeeded} team${response.succeeded === 1 ? "" : "s"} matched successfully.`
            : `${response.succeeded} matched; ${response.failed} need attention.`,
        variant: response.succeeded === 0 ? "destructive" : "default",
      });
      await q.refetch();
    } catch (error) {
      toast({
        title: (error as Error)?.message ?? "Couldn't submit club matches.",
        variant: "destructive",
      });
    } finally {
      setBulkSubmitting(false);
    }
  }

  if (q.isLoading || meLoading || !me) {
    return (
      <div className="min-h-screen max-w-2xl mx-auto p-6 space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    const message =
      (q.error as Error | null)?.message ??
      "This competition link is invalid or no longer available.";
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6">
        <Card className="rounded-xl border-border">
          <CardContent className="p-6 text-center space-y-2">
            <h1 className="text-xl font-black tracking-tight">
              Competition unavailable
            </h1>
            <p className="text-sm text-muted-foreground">{message}</p>
            <Link href="/">
              <Button variant="outline" className="font-bold mt-2">
                Go home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { tournament: t } = q.data;

  return (
    <div className="min-h-screen max-w-2xl mx-auto p-6 space-y-6">
      <div className="space-y-1">
        <Link href={`/c/${slug}`}>
          <span className="text-xs text-muted-foreground hover:underline cursor-pointer">
            ← Back to {t.name}
          </span>
        </Link>
        <h1 className="text-2xl font-black tracking-tight">
          Claim competition teams
        </h1>
        <p className="text-sm text-muted-foreground">
          Coaches can claim their own team. Organization admins can coordinate
          claims for every team in their club, even when they do not coach each
          team.{" "}
          <span data-testid="text-signup-approval-mode">
            {t.autoApproveClaims
              ? "Claims are instant — your spot is locked in as soon as you claim it."
              : "The organizer reviews each claim before your spot is locked in."}
          </span>
        </p>
      </div>

      {clubOrganizations.length > 0 && !preselectedSlot ? (
        <Card className="rounded-xl border-primary/30" data-testid="card-bulk-club-match">
          <CardContent className="p-6 space-y-5">
            <div>
              <h2 className="text-lg font-black tracking-tight">
                Match a whole club
              </h2>
              <p className="text-sm text-muted-foreground">
                Choose a club, pair as many of its teams as you want, then
                review every assignment before submitting.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Managed organization</Label>
              <Select
                value={bulkOrganizationId}
                onValueChange={(value) => {
                  setBulkOrganizationId(value);
                  const organization = clubOrganizations.find(
                    (group) => group.key === value,
                  );
                  setBulkAssignments(
                    suggestDistinctNameMatches(
                      organization?.teams ?? [],
                      unclaimed,
                    ),
                  );
                  setBulkMismatchConfirmed({});
                  setBulkResults([]);
                }}
              >
                <SelectTrigger data-testid="select-bulk-organization">
                  <SelectValue placeholder="Choose a club" />
                </SelectTrigger>
                <SelectContent>
                  {clubOrganizations.map((organization) => (
                    <SelectItem
                      key={organization.key}
                      value={organization.key}
                      data-testid={`option-bulk-organization-${organization.key}`}
                    >
                      {organization.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {bulkClub ? (
              <div className="space-y-3" data-testid="list-bulk-team-matches">
                {bulkClub.teams.map((team) => {
                  const selectedParticipantId =
                    bulkAssignments[team.id] ?? "__none__";
                  const usedByAnotherTeam = new Set(
                    Object.entries(bulkAssignments)
                      .filter(([teamId]) => teamId !== team.id)
                      .map(([, participantId]) => participantId),
                  );
                  return (
                    <div
                      key={team.id}
                      className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center"
                      data-testid={`row-bulk-team-${team.id}`}
                    >
                      <div className="min-w-0">
                        <p className="font-bold truncate">{team.name}</p>
                        {team.sport ? (
                          <p className="text-xs text-muted-foreground truncate">
                            {team.sport}
                          </p>
                        ) : null}
                      </div>
                      <Select
                        value={selectedParticipantId}
                        onValueChange={(value) => {
                          setBulkAssignments((current) => {
                            if (value === "__none__") {
                              const next = { ...current };
                              delete next[team.id];
                              return next;
                            }
                            return { ...current, [team.id]: value };
                          });
                          setBulkMismatchConfirmed((current) => ({
                            ...current,
                            [team.id]: false,
                          }));
                        }}
                      >
                        <SelectTrigger data-testid={`select-bulk-slot-${team.id}`}>
                          <SelectValue placeholder="Choose competition slot" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Not matching now</SelectItem>
                          {unclaimed.map((slot) => (
                            <SelectItem
                              key={slot.id}
                              value={slot.id}
                              disabled={usedByAnotherTeam.has(slot.id)}
                            >
                              {slot.name} · {groupLabel(slot.division, slot.bracket)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {bulkRows.length > 0 ? (
              <div className="space-y-3 rounded-lg bg-muted/50 p-4" data-testid="review-bulk-matches">
                <p className="text-sm font-black">Review assignments</p>
                {bulkRows.map(({ team, participant, mismatch }) => (
                  <div key={team.id} className="space-y-2 text-sm">
                    <p data-testid={`text-bulk-review-${team.id}`}>
                      <span className="font-bold">{team.name}</span>
                      {" → "}
                      <span className="font-bold">{participant!.name}</span>
                    </p>
                    {mismatch ? (
                      <label className="flex items-start gap-2 text-xs cursor-pointer">
                        <Checkbox
                          checked={bulkMismatchConfirmed[team.id] === true}
                          onCheckedChange={(checked) =>
                            setBulkMismatchConfirmed((current) => ({
                              ...current,
                              [team.id]: checked === true,
                            }))
                          }
                          data-testid={`checkbox-bulk-mismatch-${team.id}`}
                        />
                        <span>
                          These names differ. I confirm this is the correct
                          competition slot for {team.name}.
                        </span>
                      </label>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {bulkResults.length > 0 ? (
              <div className="space-y-2" data-testid="status-bulk-results">
                {bulkResults.map((result) => {
                  const team = myTeams.find((item) => item.id === result.teamId);
                  const slot = q.data?.participants.find(
                    (item) => item.id === result.participantId,
                  );
                  return (
                    <p
                      key={`${result.teamId}:${result.participantId}`}
                      className={`text-sm font-bold ${result.ok ? "text-primary" : "text-destructive"}`}
                      data-testid={`status-bulk-result-${result.teamId}`}
                    >
                      {team?.name ?? "Team"} → {slot?.name ?? "slot"}:{" "}
                      {result.ok
                        ? result.pendingApproval
                          ? "Submitted for organizer approval"
                          : "Matched"
                        : result.error ?? "Needs attention"}
                    </p>
                  );
                })}
              </div>
            ) : null}

            <Button
              className="w-full font-bold"
              disabled={
                bulkSubmitting ||
                bulkRows.length === 0 ||
                bulkHasUnconfirmedMismatch
              }
              onClick={submitBulkClaims}
              data-testid="btn-submit-bulk-claims"
            >
              {bulkSubmitting
                ? "Submitting club matches…"
                : t.autoApproveClaims
                  ? `Match ${bulkRows.length} team${bulkRows.length === 1 ? "" : "s"}`
                  : `Submit ${bulkRows.length} claim${bulkRows.length === 1 ? "" : "s"} for approval`}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Deep-linked claim from the competition page — show WHICH slot is
          being claimed up top instead of making the coach re-pick it. */}
      {preselectedSlot ? (
        <Card
          className="rounded-xl border-primary/40 bg-primary/5"
          data-testid="card-claiming-slot"
        >
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                You're claiming
              </p>
              <p className="text-lg font-black tracking-tight break-words">
                {preselectedSlot.name}
              </p>
              <p className="text-xs text-muted-foreground break-words">
                {groupLabel(preselectedSlot.division, preselectedSlot.bracket)}
              </p>
            </div>
            <Link href={`/c/${slug}`}>
              <Button
                size="sm"
                variant="outline"
                className="font-bold shrink-0"
                data-testid="btn-change-slot"
              >
                Not your team?
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl border-border" data-testid="card-pick-slot">
          <CardContent className="p-6 space-y-3">
            <h2 className="text-lg font-black tracking-tight">
              Pick your team name
            </h2>
            {preselectedTaken ? (
              <p className="text-sm font-bold text-destructive">
                The team you clicked is already taken or awaiting organizer
                approval — pick another name below.
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              Click your team's name in this list — or write it in below if you
              don't see it.
            </p>
            {unclaimed.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every team name in this competition has already been claimed.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {unclaimed.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p)}
                    className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                      selectedId === p.id
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-border hover:border-primary/50"
                    }`}
                    data-testid={`btn-pick-${p.id}`}
                  >
                    <p className="text-sm font-bold truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {groupLabel(p.division, p.bracket)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-xl border-border" data-testid="card-team-details">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-lg font-black tracking-tight">
            Choose the Kinectem team
          </h2>

          {myTeams.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode("existing")}
                className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                  mode === "existing"
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-primary/50"
                }`}
                data-testid="btn-mode-existing"
              >
                <p className="text-sm font-bold">Use an existing team</p>
                <p className="text-xs text-muted-foreground">
                  Club admins can choose any team in organizations they manage.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setMode("new")}
                className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                  mode === "new"
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-primary/50"
                }`}
                data-testid="btn-mode-new"
              >
                <p className="text-sm font-bold">Create a new team</p>
                <p className="text-xs text-muted-foreground">
                  Set up a temporary team page just for this competition.
                </p>
              </button>
            </div>
          )}

          {mode === "existing" && myTeams.length > 0 ? (
            <div className="space-y-3">
              <div>
                <Label>Which team should this slot link to?</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Organization admins see the full team list for each club they
                  manage, not only teams they personally coach.
                </p>
              </div>
              <div className="space-y-4" data-testid="list-manageable-teams">
                {teamsByOrganization.map((group) => (
                  <section key={group.key} className="space-y-2">
                    <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">
                      {group.label}
                    </p>
                    <div className="grid gap-2">
                      {group.teams.map((tm) => (
                        <button
                          key={tm.id}
                          type="button"
                          onClick={() => setExistingTeamId(tm.id)}
                          className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                            existingTeamId === tm.id
                              ? "border-primary ring-2 ring-primary/30"
                              : "border-border hover:border-primary/50"
                          }`}
                          data-testid={`btn-pick-team-${tm.id}`}
                        >
                          <p className="text-sm font-bold truncate">{tm.name}</p>
                          {tm.sport && (
                            <p className="text-xs text-muted-foreground truncate">
                              {tm.sport}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              {selectedSlot && chosenTeam && (
                <div
                  className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-2"
                  data-testid="text-claim-confirm"
                >
                  <p>
                    You're claiming{" "}
                    <span className="font-bold">{selectedSlot.name}</span> as{" "}
                    <span className="font-bold">{chosenTeam.name}</span> — that
                    means claiming their schedule: these competition games are
                    added to your team's schedule.
                  </p>
                  <p>
                    Your existing team page{" "}
                    <span className="font-bold">won&apos;t change</span> — you're
                    just getting these specific games added in competition form.
                    Game recaps you write for them may be shared and featured on
                    the competition page. You can edit everything from your team
                    page once you're in.
                  </p>
                  <p data-testid="text-existing-approval-mode">
                    {t.autoApproveClaims
                      ? "Your claim is instant — this slot is yours the moment you claim it."
                      : "The organizer will review your claim — your spot is locked in once they approve it."}
                  </p>
                  {nameMismatch && (
                    <label
                      className="flex items-start gap-2 text-foreground cursor-pointer"
                      data-testid="label-mismatch-confirm"
                    >
                      <Checkbox
                        checked={mismatchConfirmed}
                        onCheckedChange={(v) => setMismatchConfirmed(v === true)}
                        data-testid="checkbox-mismatch-confirm"
                      />
                      <span>
                        These names don't match — I confirm{" "}
                        <span className="font-bold">{selectedSlot.name}</span> in
                        this competition is my team{" "}
                        <span className="font-bold">{chosenTeam.name}</span>.
                      </span>
                    </label>
                  )}
                </div>
              )}
              <Button
                className="font-bold w-full"
                disabled={
                  submitting ||
                  !selectedId ||
                  !existingTeamId ||
                  (nameMismatch && !mismatchConfirmed)
                }
                onClick={submit}
                data-testid="btn-submit-signup"
              >
                {submitting
                  ? "Claiming…"
                  : t.autoApproveClaims
                    ? "Claim slot for this team"
                    : "Submit claim for approval"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="teamName">Team name</Label>
                <Input
                  id="teamName"
                  value={teamName}
                  onChange={(e) => {
                    setNameEdited(true);
                    setTeamName(e.target.value);
                  }}
                  placeholder="e.g. Riverside United 14U"
                  maxLength={120}
                  data-testid="input-team-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sport">Sport (optional)</Label>
                <Input
                  id="sport"
                  value={sport}
                  onChange={(e) => setSport(e.target.value)}
                  placeholder="e.g. Soccer"
                  maxLength={100}
                  data-testid="input-sport"
                />
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p>
                  Claiming this slot claims its{" "}
                  <span className="font-bold">schedule</span> — the competition's
                  games appear on your new Kinectem team page, where you can
                  edit all of your team's info once inside.
                </p>
                <p>
                  This is a <span className="font-bold">temporary team</span> with
                  no organization. You can write recaps while the competition is
                  active. After it ends, create or join a real organization to
                  keep full access.
                </p>
                <p data-testid="text-new-approval-mode">
                  {t.autoApproveClaims
                    ? "Your claim is instant — this slot is yours the moment you claim it."
                    : "The organizer will review your claim — your spot is locked in once they approve it."}
                </p>
              </div>
              <Button
                className="font-bold w-full"
                disabled={submitting || !selectedId}
                onClick={submit}
                data-testid="btn-submit-signup"
              >
                {submitting
                  ? "Setting up your team…"
                  : t.autoApproveClaims
                    ? "Create team & claim slot"
                    : "Create team & submit claim"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
