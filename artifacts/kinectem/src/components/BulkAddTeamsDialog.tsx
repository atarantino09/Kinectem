import { useEffect, useMemo, useRef, useState } from "react";
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
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Mail,
  Clock,
  Upload,
} from "lucide-react";

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

// Task #817 — tiny dependency-free CSV parser (quoted-field aware, handles
// \r\n and \n, escaped quotes ""). Returns rows of cells; no type coercion.
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let atFieldStart = true;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) {
      // Quote mode only opens at the start of a field; a quote appearing
      // mid-cell (e.g. 5'10" Team) is a literal character.
      inQuotes = true;
      atFieldStart = false;
      continue;
    }
    atFieldStart = ch === "," || ch === "\n" || ch === "\r";
    if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  // Drop rows where every cell is blank (incl. the trailing newline row).
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Task #817 — detect an optional CSV header row like "Team,Coach Email":
// col 1 mentions team/name, or col 2 mentions email/coach without BEING an
// email address itself.
export function isCsvHeaderRow(row: string[]): boolean {
  const c1 = (row[0] ?? "").trim();
  const c2 = (row[1] ?? "").trim();
  if (/^teams?(\s*names?)?$/i.test(c1) || /^names?$/i.test(c1)) return true;
  if (c2 && /(email|coach)/i.test(c2) && !STAGED_EMAIL_RE.test(c2.toLowerCase()))
    return true;
  return false;
}

type Pair = { name: string; email: string };

function trimTrailingEmpty(pairs: Pair[]): Pair[] {
  let end = pairs.length;
  while (end > 0 && !pairs[end - 1].name.trim() && !pairs[end - 1].email.trim())
    end--;
  return pairs.slice(0, end);
}

// Task #817 — one auto-growing cell of the row list. A 1-row textarea that
// wraps long values and resizes to fit, so the row's zebra stripe grows with
// it (the stripe lives on the row container, which stretches both columns).
function GrowCell({
  value,
  onChange,
  onEnter,
  placeholder,
  disabled,
  testId,
  refKey,
  cellRefs,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  placeholder?: string;
  disabled?: boolean;
  testId: string;
  refKey: string;
  cellRefs: React.MutableRefObject<Map<string, HTMLTextAreaElement>>;
  autoFocus?: boolean;
}) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={(el) => {
        innerRef.current = el;
        if (el) cellRefs.current.set(refKey, el);
        else cellRefs.current.delete(refKey);
      }}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onEnter();
        }
      }}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      className="w-full min-w-0 resize-none overflow-hidden break-words bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring rounded-sm disabled:opacity-50"
      data-testid={testId}
    />
  );
}

