import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getListTeamMembersQueryKey,
  getListRosterInvitesQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-errors";
import {
  groupCoachInviteAssignments,
  type CoachInviteAssignment,
} from "@/lib/coach-invite-grouping";
import {
  Building2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Mail,
  Bell,
  Clock,
  Copy,
  UserCheck,
  Plus,
} from "lucide-react";

// Task #835 — bulk-invite one coach per existing team from the org page.
// Lists every active team with an email field; saving fans out to the
// standard POST /teams/:teamId/invites endpoint with the coach role (email
// invite for unknown addresses, in-app notification for existing accounts —
// identical to the single-team flow), then shows per-row outcomes with a
// copy-link fallback for failed email sends.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CoachStatusRow = {
  teamId: string;
  hasCoach: boolean;
  hasPendingCoachInvite: boolean;
};

type RowResult = {
  teamId: string;
  teamName: string;
  email: string;
  teamIds?: string[];
  grouped?: boolean;
  // emailed: invite email handed to SendGrid; notified: existing account got
  // an in-app notification (no email attempted); emailFailed: invite was
  // created but the email couldn't be sent (copy-link fallback shown);
  // error: the invite request itself failed.
  status:
    | "emailed"
    | "notified"
    | "emailFailed"
    | "alreadyActive"
    | "autoApproved"
    | "alreadyPending"
    | "error";
  outcome?: "invited" | "already_active" | "auto_approved" | "already_pending";
  teamOutcomes?: Array<{
    teamId: string;
    outcome: "invited" | "already_active" | "auto_approved" | "already_pending";
  }>;
  reason?: string;
  acceptUrl?: string;
};

