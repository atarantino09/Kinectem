import { useRoute, useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Landing page for `/claim/competition/<token>` secret competition-claim
// links (mirrors ClaimOrgPage). The platform admin copies these to each
// ownerless competition's organizer; possessing the link is the
// authorization, so opening it and signing up makes the recipient the
// operator directly. An unauthenticated visitor is sent to signup/login with
// returnTo, and on return the claim is finalized automatically.
// Hand-written customFetch — these endpoints have no openapi.yaml entry.

type ClaimResolve = {
  competition: {
    id: string;
    slug: string;
    name: string;
    type: string;
    startDate: string;
    endDate: string;
    location: string | null;
    logoUrl: string | null;
    brandColor: string | null;
    secondaryColor: string | null;
    promoCode: string | null;
  };
  alreadyClaimed: boolean;
};

export default function ClaimCompetitionPage() {
  const [, params] = useRoute("/claim/competition/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: me } = useGetLoggedInUser();
  const [claiming, setClaiming] = useState(false);

  const resolve = useQuery<ClaimResolve>({
    queryKey: ["competition-claim-link", token],
    queryFn: () =>
      customFetch<ClaimResolve>(
        `/api/v1/competition-claim-links/${encodeURIComponent(token)}`,
        { method: "GET" },
      ),
    enabled: !!token,
    retry: false,
  });

  // Guard so the auto-claim effect fires the POST at most once per mount.
  const attempted = useRef(false);

  const competitionName = resolve.data?.competition.name;

  const finalize = useCallback(async () => {
    setClaiming(true);
    try {
      const res = await customFetch<{
        ok: boolean;
        competitionId: string;
        slug: string;
        promoCode: string | null;
      }>(
        `/api/v1/competition-claim-links/${encodeURIComponent(token)}/claim`,
        { method: "POST" },
      );
      toast({
        title: `You now run ${competitionName || "this competition"}!`,
        ...(res.promoCode
          ? {
              description: `Your promo code ${res.promoCode} is ready — it's already filled into your team invite message, so it goes out automatically when you send your invites.`,
              duration: 10000,
            }
          : {}),
      });
      // Land the new operator on their console (not the public page) so the
      // first-run "show me around" walkthrough can greet them there.
      navigate(`/competitions/${encodeURIComponent(res.competitionId)}`);
    } catch (err) {
      toast({
        title: (err as Error)?.message ?? "Couldn't claim this competition",
        variant: "destructive",
      });
      // Re-fetch so an "already claimed" race re-renders the right state.
      attempted.current = false;
      void resolve.refetch();
    } finally {
      setClaiming(false);
    }
  }, [token, competitionName, toast, navigate, resolve]);

  // Auto-finalize as soon as an authenticated visitor lands on a valid,
  // unclaimed link — including the roundtrip back from signup/login.
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

  const { competition, alreadyClaimed } = resolve.data;

  return (
    <div className="min-h-screen max-w-xl mx-auto p-6 space-y-4">
      <Card className="rounded-xl border-border" data-testid="card-competition-claim">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            {competition.logoUrl ? (
              <img
                src={competition.logoUrl}
                alt=""
                className="w-12 h-12 rounded-lg object-contain bg-muted shrink-0 p-1"
              />
            ) : (
              <div
                className="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center text-white"
                style={{
                  background: competition.brandColor
                    ? competition.secondaryColor
                      ? `linear-gradient(135deg, ${competition.brandColor} 0%, ${competition.secondaryColor} 100%)`
                      : competition.brandColor
                    : "hsl(var(--primary))",
                }}
              >
                <Trophy className="w-6 h-6" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground capitalize">
                Claim this {competition.type}
              </p>
              <h1 className="text-xl font-black tracking-tight truncate">
                {competition.name}
              </h1>
              <p className="text-xs text-muted-foreground">
                {competition.startDate} → {competition.endDate}
                {competition.location ? ` · ${competition.location}` : ""}
              </p>
            </div>
          </div>

          {!alreadyClaimed && competition.promoCode && (
            <div
              className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm"
              data-testid="text-competition-claim-promo"
            >
              <p className="font-bold text-emerald-800 dark:text-emerald-300">
                Promo code included:{" "}
                <span className="font-mono">{competition.promoCode}</span>
              </p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                Once you claim this {competition.type}, this code is already
                filled into your team invite message — no setup needed when
                you send out your invites.
              </p>
            </div>
          )}

          {alreadyClaimed ? (
            <div className="space-y-2">
              <p className="text-sm" data-testid="text-competition-already-claimed">
                This competition has already been claimed and now has an
                operator. If this is your competition and you need access,
                please contact support.
              </p>
              <Link href={`/competitions/c/${encodeURIComponent(competition.slug)}`}>
                <Button variant="outline" className="font-bold w-full">
                  View competition
                </Button>
              </Link>
            </div>
          ) : !me ? (
            <div className="space-y-2">
              <p className="text-sm">
                Create your Kinectem account (or sign in) to become the
                operator of this competition.
              </p>
              <Link
                href={`/login?signup=1&returnTo=${encodeURIComponent(`/claim/competition/${token}`)}`}
              >
                <Button
                  className="font-bold w-full"
                  data-testid="btn-competition-claim-signup"
                >
                  Sign up to claim
                </Button>
              </Link>
              <Link
                href={`/login?returnTo=${encodeURIComponent(`/claim/competition/${token}`)}`}
              >
                <Button
                  variant="outline"
                  className="font-bold w-full"
                  data-testid="btn-competition-claim-signin"
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
                  ? `Setting you up as the operator of ${competition.name}…`
                  : `Tap below if claiming ${competition.name} doesn't start automatically.`}
              </p>
              <Button
                className="font-bold w-full"
                disabled={claiming}
                onClick={finalize}
                data-testid="btn-competition-claim-finalize"
              >
                {claiming ? "Claiming…" : `Claim ${competition.name}`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
