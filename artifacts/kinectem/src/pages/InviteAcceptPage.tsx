import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { FamilySetup } from "@/components/family-setup/FamilySetup";
import { loadDraft } from "@/lib/family-setup";
import { InviteHeaderCard } from "@/components/invite-accept/InviteHeaderCard";
import { InviteBenefitsCard } from "@/components/invite-accept/InviteBenefitsCard";
import type { WhoamiResponse } from "@/hooks/useWhoami";
import { forgetInviteAccount, hasInviteAccount, rememberInviteAccount } from "@/lib/parent-invite-account";

interface InviteEnvelope {
  invite: {
    id: string;
    role: "player" | "coach";
    position: string | null;
    invitedEmail: string | null;
    invitedName: string | null;
    status: string;
  };
  team: { id: string; name: string };
  teams?: Array<{
    id: string;
    name: string;
    status: string;
    available?: boolean;
  }>;
  multiTeam?: boolean;
  organization: {
    id: string;
    name: string;
    logoUrl?: string | null;
    brandPrimaryColor?: string | null;
    brandSecondaryColor?: string | null;
  };
}

export default function InviteAcceptPage() {
  const [, params] = useRoute("/invites/:token");
  const token = params?.token ?? "";
  return <InviteEntry key={token} token={token} />;
}

