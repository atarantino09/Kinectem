import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type ReferralRow = {
  organizationId: string; organizationName: string; plan: string | null; status: string;
  billingStartsAt: string | null; expectedCommissionCents: number | null; commissionCents: number;
  paidAt: string | null; stripeInvoiceId: string | null;
};
type Report = { referralCode: string; competitionName: string; data: ReferralRow[]; checkedSubscriptions?: number };
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function CompetitionReferralReport({ competitionId, preview = false }: { competitionId: string; preview?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["competition-referrals", competitionId];
  const { data, isLoading, error } = useQuery({
    queryKey: key, queryFn: () => customFetch<Report>(`/api/v1/competitions/${competitionId}/referrals`),
    enabled: !preview, staleTime: 30_000, refetchInterval: 60_000,
  });
  const sync = useMutation({
    mutationFn: () => customFetch<Report>(`/api/v1/competitions/${competitionId}/referrals/sync-payments`, { method: "POST" }),
    onSuccess: (report) => { qc.setQueryData(key, report); toast({ title: report.checkedSubscriptions ? "Payment history refreshed" : "No saved-card subscriptions to verify" }); },
    onError: (err) => toast({ title: "Payments could not be verified", description: err instanceof Error ? err.message : "Try again later.", variant: "destructive" }),
  });
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast({ title: "Copied" }); }
    catch { toast({ title: "Could not copy. Select and copy the text instead.", variant: "destructive" }); }
  };
  if (preview) return <p className="text-sm">Your competition’s FREE2027 referral link and signup report appear here after you claim it.</p>;
  if (isLoading) return <p role="status">Loading referral tracking…</p>;
  if (error || !data) return <p role="alert" className="text-sm text-destructive">Could not load competition referrals. Refresh to try again.</p>;
  const link = `${window.location.origin}${import.meta.env.BASE_URL}referrals/${data.referralCode}`;
  const earned = data.data.reduce((sum, row) => sum + row.commissionCents, 0);
  const expected = data.data.filter((r) => r.status === "awaiting_payment").reduce((sum, r) => sum + (r.expectedCommissionCents ?? 0), 0);
  const message = `Your club can get free access to Kinectem through July 31, 2027 with FREE2027. Choose an organization plan using this link: ${link}\nYour first annual payment is August 1, 2027 at full price (no discount). The link includes our competition referral tag. If entering manually, use promo FREE2027 and competition referral ${data.referralCode.toUpperCase()} in the separate fields.`;
  return <div className="space-y-4" data-testid="competition-referral-report">
    <p className="text-sm">Share your unique link. Clubs use <strong>FREE2027</strong> for free access through July 31, 2027, and your separate referral tag credits this competition. You earn <strong>15% of the first full-price annual payment collected, excluding tax</strong>, starting August 1, 2027. No commission is earned until payment succeeds.</p>
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <p className="text-xs font-semibold">Your competition referral tag</p>
      <p className="font-mono text-sm break-all">{data.referralCode.toUpperCase()}</p>
      <p className="text-xs break-all">{link}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void copy(link)}>Copy signup link</Button>
        <Button size="sm" variant="outline" onClick={() => void copy(data.referralCode.toUpperCase())}>Copy referral tag</Button>
        <Button size="sm" variant="outline" onClick={() => void copy(message)}>Copy invite message</Button>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-2 text-sm">
      <div className="rounded-lg border p-3"><strong>{data.data.length}</strong><p>Referred orgs</p></div>
      <div className="rounded-lg border p-3"><strong>{money(expected)}</strong><p>Expected, unpaid</p></div>
      <div className="rounded-lg border p-3"><strong>{money(earned)}</strong><p>Earned, not paid out</p></div>
    </div>
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-semibold">Referred organizations</h3>
      <Button size="sm" variant="outline" disabled={sync.isPending || !data.data.length} onClick={() => sync.mutate()}>{sync.isPending ? "Verifying…" : "Verify payments"}</Button>
    </div>
    {!data.data.length ? <p className="text-sm text-muted-foreground">No organizations have used this referral tag yet.</p> :
      <div className="space-y-2">{data.data.map((row) => <div key={row.organizationId} className="rounded-lg border p-3 text-sm space-y-1">
        <p className="font-semibold">{row.organizationName}</p>
        <p>{row.plan ? `${row.plan.charAt(0).toUpperCase()}${row.plan.slice(1)} plan` : "Plan not selected"} · {row.status === "earned" ? "Payment collected — commission earned" : row.status === "canceled" ? "Subscription canceled — no payment verified" : "Waiting for first payment"}</p>
        <p>{row.status === "earned" ? `Earned commission: ${money(row.commissionCents)}` : `Expected commission: ${row.expectedCommissionCents === null ? "available after plan selection" : money(row.expectedCommissionCents)}`}</p>
        {row.billingStartsAt && <p className="text-xs">First charge: {new Date(row.billingStartsAt).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" })}</p>}
        {row.stripeInvoiceId && <p className="text-xs break-all">Verified invoice: {row.stripeInvoiceId}</p>}
      </div>)}</div>}
    <p className="text-xs text-muted-foreground">Signup tracking works without Stripe. Verified invoices are required for earned commissions. This report does not send payouts; review refunds and cancellations before paying commissions.</p>
  </div>;
}