type LineResult = {
  name: string;
  email: string;
  status: "success" | "error";
  reason?: string;
  // Outcome for the paired coach (only set when the team was created and an
  // email was given).
  coach?: "invited" | "staged" | "failed";
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
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const cellRefs = useRef(new Map<string, HTMLTextAreaElement>());

  const text = useMemo(() => pairs.map((p) => p.name).join("\n"), [pairs]);
  const coachText = useMemo(
    () => pairs.map((p) => p.email).join("\n"),
    [pairs],
  );

  const createTeam = useCreateTeam();

  const { rows, errors: lineErrors } = useMemo(
    () => parseBulkRows(text, coachText),
    [text, coachText],
  );
  const names = rows; // valid team rows (may still carry email errors above)
  const coachCount = rows.filter(
    (r) => r.email && STAGED_EMAIL_RE.test(r.email),
  ).length;

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

  // Task #817 — cell editing. A multi-line paste into either column splits
  // down that column (line k lands on row i+k), preserving today's
  // bulk-paste workflow from the old textareas.
  const updateCell = (i: number, col: "name" | "email", value: string) => {
    setPairs((prev) => {
      const next = prev.map((p) => ({ ...p }));
      const lines = value.split("\n");
      const ensure = (j: number) => {
        while (next.length <= j) next.push({ name: "", email: "" });
      };
      for (let k = 0; k < lines.length; k++) {
        ensure(i + k);
        next[i + k][col] = lines[k];
      }
      return trimTrailingEmpty(next);
    });
  };

  const focusCell = (i: number, col: "name" | "email") => {
    // Rendered rows always include one empty trailing row, so the target
    // exists on the next paint.
    requestAnimationFrame(() => {
      cellRefs.current.get(`${col}-${i}`)?.focus();
    });
  };

  const onPickCsv = () => csvInputRef.current?.click();

  const onCsvChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let raw = "";
    try {
      raw = await file.text();
    } catch {
      toast({ title: "Couldn't read that file", variant: "destructive" });
      return;
    }
    let csvRows = parseCsv(raw);
    if (csvRows.length > 0 && isCsvHeaderRow(csvRows[0])) {
      csvRows = csvRows.slice(1);
    }
    const imported = trimTrailingEmpty(
      csvRows.map((r) => ({
        name: (r[0] ?? "").trim(),
        email: (r[1] ?? "").trim(),
      })),
    );
    if (imported.length === 0) {
      toast({
        title: "No rows found in that CSV",
        description:
          "Expected team name in the first column and an optional coach email in the second.",
        variant: "destructive",
      });
      return;
    }
    if (
      trimTrailingEmpty(pairs).length > 0 &&
      !window.confirm(
        "Replace what's currently in the list with the CSV contents?",
      )
    ) {
      return;
    }
    setPairs(imported);
    toast({
      title: `Loaded ${imported.length} row${imported.length === 1 ? "" : "s"} from CSV`,
      description: "Review the pairings below, then Review & create.",
    });
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
    const failedRows: BulkRow[] = [];
    // teamId → email pairs to stage after the loop (platform-admin path).
    const toStage: Array<{ teamId: string; email: string; index: number }> = [];
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
          email: row.email,
          status: "success",
        };
        if (row.email) {
          if (staging) {
            // Defer: staged drafts are saved in one merged PUT after the
            // loop (the endpoint has replace-all semantics).
            toStage.push({
              teamId: (team as { id: string }).id,
              email: row.email,
              index: collected.length,
            });
          } else {
            // Same behavior as inviting a coach from the team page: email
            // invite for new accounts, in-app pending membership for
            // existing accounts. A failed invite never undoes the team.
            try {
              await customFetch(
                `/api/v1/teams/${(team as { id: string }).id}/invites`,
                {
                  method: "POST",
                  body: JSON.stringify({ email: row.email, position: "coach" }),
                },
              );
              result.coach = "invited";
            } catch (err) {
              result.coach = "failed";
              result.coachReason =
                apiErrorMessage(err) ?? "Couldn't send the coach invite";
            }
          }
        }
        collected.push(result);
      } catch (err) {
        collected.push({
          name: row.name,
          email: row.email,
          status: "error",
          reason: apiErrorMessage(err) ?? "Failed to create team",
        });
        failedRows.push(row);
      }
      setProgress({ done: i + 1, total: rows.length });
      setResults([...collected]);
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
    setPairs(failedRows.map((r) => ({ name: r.name, email: r.email })));
    if (failed === 0 && coachFailed === 0) {
      const coachDone = collected.filter(
        (r) => r.coach === "invited" || r.coach === "staged",
      ).length;
      toast({
        title:
          succeeded === 1 ? "Team created!" : `${succeeded} teams created!`,
        description:
          coachDone === 0
            ? undefined
            : staging
              ? `${coachDone} coach${coachDone === 1 ? "" : "es"} staged for the owner to confirm.`
              : `${coachDone} coach invite${coachDone === 1 ? "" : "s"} sent.`,
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

  // Always render at least 8 rows plus one empty trailing row so there is
  // always somewhere to keep typing.
  const renderedRows = Math.max(8, pairs.length + 1);

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
                <div className="flex items-end gap-2">
                  <div className="w-7 shrink-0" aria-hidden />
                  <div className="flex-1 min-w-0">
                    <Label className="font-bold">Team names</Label>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Label className="font-bold">
                      Coach email{" "}
                      <span className="font-medium text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                  </div>
                  {/* Task #817 — CSV upload: team name in column 1, coach
                      email in column 2; optional header row is skipped. */}
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={onCsvChange}
                    data-testid="input-bulk-csv"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0 font-bold rounded-full"
                    onClick={onPickCsv}
                    disabled={busy || atLimit}
                    data-testid="btn-bulk-upload-csv"
                  >
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Upload CSV
                  </Button>
                </div>
                {/* Task #817 — zebra-striped rows. The stripe sits on the row
                    container, so it spans number + both columns and grows when
                    a long value wraps; later row numbers shift down with it. */}
                <div
                  className="max-h-52 overflow-y-auto rounded-md border border-input"
                  data-testid="list-bulk-rows"
                >
                  {Array.from({ length: renderedRows }, (_, i) => {
                    const pair = pairs[i] ?? { name: "", email: "" };
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-2 px-1 py-0.5 ${
                          i % 2 === 1
                            ? "bg-purple-50 dark:bg-purple-950/30"
                            : "bg-background"
                        }`}
                        data-testid={`row-bulk-input-${i}`}
                      >
                        <div
                          className="w-7 shrink-0 pr-1 pt-1 text-right text-xs leading-6 text-muted-foreground select-none"
                          aria-hidden
                        >
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <GrowCell
                            value={pair.name}
                            onChange={(v) => updateCell(i, "name", v)}
                            onEnter={() => focusCell(i + 1, "name")}
                            placeholder={
                              i === 0 ? "Westfield U14 Boys" : undefined
                            }
                            disabled={busy || atLimit}
                            testId={`input-bulk-team-name-${i}`}
                            refKey={`name-${i}`}
                            cellRefs={cellRefs}
                            autoFocus={i === 0}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <GrowCell
                            value={pair.email}
                            onChange={(v) => updateCell(i, "email", v)}
                            onEnter={() => focusCell(i + 1, "email")}
                            placeholder={
                              i === 0 ? "coach@example.com" : undefined
                            }
                            disabled={busy || atLimit}
                            testId={`input-bulk-coach-email-${i}`}
                            refKey={`email-${i}`}
                            cellRefs={cellRefs}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
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
                    {r.email ? (
                      <span className="truncate">
                        {r.email}
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
                        Coach invited: {r.email}
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
