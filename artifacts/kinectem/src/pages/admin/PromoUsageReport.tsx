import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Download, Loader2 } from "lucide-react";

type Usage = {
  id: string;
  code: string;
  organizationName: string;
  organizationId: string;
  actorName: string | null;
  actorEmail: string | null;
  appliedAt: string | null;
  plan: string;
  discountType: "percent" | "amount";
  discountValue: number;
  endedAt: string | null;
  endReason: string | null;
  billingStatus: string;
  billedAt: string | null;
  actualDiscountCents: number | null;
};
type Report = { data: Usage[]; total: number; pageSize: number; legacyExcluded: boolean; legacy: Usage[]; legacyTotal: number };

const billingLabels: Record<string, string> = {
  not_billed: "Not billed yet",
  discounted_paid: "Yes — discount on paid invoice",
  discounted_no_charge: "Discount on $0 invoice",
  paid_without_discount: "Paid without this discount",
  discount_on_unpaid_invoice: "Discount on unpaid invoice",
  verification_unavailable: "Could not verify with Stripe",
  unknown: "Unknown",
};

function UsageTable({ rows }: { rows: Usage[] }) {
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[1040px] text-left text-sm">
      <thead><tr className="border-b text-muted-foreground">
        <th className="p-2">Code</th><th className="p-2">Organization</th><th className="p-2">Applied by</th>
        <th className="p-2">Applied (UTC)</th><th className="p-2">Plan / discount</th><th className="p-2">Status</th>
        <th className="p-2">Billing result</th><th className="p-2">Paid (UTC)</th>
      </tr></thead>
      <tbody>{rows.map((row) => (
        <tr key={row.id} className="border-b">
          <td className="p-2 font-semibold">{row.code}</td>
          <td className="p-2">{row.organizationName}<div className="text-xs text-muted-foreground">{row.organizationId}</div></td>
          <td className="p-2">{row.actorName ?? "Unknown"}{row.actorEmail && <div className="text-xs text-muted-foreground">{row.actorEmail}</div>}</td>
          <td className="p-2">{row.appliedAt ? new Date(row.appliedAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) : "Legacy — exact time unknown"}</td>
          <td className="p-2 capitalize">{row.plan} · {row.discountType === "percent" ? `${row.discountValue}%` : `$${row.discountValue} off`}</td>
          <td className="p-2">{row.endedAt ? (row.endReason === "replaced" ? "Replaced" : "Removed") : "Current"}</td>
          <td className="p-2">{billingLabels[row.billingStatus] ?? "Unknown"}{row.actualDiscountCents != null && <div className="text-xs text-muted-foreground">${(row.actualDiscountCents / 100).toFixed(2)} discount</div>}</td>
          <td className="p-2">{row.billedAt ? new Date(row.billedAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
        </tr>
      ))}</tbody>
    </table>
  </div>;
}

export function quarterDates(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3;
  return {
    from: `${year}-${String(startMonth + 1).padStart(2, "0")}-01`,
    to: new Date(Date.UTC(year, startMonth + 3, 0)).toISOString().slice(0, 10),
  };
}

export function PromoUsageReport() {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const [year, setYear] = useState(currentYear);
  const [quarter, setQuarter] = useState(currentQuarter);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();
  const valid = !from || !to || from <= to;
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  params.set("page", String(page));
  const { data, isLoading, isFetching, error } = useQuery<Report>({
    queryKey: ["admin", "promo-usage", from, to, page],
    queryFn: () => customFetch<Report>(`/api/v1/admin/promo-usage?${params}`),
    enabled: valid,
  });
  const apply = (dates: { from: string; to: string }) => {
    setFrom(dates.from);
    setTo(dates.to);
    setPage(1);
  };
  const previous = currentQuarter === 1
    ? { year: currentYear - 1, quarter: 4 }
    : { year: currentYear, quarter: currentQuarter - 1 };
  const exportCsv = async () => {
    setExporting(true);
    try {
      const csvParams = new URLSearchParams(params);
      csvParams.delete("page");
      csvParams.set("format", "csv");
      const blob = await customFetch<Blob>(
        `/api/v1/admin/promo-usage?${csvParams}`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `promo-usage${from || to ? `-${from || "start"}-to-${to || "end"}` : ""}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast({ title: "Could not export usage", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card data-testid="promo-usage-report">
      <CardHeader>
        <CardTitle className="text-base">Usage history</CardTitle>
        <p className="text-sm text-muted-foreground">
          Dates and quarter boundaries use UTC. Billing results are checked against Stripe invoices when available.
          Older applications without a recorded date cannot be assigned to a quarter; they appear separately below and in the export.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label htmlFor="usage-from">From (UTC)</Label>
            <Input id="usage-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1"><Label htmlFor="usage-to">Through (UTC)</Label>
            <Input id="usage-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </div>
          <Button variant="outline" onClick={() => apply({ from: "", to: "" })}>Clear filter</Button>
          <Button variant="outline" onClick={() => apply(quarterDates(currentYear, currentQuarter))}>Current quarter</Button>
          <Button variant="outline" onClick={() => apply(quarterDates(previous.year, previous.quarter))}>Previous quarter</Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label htmlFor="usage-quarter">Quarter</Label>
            <select id="usage-quarter" className="h-10 rounded-md border bg-background px-3" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label htmlFor="usage-year">Year</Label>
            <Input id="usage-year" type="number" min={2000} max={9998} className="w-28" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          <Button variant="outline" disabled={!Number.isInteger(year) || year < 2000 || year > 9998} onClick={() => apply(quarterDates(year, quarter))}>Apply quarter</Button>
          <Button onClick={exportCsv} disabled={!valid || isLoading || !!error || exporting}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />} Export CSV
          </Button>
        </div>
        {!valid && <p role="alert" className="text-sm text-destructive">Start date must be on or before end date.</p>}
        {valid && (isLoading || isFetching) && <p className="text-sm text-muted-foreground">Loading usage…</p>}
        {valid && error && <p role="alert" className="text-sm text-destructive">Could not load usage: {error instanceof Error ? error.message : "Try again."}</p>}
        {valid && !isLoading && !isFetching && !error && data && (
          <>
            <p className="text-sm text-muted-foreground">
              {data.total} dated application{data.total === 1 ? "" : "s"} match.
              {data.legacyExcluded && ` ${data.legacyTotal} older application${data.legacyTotal === 1 ? "" : "s"} ${data.legacyTotal === 1 ? "has" : "have"} an unknown date and ${data.legacyTotal === 1 ? "is" : "are"} not counted in this range.`}
            </p>
            {data.total === 0 ? <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No dated applications in this range.</p> : <UsageTable rows={data.data} />}
            {data.legacyExcluded && data.legacyTotal > 0 && <section className="space-y-2" aria-label="Applications with unknown date">
              <h3 className="font-semibold">Earlier applications — date unknown</h3>
              <p className="text-sm text-muted-foreground">These cannot be attributed to the selected quarter. The CSV includes them clearly marked as undated.{data.legacyTotal > data.legacy.length && " Clear the filter to see all earlier applications."}</p>
              <UsageTable rows={data.legacy} />
            </section>}
            {data.total > data.pageSize && <div className="flex items-center justify-end gap-3">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-sm">Page {page} of {Math.ceil(data.total / data.pageSize)}</span>
              <Button variant="outline" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}