import { useRoute, useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Loader2 } from "lucide-react";
import { useWhoami } from "@/hooks/useWhoami";
import { formatOrgName } from "@/lib/format";

// `/claim/<token>` secret org-claim links (Task #850). Rather than a small
// landing card, the link now drops the recipient onto the REAL public org
// page — fully previewable without an account — carrying the token as a
// `?claimToken=` query param. OrganizationPage renders the red
// "Claim Organization" banner (see ClaimTokenBanner.tsx) which owns the
// signup hand-off and claim finalization. Already-claimed links land on the
// plain page; invalid links keep the small error card here.
// Hand-written customFetch — these endpoints have no openapi.yaml entry.

type ClaimResolve = {
  organization: { id: string; name: string };
  alreadyClaimed: boolean;
};

export function getClaimOrgRedirect({
  organizationId,
  organizationName,
  token,
  alreadyClaimed,
  signedIn,
}: {
  organizationId: string;
  organizationName: string;
  token: string;
  alreadyClaimed: boolean;
  signedIn: boolean;
}): string {
  const destination = `/organizations/${organizationId}?claimToken=${encodeURIComponent(token)}`;
  if (alreadyClaimed || signedIn) return destination;
  const returnTo = `${destination}&autoClaim=1`;
  return `/login?signup=1&claimOrg=${encodeURIComponent(organizationName)}&returnTo=${encodeURIComponent(returnTo)}`;
}

export default function ClaimOrgPage() {
  const [, params] = useRoute("/claim/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { data: who, isLoading: whoamiLoading } = useWhoami();

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
    if (!data || whoamiLoading) return;
    navigate(
      getClaimOrgRedirect({
        organizationId: data.organization.id,
        organizationName: data.organization.name,
        token,
        alreadyClaimed: data.alreadyClaimed,
        signedIn: who?.authenticated === true,
      }),
      { replace: true },
    );
  }, [data, token, navigate, who?.authenticated, whoamiLoading]);

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
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <Card className="w-full max-w-md rounded-2xl border-border shadow-sm">
        <CardContent
          className="flex flex-col items-center p-8 text-center"
          data-testid="org-claim-preparing"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {data ? (
              <Building2 className="h-6 w-6" />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin" />
            )}
          </div>
          <h1 className="text-xl font-black tracking-tight">
            Preparing your invitation
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {data
              ? `Opening your secure invitation to become the owner of ${formatOrgName(data.organization.name)}…`
              : "Confirming your secure organization invitation…"}
          </p>
          <div className="mt-5 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Taking you to account setup
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
