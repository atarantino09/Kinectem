import { useRoute, useLocation, Link } from "wouter";
import { formatOrgName } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { useToast } from "@/hooks/use-toast";

// Landing page for `/claim/<token>` secret org-claim links. The operator
// copies these to each ownerless org page; possessing the link is the
// authorization, so opening it and signing up makes the recipient the owner
// directly (no admin-role gate, no review). An unauthenticated visitor is sent
// to signup/login with returnTo, and on return the claim is finalized
// automatically (no extra click) before dropping them on the org page.
// Hand-written customFetch — these endpoints have no openapi.yaml entry.

type ClaimResolve = {
  organization: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    logoUrl: string | null;
  };
  alreadyClaimed: boolean;
};

export default function ClaimOrgPage() {
  const [, params] = useRoute("/claim/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: me } = useGetLoggedInUser();
  const [claiming, setClaiming] = useState(false);

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

  // Guard so the auto-claim effect fires the POST at most once per mount,
  // even across the re-renders that resolve/whoami trigger.
  const attempted = useRef(false);

  const orgName = resolve.data?.organization.name;

  const finalize = useCallback(async () => {
    setClaiming(true);
    try {
      const res = await customFetch<{ ok: boolean; organizationId: string }>(
        `/api/v1/org-claim-links/${encodeURIComponent(token)}/claim`,
        { method: "POST" },
      );
      toast({ title: `You now own ${formatOrgName(orgName) || "this page"}!` });
      navigate(`/organizations/${res.organizationId}`);
    } catch (err) {
      toast({
        title: (err as Error)?.message ?? "Couldn't claim this page",
        variant: "destructive",
      });
      // Re-fetch so an "already claimed" race re-renders the right state, and
      // let the user retry from the button if it was a transient failure.
      attempted.current = false;
      void resolve.refetch();
    } finally {
      setClaiming(false);
    }
  }, [token, orgName, toast, navigate, resolve]);

  // Auto-finalize as soon as an authenticated visitor lands on a valid,
  // unclaimed link — including the roundtrip back from signup/login via
  // returnTo. The token is the authorization, so no extra confirmation click
  // is required.
  const canAutoClaim =
    !!me && !!resolve.data && !resolve.data.alreadyClaimed && !!token;
  useEffect(() => {
    if (canAutoClaim && !attempted.current) {
      attempted.current = true;
      void finalize();
    }
  }, [canAutoClaim, finalize]);

  if (resolve.isLoading) {
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6 space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  if (resolve.isError || !resolve.data) {
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

  const { organization: org, alreadyClaimed } = resolve.data;
  const location = [org.city, org.state].filter(Boolean).join(", ");

  return (
    <div className="min-h-screen max-w-xl mx-auto p-6 space-y-4">
      <Card className="rounded-xl border-border" data-testid="card-org-claim">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <OrgLogo
              logoUrl={org.logoUrl}
              name={org.name}
              className="w-12 h-12 rounded-full shrink-0"
              imgClassName="w-12 h-12 rounded-full object-cover bg-muted shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">
                Claim this organization page
              </p>
              <h1 className="text-xl font-black tracking-tight truncate">
                {formatOrgName(org.name)}
              </h1>
              {location ? (
                <p className="text-xs text-muted-foreground">{location}</p>
              ) : null}
            </div>
          </div>

          {alreadyClaimed ? (
            <div className="space-y-2">
              <p className="text-sm" data-testid="text-already-claimed">
                This page has already been claimed and now has an owner. If this
                is your organization and you need access, please contact
                support.
              </p>
              <Link href={`/organizations/${org.id}`}>
                <Button variant="outline" className="font-bold w-full">
                  View page
                </Button>
              </Link>
            </div>
          ) : !me ? (
            <div className="space-y-2">
              <p className="text-sm">
                Create your Kinectem account (or sign in) to become the owner of
                this page.
              </p>
              <Link
                href={`/login?signup=1&returnTo=${encodeURIComponent(`/claim/${token}`)}`}
              >
                <Button
                  className="font-bold w-full"
                  data-testid="btn-claim-signup"
                >
                  Sign up to claim
                </Button>
              </Link>
              <Link
                href={`/login?returnTo=${encodeURIComponent(`/claim/${token}`)}`}
              >
                <Button
                  variant="outline"
                  className="font-bold w-full"
                  data-testid="btn-claim-signin"
                >
                  I already have an account
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">
                Signed in as{" "}
                <span className="font-bold">
                  {me.firstName} {me.lastName}
                </span>
                .{" "}
                {claiming
                  ? `Setting you up as the owner of ${formatOrgName(org.name)}…`
                  : `Tap below if claiming ${formatOrgName(org.name)} doesn't start automatically.`}
              </p>
              <Button
                className="font-bold w-full"
                disabled={claiming}
                onClick={finalize}
                data-testid="btn-claim-finalize"
              >
                {claiming ? "Claiming…" : `Claim ${formatOrgName(org.name)}`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
