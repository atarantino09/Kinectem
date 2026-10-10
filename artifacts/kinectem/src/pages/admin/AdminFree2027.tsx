import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CompetitionReferralField } from "@/components/CompetitionReferralField";

type Target = { organizationId: string; organizationName: string };
type Outcome = Target & { status: "eligible" | "applied" | "staged" | "unchanged" | "skipped" | "blocked"; reason: string };
type Scope = { organizationIds: string[] } | { listId: string };
const successStatuses = new Set(["applied", "staged", "unchanged"]);

export function AdminFree2027({ selectedIds, lists }: {
  selectedIds: string[]; lists: Array<{ id: string; name: string; orgCount: number }>;
}) {
  const queryClient = useQueryClient();
  const [listId, setListId] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Outcome[]>([]);
  const [mode, setMode] = useState<"preview" | "finished">("preview");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [reviewedReferralCode, setReviewedReferralCode] = useState("");
  const eligible = results.filter((r) => r.status === "eligible");

  async function review(scope: Scope) {
    setOpen(true); setBusy(true); setResults([]); setError(""); setMode("preview");
    const tag = referralCode.trim();
    setReviewedReferralCode(tag);
    setProgress("Finding organizations…");
    try {
      const targets = await customFetch<{ data: Target[] }>("/api/v1/admin/free2027/targets", {
        method: "POST", body: JSON.stringify(scope),
      });
      const rows: Outcome[] = [];
      for (let offset = 0; offset < targets.data.length; offset += 10) {
        setProgress(`Checking ${Math.min(offset + 10, targets.data.length)} of ${targets.data.length} organizations…`);
        const response = await customFetch<{ data: Outcome[] }>("/api/v1/admin/free2027/preview", {
          method: "POST", body: JSON.stringify({ organizationIds: targets.data.slice(offset, offset + 10).map((t) => t.organizationId), ...(tag ? { referralCode: tag } : {}) }),
        });
        rows.push(...response.data);
        setResults([...rows]);
      }
      if (!targets.data.length) setError("This saved list has no organizations.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check eligibility. Try again.");
    } finally { setBusy(false); setProgress(""); }
  }

  async function apply() {
    // Freeze the reviewed IDs: list edits cannot silently widen the recipients.
    const reviewed = eligible.map((r) => r.organizationId);
    if (!reviewed.length) return;
    setBusy(true); setError("");
    const completed = new Map<string, Outcome>();
    try {
      for (let offset = 0; offset < reviewed.length; offset += 10) {
        setProgress(`Applying to ${Math.min(offset + 10, reviewed.length)} of ${reviewed.length} organizations…`);
        const batch = reviewed.slice(offset, offset + 10);
        try {
          const response = await customFetch<{ data: Outcome[] }>("/api/v1/admin/free2027/apply", {
            method: "POST", body: JSON.stringify({ organizationIds: batch, ...(reviewedReferralCode ? { referralCode: reviewedReferralCode } : {}) }),
          });
          for (const row of response.data) completed.set(row.organizationId, row);
        } catch (err) {
          for (const id of batch) completed.set(id, {
            ...results.find((r) => r.organizationId === id)!, status: "blocked",
            reason: err instanceof Error ? err.message : "This batch failed. Review and retry safely.",
          });
        }
        setResults((previous) => previous.map((r) => completed.get(r.organizationId) ?? r));
      }
      setMode("finished");
    } finally {
      setBusy(false); setProgress("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "promo-codes"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "org-claim-links"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "promo-usage"] }),
        queryClient.invalidateQueries({ queryKey: ["org-subscription"] }),
      ]);
    }
  }
  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-3" data-testid="admin-free2027">
      <div>
        <h3 className="font-bold text-foreground">Apply FREE2027 to existing organizations</h3>
        <p className="text-sm text-foreground mt-1">Free through July 31, 2027. First full-price annual charge August 1, 2027. Already-paid organizations are excluded.</p>
      </div>
      <div className="max-w-xl"><CompetitionReferralField value={referralCode} onChange={setReferralCode} disabled={busy || open} /></div>
      <div className="flex flex-wrap items-end gap-3">
        <Button onClick={() => void review({ organizationIds: selectedIds })} disabled={!selectedIds.length || busy}
          data-testid="btn-free2027-selected">Review selected ({selectedIds.length})</Button>
        <div className="space-y-1 min-w-0">
          <Label htmlFor="free2027-org-list">Or choose an entire saved list</Label>
          <select id="free2027-org-list" className="block w-full max-w-80 rounded-md border bg-background px-3 py-2 text-sm"
            value={listId} onChange={(e) => setListId(e.target.value)} disabled={busy} data-testid="select-free2027-list">
            <option value="">Choose a saved list</option>
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name} ({list.orgCount})</option>)}
          </select>
        </div>
        <Button variant="outline" disabled={!listId || busy} onClick={() => void review({ listId })}
          data-testid="btn-free2027-list">Review entire list</Button>
      </div>
      <p className="text-xs text-muted-foreground">Select one org using its checkbox, or select several. Organizations without a plan get the offer assigned for later setup. Saved-card billing is checked with Stripe before any change.</p>
      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto"
          onInteractOutside={(e) => { if (busy) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle>{mode === "finished" ? "FREE2027 application results" : "Review FREE2027 before applying"}</DialogTitle>
            <DialogDescription>
              No charge today. Eligible orgs get free access through July 31, 2027 and full-price annual billing starting August 1, 2027, Eastern time. Existing first-year discounts are removed for these orgs; paid orgs are unchanged.
            </DialogDescription>
          </DialogHeader>
          {busy && <p role="status" className="text-sm font-medium">{progress}</p>}
          {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          {!busy && results.length > 0 && <p className="font-semibold text-sm">
            {mode === "preview"
              ? `${eligible.length} eligible · ${results.length - eligible.length} already assigned, excluded, or blocked`
              : `${results.filter((r) => successStatuses.has(r.status)).length} applied or already assigned · ${results.filter((r) => !successStatuses.has(r.status)).length} excluded or blocked`}
          </p>}
          <div className="space-y-2" data-testid="free2027-results">
            {results.map((row) => <div key={row.organizationId} className="rounded-lg border p-3">
              <div className="flex justify-between gap-3">
                <span className="font-semibold text-sm">{row.organizationName}</span>
                <span className="text-xs uppercase shrink-0">{row.status === "skipped" ? "Excluded" : row.status}</span>
              </div>
              <p className="text-xs mt-1 text-muted-foreground">{row.reason}</p>
            </div>)}
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{mode === "finished" ? "Done" : "Cancel"}</Button>
            {mode === "preview" && <Button className="h-auto min-h-10 min-w-0 whitespace-normal sm:whitespace-nowrap"
              disabled={busy || Boolean(error) || !eligible.length} onClick={() => void apply()}
              data-testid="btn-confirm-free2027">Apply FREE2027 to {eligible.length} {eligible.length === 1 ? "organization" : "organizations"}</Button>}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
