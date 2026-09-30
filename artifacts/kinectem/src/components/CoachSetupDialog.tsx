import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, X } from "lucide-react";
import {
  parseStagedEmails,
  STAGED_EMAIL_RE,
  useStagedCoaches,
  type StagedCoachRow,
} from "@/components/StageCoachesDialog";
import {
  groupCoachInviteAssignments,
  stagedIdsForSuccessfulCoachInvite,
  type CoachInviteAssignment,
} from "@/lib/coach-invite-grouping";

// Task #808 / #836 — post-claim coach setup for the new org owner. Staged
// coach drafts (pre-filled by the platform admin before the claim) are shown
// as removable rows per team, plus a free-text field to add more emails.
// Skipping/closing the dialog leaves the drafts untouched — they persist
// until the owner either sends the invites or removes rows one by one.
// On confirm, only the staged entries whose invites actually went out are
// cleared from staging; failures stay staged for a later retry.

// Task #836 — gate for the persistent "Review & invite" re-entry point on
// the organization page. Staged drafts must stay side-effect-free until the
// POST-CLAIM owner confirms them, so an unclaimed org never exposes the
// invite-sending dialog — even to platform admins (who pass isOrgManager
// via the admin bypass and stage the drafts in the first place).
export function canReopenCoachSetup(args: {
  isOrgManager: boolean;
  isUnclaimed: boolean;
  stagedCount: number;
  teamsCount: number;
}): boolean {
  return (
    args.isOrgManager &&
    !args.isUnclaimed &&
    args.stagedCount > 0 &&
    args.teamsCount > 0
  );
}

type TeamResult = {
  teamName: string;
  email: string;
  grouped?: boolean;
  status: "success" | "already_active" | "auto_approved" | "already_pending" | "failed";
  outcome?: "invited" | "already_active" | "auto_approved" | "already_pending";
  teamOutcomes?: Array<{
    teamId: string;
    outcome: "invited" | "already_active" | "auto_approved" | "already_pending";
  }>;
  reason?: string;
};

