import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const REFERRAL_STORAGE_KEY = "kinectem-pending-competition-referral";
export function pendingCompetitionReferral() {
  try { return sessionStorage.getItem(REFERRAL_STORAGE_KEY) ?? ""; } catch { return ""; }
}
export function clearPendingCompetitionReferral() {
  try { sessionStorage.removeItem(REFERRAL_STORAGE_KEY); } catch { /* Manual entry still works when storage is unavailable. */ }
}
export function CompetitionReferralField({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const code = value.trim().toLowerCase();
  const { data, isFetching, error } = useQuery({
    queryKey: ["competition-referral-resolve", code],
    queryFn: () => customFetch<{ competitionName: string }>(`/api/v1/competition-referrals/resolve/${encodeURIComponent(code)}`),
    enabled: Boolean(code), retry: false,
  });
  return <div className="space-y-2">
    <Label htmlFor="competition-referral-code">Competition referral tag (optional)</Label>
    <Input id="competition-referral-code" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
      placeholder="Paste the competition’s REF-… tag" data-testid="input-competition-referral-tag" />
    <p className="text-xs text-muted-foreground">Separate from FREE2027. This credits the competition’s 15% commission after the first full-price annual payment. It does not change the org’s price.</p>
    {code && <p role={error ? "alert" : "status"} className={`text-sm ${error ? "text-destructive" : "text-foreground"}`}>
      {isFetching ? "Checking competition…" : error ? "Tag not found. Paste the competition referral tag, not its discount code." : data ? `Referral credit: ${data.competitionName}` : ""}
    </p>}
  </div>;
}
