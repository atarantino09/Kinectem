import { useRoute, useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// `/claim/<token>` secret org-claim links (Task #850). Rather than a small
// landing card, the link now drops the recipient onto the REAL public org
// page — fully previewable without an account — carrying the token as a
// `?claimToken=` query param. OrganizationPage renders the red
// "Claim Organization" banner (see ClaimTokenBanner.tsx) which owns the
// signup hand-off and claim finalization. Already-claimed links land on the
// plain page; invalid links keep the small error card here.
// Hand-written customFetch — these endpoints have no openapi.yaml entry.

type ClaimResolve = {
  organization: { id: string };
  alreadyClaimed: boolean;
};

export default function ClaimOrgPage() {
  const [, params] = useRoute("/claim/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();

  const resolve = useQuery<ClaimResolve>({
    queryKey: ["org-claim-link", token],
    queryFn: () =>
      customFetch<ClaimResolve>(
        `/api/v1/org-claim-links/${encodeURIComponent(token)}`,
        { method: "GET" },
      ),
    enabled: !!token,
    retry: false,
  });

  const data = resolve.data;
  useEffect(() => {
    if (!data) return;
    // Keep the token on already-claimed links too so the page can explain
    // why there's no claim button (banner shows an informational notice).
    const dest = `/organizations/${data.organization.id}?claimToken=${encodeURIComponent(token)}`;
    navigate(dest, { replace: true });
  }, [data, token, navigate]);

  if (resolve.isError) {
    const message =
      (resolve.error as Error | null)?.message ??
      "This claim link is invalid or no longer valid.";
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6">
        <Card className="rounded-xl border-border">
          <CardContent className="p-6 text-center space-y-2">
            <h1 className="text-xl font-black tracking-tight">
              Claim link unavailable
            </h1>
            <p className="text-sm text-muted-foreground">{message}</p>
            <Link href="/">
              <Button variant="outline" className="font-bold mt-2">
                Go home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-xl mx-auto p-6 space-y-4">
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
    </div>
  );
}