export function CoachSetupDialog({
  orgId,
  teams,
  open,
  onOpenChange,
}: {
  orgId: string;
  teams: Array<{ id: string; name: string }>;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const staged = useStagedCoaches(orgId, open);
  // Extra emails typed by the owner, per team (beyond the staged rows).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [results, setResults] = useState<TeamResult[] | null>(null);

  useEffect(() => {
    if (!open) {
      setResults(null);
      setDrafts({});
    }
  }, [open]);

  const stagedByTeam = useMemo(() => {
    const byTeam: Record<string, StagedCoachRow[]> = {};
    for (const row of staged.data?.data ?? []) {
      (byTeam[row.teamId] ??= []).push(row);
    }
    return byTeam;
  }, [staged.data]);

  const invalidEmails = useMemo(() => {
    const bad: string[] = [];
    for (const t of teams) {
      for (const e of parseStagedEmails(drafts[t.id] ?? "")) {
        if (!STAGED_EMAIL_RE.test(e)) bad.push(e);
      }
    }
    return bad;
  }, [drafts, teams]);

  const totalCount = useMemo(
    () =>
      teams.reduce((n, t) => {
        const stagedRows = stagedByTeam[t.id] ?? [];
        const stagedEmails = new Set(stagedRows.map((r) => r.email));
        const extras = parseStagedEmails(drafts[t.id] ?? "").filter(
          (e) => !stagedEmails.has(e),
        );
        return n + stagedRows.length + extras.length;
      }, 0),
    [drafts, teams, stagedByTeam],
  );

  // Task #836 — per-row removal: deletes only that staged entry, leaving
  // the rest intact. Optimistic via cache update, rolled back on failure.
  const onRemoveStaged = async (row: StagedCoachRow) => {
    if (busy || removingId) return;
    setRemovingId(row.id);
    const key = ["staged-coaches", orgId];
    const prev = qc.getQueryData<{ data: StagedCoachRow[] }>(key);
    qc.setQueryData<{ data: StagedCoachRow[] }>(key, (old) =>
      old ? { data: old.data.filter((r) => r.id !== row.id) } : old,
    );
    try {
      await customFetch(
        `/api/v1/organizations/${orgId}/staged-coaches/${row.id}`,
        { method: "DELETE" },
      );
    } catch {
      if (prev) qc.setQueryData(key, prev);
      toast({ title: "Couldn't remove that coach", variant: "destructive" });
    } finally {
      setRemovingId(null);
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  const onSkip = () => {
    // Task #836 — skipping no longer discards drafts; they persist and the
    // owner can reopen coach setup later from the organization page.
    if (busy) return;
    onOpenChange(false);
  };

  const onConfirm = async () => {
    if (busy) return;
    if (invalidEmails.length > 0) {
      toast({
        title: `Invalid email: ${invalidEmails[0]}`,
        variant: "destructive",
      });
      return;
    }
    if (totalCount === 0) {
      toast({
        title: "Enter at least one coach email, or skip for now",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    const collected: TeamResult[] = [];
    const invitedStagedIds: string[] = [];
    const assignments: CoachInviteAssignment[] = [];
    for (const t of teams) {
      const stagedRows = stagedByTeam[t.id] ?? [];
      const stagedEmails = new Set(stagedRows.map((r) => r.email));
      const extras = parseStagedEmails(drafts[t.id] ?? "").filter(
        (e) => !stagedEmails.has(e),
      );
      const targets: Array<{ email: string; stagedId?: string }> = [
        ...stagedRows.map((r) => ({ email: r.email, stagedId: r.id })),
        ...extras.map((email) => ({ email })),
      ];
      for (const { email, stagedId } of targets) {
        assignments.push({
          teamId: t.id,
          teamName: t.name,
          email,
          stagedId,
        });
      }
    }
    // One unknown email across staged teams gets one envelope and one email.
    // Known accounts still follow the familiar per-team pending/in-app route
    // inside the grouped server operation.
    for (const group of groupCoachInviteAssignments(assignments)) {
      const grouped = group.assignments.length > 1;
      try {
        let response: {
          outcome?: "invited" | "already_active" | "auto_approved" | "already_pending";
          data?: Array<{
            outcome?: "invited" | "already_active" | "auto_approved" | "already_pending";
            teamOutcomes?: Array<{
              teamId: string;
              outcome: "invited" | "already_active" | "auto_approved" | "already_pending";
            }>;
          }>;
          teamOutcomes?: Array<{
            teamId: string;
            outcome: "invited" | "already_active" | "auto_approved" | "already_pending";
          }>;
        };
        if (grouped) {
          response = await customFetch(`/api/v1/organizations/${orgId}/coach-invites`, {
            method: "POST",
            body: JSON.stringify({
              assignments: group.assignments.map(({ teamId, email }) => ({
                teamId,
                email,
              })),
            }),
          });
        } else {
          response = await customFetch(`/api/v1/teams/${group.assignments[0].teamId}/invites`, {
            method: "POST",
            body: JSON.stringify({ email: group.email, position: "coach" }),
          });
        }
        const inviteRow = response.data?.[0];
        const outcome =
          inviteRow?.outcome ?? response.outcome ?? "invited";
        collected.push({
          teamName: group.assignments.map((a) => a.teamName).join(", "),
          email: group.email,
          grouped,
          status:
            outcome === "auto_approved"
              ? "auto_approved"
              : outcome === "already_active"
                ? "already_active"
                : outcome === "already_pending"
                  ? "already_pending"
                  : "success",
          outcome,
          teamOutcomes: inviteRow?.teamOutcomes ?? response.teamOutcomes,
        });
        invitedStagedIds.push(
          ...stagedIdsForSuccessfulCoachInvite(group.assignments),
        );
      } catch (err) {
        collected.push({
          teamName: group.assignments.map((a) => a.teamName).join(", "),
          email: group.email,
          grouped,
          status: "failed",
          reason:
            err instanceof Error ? err.message : "Failed to send invite",
        });
      }
      setResults([...collected]);
    }
    // Task #836 — clear only the staged entries that were actually invited;
    // failed ones stay staged so the owner can retry later.
    for (const id of invitedStagedIds) {
      try {
        await customFetch(
          `/api/v1/organizations/${orgId}/staged-coaches/${id}`,
          { method: "DELETE" },
        );
      } catch {
        // Non-fatal: a leftover row just reappears in the list; the invite
        // itself already went out.
      }
    }
    await qc.invalidateQueries({ queryKey: ["staged-coaches", orgId] });
    setBusy(false);
    const failed = collected.filter((r) => r.status === "failed").length;
    const sent = collected.filter((r) =>
      r.teamOutcomes
        ? r.teamOutcomes.some((item) => item.outcome === "invited")
        : r.status === "success",
    ).length;
    const countTeamOutcome = (
      outcome: "auto_approved" | "already_active" | "already_pending",
      status: TeamResult["status"],
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
    const autoApproved = countTeamOutcome("auto_approved", "auto_approved");
    const alreadyActive = countTeamOutcome("already_active", "already_active");
    const alreadyPending = countTeamOutcome("already_pending", "already_pending");
    const outcomeNotes = [
      sent > 0 && (autoApproved > 0 || alreadyActive > 0 || alreadyPending > 0)
        ? `${sent} new invitation${sent === 1 ? "" : "s"} sent.`
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
    toast(
      failed === 0
        ? {
            title: autoApproved || alreadyActive || alreadyPending
              ? `${collected.length} coach assignment${collected.length === 1 ? "" : "s"} processed`
              : sent === 1
                ? "Coach invite sent!"
                : `${sent} coach invites sent!`,
            description: outcomeNotes || undefined,
          }
        : {
            title: `${collected.length - failed} completed, ${failed} failed`,
            description: `${outcomeNotes ? `${outcomeNotes} ` : ""}Failed invites stay in this list — reopen coach setup to retry.`,
            variant: "destructive",
          },
    );
  };

    const done = !busy && results !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent
        className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="dialog-coach-setup"
      >
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            Add coaches to your teams
          </DialogTitle>
          <DialogDescription>
            Your teams are already set up. Review the suggested coach emails
            below, add more if you like, and send every invite at once —
            coaches get coach access as soon as they accept. Suggestions stay
            here until you send or remove them.
          </DialogDescription>
        </DialogHeader>

        {!done ? (
          <div className="space-y-4">
            {teams.map((t) => {
              const rows = stagedByTeam[t.id] ?? [];
              return (
                <div key={t.id} className="space-y-1.5">
                  <Label htmlFor={`coach-setup-${t.id}`} className="font-bold">
                    {t.name}
                  </Label>
                  {rows.length > 0 && (
                    <div
                      className="rounded-lg border border-border divide-y divide-border"
                      data-testid={`list-staged-coaches-${t.id}`}
                    >
                      {rows.map((row) => (
                        <div
                          key={row.id}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm"
                          data-testid={`row-staged-coach-${row.id}`}
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {row.email}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={() => onRemoveStaged(row)}
                            disabled={busy || removingId !== null}
                            aria-label={`Remove ${row.email}`}
                            data-testid={`btn-remove-staged-coach-${row.id}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Textarea
                    id={`coach-setup-${t.id}`}
                    rows={2}
                    placeholder={
                      rows.length > 0
                        ? "Add more emails…"
                        : "coach@example.com, assistant@example.com"
                    }
                    value={drafts[t.id] ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [t.id]: e.target.value }))
                    }
                    disabled={busy}
                    data-testid={`textarea-coach-setup-${t.id}`}
                  />
                </div>
              );
            })}
            {invalidEmails.length > 0 && (
              <p className="text-xs font-medium text-destructive">
                Invalid email{invalidEmails.length === 1 ? "" : "s"}:{" "}
                {invalidEmails.slice(0, 3).join(", ")}
              </p>
            )}
          </div>
        ) : null}

        {results && results.length > 0 && (
          <div
            className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border"
            data-testid="list-coach-setup-results"
          >
            {results.map((r, i) => (
              <div
                key={`${r.email}-${i}`}
                className="flex items-start gap-2 px-3 py-2 text-xs"
              >
                {r.status !== "failed" ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className="font-bold truncate">
                    {r.email}{" "}
                    <span className="font-medium text-muted-foreground">
                      → {r.teamName}
                    </span>
                  </p>
                  {r.status === "success" && r.grouped && !r.teamOutcomes && (
                    <p className="text-muted-foreground">
                      One shared invitation covers these teams
                    </p>
                  )}
                  {r.status === "already_active" && !r.teamOutcomes && (
                    <p className="text-muted-foreground">
                      Already active on the roster — no invite sent.
                    </p>
                  )}
                  {r.status === "auto_approved" && !r.teamOutcomes && (
                    <p className="text-muted-foreground">
                      Your team assignment is already approved because you’re an
                      organization admin. You don’t need to accept an invitation.
                    </p>
                  )}
                  {r.status === "already_pending" && !r.teamOutcomes && (
                    <p className="text-muted-foreground">
                      An invitation is already pending — no new invitation was sent.
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
                  {r.status === "failed" && r.reason && (
                    <p className="text-muted-foreground">{r.reason}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button
              type="button"
              variant="brand"
              onClick={() => onOpenChange(false)}
              data-testid="btn-coach-setup-done"
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={onSkip}
                disabled={busy}
                data-testid="btn-coach-setup-skip"
              >
                Not now
              </Button>
              <Button
                type="button"
                variant="brand"
                onClick={onConfirm}
                disabled={
                  busy || totalCount === 0 || invalidEmails.length > 0
                }
                data-testid="btn-coach-setup-confirm"
              >
                {busy
                  ? "Sending…"
                  : `Confirm & send ${totalCount > 0 ? totalCount : ""} coach assignment${totalCount === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