function InviteEntry({ token }: { token: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useGetLoggedInUser();

  const [envelope, setEnvelope] = useState<InviteEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [setupAccount, setSetupAccount] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const autoStarted = useRef<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const isPlayerInvite = envelope?.invite.position === "player";
  // Invitation entry must not trust a users/me result left by another session.
  const session = useQuery<WhoamiResponse>({
    queryKey: ["parent-invite-session", token],
    queryFn: () => customFetch("/api/v1/auth/whoami", { method: "GET" }),
    enabled: !!isPlayerInvite,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const account = session.data?.authenticated
    ? session.data.isMasquerading ? session.data.viewingAs : session.data.realUser
    : null;
  const myId = isPlayerInvite ? account?.id ?? null : me?.id ?? null;
  const accountReady = !isPlayerInvite || (session.isFetchedAfterMount && !session.isFetching && !session.isError);
  const accountKey = myId ? `${myId}:${token}` : null;
  const currentKey = useRef(accountKey);
  const identityVersion = useRef(0);
  // Invalidate in-flight results and visible setup immediately on identity change.
  if (currentKey.current !== accountKey) {
    currentKey.current = accountKey;
    identityVersion.current += 1;
  }
  // Keep the validated component mounted during a same-session recheck so its
  // pending writes and in-memory draft cannot be lost. Disable it while checking.
  const needsChildSetup = session.isFetchedAfterMount && !session.isError && !!accountKey && setupAccount === accountKey;
  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(null);
    customFetch<InviteEnvelope>(`/api/v1/invites/${encodeURIComponent(token)}`)
      .then((r) => { if (active) setEnvelope(r); })
      .catch((e) => { if (active) setError((e as Error).message ?? "Invite not found"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, loadAttempt]);

  useEffect(() => {
    setSetupAccount(null);
    setAcceptError(null);
    setAccepted(false);
  }, [accountKey]);

  const childHint = envelope?.invite.invitedName ?? "";
  const acceptedState = accepted || envelope?.invite.status === "accepted";

  const onAccept = async () => {
    if (!myId || !accountReady || !envelope || inFlight.current) {
      if (isPlayerInvite) return;
      navigate("/login");
      return;
    }
    const expectedKey = accountKey;
    const expectedVersion = identityVersion.current;
    const stillCurrent = () => mounted.current && currentKey.current === expectedKey && identityVersion.current === expectedVersion;
    inFlight.current = true;
    setAccepting(true);
    setAcceptError(null);
    try {
      if (isPlayerInvite) {
        const verified = await session.refetch();
        const who = verified.data;
        const user = who?.isMasquerading ? who.viewingAs : who?.realUser;
        if (verified.isError || !who?.authenticated || user?.id !== myId || !stillCurrent()) {
          throw new Error("Your account changed or could not be verified. Check your account and try again.");
        }
      }
      const r = await customFetch<{
        requiresChildSetup?: boolean;
        multiTeam?: boolean;
        teamIds?: string[];
      }>(
        `/api/v1/invites/${encodeURIComponent(token)}/accept`,
        { method: "POST" },
      );
      if (isPlayerInvite) {
        const verified = await session.refetch();
        const who = verified.data;
        const user = who?.isMasquerading ? who.viewingAs : who?.realUser;
        if (verified.isError || !who?.authenticated || user?.id !== myId || !stillCurrent()) {
          throw new Error("Your account changed or could not be verified. Check your account and try again.");
        }
      }
      if (!stillCurrent()) return;
      setAccepted(true);
      // Accepting changes this user's roster status and capabilities on the
      // team. Drop any cached team/member data so the team page we navigate to
      // sees the fresh state immediately (e.g. the coach walkthrough gates on
      // `canManage`, which is derived from the members list).
      await qc.invalidateQueries({
        predicate: (q) => {
          const url =
            Array.isArray(q.queryKey) && typeof q.queryKey[0] === "string"
              ? q.queryKey[0]
              : "";
          const teamIds = envelope!.teams?.map((team) => team.id) ?? [
            envelope!.team.id,
          ];
          return teamIds.some((teamId) => url.includes(`/teams/${teamId}`));
        },
      });
      if (r.requiresChildSetup) {
        rememberInviteAccount(token, myId);
        if (stillCurrent()) setSetupAccount(expectedKey);
      } else {
        toast({
          title: r.multiTeam ? "Welcome to your teams!" : "Welcome to the team!",
        });
        navigate(`/teams/${envelope!.team.id}`);
      }
    } catch (e) {
      if (!stillCurrent()) return;
      setAcceptError((e as Error).message ?? "Failed to accept invite");
      toast({
        title: (e as Error).message ?? "Failed to accept invite",
        variant: "destructive",
      });
    } finally {
      inFlight.current = false;
      if (mounted.current) setAccepting(false);
    }
  };

  // Only invitation-specific completed authentication or this user's own
  // draft may resume. Public "accepted" status never establishes an identity.
  useEffect(() => {
    if (!myId || !isPlayerInvite || !accountReady || needsChildSetup || accepting) return;
    if (!hasInviteAccount(token, myId) && !loadDraft(myId, `team:${token}`)) return;
    const key = `${myId}:${token}`;
    if (autoStarted.current === key) return;
    autoStarted.current = key;
    void onAccept();
  }, [myId, isPlayerInvite, token, needsChildSetup, accountReady, accepting]);

  const switchAccount = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setAccepting(true);
    try {
      await customFetch("/api/v1/auth/logout", { method: "POST" });
      currentKey.current = null;
      identityVersion.current += 1;
      setSetupAccount(null);
      forgetInviteAccount(token);
      await qc.cancelQueries();
      qc.clear();
      const destination = `/login?signup=parent&returnTo=${encodeURIComponent(`/invites/${token}`)}`;
      window.location.assign(import.meta.env.BASE_URL.replace(/\/$/, "") + destination);
    } catch (e) {
      inFlight.current = false;
      setAcceptError((e as Error).message || "Could not switch accounts. Please try again.");
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6 space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error || !envelope) {
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6">
        <Card className="rounded-xl border-border">
          <CardContent className="p-6 text-center space-y-2">
            <h1 className="text-xl font-black tracking-tight">
              Invite not found
            </h1>
            <p className="text-sm text-muted-foreground">
              {error ?? "The invite link may have expired."}
            </p>
            <Link href="/">
              <Button variant="outline" className="font-bold mt-2">
                Go home
              </Button>
            </Link>
            <Button variant="outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry invitation</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-xl mx-auto p-6 space-y-4">
      <InviteHeaderCard
        organizationName={envelope.organization.name}
        organizationBranding={envelope.organization}
        teamName={envelope.team.name}
        teamNames={envelope.teams?.map((team) => team.name)}
        isPlayerInvite={isPlayerInvite}
        positionLabel={envelope.invite.position ?? envelope.invite.role}
        childHint={childHint}
        loggedIn={isPlayerInvite ? !!account && accountReady : !!me}
        accountLabel={account ? `${account.name} (${account.email})` : undefined}
        accountLoading={isPlayerInvite && !accountReady}
        onSwitchAccount={switchAccount}
        accepted={acceptedState}
        needsChildSetup={needsChildSetup}
        accepting={accepting}
        token={token}
        onAccept={onAccept}
      />
      {isPlayerInvite && session.isError && (
        <div role="alert" className="text-sm space-y-2">
          <p>We couldn’t verify your account. Retry before continuing.</p>
          <Button variant="outline" onClick={() => void session.refetch()}>Retry account check</Button>
        </div>
      )}
      {acceptError && <p role="alert" className="text-sm text-destructive">{acceptError} Try again using the continue button above.</p>}
      {/* Hide the explainer once the invite is accepted so attention
          moves to the success state / child-setup next action. */}
      {!acceptedState && <InviteBenefitsCard />}
      {needsChildSetup && myId && (
        <fieldset disabled={session.isFetching} className="min-w-0">
        <FamilySetup
          key={`${myId}:team:${token}`}
          userId={myId}
          mode="team"
          token={token}
          teamName={envelope.team.name}
          organizationName={envelope.organization?.name}
          childHint={childHint}
          verifyAccount={async () => {
            const expectedKey = accountKey;
            const expectedVersion = identityVersion.current;
            const checked = await session.refetch();
            const who = checked.data;
            const user = who?.isMasquerading ? who.viewingAs : who?.realUser;
            if (checked.isError || !who?.authenticated || user?.id !== myId ||
              !mounted.current || currentKey.current !== expectedKey || identityVersion.current !== expectedVersion) {
              throw new Error("Your account changed or could not be verified. Reopen your invitation and check your account before continuing.");
            }
          }}
          onDone={() =>
            navigate(
              `/family?tour=1&next=${encodeURIComponent(`/teams/${envelope.team.id}`)}`,
            )
          }
        />
        </fieldset>
      )}
    </div>
  );
}
