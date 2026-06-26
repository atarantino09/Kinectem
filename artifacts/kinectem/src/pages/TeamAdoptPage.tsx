import { useRoute, useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  customFetch,
  useGetLoggedInUser,
  useListUserOrganizations,
  queryOpts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { TeamAvatar } from "@/components/UserAvatar";
import { CreateOrgDialog } from "@/components/CreateOrgDialog";
import { useToast } from "@/hooks/use-toast";

// Landing page for `/adopt-team/<token>` coach-generated adopt links. A solo
// team's coach mints the link and shares it with their organization admin, who
// opens it here, confirms WHICH organization to pull the team into (or creates
// one inline), and reparents it. Unlike the org-claim link, this is NOT a
// silent auto-claim: the org admin must pick the target org, and the finalize
// still gates server-side on them being an owner/admin of that org. The token
// is single-use — consumed on success. Hand-written customFetch — these
// endpoints have no openapi.yaml entry.

type AdoptResolve = {
  team: {
    id: string;
    name: string;
    sport: string | null;
    logoUrl: string | null;
  };
  alreadyAdopted: boolean;
};

export default function TeamAdoptPage() {
  const [, params] = useRoute("/adopt-team/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: me } = useGetLoggedInUser();

  const [orgId, setOrgId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const resolve = useQuery<AdoptResolve>({
    queryKey: ["team-adopt-link", token],
    queryFn: () =>
      customFetch<AdoptResolve>(
        `/api/v1/team-adopt-links/${encodeURIComponent(token)}`,
        { method: "GET" },
      ),
    enabled: !!token,
    retry: false,
  });

  const { data: orgsResp } = useListUserOrganizations(me?.id ?? "", undefined, {
    query: queryOpts({ enabled: !!me?.id }),
  });
  const manageableOrgs = useMemo(
    () =>
      (orgsResp?.data ?? []).filter(
        (o) => o.role === "owner" || o.role === "admin",
      ),
    [orgsResp],
  );

  const team = resolve.data?.team;

  async function finalize(
    targetOrgId: string,
    opts?: { newlyCreated?: boolean },
  ) {
    if (!targetOrgId) return;
    setSubmitting(true);
    try {
      const res = await customFetch<{ ok: boolean; teamId: string }>(
        `/api/v1/team-adopt-links/${encodeURIComponent(token)}/claim`,
        {
          method: "POST",
          body: JSON.stringify({ organizationId: targetOrgId }),
        },
      );
      toast({
        title: "Team adopted",
        description: `${team?.name ?? "This team"} is now part of your organization with full features.`,
      });
      // When the org was just created inline, send the new owner to the
      // subscribe/payment page first — same as the normal org-creation flow —
      // instead of dropping them straight on the team page.
      if (opts?.newlyCreated) {
        navigate(`/organizations/${targetOrgId}/subscribe`);
      } else {
        navigate(`/teams/${res.teamId}`);
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't adopt team",
        description:
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
      });
      // Re-fetch so an "already adopted" race re-renders the right state.
      void resolve.refetch();
    } finally {
      setSubmitting(false);
    }
  }

  if (resolve.isLoading) {
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6 space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  if (resolve.isError || !resolve.data) {
    const message =
      (resolve.error as Error | null)?.message ??
      "This adopt link is invalid or no longer valid.";
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6">
        <Card className="rounded-xl border-border">
          <CardContent className="p-6 text-center space-y-2">
            <h1 className="text-xl font-black tracking-tight">
              Adopt link unavailable
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

  const { alreadyAdopted } = resolve.data;

  return (
    <div className="min-h-screen max-w-xl mx-auto p-6 space-y-4">
      <Card className="rounded-xl border-border" data-testid="card-team-adopt">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <TeamAvatar
              avatarUrl={team?.logoUrl}
              displayName={team?.name ?? "Team"}
              size="xl"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">
                Adopt this team into your organization
              </p>
              <h1 className="text-xl font-black tracking-tight truncate">
                {team?.name}
              </h1>
              {team?.sport ? (
                <p className="text-xs text-muted-foreground capitalize">
                  {team.sport}
                </p>
              ) : null}
            </div>
          </div>

          {alreadyAdopted ? (
            <div className="space-y-2">
              <p className="text-sm" data-testid="text-already-adopted">
                This team already belongs to an organization. If you need
                access, ask its organization owner to add you.
              </p>
              <Link href={`/teams/${team?.id}`}>
                <Button variant="outline" className="font-bold w-full">
                  View team
                </Button>
              </Link>
            </div>
          ) : !me ? (
            <div className="space-y-2">
              <p className="text-sm">
                Sign in (or create your Kinectem account) to adopt this team
                into one of your organizations.
              </p>
              <Link
                href={`/login?returnTo=${encodeURIComponent(`/adopt-team/${token}`)}`}
              >
                <Button
                  className="font-bold w-full"
                  data-testid="btn-adopt-signin"
                >
                  Sign in to continue
                </Button>
              </Link>
              <Link
                href={`/login?signup=1&returnTo=${encodeURIComponent(`/adopt-team/${token}`)}`}
              >
                <Button
                  variant="outline"
                  className="font-bold w-full"
                  data-testid="btn-adopt-signup"
                >
                  I need an account
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">
                Pick the organization to adopt{" "}
                <span className="font-bold">{team?.name}</span> into. It keeps
                its roster and recap history, and recap authoring is no longer
                limited to the tournament window.
              </p>
              {manageableOrgs.length > 0 && (
                <Select value={orgId} onValueChange={setOrgId}>
                  <SelectTrigger data-testid="select-adopt-org">
                    <SelectValue placeholder="Choose an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {manageableOrgs.map((o) => (
                      <SelectItem
                        key={o.id}
                        value={o.id}
                        data-testid={`option-adopt-org-${o.id}`}
                      >
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {manageableOrgs.length > 0 ? (
                <Button
                  onClick={() => finalize(orgId)}
                  disabled={!orgId || submitting}
                  className="font-bold w-full"
                  data-testid="btn-adopt-confirm"
                >
                  {submitting ? "Adopting…" : "Adopt team"}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You don't own or manage an organization yet. Create one to
                  adopt this team into it.
                </p>
              )}
              <Button
                variant="outline"
                onClick={() => setCreateOpen(true)}
                disabled={submitting}
                className="font-bold w-full"
                data-testid="btn-adopt-create-org"
              >
                Create a new organization
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateOrgDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(org) => finalize(org.id, { newlyCreated: true })}
      />
    </div>
  );
}
