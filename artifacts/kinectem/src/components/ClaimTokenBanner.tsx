import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatOrgName } from "@/lib/format";

// Task #850 — claim links now land directly on the real public org /
// competition page (so the recipient sees exactly what they'd own) with a
// prominent red "Claim ..." banner. The secret token rides along as a
// `?claimToken=` query param; ClaimOrgPage / ClaimCompetitionPage redirect
// here. `autoClaim=1` is appended to the returnTo used for signup/sign-in so
// the claim finalizes automatically on the roundtrip back — a plain visit
// with a token requires one explicit click instead.

export function useClaimTokenParams(): { token: string; autoClaim: boolean } {
  const search = useSearch();
  const params = new URLSearchParams(search);
  return {
    token: params.get("claimToken") ?? "",
    autoClaim: params.get("autoClaim") === "1",
  };
}

function baseUrl(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

type OrgClaimResolve = {
  organization: { id: string; name: string };
  alreadyClaimed: boolean;
  promo?: {
    code: string;
    description: string | null;
    discountType: string;
    discountValue: number;
  } | null;
};

function promoDiscountLabel(
  promo: NonNullable<OrgClaimResolve["promo"]>,
): string {
  return promo.discountType === "percent"
    ? `${promo.discountValue}% off your first year`
    : `$${promo.discountValue} off your first year`;
}

function BannerShell({
  children,
  testid,
}: {
  children: React.ReactNode;
  testid: string;
}) {
  return (
    <div
      className="rounded-xl border-2 border-red-600 bg-red-50 dark:bg-red-950/40 p-4 space-y-3"
      data-testid={testid}
    >
      {children}
    </div>
  );
}

function ClaimActions({
  me,
  claiming,
  onClaim,
  claimLabel,
  returnTo,
  testidPrefix,
}: {
  me: unknown;
  claiming: boolean;
  onClaim: () => void;
  claimLabel: string;
  returnTo: string;
  testidPrefix: string;
}) {
  if (me) {
    return (
      <Button
        className="font-bold bg-red-600 hover:bg-red-700 text-white"
        disabled={claiming}
        onClick={onClaim}
        data-testid={`btn-${testidPrefix}-claim`}
      >
        {claiming ? "Claiming…" : claimLabel}
      </Button>
    );
  }
  const encoded = encodeURIComponent(returnTo);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link href={`/login?signup=1&returnTo=${encoded}`}>
        <Button
          className="font-bold bg-red-600 hover:bg-red-700 text-white"
          data-testid={`btn-${testidPrefix}-claim`}
        >
          {claimLabel}
        </Button>
      </Link>
      <Link
        href={`/login?returnTo=${encoded}`}
        className="text-sm font-bold underline underline-offset-2"
        data-testid={`link-${testidPrefix}-signin`}
      >
        Already have an account? Sign in
      </Link>
    </div>
  );
}

