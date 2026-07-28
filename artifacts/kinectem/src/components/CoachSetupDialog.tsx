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
import { CheckCircle2, XCircle } from "lucide-react";
import {
  parseStagedEmails,
  STAGED_EMAIL_RE,
  useStagedCoaches,
} from "@/components/StageCoachesDialog";

// Task #808 — one-time post-claim prompt for the new org owner. Lists every
// team with a coach-email field (pre-filled from any drafts the platform
// admin staged before the claim) and a single "confirm & send" that fans out
// to the normal team-invite endpoint with the coach role. Only here do the
// invites actually go out; consumed drafts are then cleared. Skipping
// discards the drafts (the copy says so explicitly) — the owner can always
// invite coaches later from each team page.

type TeamResult = {
  teamName: string;
  email: string;
  status: "success" | "failed";
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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<TeamResult[] | null>(null);

  useEffect(() => {
    if (!open) {
      setHydrated(false);
      setResults(null);
      return;
    }
    if (hydrated || !staged.data) return;
    const byTeam: Record<string, string[]> = {};
    for (const row of staged.data.data) {
      (byTeam[row.teamId] ??= []).push(row.email);
    }
    const next: Record<string, string> = {};
    for (const t of teams) next[t.id] = (byTeam[t.id] ?? []).join("\n");
    setDrafts(next);
    setHydrated(true);
  }, [open, staged.data, hydrated, teams]);

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
      teams.reduce(
        (n, t) => n + parseStagedEmails(drafts[t.id] ?? "").length,
        0,
      ),
    [drafts, teams],
  );

  const clearDrafts = async () => {
    try {
      await customFetch(`/api/v1/organizations/${orgId}/staged-coaches`, {
        method: "DELETE",
      });
      await qc.invalidateQueries({ queryKey: ["staged-coaches", orgId] });
    } catch {
      // Non-fatal: leftover drafts are inert and invisible to the owner.
    }
  };

  const onSkip = async () => {
    if (busy) return;
    await clearDrafts();
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
    // Sequential on purpose — keeps rate limiting predictable and lets a
    // mid-run failure keep the successes.
    for (const t of teams) {
      for (const email of parseStagedEmails(drafts[t.id] ?? "")) {
        try {
          await customFetch(`/api/v1/teams/${t.id}/invites`, {
            method: "POST",
            body: JSON.stringify({ email, position: "coach" }),
          });
          collected.push({ teamName: t.name, email, status: "success" });
        } catch (err) {
          collected.push({
            teamName: t.name,
            email,
            status: "failed",
            reason:
              err instanceof Error ? err.message : "Failed to send invite",
          });
        }
        setResults([...collected]);
      }
    }
    await clearDrafts();
    setBusy(false);
    const failed = collected.filter((r) => r.status === "failed").length;
    const sent = collected.length - failed;
    toast(
      failed === 0
        ? {
            title:
              sent === 1
                ? "Coach invite sent!"
                : `${sent} coach invites sent!`,
          }
        : {
            title: `${sent} sent, ${failed} failed`,
            description: "Failed invites are listed — you can retry from each team page.",
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
            Your teams are already set up. Add each team's coach emails below
            and send every invite at once — coaches get coach access as soon
            as they accept. You can edit anything before sending.
          </DialogDescription>
        </DialogHeader>

        {!done ? (
          <div className="space-y-4">
            {teams.map((t) => (
              <div key={t.id} className="space-y-1.5">
                <Label htmlFor={`coach-setup-${t.id}`} className="font-bold">
                  {t.name}
                </Label>
                <Textarea
                  id={`coach-setup-${t.id}`}
                  rows={2}
                  placeholder="coach@example.com, assistant@example.com"
                  value={drafts[t.id] ?? ""}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [t.id]: e.target.value }))
                  }
                  disabled={busy}
                  data-testid={`textarea-coach-setup-${t.id}`}
                />
              </div>
            ))}
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
                {r.status === "success" ? (
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
                Skip — discard suggestions
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
                  : `Confirm & send ${totalCount > 0 ? totalCount : ""} invite${totalCount === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
