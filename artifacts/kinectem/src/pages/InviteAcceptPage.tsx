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
  type LinkedChildOption,
} from "@/components/invite-accept/ChildSetupCard";
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
  organization: { id: string; name: string };
}

interface MyChildRow {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
}

interface TeamMembershipRow {
  userId: string;
  position?: string | null;
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

  const [linkedChildren, setLinkedChildren] = useState<LinkedChildOption[]>([]);
  const [linkedChildrenLoaded, setLinkedChildrenLoaded] = useState(false);
  const [alreadyOnTeam, setAlreadyOnTeam] = useState<Set<string>>(new Set());
  const [addingChildId, setAddingChildId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    customFetch<InviteEnvelope>(`/api/v1/invites/${token}`)
      .then((r) => setEnvelope(r))
      .catch((e) => setError((e as Error).message ?? "Invite not found"))
      .finally(() => setLoading(false));
  }, [token]);

  // Once the parent triggers child-setup, fetch their linked children plus
  // the team's existing roster so we can show "On team" state correctly.
  useEffect(() => {
    if (!needsChildSetup || !envelope || !me) return;
    let cancelled = false;
    (async () => {
      try {
        const [kidsRes, rosterRes] = await Promise.all([
          customFetch<{ data: MyChildRow[] }>("/api/v1/users/me/children"),
          customFetch<{ data: TeamMembershipRow[] }>(
            `/api/v1/teams/${envelope.team.id}/members?limit=200`,
          ).catch(() => ({ data: [] as TeamMembershipRow[] })),
        ]);
        if (cancelled) return;
        setLinkedChildren(
          (kidsRes.data ?? []).map((c) => ({
            id: c.id,
            firstName: c.firstName ?? "",
            lastName: c.lastName ?? "",
            avatarUrl: c.avatarUrl ?? null,
          })),
        );
        setAlreadyOnTeam(
          new Set((rosterRes.data ?? []).map((r) => r.userId)),
        );
        setLinkedChildrenLoaded(true);
      } catch {
        if (!cancelled) {
          setLinkedChildren([]);
          setAlreadyOnTeam(new Set());
          setLinkedChildrenLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsChildSetup, envelope, me]);

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

  const onAddExistingChild = async (childId: string) => {
    setAddingChildId(childId);
    try {
      const r = await customFetch<{ child: AddedChild }>(
        `/api/v1/invites/${token}/children`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ childId }),
        },
      );
      setChildren((prev) => [...prev, r.child]);
      setAlreadyOnTeam((prev) => {
        const next = new Set(prev);
        next.add(childId);
        return next;
      });
      toast({ title: `Added ${r.child.firstName} to the roster` });
    } catch (err) {
      // If the server says the child is already rostered (e.g. our local
      // `alreadyOnTeam` set was stale), treat it as a non-error: just flip
      // the row to its "On team" state and surface a neutral toast.
      const code = (err as { code?: string } | null)?.code;
      const message = (err as Error)?.message ?? "Failed to add child";
      if (code === "ALREADY_ON_ROSTER" || /already on/i.test(message)) {
        setAlreadyOnTeam((prev) => {
          const next = new Set(prev);
          next.add(childId);
          return next;
        });
        toast({ title: "This child is already on the team's roster." });
      } else {
        toast({ title: message, variant: "destructive" });
      }
    } finally {
      setAddingChildId(null);
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
      // Surface the brand-new child in the chooser too, marked as on-team,
      // so the parent sees a single consistent list as they add more.
      setLinkedChildren((prev) =>
        prev.some((c) => c.id === r.child.id)
          ? prev
          : [
              ...prev,
              {
                id: r.child.id,
                firstName: r.child.firstName,
                lastName: r.child.lastName,
                avatarUrl: r.child.avatarUrl ?? null,
              },
            ],
      );
      setAlreadyOnTeam((prev) => {
        const next = new Set(prev);
        next.add(r.child.id);
        return next;
      });
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
      {/* Hide the explainer once the invite is accepted so attention
          moves to the success state / child-setup next action. */}
      {!accepted && <InviteBenefitsCard />}
      {needsChildSetup && (
        <ChildSetupCard
          children={children}
          linkedChildren={linkedChildren}
          linkedChildrenLoaded={linkedChildrenLoaded}
          alreadyOnTeam={alreadyOnTeam}
          firstName={firstName}
          lastName={lastName}
          saving={savingChild}
          addingChildId={addingChildId}
          onFirstNameChange={setFirstName}
          onLastNameChange={setLastName}
          onAddExistingChild={onAddExistingChild}
          onSubmit={onAddChild}
          onFinish={() => navigate(`/teams/${envelope.team.id}`)}
        />
      )}
    </div>
  );
}
