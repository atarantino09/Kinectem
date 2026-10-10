import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export type ConversionPromo = {
  id: string;
  code: string;
  linkedOffer?: string | null;
  discountType: string;
  discountValue: number;
  firstAnnualDiscount?: { discountType: "percent" | "amount"; discountValue: number } | null;
};
export type ConversionSettings = { description: string | null; maxRedemptions: number | null; expiresAt: string | null };
type Row = { organizationId: string; organizationName: string; status: string; reason: string; currentTerms?: string; proposedTerms?: string };
type Phase = "choose" | "reviewing" | "checking" | "ready" | "confirming" | "applying" | "finished";
const OK = new Set(["applied", "staged", "unchanged"]);
const msg = (e: unknown, d: string) => (e instanceof Error ? e.message : d);
const money = (d: { discountType: string; discountValue: number }) =>
  d.discountType === "percent" ? `${d.discountValue}%` : `$${d.discountValue.toLocaleString("en-US")}`;

export function existingDiscount(p: ConversionPromo) {
  if (p.linkedOffer === "free2027") return p.firstAnnualDiscount ?? null;
  return p.discountType === "percent" || p.discountType === "amount" ? { discountType: p.discountType, discountValue: p.discountValue } : null;
}

export function PromoFree2027Conversion({ promo, settings, onDone, onBusyChange }: {
  promo: ConversionPromo; settings: ConversionSettings; onDone: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const qc = useQueryClient();
  const discount = existingDiscount(promo);
  const [pricing, setPricing] = useState<"keep_discount" | "full_price" | "">("");
  const [phase, setPhase] = useState<Phase>("choose");
  const [rows, setRows] = useState<Row[]>([]);
  const [terms, setTerms] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [codeSaved, setCodeSaved] = useState(false);
  const [applyFailed, setApplyFailed] = useState(false);
  const reviewId = useRef("");
  const rowsRef = useRef<Row[]>([]);
  const frozen = useRef<string[]>([]);
  const checked = useRef(new Set<string>());
  const interrupted = useRef(false);

  const setBusy = (p: Phase) => { setPhase(p); onBusyChange?.(["reviewing", "checking", "confirming", "applying"].includes(p)); };
  const put = (next: Row[]) => { rowsRef.current = next; setRows(next); };
  const merge = (out: Row[]) => {
    const m = new Map(out.map((o) => [o.organizationId, o]));
    put(rowsRef.current.map((r) => { const o = m.get(r.organizationId); return o ? { ...r, ...o } : r; }));
  };
  const refresh = () => Promise.all([
    ["admin", "promo-codes"], ["admin", "promo-usage"], ["admin", "organizations"],
    ["org-subscription"], ["admin", "org-claim-links"], ["competition-referrals"],
  ].map((queryKey) => qc.invalidateQueries({ queryKey })));
  const base = `/api/v1/admin/promo-code-conversions`;

  async function check() {
    setBusy("checking"); setError(""); interrupted.current = false;
    const ids = rowsRef.current.map((r) => r.organizationId).filter((id) => !checked.current.has(id));
    try {
      for (let i = 0; i < ids.length; i += 10) {
        setProgress(`Checking ${Math.min(i + 10, ids.length)} of ${ids.length} organizations`);
        const batch = ids.slice(i, i + 10);
        const res = await customFetch<{ data: Row[] }>(`${base}/${reviewId.current}/preview`, { method: "POST", body: JSON.stringify({ organizationIds: batch }) });
        merge(res.data); batch.forEach((id) => checked.current.add(id));
      }
      setBusy("ready");
    } catch (e) {
      interrupted.current = true;
      setError(`Checking was interrupted: ${msg(e, "try again")}. Confirmation is disabled until every organization is checked.`);
      setBusy("ready");
    } finally { setProgress(""); }
  }

  async function review() {
    if (!pricing) return;
    setBusy("reviewing"); setError(""); checked.current = new Set(); put([]);
    try {
      const res = await customFetch<{ reviewId: string; terms: string; data: Row[] }>(`/api/v1/admin/promo-codes/${promo.id}/free2027/review`, {
        method: "POST", body: JSON.stringify({ pricing, settings }),
      });
      reviewId.current = res.reviewId; setTerms(res.terms); put(res.data);
      await check();
    } catch (e) { setError(msg(e, "Could not start the review.")); setBusy("choose"); }
  }

  async function apply(ids: string[]) {
    setBusy("applying"); setError(""); setApplyFailed(false);
    let failed = false;
    try {
      for (let i = 0; i < ids.length; i += 10) {
        setProgress(`Applying to ${Math.min(i + 10, ids.length)} of ${ids.length} organizations`);
        const batch = ids.slice(i, i + 10);
        try {
          const res = await customFetch<{ data: Row[] }>(`${base}/${reviewId.current}/apply`, { method: "POST", body: JSON.stringify({ organizationIds: batch }) });
          merge(res.data);
          if (res.data.some((r) => r.status === "blocked")) failed = true;
        } catch (e) {
          failed = true;
          merge(batch.map((id) => ({ organizationId: id, organizationName: "", status: "blocked", reason: msg(e, "This batch failed. Retry the same reviewed organizations.") })));
        }
      }
    } finally { setProgress(""); }
    setApplyFailed(failed); setBusy("finished"); await refresh();
  }

  async function confirm() {
    setBusy("confirming"); setError("");
    frozen.current = rowsRef.current.filter((r) => r.status === "eligible").map((r) => r.organizationId);
    try {
      await customFetch(`${base}/${reviewId.current}/confirm`, { method: "POST", body: JSON.stringify({}) });
      setCodeSaved(true); await refresh();
    } catch (e) { setError(`The code was not saved: ${msg(e, "try again")}. No organization was changed.`); setBusy("ready"); return; }
    if (!frozen.current.length) { setBusy("finished"); return; }
    await apply(frozen.current);
  }

  const retryable = rows.filter((r) => frozen.current.includes(r.organizationId) && r.status === "blocked").map((r) => r.organizationId);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const eligible = count("eligible");
  const busy = ["reviewing", "checking", "confirming", "applying"].includes(phase);
  const cantConfirm = busy || interrupted.current || rows.some((r) => r.status === "pending") || !!error && interrupted.current;
  const ok = rows.filter((r) => OK.has(r.status)).length;

  return (
    <div className="space-y-4" data-testid="free2027-conversion">
      <div className="rounded-md border bg-muted/50 p-3 text-sm space-y-1">
        <p className="font-semibold">Link {promo.code.toUpperCase()} to FREE2027</p>
        <p>Free through July 31, 2027; first annual payment August 1, 2027 (midnight Eastern). The code and its source stay as they are. Organizations that already paid are explicitly excluded.</p>
      </div>

      {phase === "choose" && (
        <>
          <fieldset className="space-y-2" data-testid="free2027-pricing">
            <legend className="text-sm font-semibold">August 2027 billing</legend>
            <p className="text-xs text-muted-foreground" data-testid="text-existing-discount">
              {discount ? `Existing first-year discount: ${money(discount)} off.` : "This code has no first-year discount."}
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="f27-pricing" disabled={!discount} checked={pricing === "keep_discount"} onChange={() => setPricing("keep_discount")} />
              <span>Keep the discount on the first annual invoice{discount && discount.discountType === "percent" && discount.discountValue === 100 ? " (100%: the first annual invoice is $0)" : ""}. Later renewals are full price.</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="f27-pricing" checked={pricing === "full_price"} onChange={() => setPricing("full_price")} />
              <span>Charge full price on August 1, 2027.</span>
            </label>
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button onClick={() => void review()} disabled={!pricing} data-testid="btn-free2027-review">Review affected organizations</Button>
        </>
      )}

      {phase !== "choose" && (
        <div className="space-y-3">
          {terms && <p className="text-sm" data-testid="text-review-terms">{terms}</p>}
          {busy && <p role="status" className="text-sm font-medium flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{progress || "Working"}</p>}
          {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          {!busy && rows.length > 0 && (
            <p className="text-sm font-semibold" data-testid="text-counts">
              {phase === "finished"
                ? `${ok} applied or already set, ${rows.length - ok} excluded or blocked (of ${rows.length})`
                : `${eligible} eligible, ${count("unchanged")} unchanged, ${count("skipped")} excluded, ${count("blocked")} blocked (of ${rows.length})`}
            </p>
          )}
          {(codeSaved || phase === "finished") && (
            <p role="status" className="text-sm rounded-md border p-3" data-testid="text-code-saved">
              {codeSaved ? `Code ${promo.code.toUpperCase()} saved for future redemptions.` : "Code not saved."}
            </p>
          )}
          <div className="space-y-2 max-h-64 overflow-y-auto" data-testid="free2027-conversion-rows">
            {rows.map((r) => (
              <div key={r.organizationId} className="rounded-lg border p-3" data-testid={`conv-row-${r.organizationId}`}>
                <div className="flex justify-between gap-3">
                  <span className="font-semibold text-sm">{r.organizationName}</span>
                  <span className="text-xs uppercase shrink-0">{r.status === "skipped" ? "Excluded" : r.status}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{r.reason}</p>
                {(r.currentTerms || r.proposedTerms) && <p className="text-xs mt-1">{r.currentTerms} {r.proposedTerms ? `-> ${r.proposedTerms}` : ""}</p>}
              </div>
            ))}
          </div>
          {phase === "ready" && interrupted.current && <Button variant="outline" onClick={() => void check()} data-testid="btn-free2027-resume">Resume checking</Button>}
          {phase === "ready" && (
            <Button onClick={() => void confirm()} disabled={cantConfirm} className="h-auto min-h-10 whitespace-normal" data-testid="btn-free2027-confirm">
              {eligible
                ? `Confirm: save code and apply to ${eligible} ${eligible === 1 ? "organization" : "organizations"}`
                : "Confirm: save code for future redemptions only"}
            </Button>
          )}
          {phase === "finished" && (
            <div className="flex flex-wrap gap-2">
              {applyFailed && retryable.length > 0 && (
                <Button variant="outline" onClick={() => void apply(retryable)} data-testid="btn-free2027-retry">Retry {retryable.length} blocked (same review)</Button>
              )}
              {applyFailed && <p className="text-xs text-muted-foreground w-full">If an organization changed since review, close and run a new review.</p>}
              <Button onClick={onDone} data-testid="btn-free2027-done">Done</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
