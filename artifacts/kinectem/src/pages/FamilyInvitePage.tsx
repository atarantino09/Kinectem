import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWhoami } from "@/hooks/useWhoami";

type Invite = {
  kind: "guardian" | "contact";
  status: "pending" | "active" | "declined";
  child: { id: string; displayName: string };
  invitedBy: string | null;
  access: "parent" | "legal_guardian" | "updates-only";
};

export default function FamilyInvitePage() {
  const [, params] = useRoute("/family-invites/:kind/:id");
  const kind = params?.kind ?? "";
  const id = params?.id ?? "";
  const path = `/family-invites/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const whoami = useWhoami();
  const authenticated = whoami.data?.authenticated === true;
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [declined, setDeclined] = useState(false);
  const invite = useQuery<Invite>({
    queryKey: ["family-invitation", kind, id, whoami.data?.viewingAs?.id ?? whoami.data?.realUser?.id],
    queryFn: () => customFetch<Invite>(`/api/v1/family-invitations/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`),
    enabled: authenticated && !!id && (kind === "guardian" || kind === "contact"),
    retry: false,
  });

  const decide = async (action: "accept" | "decline") => {
    if (!invite.data || working) return;
    setWorking(true);
    setError("");
    try {
      const endpoint = invite.data.kind === "guardian"
        ? `/api/v1/guardian-links/${encodeURIComponent(id)}/${action}`
        : `/api/v1/family-contacts/${encodeURIComponent(id)}/${action}`;
      await customFetch(endpoint, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["whoami"] });
      if (action === "decline") {
        setDeclined(true);
      } else if (invite.data.kind === "contact") {
        navigate(`/users/${invite.data.child.id}`);
      } else {
        navigate(`/family?child=${encodeURIComponent(invite.data.child.id)}`);
      }
    } catch (err) {
      setError((err as { body?: { error?: string }; message?: string })?.body?.error ??
        (err as Error)?.message ?? "Could not update this invitation.");
    } finally {
      setWorking(false);
    }
  };

  const loginHref = `/login?returnTo=${encodeURIComponent(path)}`;
  const signupHref = `/login?signup=${kind === "guardian" ? "parent" : "family"}&returnTo=${encodeURIComponent(path)}`;
  return (
    <main className="min-h-screen bg-background px-4 py-14">
      <div className="mx-auto max-w-lg">
        <Link href="/" className="font-black text-2xl text-primary">Kinectem</Link>
        <Card className="mt-8 rounded-2xl">
          <CardContent className="p-6 sm:p-8 space-y-5" data-testid="family-invite-landing">
            <h1 className="text-2xl font-black">Your family invitation</h1>
            {whoami.isLoading || (authenticated && invite.isLoading) ? (
              <Skeleton className="h-32 w-full" />
            ) : declined ? (
              <div className="space-y-3">
                <p>Invitation declined. No family access was added.</p>
                <Link href="/"><Button variant="outline">Go home</Button></Link>
              </div>
            ) : !authenticated ? (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Create an account or sign in with the email address that received this invitation.
                  Then you can review who invited you and choose whether to accept.
                </p>
                <Link href={signupHref}><Button variant="brand" className="w-full" data-testid="family-invite-signup">Create account</Button></Link>
                <Link href={loginHref}><Button variant="outline" className="w-full" data-testid="family-invite-signin">Sign in</Button></Link>
              </div>
            ) : invite.isError || !invite.data ? (
              <div className="space-y-3">
                <p className="text-muted-foreground">
                  This invitation isn't available for this account. It may have been withdrawn or
                  addressed to a different email. Sign in with the address that received the invitation.
                </p>
                <Button variant="outline" onClick={async () => {
                  await customFetch("/api/v1/auth/logout", { method: "POST" });
                  qc.clear();
                  window.location.assign(import.meta.env.BASE_URL + loginHref.slice(1));
                }}>Use another account</Button>
              </div>
            ) : (
              <div className="space-y-4" data-testid="family-invite-confirmation">
                {invite.data.status === "pending" ? <>
                  <p><strong>{invite.data.invitedBy ?? "A guardian"}</strong> invited you to
                    {invite.data.kind === "guardian" ? ` become ${invite.data.child.displayName}'s ${invite.data.access === "legal_guardian" ? "legal guardian" : "parent"}` :
                      ` follow ${invite.data.child.displayName}'s updates`}.</p>
                  <p className="text-sm text-muted-foreground">
                    {invite.data.kind === "guardian"
                      ? "Accepting links you as a guardian with family management and applicable consent permissions."
                      : "You'll see permitted child and team activity and receive updates. You cannot manage the child's account, make consent decisions, edit their profile, or gain roster or coaching permissions."}
                  </p>
                  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                  <div className="flex gap-3">
                    <Button variant="outline" disabled={working} onClick={() => void decide("decline")} data-testid="family-invite-decline">Decline</Button>
                    <Button variant="brand" disabled={working} onClick={() => void decide("accept")} data-testid="family-invite-accept">{working ? "Working…" : "Accept invitation"}</Button>
                  </div>
                </> : (
                  <div className="space-y-3">
                    <p>{invite.data.status === "active" ? "You already accepted this invitation." : "This invitation was declined."}</p>
                    {invite.data.status === "active" &&
                      <Link href={invite.data.kind === "contact" ? `/users/${invite.data.child.id}` : `/family?child=${invite.data.child.id}`}>
                        <Button variant="brand">Continue to {invite.data.child.displayName}</Button>
                      </Link>}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}