import { useEffect, useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Shield, UserPlus, CheckCircle2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

interface AddedChild {
  id: string;
  firstName: string;
  lastName: string;
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
      {/* Invite context */}
      <Card className="rounded-xl border-border overflow-hidden">
        <div className="bg-gradient-to-br from-purple-600 to-blue-600 p-6 text-white">
          <p className="text-xs uppercase tracking-widest font-bold opacity-90">
            {envelope.organization.name}
          </p>
          <h1 className="text-3xl font-black tracking-tight mt-1">
            You're invited to{" "}
            <span className="underline decoration-white/40">
              {envelope.team.name}
            </span>
          </h1>
          <Badge className="mt-3 bg-white/20 text-white border-white/30 font-bold">
            {isPlayerInvite ? "Player roster" : envelope.invite.position ?? envelope.invite.role}
          </Badge>
        </div>

        <CardContent className="p-6 space-y-4">
          {isPlayerInvite && !accepted && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <Shield className="w-4 h-4 mt-0.5 shrink-0" />
              <p>
                <span className="font-bold">This invite is for a parent or guardian.</span>{" "}
                After you accept, you'll add your child{childHint ? ` (${childHint})` : ""} to the roster — and any siblings on the same team.
              </p>
            </div>
          )}
          {!me && (
            <p className="text-sm text-muted-foreground">
              You'll need to{" "}
              <Link href="/login" className="font-bold text-primary hover:underline">
                sign in or create an account
              </Link>{" "}
              before accepting.
            </p>
          )}
          {!accepted ? (
            <Button
              size="lg"
              onClick={onAccept}
              disabled={accepting}
              className="w-full font-bold rounded-full bg-gradient-to-r from-purple-600 to-blue-600 hover:opacity-90"
              data-testid="btn-accept-invite"
            >
              {accepting
                ? "Accepting..."
                : me
                  ? `Accept invite${isPlayerInvite ? " as guardian" : ""}`
                  : "Sign in to accept"}
            </Button>
          ) : !needsChildSetup ? (
            <div className="flex items-center justify-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              <span className="font-bold">Invite accepted</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Child setup */}
      {needsChildSetup && (
        <Card className="rounded-xl border-border">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start gap-2">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shrink-0">
                <UserPlus className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="font-black tracking-tight">
                  Add your child{children.length > 0 ? "ren" : ""} to the roster
                </h2>
                <p className="text-xs text-muted-foreground">
                  Add as many kids as you have on this team. Each gets their own
                  athlete profile under your guardian account.
                </p>
              </div>
            </div>

            {children.length > 0 && (
              <div className="space-y-2">
                {children.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"
                    data-testid={`row-added-child-${c.id}`}
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span className="font-bold">
                      {c.firstName} {c.lastName}
                    </span>
                    <span className="text-emerald-700 ml-auto text-xs uppercase tracking-wider font-bold">
                      On roster
                    </span>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={onAddChild} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="font-bold text-xs">First name</Label>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jordan"
                    data-testid="input-child-first"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-bold text-xs">Last name</Label>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Carter"
                    data-testid="input-child-last"
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={savingChild}
                className="font-bold rounded-full"
                data-testid="btn-add-child"
              >
                {savingChild ? "Adding..." : "Add child to roster"}
              </Button>
            </form>

            {children.length > 0 && (
              <Button
                variant="outline"
                className="w-full font-bold rounded-full"
                onClick={() => navigate(`/teams/${envelope.team.id}`)}
                data-testid="btn-finish-setup"
              >
                Done — go to team{" "}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
