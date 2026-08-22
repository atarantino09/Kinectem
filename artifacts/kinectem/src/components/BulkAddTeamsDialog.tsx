import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTeam,
  getListOrgTeamsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-errors";
import { PLANS, nextPlan, type OrgPlanUsage } from "@/lib/plans";
import {
  STAGED_EMAIL_RE,
  type StagedCoachRow,
} from "@/components/StageCoachesDialog";
import {
  groupCoachInviteAssignments,
  type CoachInviteAssignment,
} from "@/lib/coach-invite-grouping";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Mail,
  Clock,
} from "lucide-react";
import { BulkPairEditor, type BulkPair } from "@/components/BulkPairEditor";

// Mirrors CreateTeamDialog's slugify so bulk-created teams get the same
// URL handles as ones made one-at-a-time.
function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

// Task #814 — the dialog now carries two line-paired columns: team names and
// optional coach emails. Pairing is strictly by visual line number, so we
// parse both textareas by raw line index (no pre-filtering) and only then
// drop empty / duplicate rows. Each parsed row keeps its original 1-based
// line number for error messages.
export type BulkRow = {
  line: number;
  name: string;
  email: string; // "" = no coach for this line
};

export type BulkLineError = { line: number; message: string };

export function parseBulkRows(
  teamsRaw: string,
  coachesRaw: string,
): { rows: BulkRow[]; errors: BulkLineError[] } {
  const teamLines = teamsRaw.split("\n");
  const coachLines = coachesRaw.split("\n");
  const total = Math.max(teamLines.length, coachLines.length);
  const rows: BulkRow[] = [];
  const errors: BulkLineError[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < total; i++) {
    const name = (teamLines[i] ?? "").trim();
    const email = (coachLines[i] ?? "").trim().toLowerCase();
    if (!name && !email) continue; // fully blank line — ignore
    if (!name) {
      errors.push({
        line: i + 1,
        message: `Line ${i + 1}: coach email has no team name on the same line`,
      });
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // duplicate team name — collapse to first, as before
    seen.add(key);
    if (email && !STAGED_EMAIL_RE.test(email)) {
      errors.push({
        line: i + 1,
        message: `Line ${i + 1}: "${email}" doesn't look like an email`,
      });
      // Still keep the row visible in counts, but block submission via errors.
    }
    rows.push({ line: i + 1, name, email });
  }
  return { rows, errors };
}

// Task #832 — the CSV helpers and the row-list editor itself moved to the
// shared BulkPairEditor component (also used by admin org quick setup).
// Re-exported here so existing imports keep working.
export { parseCsv, isCsvHeaderRow } from "@/components/BulkPairEditor";

type Pair = BulkPair;

type LineResult = {
  name: string;
  email: string;
  status: "success" | "error";
  reason?: string;
  // Outcome for the paired coach (only set when the team was created and an
  // email was given).
  coach?: "invited" | "staged" | "failed";
  coachGrouped?: boolean;
  coachReason?: string;
};

export function BulkAddTeamsDialog({
  orgId,
  open,
  onOpenChange,
  usage,
  staging = false,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  usage?: OrgPlanUsage | null;
  // Task #814 — true when a platform admin is bulk-adding on an UNCLAIMED
  // org: coach emails are saved as staged drafts (nothing sent) instead of
  // being invited immediately.
  staging?: boolean;
}) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  // Task #817 — the input step is a row-based list (number + team name +
  // coach email per row) so zebra stripes can span both columns and grow
  // with wrapped lines. `pairs` is the single source of truth; the two
  // newline-joined strings below feed the unchanged parseBulkRows.
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [step, setStep] = useState<"input" | "preview">("input");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<LineResult[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const text = useMemo(() => pairs.map((p) => p.name).join("\n"), [pairs]);
  const coachText = useMemo(
    () => pairs.map((p) => p.email).join("\n"),
    [pairs],
  );

  const createTeam = useCreateTeam();

  const { rows, errors: lineErrors } = useMemo(() => {
    const parsed = parseBulkRows(text, coachText);
    // Per-row extra coaches (the "+ Add coach" control). Rows keep their
    // original 1-based line numbers, so pairs[line-1] is the matching row.
    const errors = [...parsed.errors];
    const rows = parsed.rows.map((r) => {
      const extras = (pairs[r.line - 1]?.extraEmails ?? [])
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      for (const e of extras) {
        if (!STAGED_EMAIL_RE.test(e)) {
          errors.push({
            line: r.line,
            message: `Line ${r.line}: "${e}" doesn't look like an email`,
          });
        }
      }
      // De-dup within the row (incl. against the primary email).
      const emails: string[] = [];
      for (const e of [r.email, ...extras]) {
        if (e && !emails.includes(e)) emails.push(e);
      }
      return { ...r, emails };
    });
    // Extras on a line parseBulkRows skipped (blank name AND blank primary
    // email) would otherwise be silently dropped — surface them as the same
    // orphan error the primary column gets.
    const rowLines = new Set(parsed.rows.map((r) => r.line));
    const errorLines = new Set(parsed.errors.map((e) => e.line));
    pairs.forEach((p, i) => {
      const line = i + 1;
      if (rowLines.has(line) || errorLines.has(line)) return;
      if ((p.extraEmails ?? []).some((e) => e.trim())) {
        errors.push({
          line,
          message: `Line ${line}: coach email has no team name on the same line`,
        });
      }
    });
    return { rows, errors };
  }, [text, coachText, pairs]);
  const names = rows; // valid team rows (may still carry email errors above)
  const coachCount = rows.reduce(
    (n, r) => n + r.emails.filter((e) => STAGED_EMAIL_RE.test(e)).length,
    0,
  );

  // Plan-limit awareness. `usage` is undefined until the parent loads it; in
  // that case no limit UI renders and nothing is blocked client-side — the
  // server still enforces the cap per-create.
  const limit = usage?.teamsLimit ?? null;
  const used = usage?.teamsUsed ?? 0;
  const unlimited = !usage || limit == null;
  const remaining = unlimited ? null : Math.max(0, (limit as number) - used);
  // Live projected total as names are typed (i.e. "1/15" ticking up).
  const projected = used + names.length;
  const atLimit = !unlimited && (remaining as number) <= 0;
  const overBy = unlimited ? 0 : Math.max(0, names.length - (remaining as number));
  const wouldExceed = overBy > 0;
  const planLabel = usage
    ? (PLANS.find((p) => p.id === usage.plan)?.name ?? usage.plan)
    : "";
  const upgradePlan = usage ? nextPlan(usage.plan) : null;
  const goUpgrade = () => {
    onOpenChange(false);
    setLocation(`/organizations/${orgId}/subscribe`);
  };

  const handleOpenChange = (v: boolean) => {
    if (busy) return; // don't let the dialog close mid-run
    if (!v) {
      // Reset transient UI when fully closing so a reopen starts clean.
      setResults([]);
      setProgress(null);
      setStep("input");
    }
    onOpenChange(v);
  };

  const validateForReview = (): boolean => {
    if (names.length === 0) {
      toast({ title: "Enter at least one team name", variant: "destructive" });
      return false;
    }
    if (lineErrors.length > 0) {
      toast({
        title: lineErrors[0].message,
        variant: "destructive",
      });
      return false;
    }
    if (atLimit) {
      toast({
        title: "Team limit reached",
        description: "Upgrade your plan to add more teams.",
        variant: "destructive",
      });
      return false;
    }
    if (wouldExceed) {
      toast({
        title: `You can only add ${remaining} more team${remaining === 1 ? "" : "s"}`,
        description: "Upgrade your plan to add the rest.",
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const runCreate = async () => {
    if (busy) return;
    if (!validateForReview()) return;
    setBusy(true);
    setResults([]);
    setProgress({ done: 0, total: rows.length });
    const collected: LineResult[] = [];
    const failedRows: Array<BulkRow & { emails: string[] }> = [];
    // teamId → email pairs to stage after the loop (platform-admin path).
    const toStage: Array<{ teamId: string; email: string; index: number }> = [];
    // On the normal (non-staging) path, teams must exist before we can send a
    // consolidated invitation. Collect successful assignments first, then
    // group them by normalized email below.
    const toInvite: CoachInviteAssignment[] = [];
    // Sequential on purpose: keeps slug-collision and rate-limit behavior
    // predictable, and lets a mid-list failure not lose the rest.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const season = `Season ${new Date().getFullYear()}`;
      try {
        const team = await createTeam.mutateAsync({
          orgId,
          data: {
            name: row.name,
            slug: slugify(row.name),
            season: { name: season },
          },
        });
        const result: LineResult = {
          name: row.name,
          email: row.emails.join(", "),
          status: "success",
        };
        if (row.emails.length > 0) {
          if (staging) {
            // Defer: staged drafts are saved in one merged PUT after the
            // loop (the endpoint has replace-all semantics).
            for (const email of row.emails) {
              toStage.push({
                teamId: (team as { id: string }).id,
                email,
                index: collected.length,
              });
            }
          } else {
            for (const email of row.emails) {
              toInvite.push({
                teamId: (team as { id: string }).id,
                teamName: row.name,
                email,
                resultIndex: collected.length,
              });
            }
          }
        }
        collected.push(result);
      } catch (err) {
        collected.push({
          name: row.name,
          email: row.emails.join(", "),
          status: "error",
          reason: apiErrorMessage(err) ?? "Failed to create team",
        });
        failedRows.push(row);
      }
      setProgress({ done: i + 1, total: rows.length });
      setResults([...collected]);
    }

    let coachInvitationCount = 0;
    if (!staging && toInvite.length > 0) {
      for (const group of groupCoachInviteAssignments(toInvite)) {
        const grouped = group.assignments.length > 1;
        try {
          if (grouped) {
            await customFetch(`/api/v1/organizations/${orgId}/coach-invites`, {
              method: "POST",
              body: JSON.stringify({
                assignments: group.assignments.map(({ teamId, email }) => ({
                  teamId,
                  email,
                })),
              }),
            });
          } else {
            await customFetch(`/api/v1/teams/${group.assignments[0].teamId}/invites`, {
              method: "POST",
              body: JSON.stringify({ email: group.email, position: "coach" }),
            });
          }
          coachInvitationCount++;
          for (const assignment of group.assignments) {
            const result = collected[assignment.resultIndex!];
            result.coach = "invited";
            result.coachGrouped = grouped;
          }
        } catch (err) {
          const reason = apiErrorMessage(err) ?? "Couldn't send the coach invite";
          for (const assignment of group.assignments) {
            const result = collected[assignment.resultIndex!];
            result.coach = "failed";
            result.coachReason = reason;
          }
        }
        setResults([...collected]);
      }
    }

    // Platform-admin staging: merge the new pairs with any coaches already
    // staged for other teams (the save endpoint replaces everything, so we
    // must read-modify-write the full picture).
    if (staging && toStage.length > 0) {
      try {
        const existing = await customFetch<{ data: StagedCoachRow[] }>(
          `/api/v1/organizations/${orgId}/staged-coaches`,
          { method: "GET" },
        );
        const byTeam = new Map<string, string[]>();
        for (const r of existing.data) {
          const list = byTeam.get(r.teamId) ?? [];
          list.push(r.email);
          byTeam.set(r.teamId, list);
        }
        for (const s of toStage) {
          const list = byTeam.get(s.teamId) ?? [];
          if (!list.includes(s.email)) list.push(s.email);
          byTeam.set(s.teamId, list);
        }
        await customFetch(`/api/v1/organizations/${orgId}/staged-coaches`, {
          method: "PUT",
          body: JSON.stringify({
            entries: Array.from(byTeam.entries()).map(([teamId, emails]) => ({
              teamId,
              emails,
            })),
          }),
        });
        for (const s of toStage) collected[s.index].coach = "staged";
        await qc.invalidateQueries({ queryKey: ["staged-coaches", orgId] });
      } catch (err) {
        const reason =
          apiErrorMessage(err) ?? "Couldn't save the staged coach drafts";
        for (const s of toStage) {
          collected[s.index].coach = "failed";
          collected[s.index].coachReason = reason;
        }
      }
      setResults([...collected]);
    }

    setBusy(false);
    setStep("input");
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListOrgTeamsQueryKey(orgId) }),
      qc.invalidateQueries({ queryKey: ["org-plan-usage", orgId] }),
    ]);

    const succeeded = collected.filter((r) => r.status === "success").length;
    const failed = collected.length - succeeded;
    const coachFailed = collected.filter((r) => r.coach === "failed").length;
    // Keep only the failed lines (name + paired coach email) in the
    // textareas so the user can retry just those; clear entirely when
    // everything succeeded.
    setPairs(
      failedRows.map((r) => ({
        name: r.name,
        email: r.emails[0] ?? "",
        extraEmails: r.emails.length > 1 ? r.emails.slice(1) : undefined,
      })),
    );
    if (failed === 0 && coachFailed === 0) {
      const coachDone = staging
        ? collected.filter((r) => r.coach === "staged").length
        : coachInvitationCount;
      toast({
        title:
          succeeded === 1 ? "Team created!" : `${succeeded} teams created!`,
        description:
          coachDone === 0
            ? undefined
            : staging
              ? `${coachDone} coach${coachDone === 1 ? "" : "es"} staged for the owner to confirm.`
              : `${coachDone} coach invitation${coachDone === 1 ? "" : "s"} sent.`,
      });
    } else if (failed === 0) {
      toast({
        title: `${succeeded} teams created, but ${coachFailed} coach ${staging ? "draft" : "invite"}${coachFailed === 1 ? "" : "s"} failed`,
        description: staging
          ? "The teams exist — you can stage those coaches again from this page."
          : "The teams exist — you can retry those invites from each team page.",
        variant: "destructive",
      });
    } else {
      toast({
        title: `${succeeded} created, ${failed} failed`,
        description: "Failed teams are kept below so you can retry.",
        variant: "destructive",
      });
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (step === "input") {
      if (validateForReview()) setStep("preview");
      return;
    }
    await runCreate();
  };

  // After a run where everything succeeded we clear the textarea, so
  // `names` is empty while `results` still holds the successes. In that
  // state, swap the primary action to a "Done" button that closes the
  // dialog instead of leaving a disabled "Create teams".
  const showDone = !busy && results.length > 0 && names.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              Bulk add teams
            </DialogTitle>
            <DialogDescription>
              One team per line, with an optional coach email on the same line
              of the second column. Coaches are optional — leave any line (or
              the whole column) blank and add them later.
              {staging
                ? " Coach emails will be staged as drafts for the owner to confirm after claiming this page — nothing is sent now."
                : " Each coach gets an invite to that specific team."}
            </DialogDescription>
          </DialogHeader>

          {step === "input" && (
            <>
              <div className="space-y-1.5">
                {/* Task #832 — shared row-list editor (also used by admin
                    org quick setup). idPrefix "bulk" keeps the historical
                    test ids. */}
                <BulkPairEditor
                  pairs={pairs}
                  onPairsChange={setPairs}
                  disabled={busy || atLimit}
                  idPrefix="bulk"
                  autoFocusFirst
                />
                <p
                  className="text-xs font-medium text-muted-foreground"
                  data-testid="text-bulk-team-count"
                >
                  {unlimited
                    ? names.length === 0
                      ? "No teams yet — add one name per line."
                      : `${names.length} team${names.length === 1 ? "" : "s"} will be created${coachCount > 0 ? ` · ${coachCount} coach${coachCount === 1 ? "" : "es"} ${staging ? "will be staged" : "will be invited"}` : ""}`
                    : `${projected}/${limit} teams${names.length > 0 ? ` · adding ${names.length}` : ""}${coachCount > 0 ? ` · ${coachCount} coach${coachCount === 1 ? "" : "es"} ${staging ? "will be staged" : "will be invited"}` : ""}`}
                </p>
              </div>

              {lineErrors.length > 0 && (
                <div
                  className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-1"
                  data-testid="bulk-line-errors"
                >
                  {lineErrors.slice(0, 4).map((e) => (
                    <p
                      key={e.line}
                      className="text-xs font-medium text-destructive"
                    >
                      {e.message}
                    </p>
                  ))}
                  {lineErrors.length > 4 && (
                    <p className="text-xs font-medium text-destructive">
                      …and {lineErrors.length - 4} more
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {step === "preview" && !busy && (
            <div className="space-y-2">
              <p className="text-sm font-bold">
                Review pairings before creating
              </p>
              <div
                className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border"
                data-testid="list-bulk-preview"
              >
                {rows.map((r, i) => (
                  <div
                    key={`${r.name}-${i}`}
                    className="flex items-center gap-2 px-3 py-2 text-xs"
                    data-testid={`row-bulk-preview-${i}`}
                  >
                    <span className="w-5 shrink-0 text-right text-muted-foreground">
                      {i + 1}.
                    </span>
                    <span className="font-bold truncate">{r.name}</span>
                    <span className="text-muted-foreground shrink-0">→</span>
                    {r.emails.length > 0 ? (
                      <span className="truncate">
                        {r.emails.join(", ")}
                        <span className="text-muted-foreground">
                          {staging
                            ? " (staged for owner confirmation)"
                            : " (will be invited)"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">
                        no coach yet
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                {staging
                  ? "Coach emails are saved as drafts only — the owner confirms and sends invites after claiming the page."
                  : "Each coach is invited to their team the same way as from the team page."}
              </p>
            </div>
          )}

          {usage && (atLimit || wouldExceed) && step === "input" && (
            <div
              className={`rounded-lg border p-3 space-y-2 ${
                atLimit
                  ? "border-destructive/40 bg-destructive/10"
                  : "border-amber-300 bg-amber-50 dark:bg-amber-950/30"
              }`}
              data-testid="bulk-limit-warning"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className={`w-4 h-4 shrink-0 mt-0.5 ${atLimit ? "text-destructive" : "text-amber-600"}`}
                />
                <p
                  className={`text-xs font-medium ${atLimit ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}
                >
                  {atLimit
                    ? `You've used all ${limit} teams on your ${planLabel} plan.`
                    : `That's ${overBy} more than your ${planLabel} plan allows — you can add ${remaining} more.`}
                  {upgradePlan ? " Upgrade to add more." : ""}
                </p>
              </div>
              {upgradePlan && (
                <Button
                  type="button"
                  size="sm"
                  variant="brand"
                  className="w-full font-bold rounded-full"
                  onClick={goUpgrade}
                  data-testid="btn-bulk-upgrade"
                >
                  Upgrade to {upgradePlan.name}
                </Button>
              )}
            </div>
          )}

          {progress && (
            <p
              className="text-xs font-bold text-muted-foreground"
              data-testid="text-bulk-progress"
            >
              {busy
                ? `Creating ${progress.done} of ${progress.total}...`
                : `Done — processed ${progress.total} team${progress.total === 1 ? "" : "s"}.`}
            </p>
          )}

          {results.length > 0 && (
            <div
              className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border"
              data-testid="list-bulk-results"
            >
              {results.map((r, i) => (
                <div
                  key={`${r.name}-${i}`}
                  className="flex items-start gap-2 px-3 py-2 text-xs"
                  data-testid={`row-bulk-result-${i}`}
                >
                  {r.status === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className="font-bold truncate">{r.name}</p>
                    {r.status === "error" && r.reason && (
                      <p className="text-muted-foreground">{r.reason}</p>
                    )}
                    {r.coach === "invited" && (
                      <p className="text-muted-foreground flex items-center gap-1">
                        <Mail className="w-3 h-3 shrink-0" />
                        {r.coachGrouped
                          ? `One shared coach invite: ${r.email}`
                          : `Coach invited: ${r.email}`}
                      </p>
                    )}
                    {r.coach === "staged" && (
                      <p className="text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3 shrink-0" />
                        Coach staged for owner confirmation: {r.email}
                      </p>
                    )}
                    {r.coach === "failed" && (
                      <p className="text-destructive">
                        Coach {staging ? "staging" : "invite"} failed for{" "}
                        {r.email}
                        {r.coachReason ? ` — ${r.coachReason}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            {showDone ? (
              <Button
                type="button"
                variant="brand"
                onClick={() => handleOpenChange(false)}
                data-testid="btn-bulk-done"
              >
                Done
              </Button>
            ) : step === "preview" ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("input")}
                  disabled={busy}
                  data-testid="btn-bulk-back"
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  variant="brand"
                  disabled={busy}
                  data-testid="btn-bulk-create-teams"
                >
                  {busy
                    ? "Creating..."
                    : `Create ${names.length} team${names.length === 1 ? "" : "s"}${coachCount > 0 ? ` & ${staging ? "stage" : "invite"} ${coachCount} coach${coachCount === 1 ? "" : "es"}` : ""}`}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleOpenChange(false)}
                  disabled={busy}
                >
                  {results.length > 0 && !busy ? "Close" : "Cancel"}
                </Button>
                <Button
                  type="submit"
                  variant="brand"
                  disabled={
                    busy ||
                    names.length === 0 ||
                    atLimit ||
                    wouldExceed ||
                    lineErrors.length > 0
                  }
                  data-testid="btn-bulk-review"
                >
                  {busy ? "Creating..." : "Review & create"}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
