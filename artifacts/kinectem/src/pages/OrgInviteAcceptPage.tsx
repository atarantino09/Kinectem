import { useRoute, useLocation, Link } from "wouter";
import {
  usePreviewOrganizationInvite,
  useAcceptOrganizationInvite,
  useGetLoggedInUser,
  getListMembersQueryKey,
  getListUserOrganizationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Shield, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/format";

// Task #541 — Landing page for `/org-invites/<token>` emails. Mirrors the
// roster-invite accept page but is scoped to organization membership. The
// preview endpoint is public so we can render the org/role even before
// the recipient signs in.
export default function OrgInviteAcceptPage() {
  const [, params] = useRoute("/org-invites/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useGetLoggedInUser();

  const preview = usePreviewOrganizationInvite(token);
  const accept = useAcceptOrganizationInvite({
    mutation: {
      onSuccess: async (member) => {
        const orgId = preview.data?.organization.id;
        toast({
          title: `Welcome to ${preview.data?.organization.name ?? "the organization"}!`,
        });
        if (orgId) {
          await Promise.all([
            qc.invalidateQueries({ queryKey: getListMembersQueryKey(orgId) }),
            me?.id
              ? qc.invalidateQueries({
                  queryKey: getListUserOrganizationsQueryKey(me.id),
                })
              : Promise.resolve(),
          ]);
          navigate(`/organizations/${orgId}`);
        } else {
          navigate("/");
        }
        void member;
      },
      onError: (err: unknown) => {
        toast({
          title: (err as Error)?.message ?? "Couldn't accept invite",
          variant: "destructive",
        });
      },
    },
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
      (preview.error as Error | null)?.message ?? "Invite not found or no longer valid.";
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
  const RoleIcon = invite.role === "admin" ? Shield : User;
  const roleLabel = invite.role === "admin" ? "Admin" : "Member";

  return (
    <div className="min-h-screen max-w-xl mx-auto p-6 space-y-4">
      <Card className="rounded-xl border-border" data-testid="card-org-invite">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12">
              {invite.organization.avatarUrl ? (
                <AvatarImage
                  src={invite.organization.avatarUrl}
                  alt={invite.organization.name}
                />
              ) : null}
              <AvatarFallback className="bg-slate-900 text-primary-foreground font-bold">
                {getInitials(invite.organization.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">
                You've been invited to join
              </p>
              <h1 className="text-xl font-black tracking-tight truncate">
                {invite.organization.name}
              </h1>
              <Badge variant="secondary" className="mt-1 text-[10px] font-bold gap-1">
                <RoleIcon className="w-3 h-3" /> {roleLabel}
              </Badge>
            </div>
          </div>
          {invite.invitedBy ? (
            <p className="text-sm text-muted-foreground">
              Invited by <span className="font-bold">{invite.invitedBy.displayName}</span>
            </p>
          ) : null}
          {!me ? (
            <div className="space-y-2">
              <p className="text-sm">
                Sign in or create a Kinectem account to accept this invite.
              </p>
              <Link
                href={`/login?next=${encodeURIComponent(`/org-invites/${token}`)}`}
              >
                <Button
                  className="font-bold w-full"
                  data-testid="btn-org-invite-signin"
                >
                  Sign in to accept
                </Button>
              </Link>
            </div>
          ) : (
            <Button
              className="font-bold w-full"
              disabled={accept.isPending}
              onClick={() => accept.mutate({ token })}
              data-testid="btn-org-invite-accept"
            >
              {accept.isPending ? "Accepting…" : `Join ${invite.organization.name}`}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
