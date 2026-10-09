import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { FamilySetup } from "@/components/family-setup/FamilySetup";
import { loadDraft } from "@/lib/family-setup";
import { InviteHeaderCard } from "@/components/invite-accept/InviteHeaderCard";
import { InviteBenefitsCard } from "@/components/invite-accept/InviteBenefitsCard";

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
  organization: { id: string; name: string };
}

export default function InviteAcceptPage() {
  const [, params] = useRoute("/invites/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useGetLoggedInUser();

  const [envelope, setEnvelope] = useState<InviteEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [needsChildSetup, setNeedsChildSetup] = useState(false);
  const autoStarted = useRef<string | null>(null);

  const myId = me?.id ?? null;
  useEffect(() => {
    if (!token) return;
    customFetch<InviteEnvelope>(`/api/v1/invites/${token}`)
      .then((r) => setEnvelope(r))
      .catch((e) => setError((e as Error).message ?? "Invite not found"))
      .finally(() => setLoading(false));
  }, [token]);

  // Resume after refresh: a saved draft for this user and invitation, or an
  // already accepted player invite, reopens family setup.
  useEffect(() => {
    if (!myId || !envelope || needsChildSetup) return;
    if (
      loadDraft(myId, `team:${token}`) ||
      (envelope.invite.status === "accepted" && envelope.invite.position === "player")
    ) {
      setNeedsChildSetup(true);
    }
  }, [myId, envelope, token, needsChildSetup]);

  const isPlayerInvite = envelope?.invite.position === "player";
  const childHint = envelope?.invite.invitedName ?? "";
  const acceptedState = accepted || envelope?.invite.status === "accepted";

  const onAccept = async () => {
    if (!me) {
      navigate("/login");
      return;
    }
    setAccepting(true);
    try {
      const r = await customFetch<{
        requiresChildSetup?: boolean;
        multiTeam?: boolean;
        teamIds?: string[];
      }>(
        `/api/v1/invites/${token}/accept`,
        { method: "POST" },
      );
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
        setNeedsChildSetup(true);
      } else {
        toast({
          title: r.multiTeam ? "Welcome to your teams!" : "Welcome to the team!",
        });
        navigate(`/teams/${envelope!.team.id}`);
      }
    } catch (e) {
      toast({
        title: (e as Error).message ?? "Failed to accept invite",
        variant: "destructive",
      });
    } finally {
      setAccepting(false);
    }
  };

  // A signed-in parent already completed step 1. Validate the invite through
  // the same server gate, then open step 2 without another confirmation page.
  // Guard by user+token so rerenders/StrictMode cannot send repeated requests;
  // a rejected invite retains the existing explicit retry action.
  useEffect(() => {
    if (!myId || !isPlayerInvite || needsChildSetup) return;
    const key = `${myId}:${token}`;
    if (autoStarted.current === key) return;
    autoStarted.current = key;
    void onAccept();
  }, [myId, isPlayerInvite, token, needsChildSetup]);

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
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-xl mx-auto p-6 space-y-4">
      <InviteHeaderCard
        organizationName={envelope.organization.name}
        teamName={envelope.team.name}
        teamNames={envelope.teams?.map((team) => team.name)}
        isPlayerInvite={isPlayerInvite}
        positionLabel={envelope.invite.position ?? envelope.invite.role}
        childHint={childHint}
        loggedIn={!!me}
        accepted={acceptedState}
        needsChildSetup={needsChildSetup}
        accepting={accepting}
        token={token}
        onAccept={onAccept}
      />
      {/* Hide the explainer once the invite is accepted so attention
          moves to the success state / child-setup next action. */}
      {!acceptedState && <InviteBenefitsCard />}
      {needsChildSetup && myId && (
        <FamilySetup
          key={`${myId}:team:${token}`}
          userId={myId}
          mode="team"
          token={token}
          teamName={envelope.team.name}
          childHint={childHint}
          onDone={() =>
            navigate(
              `/family?tour=1&next=${encodeURIComponent(`/teams/${envelope.team.id}`)}`,
            )
          }
        />
      )}
    </div>
  );
}