export function BulkAddCoachesDialog({
  orgId,
  teams,
  open,
  onOpenChange,
}: {
  orgId: string;
  teams: Array<{ id: string; name: string; sport?: string | null }>;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Additional coach emails per team ("+ Add another coach to this team").
  const [extraDrafts, setExtraDrafts] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [results, setResults] = useState<RowResult[] | null>(null);

  // Per-team coach status (extra endpoint outside the locked openapi.yaml).
  // Best-effort: if it fails, the dialog still works, just without the
  // "has coach / invite pending" indicators.
  const coachStatus = useQuery({
    queryKey: ["org-coach-status", orgId],
    enabled: open && !!orgId,
    queryFn: () =>
      customFetch<{ data: CoachStatusRow[] }>(
        `/api/v1/organizations/${orgId}/coach-status`,
        { method: "GET" },
      ),
  });
  const statusByTeam = useMemo(() => {
    const m = new Map<string, CoachStatusRow>();
    for (const r of coachStatus.data?.data ?? []) m.set(r.teamId, r);
    return m;
  }, [coachStatus.data]);

  useEffect(() => {
    if (!open) {
      setDrafts({});
      setExtraDrafts({});
      setResults(null);
      setProgress(null);
    }
  }, [open]);

  // Every email typed for a team (primary + extras), de-duped per team.
  const emailsForTeam = (teamId: string): string[] => {
    const all = [drafts[teamId] ?? "", ...(extraDrafts[teamId] ?? [])]
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return Array.from(new Set(all));
  };
  const invalidTeams = useMemo(
    () =>
      teams.filter((t) =>
        [drafts[t.id] ?? "", ...(extraDrafts[t.id] ?? [])].some((raw) => {
          const e = raw.trim();
          return e.length > 0 && !EMAIL_RE.test(e);
        }),
      ),
    [teams, drafts, extraDrafts],
  );
  const filledCount = useMemo(
    () => teams.reduce((n, t) => n + emailsForTeam(t.id).length, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teams, drafts, extraDrafts],
  );

  const handleOpenChange = (v: boolean) => {
    if (busy) return; // don't let the dialog close mid-run
    onOpenChange(v);
  };

  const onSend = async () => {
    if (busy) return;
    if (invalidTeams.length > 0) {
      toast({
        title: "Fix the invalid emails before sending",
        variant: "destructive",
      });
      return;
    }
    const rows: CoachInviteAssignment[] = teams.flatMap((t) =>
      emailsForTeam(t.id).map((email) => ({ team: t, email })),
    ).map(({ team, email }) => ({
      teamId: team.id,
      teamName: team.name,
      email,
    }));
    if (rows.length === 0) {
      toast({
        title: "Enter at least one coach email",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    setResults(null);
    const emailGroups = groupCoachInviteAssignments(rows);
    setProgress({ done: 0, total: emailGroups.length });
    const collected: RowResult[] = [];
    // Sequential on purpose — keeps rate limiting predictable and lets a
    // mid-run failure keep the successes. Each email group produces one
    // outcome, even when it covers several teams.
    for (let i = 0; i < emailGroups.length; i++) {
      const group = emailGroups[i];
      const grouped = group.assignments.length > 1;
      const teamNames = group.assignments.map((a) => a.teamName);
      const teamIds = group.assignments.map((a) => a.teamId);
      try {
        const resp =
          grouped
            ? await customFetch<{
                outcome?: "invited" | "already_active" | "auto_approved" | "already_pending";
                data: Array<{
                  emailSent?: boolean | null;
                  acceptUrl?: string;
                  notified?: boolean;
                  outcome?: "invited" | "already_active" | "auto_approved" | "already_pending";
                  teamOutcomes?: Array<{
                    teamId: string;
                    outcome: "invited" | "already_active" | "auto_approved" | "already_pending";
                  }>;
                }>;
              }>(`/api/v1/organizations/${orgId}/coach-invites`, {
                method: "POST",
                body: JSON.stringify({
                  assignments: group.assignments.map(({ teamId, email }) => ({
                    teamId,
                    email,
                  })),
                }),
              })
            : await customFetch<Record<string, unknown>>(
                `/api/v1/teams/${teamIds[0]}/invites`,
                {
                  method: "POST",
                  body: JSON.stringify({ email: group.email, position: "coach" }),
                },
              );
        // `emailSent` + `acceptUrl` are appended by the server outside the
        // locked openapi.yaml (same pattern as the single-invite flow).
        const groupedResponse = grouped
          ? (resp as {
              outcome?: "invited" | "already_active" | "auto_approved" | "already_pending";
              data: Array<{
                emailSent?: boolean | null;
                acceptUrl?: string;
                notified?: boolean;
                outcome?: "invited" | "already_active" | "auto_approved" | "already_pending";
                teamOutcomes?: Array<{
                  teamId: string;
                  outcome: "invited" | "already_active" | "auto_approved" | "already_pending";
                }>;
              }>;
            })
          : null;
        const extra = (grouped
          ? groupedResponse?.data?.[0] ?? {}
          : resp) as {
          emailSent?: boolean | null;
          acceptUrl?: string;
          outcome?: "invited" | "already_active" | "auto_approved" | "already_pending";
          teamOutcomes?: Array<{
            teamId: string;
            outcome: "invited" | "already_active" | "auto_approved" | "already_pending";
          }>;
        };
        const overallOutcome =
          extra.outcome ?? groupedResponse?.outcome ?? "invited";
        const teamOutcomes = extra.teamOutcomes;
        const hasTeamInvite =
          teamOutcomes?.some((item) => item.outcome === "invited") ?? false;
        const outcome = teamOutcomes
          ? hasTeamInvite
            ? "invited"
            : teamOutcomes.some((item) => item.outcome === "already_pending")
              ? "already_pending"
              : teamOutcomes.some((item) => item.outcome === "auto_approved")
                ? "auto_approved"
                : teamOutcomes.some((item) => item.outcome === "already_active")
                  ? "already_active"
                  : overallOutcome
          : overallOutcome;
        collected.push({
          teamId: teamIds[0],
          teamIds,
          teamName: teamNames.join(", "),
          email: group.email,
          grouped,
          status:
            outcome === "auto_approved"
              ? "autoApproved"
              : outcome === "already_active"
                ? "alreadyActive"
                : outcome === "already_pending"
                  ? "alreadyPending"
                  : extra.emailSent === true
                  ? "emailed"
                  : extra.emailSent === false
                    ? "emailFailed"
                    : "notified",
          outcome,
          teamOutcomes,
          acceptUrl: extra.acceptUrl,
        });
      } catch (err) {
        collected.push({
          teamId: teamIds[0],
          teamIds,
          teamName: teamNames.join(", "),
          email: group.email,
          grouped,
          status: "error",
          reason: apiErrorMessage(err) ?? "Couldn't send the invite",
        });
      }
      setProgress({ done: i + 1, total: emailGroups.length });
      setResults([...collected]);
    }
    setBusy(false);
    // Refresh each touched team's staff/invite lists and the indicators.
    const touchedTeams = teams.filter((team) =>
      rows.some((row) => row.teamId === team.id),
    );
    await Promise.all([
      ...touchedTeams.flatMap((t) => [
        qc.invalidateQueries({ queryKey: getListTeamMembersQueryKey(t.id) }),
        qc.invalidateQueries({ queryKey: getListRosterInvitesQueryKey(t.id) }),
      ]),
      qc.invalidateQueries({ queryKey: ["org-coach-status", orgId] }),
    ]);
    const failed = collected.filter((s) => s.status === "error").length;
    const emailFailed = collected.filter((s) => s.status === "emailFailed").length;
    const ok = collected.length - failed;
    const invitationCount = collected.filter(
      (r) => r.teamOutcomes
        ? r.teamOutcomes.some((item) => item.outcome === "invited")
        : r.status === "emailed" ||
          r.status === "notified" ||
          r.status === "emailFailed",
    ).length;
    const countTeamOutcome = (
      outcome: "auto_approved" | "already_active" | "already_pending",
      status: RowResult["status"],
    ) =>
      collected.reduce(
        (count, row) =>
          count +
          (row.teamOutcomes
            ? row.teamOutcomes.filter((item) => item.outcome === outcome).length
            : row.status === status
              ? 1
              : 0),
        0,
      );
    const autoApproved = countTeamOutcome("auto_approved", "autoApproved");
    const alreadyActive = countTeamOutcome("already_active", "alreadyActive");
    const alreadyPending = countTeamOutcome("already_pending", "alreadyPending");
    const outcomeNotes = [
      invitationCount > 0 && (autoApproved > 0 || alreadyActive > 0 || alreadyPending > 0)
        ? `${invitationCount} new invitation${invitationCount === 1 ? "" : "s"} sent.`
        : "",
      autoApproved > 0
        ? "Your team assignment is already approved because you’re an organization admin. You don’t need to accept an invitation."
        : "",
      alreadyActive > 0
        ? `${alreadyActive} coach assignment${alreadyActive === 1 ? " is" : "s are"} already active; no invitation was sent.`
        : "",
      alreadyPending > 0
        ? `${alreadyPending} coach invitation${alreadyPending === 1 ? " is" : "s are"} already pending; no new invitation was sent.`
        : "",
    ].filter(Boolean).join(" ");
    if (failed === 0 && emailFailed === 0) {
      toast({
        title:
          ok === 1
            ? autoApproved || alreadyActive || alreadyPending
              ? "Coach assignment updated"
              : "Coach invite sent!"
            : autoApproved || alreadyActive || alreadyPending
              ? `${ok} coach assignments processed`
              : `${ok} coach invitations sent!`,
        description: outcomeNotes || undefined,
      });
    } else if (failed === 0) {
      toast({
        title: `${invitationCount} invite${invitationCount === 1 ? "" : "s"} created, ${emailFailed} email${emailFailed === 1 ? "" : "s"} didn't send`,
        description: `${outcomeNotes ? `${outcomeNotes} ` : ""}Copy invite links below and share them directly.`,
        variant: "destructive",
      });
    } else {
      toast({
        title: `${ok} completed, ${failed} failed`,
        description: "Each row's outcome is listed below.",
        variant: "destructive",
      });
    }
  };

  const copyLink = (url: string) =>
    navigator.clipboard
      .writeText(url)
      .then(() => toast({ title: "Invite link copied" }))
      .catch(() =>
        toast({ title: "Couldn't copy link", variant: "destructive" }),
      );

  const done = !busy && results !== null;
  const hasEmailedInvites =
    results?.some((result) => result.status === "emailed") ?? false;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="dialog-bulk-add-coaches"
      >
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            Bulk add coaches
          </DialogTitle>
          <DialogDescription>
            Add a coach email next to any team and send every invite at once.
            Rows left blank are skipped. When the same new coach is assigned to
            multiple teams, they receive one secure invitation listing them all.
          </DialogDescription>
        </DialogHeader>

        {teams.length === 0 ? (
          <div className="p-6 text-center" data-testid="bulk-coaches-empty">
            <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No teams yet — create your teams first, then come back to add
              their coaches.
            </p>
          </div>
        ) : !done ? (
          <div className="space-y-3">
            {teams.map((t) => {
              const st = statusByTeam.get(t.id);
              const value = drafts[t.id] ?? "";
              const invalid =
                value.trim().length > 0 && !EMAIL_RE.test(value.trim());
              return (
                <div
                  key={t.id}
                  className="space-y-1"
                  data-testid={`row-bulk-coach-${t.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-sm truncate">{t.name}</span>
                    {t.sport && (
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase tracking-wider font-bold shrink-0"
                      >
                        {t.sport}
                      </Badge>
                    )}
                    {st?.hasCoach && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] uppercase tracking-wider font-bold shrink-0 gap-1"
                        data-testid={`badge-has-coach-${t.id}`}
                      >
                        <UserCheck className="w-3 h-3" /> Has coach
                      </Badge>
                    )}
                    {st?.hasPendingCoachInvite && (
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase tracking-wider font-bold shrink-0 gap-1"
                        data-testid={`badge-pending-coach-${t.id}`}
                      >
                        <Clock className="w-3 h-3" /> Invite pending
                      </Badge>
                    )}
                  </div>
                  <Input
                    type="email"
                    placeholder="coach@example.com"
                    value={value}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [t.id]: e.target.value }))
                    }
                    disabled={busy}
                    aria-invalid={invalid || undefined}
                    className={invalid ? "border-destructive" : undefined}
                    data-testid={`input-bulk-coach-${t.id}`}
                  />
                  {invalid && (
                    <p
                      className="text-xs font-medium text-destructive"
                      data-testid={`error-bulk-coach-${t.id}`}
                    >
                      "{value.trim()}" doesn't look like an email
                    </p>
                  )}
                  {(extraDrafts[t.id] ?? []).map((extra, j) => {
                    const extraInvalid =
                      extra.trim().length > 0 && !EMAIL_RE.test(extra.trim());
                    return (
                      <div key={j} className="space-y-1">
                        <div className="flex items-center gap-1">
                          <Input
                            type="email"
                            placeholder="another-coach@example.com"
                            value={extra}
                            onChange={(e) =>
                              setExtraDrafts((d) => {
                                const list = [...(d[t.id] ?? [])];
                                list[j] = e.target.value;
                                return { ...d, [t.id]: list };
                              })
                            }
                            disabled={busy}
                            aria-invalid={extraInvalid || undefined}
                            className={
                              extraInvalid ? "border-destructive" : undefined
                            }
                            data-testid={`input-bulk-coach-extra-${t.id}-${j}`}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setExtraDrafts((d) => {
                                const list = [...(d[t.id] ?? [])];
                                list.splice(j, 1);
                                return { ...d, [t.id]: list };
                              })
                            }
                            disabled={busy}
                            aria-label="Remove coach"
                            className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                            data-testid={`btn-bulk-coach-remove-extra-${t.id}-${j}`}
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                        {extraInvalid && (
                          <p
                            className="text-xs font-medium text-destructive"
                            data-testid={`error-bulk-coach-extra-${t.id}-${j}`}
                          >
                            "{extra.trim()}" doesn't look like an email
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      setExtraDrafts((d) => ({
                        ...d,
                        [t.id]: [...(d[t.id] ?? []), ""],
                      }))
                    }
                    disabled={busy}
                    className="flex items-center gap-1 px-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                    data-testid={`btn-bulk-coach-add-extra-${t.id}`}
                  >
                    <Plus className="w-3 h-3" />
                    Add another coach to this team
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {busy && progress && (
          <p
            className="text-xs font-medium text-muted-foreground"
            data-testid="text-bulk-coach-progress"
          >
            Sending {progress.done}/{progress.total}…
          </p>
        )}

        {results && results.length > 0 && (
          <div
            className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border"
            data-testid="list-bulk-coach-results"
          >
            {results.map((r, i) => (
              <div
                key={`${r.teamId}-${i}`}
                className="flex items-start gap-2 px-3 py-2 text-xs"
                data-testid={`result-bulk-coach-${r.teamId}-${i}`}
              >
                {r.status === "error" ? (
                  <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                ) : r.status === "emailFailed" ? (
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                ) : r.status === "alreadyActive" || r.status === "autoApproved" ? (
                  <UserCheck className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                ) : r.status === "alreadyPending" ? (
                  <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                ) : r.status === "notified" ? (
                  <Bell className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate">
                    {r.teamName}{" "}
                    <span className="font-medium text-muted-foreground">
                      → {r.email}
                    </span>
                  </p>
                  {r.status === "emailed" && (
                    <p className="text-muted-foreground flex items-center gap-1">
                      <Mail className="w-3 h-3" />{" "}
                      {r.grouped && (!r.teamOutcomes || r.teamOutcomes.every((item) => item.outcome === "invited"))
                        ? "One invite email covers these teams"
                        : r.teamOutcomes?.length
                          ? "Invite outcomes are listed per team below"
                          : "Invite email sent"}
                    </p>
                  )}
                  {r.status === "notified" && (
                    <p className="text-muted-foreground">
                      Has a Kinectem account — notified in-app
                    </p>
                  )}
                  {r.status === "alreadyActive" && !r.teamOutcomes && (
                    <p className="text-muted-foreground">
                      Already active on the roster — no invite sent.
                    </p>
                  )}
                  {r.status === "alreadyPending" && !r.teamOutcomes && (
                    <p className="text-muted-foreground">
                      An invitation is already pending — no new invitation was sent.
                    </p>
                  )}
                  {r.status === "autoApproved" && !r.teamOutcomes && (
                    <p className="text-muted-foreground">
                      Your team assignment is already approved because you’re an
                      organization admin. You don’t need to accept an invitation.
                    </p>
                  )}
                  {r.teamOutcomes?.map((teamOutcome) => {
                    const teamName = teams.find((team) => team.id === teamOutcome.teamId)?.name ?? teamOutcome.teamId;
                    return (
                      <p key={teamOutcome.teamId} className="text-muted-foreground">
                        {teamName}: {teamOutcome.outcome === "auto_approved"
                          ? "Your team assignment is already approved because you’re an organization admin. You don’t need to accept an invitation."
                          : teamOutcome.outcome === "already_active"
                            ? "Already active on the roster — no invite sent."
                            : teamOutcome.outcome === "already_pending"
                              ? "Invitation already pending — no new invitation sent."
                              : "Invitation sent."}
                      </p>
                    );
                  })}
                  {r.status === "emailFailed" && (
                    <div className="space-y-1">
                      <p className="text-muted-foreground">
                        Invite created, but the email didn't send — share the
                        link directly:
                      </p>
                      {r.acceptUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[11px] font-bold"
                          onClick={() => copyLink(r.acceptUrl!)}
                          data-testid={`btn-copy-invite-link-${r.teamId}-${i}`}
                        >
                          <Copy className="w-3 h-3 mr-1" /> Copy invite link
                        </Button>
                      )}
                    </div>
                  )}
                  {r.status === "error" && r.reason && (
                    <p className="text-muted-foreground">{r.reason}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {done && hasEmailedInvites && (
          <div
            className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
            role="status"
            data-testid="bulk-coaches-junk-folder-reminder"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1 text-sm leading-relaxed">
              <p className="font-bold">
                Invite emails can land in Junk or Spam.
              </p>
              <p>
                Follow up with each coach and ask them to check their{" "}
                <strong>Junk or Spam folder</strong>. If the invite is still not
                there, open their individual team page, go to{" "}
                <strong>Pending invites</strong>, copy the invite link, and send
                it to the coach directly.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {done || teams.length === 0 ? (
            <Button
              type="button"
              variant="brand"
              onClick={() => onOpenChange(false)}
              data-testid="btn-bulk-coaches-done"
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={busy}
                data-testid="btn-bulk-coaches-cancel"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="brand"
                onClick={onSend}
                disabled={busy || filledCount === 0 || invalidTeams.length > 0}
                data-testid="btn-bulk-coaches-send"
              >
                {busy
                  ? "Sending…"
                  : `Send ${filledCount > 0 ? filledCount : ""} invite${filledCount === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
