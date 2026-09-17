import { useRoute, useLocation, Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2, ShieldCheck, Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Task #745 — landing page for `/admin-invites/<token>` emails: become an
// admin of a competition hub or a single competition. Mirrors the
// org-invite accept page. The preview endpoint is public so we can render
// the target before the recipient signs in; accept requires auth (and the
// server blocks minor accounts — COPPA). customFetch — routes are outside
// the locked openapi.yaml.

interface InvitePreview {
  id: string;
  status: string;
  invitedEmail: string;
  target: {
    kind: "hub" | "competition";
    id: string;
    name: string;
    slug: string;
  };
  invitedBy: { id: string; displayName: string } | null;
  willBecomeOwner?: boolean;
}

interface AcceptResponse {
  ok: true;
  accessRole: "owner" | "admin";
  target: InvitePreview["target"];
}

export default function AdminInviteAcceptPage() {
  const [, params] = useRoute("/admin-invites/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useGetLoggedInUser();

  const preview = useQuery<InvitePreview>({
    queryKey: ["admin-invite-preview", token],
    queryFn: () =>
      customFetch<InvitePreview>(
        `/api/v1/admin-invites/${encodeURIComponent(token)}/preview`,
        { method: "GET" },
      ),
    enabled: !!token,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () =>
      customFetch<AcceptResponse>(
        `/api/v1/admin-invites/${encodeURIComponent(token)}/accept`,
        { method: "POST" },
      ),
    onSuccess: (r) => {
      toast({
        title: `You're now ${r.accessRole === "owner" ? "the owner" : "an admin"} of ${r.target.name}`,
      });
      qc.invalidateQueries({ queryKey: ["my", "organizers"] });
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      navigate(
        r.target.kind === "hub"
          ? `/competitions/o/${r.target.slug}`
          : `/competitions/${r.target.id}`,
      );
    },
    onError: (err) =>
      toast({
        title: "Couldn't accept the invite",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      }),
  });

  if (preview.isLoading) {
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6 space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  if (preview.isError || !preview.data) {
    const message =
      (preview.error as Error | null)?.message ??
      "Invite not found or no longer valid.";
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6">
        <Card className="rounded-xl border-border">
          <CardContent className="p-6 text-center space-y-2">
            <h1 className="text-xl font-black tracking-tight">
              Invite unavailable
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

  const invite = preview.data;
  const TargetIcon = invite.target.kind === "hub" ? Building2 : Trophy;
  const targetLabel =
    invite.target.kind === "hub" ? "Competition hub" : "Competition";
  const roleLabel = invite.willBecomeOwner ? "Owner" : "Admin";

  return (
    <div className="min-h-screen max-w-xl mx-auto p-6 space-y-4">
      <Card className="rounded-xl border-border" data-testid="card-admin-invite">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted">
              <TargetIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">
                You've been invited to help run
              </p>
              <h1 className="text-xl font-black tracking-tight truncate">
                {invite.target.name}
              </h1>
              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] font-bold">
                  {targetLabel}
                </Badge>
                <Badge
                  variant="secondary"
                  className="text-[10px] font-bold gap-1"
                >
                  <ShieldCheck className="w-3 h-3" /> {roleLabel}
                </Badge>
              </div>
            </div>
          </div>
          {invite.invitedBy ? (
            <p className="text-sm text-muted-foreground">
              Invited by{" "}
              <span className="font-bold">{invite.invitedBy.displayName}</span>
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {invite.target.kind === "hub"
              ? invite.willBecomeOwner
                ? "As the hub owner, you can manage this hub and every competition in it — including schedules, branding, claims, and recap curation."
                : "As a hub admin you can manage every competition in this hub — schedules, branding, claims, and recap curation."
              : "As an admin you can manage this competition — schedule, branding, claims, and recap curation."}
          </p>
          {!me ? (
            <div className="space-y-2">
              <p className="text-sm">
                Sign in or create a Kinectem account to accept this invite.
              </p>
              <Link
                href={`/login?next=${encodeURIComponent(`/admin-invites/${token}`)}`}
              >
                <Button
                  className="font-bold w-full"
                  data-testid="btn-admin-invite-signin"
                >
                  Sign in to accept
                </Button>
              </Link>
            </div>
          ) : (
            <Button
              className="font-bold w-full"
              disabled={accept.isPending}
              onClick={() => accept.mutate()}
              data-testid="btn-admin-invite-accept"
            >
              {accept.isPending
                ? "Accepting…"
                : `Become ${invite.willBecomeOwner ? "the owner" : "an admin"} of ${invite.target.name}`}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