export function OrgClaimBanner({ orgId }: { orgId: string }) {
  const { token, autoClaim } = useClaimTokenParams();
  const { toast } = useToast();
  const { data: me } = useGetLoggedInUser();
  const [claiming, setClaiming] = useState(false);
  const attempted = useRef(false);

  const resolve = useQuery<OrgClaimResolve>({
    queryKey: ["org-claim-link", token],
    queryFn: () =>
      customFetch<OrgClaimResolve>(
        `/api/v1/org-claim-links/${encodeURIComponent(token)}`,
        { method: "GET" },
      ),
    enabled: !!token,
    retry: false,
  });

  const finalize = useCallback(async () => {
    setClaiming(true);
    try {
      const res = await customFetch<{ ok: boolean; organizationId: string }>(
        `/api/v1/org-claim-links/${encodeURIComponent(token)}/claim`,
        { method: "POST" },
      );
      toast({
        title: `You now own ${formatOrgName(resolve.data?.organization.name) || "this page"}!`,
      });
      // Task #808 — flag the post-claim coach-setup prompt; OrganizationPage
      // consumes it on mount, so finish with a full navigation (token param
      // dropped) to remount the page as the new owner.
      try {
        sessionStorage.setItem(
          `kinectem:coach-setup:${res.organizationId}`,
          "1",
        );
        sessionStorage.setItem(
          `kinectem:pre-invite-org:${res.organizationId}`,
          "1",
        );
        sessionStorage.setItem(
          `kinectem:ownership-handoff:${res.organizationId}`,
          "1",
        );
      } catch {
        // sessionStorage unavailable — the owner can invite coaches later.
      }
      window.location.assign(
        `${baseUrl()}/organizations/${res.organizationId}`,
      );
    } catch (err) {
      toast({
        title: (err as Error)?.message ?? "Couldn't claim this page",
        variant: "destructive",
      });
      // Deliberately do NOT reset the auto-attempt guard: the automatic
      // claim fires at most one POST, and after a failure the visitor
      // retries explicitly via the red button.
      void resolve.refetch();
      setClaiming(false);
    }
  }, [token, toast, resolve]);

  // Auto-finalize only on the roundtrip back from signup/sign-in
  // (autoClaim=1 in the returnTo) — a logged-in visitor just opening the
  // link gets the red button and claims with one explicit click.
  const canAutoClaim =
    autoClaim && !!me && !!resolve.data && !resolve.data.alreadyClaimed;
  useEffect(() => {
    if (canAutoClaim && !attempted.current) {
      attempted.current = true;
      void finalize();
    }
  }, [canAutoClaim, finalize]);

  if (!token) return null;

  if (resolve.isError) {
    return (
      <BannerShell testid="banner-org-claim-invalid">
        <p className="text-sm font-bold">This claim link is no longer valid.</p>
        <p className="text-sm text-muted-foreground">
          You're viewing the public page below. If you believe you should own
          this page, please contact support.
        </p>
      </BannerShell>
    );
  }

  const data = resolve.data;
  if (!data || data.organization.id !== orgId) return null;

  if (data.alreadyClaimed) {
    return (
      <BannerShell testid="banner-org-already-claimed">
        <p className="text-sm font-bold">
          This page has already been claimed and now has an owner.
        </p>
        <p className="text-sm text-muted-foreground">
          You're viewing the public page below. If this is your organization
          and you need access, please contact support.
        </p>
      </BannerShell>
    );
  }

  const returnTo = `/organizations/${orgId}?claimToken=${encodeURIComponent(token)}&autoClaim=1`;

  return (
    <BannerShell testid="banner-org-claim">
      <div>
        <p className="text-sm font-black">
          You've been invited to claim {formatOrgName(data.organization.name)}.
        </p>
        <p className="text-sm text-muted-foreground">
          This is exactly what your page looks like. Claim it to become the
          owner and start managing teams, posts, and members.
        </p>
      </div>
      {data.promo && (
        <div
          className="rounded-md border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 px-3 py-2 text-sm"
          data-testid="claim-promo-banner"
        >
          <span className="font-bold">
            Promo code {data.promo.code.toUpperCase()} is already applied
          </span>{" "}
          — {promoDiscountLabel(data.promo)} when you set up billing.
        </div>
      )}
      <ClaimActions
        me={me}
        claiming={claiming}
        onClaim={finalize}
        claimLabel={
          claiming ? "Claiming…" : autoClaim && me ? "Claiming…" : "Claim Organization"
        }
        returnTo={returnTo}
        testidPrefix="org"
      />
    </BannerShell>
  );
}

type CompetitionClaimResolve = {
  competition: {
    id: string;
    slug: string;
    name: string;
    type: string;
    promoCode: string | null;
  };
  alreadyClaimed: boolean;
};

