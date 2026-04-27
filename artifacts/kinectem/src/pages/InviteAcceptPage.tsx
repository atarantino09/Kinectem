import { useEffect, useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ChildSetupCard,
  type AddedChild,
} from "@/components/invite-accept/ChildSetupCard";
import { InviteHeaderCard } from "@/components/invite-accept/InviteHeaderCard";

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
  organization: { id: string; name: string };
}

export default function InviteAcceptPage() {
  const [, params] = useRoute("/invites/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: me } = useGetLoggedInUser();

  const [envelope, setEnvelope] = useState<InviteEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [needsChildSetup, setNeedsChildSetup] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [savingChild, setSavingChild] = useState(false);
  const [children, setChildren] = useState<AddedChild[]>([]);

  useEffect(() => {
    if (!token) return;
    customFetch<InviteEnvelope>(`/api/v1/invites/${token}`)
      .then((r) => setEnvelope(r))
      .catch((e) => setError((e as Error).message ?? "Invite not found"))
      .finally(() => setLoading(false));
  }, [token]);

  const isPlayerInvite = envelope?.invite.position === "player";
  const childHint = envelope?.invite.invitedName ?? "";

  const onAccept = async () => {
    if (!me) {
      navigate("/login");
      return;
    }
    setAccepting(true);
    try {
      const r = await customFetch<{ requiresChildSetup?: boolean }>(
        `/api/v1/invites/${token}/accept`,
        { method: "POST" },
      );
      setAccepted(true);
      if (r.requiresChildSetup) {
        setNeedsChildSetup(true);
        if (childHint) {
          const parts = childHint.trim().split(/\s+/);
          setFirstName(parts[0] ?? "");
          setLastName(parts.slice(1).join(" "));
        }
      } else {
        toast({ title: "Welcome to the team!" });
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

  const onAddChild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      toast({ title: "First and last name required", variant: "destructive" });
      return;
    }
    setSavingChild(true);
    try {
      const r = await customFetch<{ child: AddedChild }>(
        `/api/v1/invites/${token}/children`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
          }),
        },
      );
      setChildren((prev) => [...prev, r.child]);
      setFirstName("");
      setLastName("");
      toast({ title: `Added ${r.child.firstName} to the roster` });
    } catch (err) {
      toast({
        title: (err as Error).message ?? "Failed to add child",
        variant: "destructive",
      });
    } finally {
      setSavingChild(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-xl mx-auto p-6 space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error || !envelope) {
    return (
      <div className="max-w-xl mx-auto p-6">
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
    <div className="max-w-xl mx-auto p-6 space-y-4">
      <InviteHeaderCard
        organizationName={envelope.organization.name}
        teamName={envelope.team.name}
        isPlayerInvite={isPlayerInvite}
        positionLabel={envelope.invite.position ?? envelope.invite.role}
        childHint={childHint}
        loggedIn={!!me}
        accepted={accepted}
        needsChildSetup={needsChildSetup}
        accepting={accepting}
        token={token}
        onAccept={onAccept}
      />
      {needsChildSetup && (
        <ChildSetupCard
          children={children}
          firstName={firstName}
          lastName={lastName}
          saving={savingChild}
          onFirstNameChange={setFirstName}
          onLastNameChange={setLastName}
          onSubmit={onAddChild}
          onFinish={() => navigate(`/teams/${envelope.team.id}`)}
        />
      )}
    </div>
  );
}
