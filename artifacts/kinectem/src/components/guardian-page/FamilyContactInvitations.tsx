import { Link, useLocation } from "wouter";
import { MailOpen, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { useToast } from "@/hooks/use-toast";
import { useFamilyContactInvitations, useRespondToFamilyContactInvite } from "@/hooks/useFamilyContacts";
import { useWhoami } from "@/hooks/useWhoami";

export function FamilyContactInvitations() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: whoami } = useWhoami();
  const invitations = useFamilyContactInvitations(!!(whoami?.viewingAs?.id ?? whoami?.realUser?.id));
  const respond = useRespondToFamilyContactInvite();
  if (invitations.isLoading) return <Skeleton className="h-24 rounded-xl" data-testid="loading-family-contact-invitations" />;
  if (invitations.isError) return <Card className="app-surface"><CardContent className="p-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm">Couldn't load your family invitations.</p><Button variant="outline" size="sm" onClick={() => void invitations.refetch()} data-testid="button-retry-family-invitations">Retry</Button></CardContent></Card>;
  const all = invitations.data?.data ?? [];
  const pending = all.filter((invite) => invite.status === "pending");
  const accepted = all.filter((invite) => invite.status === "accepted" || invite.status === "active");
  if (!pending.length && !accepted.length) return null;
  const act = async (id: string, action: "accept" | "decline") => {
    try {
      await respond.mutateAsync({ id, action });
      toast({ title: action === "accept" ? "Invitation accepted" : "Invitation declined" });
      if (action === "accept") {
        const invite = pending.find((item) => item.id === id);
        if (invite) navigate(`/users/${invite.child.id}`);
      }
    } catch (err) {
      const e = err as { error?: string; message?: string };
      toast({ title: e?.error ?? e?.message ?? "Couldn't update the invitation", variant: "destructive" });
    }
  };
  return <Card className="app-surface" data-testid="card-family-contact-invitations"><CardContent className="p-5 sm:p-6 space-y-4">
    <div className="flex items-center gap-2"><MailOpen className="h-4 w-4 text-primary" /><h2 className="font-black tracking-tight">Family updates</h2></div>
    {pending.length > 0 && <p className="text-sm text-muted-foreground">You've been invited to follow a child's updates. This does not give you account management or consent permissions.</p>}
    <div className="space-y-2">{pending.map((invite) => <div key={invite.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3" data-testid={`card-family-invitation-${invite.id}`}>
      <UserAvatar avatarUrl={invite.child.avatarUrl} displayName={invite.child.displayName} size="sm" />
      <div className="flex-1 min-w-40"><p className="text-sm font-bold">{invite.child.displayName}</p>{invite.invitedBy?.displayName && <p className="text-xs text-muted-foreground">Invited by {invite.invitedBy.displayName}</p>}</div>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={respond.isPending} onClick={() => void act(invite.id, "decline")} data-testid={`button-decline-family-invitation-${invite.id}`}>Decline</Button><Button variant="brand" size="sm" disabled={respond.isPending} onClick={() => void act(invite.id, "accept")} data-testid={`button-accept-family-invitation-${invite.id}`}>Accept</Button></div>
    </div>)}</div>
    {accepted.length > 0 && <div className="space-y-2 border-t border-border pt-4"><p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Children you follow</p>
      {accepted.map((invite) => <div key={invite.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/20 p-3" data-testid={`card-followed-child-${invite.child.id}`}>
        <UserAvatar avatarUrl={invite.child.avatarUrl} displayName={invite.child.displayName} size="sm" />
        <div className="flex-1 min-w-40"><p className="text-sm font-bold">{invite.child.displayName}</p>
          {!!invite.teams?.length && <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{invite.teams.map((team) => <Link key={team.id} href={`/teams/${team.id}`} className="text-xs font-semibold text-primary hover:underline" data-testid={`link-family-team-${team.id}`}>{team.name} schedule <ArrowUpRight className="inline h-3 w-3" /></Link>)}</div>}
        </div>
        <Link href={`/users/${invite.child.id}`} className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline" data-testid={`link-family-child-updates-${invite.child.id}`}>View profile <ArrowUpRight className="h-4 w-4" /></Link>
      </div>)}
    </div>}
  </CardContent></Card>;
}