// Shared resolve query (deduped by queryKey) so CompetitionPage can also
// react to a valid unclaimed token — e.g. auto-expanding the "How your
// competition works" walkthrough for the prospective operator (Task #851).
export function useCompetitionClaimResolve(token: string) {
  return useQuery<CompetitionClaimResolve>({
    queryKey: ["competition-claim-link", token],
    queryFn: () =>
      customFetch<CompetitionClaimResolve>(
        `/api/v1/competition-claim-links/${encodeURIComponent(token)}`,
        { method: "GET" },
      ),
    enabled: !!token,
    retry: false,
  });
}

export function CompetitionClaimBanner({ slug }: { slug: string }) {
  const { token, autoClaim } = useClaimTokenParams();
  const { toast } = useToast();
  const { data: me } = useGetLoggedInUser();
  const [claiming, setClaiming] = useState(false);
  const attempted = useRef(false);

  const resolve = useCompetitionClaimResolve(token);

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
        title: `You now run ${resolve.data?.competition.name || "this competition"}!`,
        ...(res.promoCode
          ? {
              description: `Your promo code ${res.promoCode} is ready — it's already filled into your team invite message, so it goes out automatically when you send your invites.`,
              duration: 10000,
            }
          : {}),
      });
      // Land the new operator on their console (not the public page) so the
      // first-run walkthrough can greet them there. Full navigation so the
      // app remounts with the operator's session state.
      window.location.assign(
        `${baseUrl()}/competitions/${encodeURIComponent(res.competitionId)}`,
      );
    } catch (err) {
      toast({
        title: (err as Error)?.message ?? "Couldn't claim this competition",
        variant: "destructive",
      });
      // One-shot: never reset the auto-attempt guard; retries are explicit.
      void resolve.refetch();
      setClaiming(false);
    }
  }, [token, toast, resolve]);

  const canAutoClaim =
    autoClaim && !!me && !!resolve.data && !resolve.data.alreadyClaimed;
  useEffect(() => {
    if (canAutoClaim && !attempted.current) {
      attempted.current = true;
      void finalize();
    }
  }, [canAutoClaim, finalize]);

  if (!token) return null;

  if (resolve.isError) {
    return (
      <BannerShell testid="banner-competition-claim-invalid">
        <p className="text-sm font-bold">This claim link is no longer valid.</p>
        <p className="text-sm text-muted-foreground">
          You're viewing the public page below. If you believe you should run
          this competition, please contact support.
        </p>
      </BannerShell>
    );
  }

  const data = resolve.data;
  if (!data || data.competition.slug !== slug) return null;

  if (data.alreadyClaimed) {
    return (
      <BannerShell testid="banner-competition-already-claimed">
        <p className="text-sm font-bold">
          This competition has already been claimed and now has an operator.
        </p>
        <p className="text-sm text-muted-foreground">
          You're viewing the public page below. If this is your competition
          and you need access, please contact support.
        </p>
      </BannerShell>
    );
  }

  const returnTo = `/c/${encodeURIComponent(slug)}?claimToken=${encodeURIComponent(token)}&autoClaim=1`;

  return (
    <BannerShell testid="banner-competition-claim">
      <div>
        <p className="text-sm font-black">
          You've been invited to claim {data.competition.name}.
        </p>
        <p className="text-sm text-muted-foreground">
          This is exactly what your {data.competition.type} page looks like.
          Claim it to become the operator — brand it, import your schedule,
          and invite your teams.
        </p>
      </div>
      {data.competition.promoCode && (
        <div
          className="rounded-md border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 px-3 py-2 text-sm"
          data-testid="text-competition-claim-promo"
        >
          <span className="font-bold">
            Promo code included:{" "}
            <span className="font-mono">{data.competition.promoCode}</span>
          </span>{" "}
          — it's already filled into your team invite message.
        </div>
      )}
      <ClaimActions
        me={me}
        claiming={claiming}
        onClaim={finalize}
        claimLabel={claiming ? "Claiming…" : "Claim Competition"}
        returnTo={returnTo}
        testidPrefix="competition"
      />
    </BannerShell>
  );
}
