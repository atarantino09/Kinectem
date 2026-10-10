import { useEffect } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { REFERRAL_STORAGE_KEY } from "@/components/CompetitionReferralField";

export default function CompetitionReferralPage() {
  const { code = "" } = useParams<{ code: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["competition-referral-resolve", code],
    queryFn: () => customFetch<{ competitionName: string; referralCode: string }>(`/api/v1/competition-referrals/resolve/${encodeURIComponent(code)}`),
    retry: false,
  });
  useEffect(() => {
    if (data) {
      try { sessionStorage.setItem(REFERRAL_STORAGE_KEY, data.referralCode); } catch { /* Show the tag for manual entry below. */ }
    }
  }, [data]);
  return <main className="max-w-xl mx-auto px-4 py-12">
    <Card><CardContent className="p-6 space-y-5">
      {isLoading ? <p>Loading your offer…</p> : error || !data ? <p role="alert">This competition referral link isn’t valid. Ask the organizer for a new link.</p> : <>
        <p className="text-sm font-semibold">{data.competitionName}</p>
        <h1 className="text-3xl font-bold">Free org access with FREE2027</h1>
        <p>Create your account, then create or select your organization and choose a plan.</p>
        <p>Free through July 31, 2027. Your first annual payment is August 1, 2027 at full price—no discount. Add a card before billing begins.</p>
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
          <p><strong>Promo code:</strong> FREE2027</p>
          <p className="break-all"><strong>Competition referral:</strong> {data.referralCode.toUpperCase()}</p>
          <p className="text-sm">Your plan setup will fill these in for you. This credits {data.competitionName} without changing your price. If they aren’t filled in, paste the two codes in their separate fields.</p>
        </div>
        <Button asChild className="w-full"><Link href="/organizations/mine?new=1">Continue to organization setup</Link></Button>
        <p className="text-xs text-muted-foreground">Existing unpaid organizations are eligible too. An organization can be credited to one competition.</p>
      </>}
    </CardContent></Card>
  </main>;
}
