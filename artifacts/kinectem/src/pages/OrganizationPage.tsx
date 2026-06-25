import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useGetOrganizationById,
  useListOrgTeams,
  useListArchivedOrgTeams,
  queryOpts,
  useListOrgPosts,
  useListMembers,
  useFollowOrg,
  useUnfollowOrg,
  useGetLoggedInUser,
  getGetOrganizationByIdQueryKey,
  getListFeedQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useIsLg } from "@/hooks/use-mobile";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Archive,
  Building2,
  ChevronDown,
  ExternalLink,
  ListPlus,
  Newspaper,
  Pencil,
  Plus,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { AvatarLightbox } from "@/components/AvatarLightbox";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { OrgAdminPanel } from "@/components/OrgAdminPanel";
import {
  OrgSetupChecklist,
  RolesPermissionsCard,
} from "@/components/OrgSetupChecklist";
import { CreateTeamDialog } from "@/components/CreateTeamDialog";
import { BulkAddTeamsDialog } from "@/components/BulkAddTeamsDialog";
import { EditOrgDialog } from "@/components/EditOrgDialog";
import { FollowListDialog } from "@/components/FollowListDialog";
import { NewOrgPostDialog } from "@/components/NewOrgPostDialog";
import { NewsletterDialog } from "@/components/NewsletterDialog";
import { ManageMembersDialog } from "@/components/ManageMembersDialog";
import { OrganizationDescription } from "@/components/organization-page/OrganizationDescription";
import { getInitials, formatOrgName } from "@/lib/format";
import { PLANS, type OrgPlanUsage } from "@/lib/plans";

type TeamRailItem = {
  id: string;
  name: string;
  sport?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  followerCount?: number | null;
};

export default function OrganizationPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [bulkTeamsOpen, setBulkTeamsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [followersOpen, setFollowersOpen] = useState(false);
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [newsletterOpen, setNewsletterOpen] = useState(false);
  const [manageMembersOpen, setManageMembersOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  // Task #443 — celebratory popup shown once right after a successful
  // org create. CreateOrgDialog stashes the org name under
  // `kinectem:welcome-org:<orgId>` and we consume it on mount so a
  // refresh / revisit can never re-trigger the modal.
  const [welcomeOrgName, setWelcomeOrgName] = useState<string | null>(null);
  useEffect(() => {
    if (!orgId) return;
    // After checkout, OrgSubscribePage stashes a bulk-add flag so we land
    // straight on the "Bulk add teams" popup. It takes priority over the
    // org-create welcome popup so the user never sees two modals at once.
    try {
      const bulkKey = `kinectem:bulk-add-org:${orgId}`;
      if (sessionStorage.getItem(bulkKey) === "1") {
        sessionStorage.removeItem(bulkKey);
        sessionStorage.removeItem(`kinectem:welcome-org:${orgId}`);
        setBulkTeamsOpen(true);
        return;
      }
    } catch {
      // sessionStorage unavailable; fall through to the welcome popup.
    }
    let name: string | null = null;
    try {
      const key = `kinectem:welcome-org:${orgId}`;
      name = sessionStorage.getItem(key);
      if (name != null) sessionStorage.removeItem(key);
    } catch {
      // sessionStorage unavailable; nothing to show.
    }
    if (name) setWelcomeOrgName(name);
  }, [orgId]);
  const isLg = useIsLg();
  const { data: me } = useGetLoggedInUser();
  const { data: organization, isLoading } = useGetOrganizationById(orgId);
  const { data: teamsResp } = useListOrgTeams(orgId);
  const { data: archivedTeamsResp } = useListArchivedOrgTeams(
    orgId,
    undefined,
    {
      query: queryOpts({
        enabled:
          !!orgId &&
          (organization?.role === "owner" || organization?.role === "admin"),
      }),
    },
  );
  const { data: postsResp } = useListOrgPosts(orgId);
  const { data: membersResp } = useListMembers(orgId);
  const { data: planUsageResp } = useQuery<{ usage: OrgPlanUsage }>({
    queryKey: ["org-plan-usage", orgId],
    enabled:
      !!orgId &&
      (organization?.role === "owner" || organization?.role === "admin"),
    queryFn: () =>
      customFetch<{ usage: OrgPlanUsage }>(
        `/api/v1/organizations/${orgId}/subscription`,
        { method: "GET" },
      ),
  });
  const followOrg = useFollowOrg();
  const unfollowOrg = useUnfollowOrg();
  const onToggleFollow = async () => {
    if (!organization) return;
    try {
      if (organization.isFollowing) {
        await unfollowOrg.mutateAsync({ orgId });
      } else {
        await followOrg.mutateAsync({ orgId });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetOrganizationByIdQueryKey(orgId) }),
        qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
      ]);
    } catch {
      toast({ title: "Couldn't update follow", variant: "destructive" });
    }
  };

  // Task #603 — submit a claim request for an ownerless org page. Not an
  // instant transfer; a platform admin reviews it before ownership is granted.
  const onClaim = async () => {
    if (!organization) return;
    setClaiming(true);
    try {
      await customFetch(`/api/v1/organizations/${orgId}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await qc.invalidateQueries({
        queryKey: getGetOrganizationByIdQueryKey(orgId),
      });
      toast({
        title: "Claim submitted",
        description: "A moderator will review your request shortly.",
      });
    } catch (e) {
      const msg = (e as Error)?.message ?? "Couldn't submit your claim";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setClaiming(false);
    }
  };

  if (isLoading || !organization) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const teams = teamsResp?.data ?? [];
  const archivedTeams = archivedTeamsResp?.data ?? [];
  const posts = postsResp?.data ?? [];
  const members = membersResp?.data ?? [];
  const isOrgManager =
    organization.role === "admin" || organization.role === "owner";
  const planUsage = planUsageResp?.usage;
  const atTeamLimit =
    !!planUsage &&
    planUsage.teamsLimit != null &&
    planUsage.teamsUsed >= planUsage.teamsLimit;
  // Task #603 — claim affordances for ownerless (bulk-imported) org pages.
  // `hasOwner`/`myClaimStatus` are appended by the server outside the locked
  // openapi.yaml, so read them via a narrow cast.
  const claimInfo = organization as {
    hasOwner?: boolean;
    myClaimStatus?: "pending" | "approved" | "declined" | null;
  };
  const isUnclaimed = claimInfo.hasOwner === false;
  const hasPendingClaim = claimInfo.myClaimStatus === "pending";
  // Only admin-role accounts can claim a page (task eligibility rule).
  const canClaim = isUnclaimed && me?.role === "admin";

  return (
    <>
      <CreateTeamDialog
        orgId={orgId}
        open={createTeamOpen}
        onOpenChange={setCreateTeamOpen}
        usage={planUsage}
      />
      <BulkAddTeamsDialog
        orgId={orgId}
        open={bulkTeamsOpen}
        onOpenChange={setBulkTeamsOpen}
        usage={planUsage}
      />
      <Dialog
        open={welcomeOrgName !== null && isOrgManager}
        onOpenChange={(v) => {
          if (!v) setWelcomeOrgName(null);
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          data-testid="dialog-welcome-org"
        >
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              Congratulations on creating {formatOrgName(welcomeOrgName)}!
            </DialogTitle>
            <DialogDescription>
              Next step: create teams and invite coaches, players, and
              parents so they can start sharing updates and highlights.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setWelcomeOrgName(null)}
              data-testid="btn-welcome-org-dismiss"
            >
              Maybe later
            </Button>
            <Button
              type="button"
              variant="brand"
              onClick={() => {
                setWelcomeOrgName(null);
                setCreateTeamOpen(true);
              }}
              data-testid="btn-welcome-org-create-team"
            >
              Create your first team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NewOrgPostDialog
        orgId={orgId}
        orgName={organization.name}
        open={newPostOpen}
        onOpenChange={setNewPostOpen}
      />
      {isOrgManager && (
        <NewsletterDialog
          orgId={orgId}
          orgName={organization.name}
          open={newsletterOpen}
          onOpenChange={setNewsletterOpen}
        />
      )}
      <FollowListDialog
        open={followersOpen}
        onOpenChange={setFollowersOpen}
        title={`${formatOrgName(organization.name)} followers`}
        variant={{ kind: "org-followers", orgId }}
      />
      {isOrgManager && (
        <EditOrgDialog
          organization={organization}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
      {me?.id && isOrgManager && (
        <ManageMembersDialog
          open={manageMembersOpen}
          onOpenChange={setManageMembersOpen}
          orgId={orgId}
          orgName={organization.name}
          myUserId={me.id}
          myRole={organization.role!}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        {/* Main column */}
        <div className="space-y-6 min-w-0">
          {/* Hero */}
          <div className="rounded-xl border border-border shadow-sm overflow-hidden bg-card">
            <div className="h-32 bg-gradient-to-br from-primary/30 via-primary/10 to-primary/5 relative" />
            <div className="px-4 sm:px-6 pb-4 sm:pb-6 -mt-16 sm:-mt-20 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 sm:flex-wrap relative z-10">
              <div className="flex items-end gap-3 sm:gap-4 min-w-0">
                <div className="shrink-0">
                  <AvatarLightbox
                    avatarUrl={organization.logoUrl}
                    displayName={formatOrgName(organization.name)}
                    ariaLabel={`View ${organization.name}'s logo`}
                    triggerClassName="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    triggerTestId="btn-open-org-logo-lightbox"
                    dialogTestId="dialog-org-logo-lightbox"
                    imageTestId="img-org-logo-lightbox"
                  >
                    <div className="w-24 h-24 sm:w-36 sm:h-36 bg-card rounded-xl shadow-lg border-4 border-card flex items-center justify-center overflow-hidden">
                      <OrgLogo
                        logoUrl={organization.logoUrl}
                        name={organization.name}
                        className="w-full h-full"
                        imgClassName="w-full h-full object-contain"
                      />
                    </div>
                  </AvatarLightbox>
                </div>
                <div className="pb-1 sm:pb-2 min-w-0 flex-1">
                  <h1 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight sm:leading-none break-words">
                    {formatOrgName(organization.name)}
                  </h1>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2 font-medium flex-wrap">
                    <span className="font-bold text-foreground">@{organization.slug}</span>
                    {organization.role && (
                      <>
                        <span className="opacity-50">•</span>
                        <span className="font-bold uppercase tracking-wider">
                          {organization.role}
                        </span>
                      </>
                    )}
                    {(() => {
                      const o = organization as {
                        city?: string | null;
                        state?: string | null;
                        zipCode?: string | null;
                      };
                      if (!o.city && !o.state && !o.zipCode) return null;
                      // Render as "City, ST 07090" — falling through to
                      // whichever pieces are present so older orgs that
                      // never collected zip / state keep their existing
                      // "City, ST" rendering.
                      const cityState = [o.city, o.state]
                        .filter(Boolean)
                        .join(", ");
                      const text = [cityState, o.zipCode]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <>
                          <span className="opacity-50">•</span>
                          <span
                            className="font-medium"
                            data-testid="text-org-address"
                          >
                            {text}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {isUnclaimed && (
                  <Badge
                    variant="outline"
                    className="font-bold rounded-full border-amber-400 text-amber-700 dark:text-amber-300"
                    data-testid="badge-org-unclaimed"
                  >
                    Unclaimed
                  </Badge>
                )}
                {canClaim &&
                  (hasPendingClaim ? (
                    <Button
                      variant="outline"
                      disabled
                      className="font-bold rounded-full"
                      data-testid="btn-claim-org-pending"
                    >
                      <Shield className="w-4 h-4 mr-1.5" /> Claim pending review
                    </Button>
                  ) : (
                    <Button
                      variant="brand"
                      onClick={onClaim}
                      disabled={claiming}
                      className="font-bold rounded-full"
                      data-testid="btn-claim-org"
                    >
                      <Shield className="w-4 h-4 mr-1.5" />
                      {claiming ? "Submitting…" : "Claim this organization"}
                    </Button>
                  ))}
                {isOrgManager && (
                  <Button
                    asChild
                    variant="ghost"
                    className="font-bold rounded-full"
                    data-testid="link-org-getting-started"
                  >
                    <a
                      href="/getting-started.html"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="w-4 h-4 mr-1.5" />
                      Getting started guide
                    </a>
                  </Button>
                )}
                {isOrgManager && (
                  <Button
                    variant="outline"
                    onClick={() => setManageMembersOpen(true)}
                    className="font-bold rounded-full"
                    data-testid="btn-manage-admins-hero"
                  >
                    <Shield className="w-4 h-4 mr-1.5" /> Manage admins & members
                  </Button>
                )}
                {isOrgManager && (
                  <Button
                    variant="outline"
                    onClick={() => setEditOpen(true)}
                    className="font-bold rounded-full"
                    data-testid="btn-edit-org"
                  >
                    <Pencil className="w-4 h-4 mr-1.5" /> Edit
                  </Button>
                )}
                <Button
                  variant="brand"
                  onClick={onToggleFollow}
                  disabled={followOrg.isPending || unfollowOrg.isPending}
                  data-testid="btn-follow-org"
                >
                  {organization.isFollowing ? "Following" : "Follow"}
                </Button>
                <Button
                  variant="outline"
                  className="font-bold rounded-full"
                  onClick={() => setFollowersOpen(true)}
                  data-testid="btn-view-org-followers"
                >
                  <Users className="w-4 h-4 mr-1.5" />
                  {(organization as { followerCount?: number }).followerCount ?? 0}
                  <span className="ml-1 hidden sm:inline">Followers</span>
                </Button>
              </div>
            </div>
            {(organization.description || organization.website) && (
              <div className="px-4 sm:px-6 pb-4 sm:pb-6">
                {organization.description && (
                  <OrganizationDescription
                    description={organization.description}
                    organizationName={organization.name}
                  />
                )}
                {organization.website && (
                  <a
                    href={organization.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold text-primary mt-2 inline-block hover:underline"
                    data-testid="link-org-website"
                  >
                    {organization.website}
                  </a>
                )}
              </div>
            )}
          </div>

          {isOrgManager && planUsage && (
            <OrgPlanUsageCard usage={planUsage} orgId={orgId} />
          )}

          {isOrgManager && (
            <OrgSetupChecklist
              orgId={orgId}
              actions={{
                onEditLogo: () => setEditOpen(true),
                onCreateTeam: () => setCreateTeamOpen(true),
                onManageMembers: () => setManageMembersOpen(true),
                onPromoteAdmin: () => setManageMembersOpen(true),
                onGoToTeams: () => {
                  // Scroll the teams rail / inline teams section into view.
                  const el = document.querySelector(
                    '[data-testid="rail-teams"]',
                  );
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                },
              }}
            />
          )}

          {isOrgManager && (() => {
            const adminCount = members.filter(
              (m) => m.role === "admin" || m.role === "owner",
            ).length;
            if (adminCount > 1) return null;
            return (
              <Card
                className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30"
                data-testid="card-empty-admins-nudge"
              >
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <Shield className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-bold text-sm">
                        You're the only admin
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Promote a member to help you run {formatOrgName(organization.name)}.
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="brand"
                    className="font-bold rounded-full shrink-0"
                    onClick={() => setManageMembersOpen(true)}
                    data-testid="btn-empty-admins-promote"
                  >
                    Promote a member
                  </Button>
                </CardContent>
              </Card>
            );
          })()}

          {isOrgManager && <OrgAdminPanel orgId={orgId} />}

          {/* Teams + archived: inline on mobile, in rail on lg+. The
              hook ensures only one instance mounts at a time so testids
              stay unique. */}
          {!isLg && (
            <div className="space-y-4">
              <TeamsRail
                teams={teams}
                canManage={isOrgManager}
                atLimit={atTeamLimit}
                onAddTeam={() => setCreateTeamOpen(true)}
                onBulkAddTeams={() => setBulkTeamsOpen(true)}
              />
              {isOrgManager && archivedTeams.length > 0 && (
                <ArchivedTeamsCard teams={archivedTeams} />
              )}
            </div>
          )}

          {/* Members preview */}
          {members.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-black tracking-tight">Members</h2>
                {isOrgManager && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="font-bold rounded-full"
                    onClick={() => setManageMembersOpen(true)}
                    data-testid="btn-manage-members"
                  >
                    <Settings className="w-4 h-4 mr-1" /> Manage admins & members
                  </Button>
                )}
              </div>
              <Card className="rounded-xl border border-border">
                <CardContent className="p-4">
                  <div className="flex flex-wrap gap-3">
                    {members.slice(0, 12).map((m) => (
                      <Link key={m.userId} href={`/users/${m.userId}`}>
                        <div className="flex items-center gap-2 bg-muted/50 hover:bg-muted px-3 py-2 rounded-lg cursor-pointer">
                          <div className="w-7 h-7 rounded-full bg-slate-900 text-primary-foreground flex items-center justify-center text-[10px] font-bold">
                            {getInitials(m.displayName)}
                          </div>
                          <div>
                            <p className="text-xs font-bold leading-tight">
                              {m.displayName}
                            </p>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                              {m.role}
                            </p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {/* Task #548 — Roles & permissions reference, visible to any
              org member (the checklist card already includes the same
              accordion for owners/admins, so this only renders for
              non-managers to avoid duplication). */}
          {!isOrgManager && organization.role && <RolesPermissionsCard />}

          {/* Posts */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-black tracking-tight">Recent Posts</h2>
              {isOrgManager && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setNewsletterOpen(true)}
                    className="font-bold rounded-full"
                    data-testid="btn-org-newsletter"
                  >
                    <Newspaper className="w-4 h-4 mr-1" /> Newsletter
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setNewPostOpen(true)}
                    className="font-bold rounded-full"
                    data-testid="btn-new-org-post"
                  >
                    <Plus className="w-4 h-4 mr-1" /> New post
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-3">
              {posts.length > 0 ? (
                posts.map((p) => <PostCard key={p.id} post={p} />)
              ) : (
                <Card className="rounded-xl border border-border">
                  <CardContent className="p-6 text-center text-sm text-muted-foreground space-y-3">
                    <p>No posts yet.</p>
                    {isOrgManager && (
                      <Button
                        size="sm"
                        onClick={() => setNewPostOpen(true)}
                        className="font-bold rounded-full"
                        data-testid="btn-empty-new-org-post"
                      >
                        <Plus className="w-4 h-4 mr-1" /> Be the first to post
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </section>
        </div>

        {/* Right rail (lg+ only — on mobile this renders inline above) */}
        {isLg && (
          <aside className="lg:sticky lg:top-20 lg:self-start space-y-4">
            <TeamsRail
              teams={teams}
              canManage={isOrgManager}
              atLimit={atTeamLimit}
              onAddTeam={() => setCreateTeamOpen(true)}
              onBulkAddTeams={() => setBulkTeamsOpen(true)}
            />
            {isOrgManager && archivedTeams.length > 0 && (
              <ArchivedTeamsCard teams={archivedTeams} />
            )}
          </aside>
        )}
      </div>
    </>
  );
}

function OrgPlanUsageCard({
  usage,
  orgId,
}: {
  usage: OrgPlanUsage;
  orgId: string;
}) {
  const planName =
    PLANS.find((p) => p.id === usage.plan)?.name ??
    usage.plan.charAt(0).toUpperCase() + usage.plan.slice(1);
  const unlimited = usage.teamsLimit == null;
  const atLimit = !unlimited && usage.teamsUsed >= (usage.teamsLimit as number);
  const pct = unlimited
    ? 0
    : Math.min(
        100,
        Math.round(
          (usage.teamsUsed / Math.max(1, usage.teamsLimit as number)) * 100,
        ),
      );
  return (
    <Card
      className="rounded-xl border border-border shadow-sm"
      data-testid="card-plan-usage"
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <p
                className="text-sm font-black tracking-tight"
                data-testid="text-plan-name"
              >
                {planName} plan
              </p>
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-plan-usage"
              >
                {unlimited
                  ? `${usage.teamsUsed} teams · unlimited`
                  : `${usage.teamsUsed} of ${usage.teamsLimit} teams used · ${usage.teamsRemaining} remaining`}
              </p>
            </div>
          </div>
          <Button
            asChild
            size="sm"
            variant={atLimit ? "brand" : "outline"}
            className="font-bold rounded-full shrink-0"
          >
            <Link
              href={`/organizations/${orgId}/subscribe`}
              data-testid="btn-plan-usage-upgrade"
            >
              {atLimit ? "Upgrade" : "Change plan"}
            </Link>
          </Button>
        </div>
        {!unlimited && (
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${
                atLimit ? "bg-destructive" : "bg-primary"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        {atLimit && (
          <p
            className="text-xs font-medium text-destructive"
            data-testid="text-plan-limit-reached"
          >
            You've reached your team limit. Upgrade your plan to add more teams.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TeamsRail({
  teams,
  canManage,
  atLimit = false,
  onAddTeam,
  onBulkAddTeams,
}: {
  teams: TeamRailItem[];
  canManage: boolean;
  atLimit?: boolean;
  onAddTeam: () => void;
  onBulkAddTeams: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);

  // Cap the list at roughly the visible viewport. The cap matches the
  // CSS expression below (calc(100vh - 14rem)) so overflow detection
  // and rendering stay in sync.
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const remPx = parseFloat(
      getComputedStyle(document.documentElement).fontSize || "16",
    );
    const check = () => {
      const capPx = window.innerHeight - 14 * remPx;
      setHasOverflow(inner.scrollHeight > capPx + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(inner);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [teams.length]);

  return (
    <Card
      className="rounded-xl border border-border shadow-sm overflow-hidden"
      data-testid="rail-teams"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="w-5 h-5 text-primary shrink-0" />
          <h2 className="text-base font-black tracking-tight truncate">
            Teams
          </h2>
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wider font-bold"
            data-testid="rail-teams-count"
          >
            {teams.length}
          </Badge>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="font-bold rounded-full"
              onClick={onBulkAddTeams}
              disabled={atLimit}
              title={
                atLimit
                  ? "You've reached your plan's team limit. Upgrade to add more."
                  : undefined
              }
              data-testid="btn-bulk-add-teams"
            >
              <ListPlus className="w-4 h-4 mr-1" /> Bulk add
            </Button>
            <Button
              variant="brand"
              size="sm"
              onClick={onAddTeam}
              disabled={atLimit}
              title={
                atLimit
                  ? "You've reached your plan's team limit. Upgrade to add more."
                  : undefined
              }
              data-testid="btn-add-team"
            >
              <Plus className="w-4 h-4 mr-1" /> Add team
            </Button>
          </div>
        )}
      </div>

      {teams.length === 0 ? (
        <div className="p-8 text-center">
          <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No teams yet.</p>
        </div>
      ) : (
        <>
          <div
            className={
              expanded
                ? "overflow-y-auto max-h-[calc(100vh-14rem)]"
                : "overflow-hidden max-h-[calc(100vh-14rem)]"
            }
          >
            <div ref={innerRef} className="flex flex-col gap-2 p-2">
              {teams.map((team) => (
                <Link key={team.id} href={`/teams/${team.id}`}>
                  <div
                    className="rounded-lg overflow-hidden border border-border hover:border-primary/40 hover:shadow-md cursor-pointer group transition-all"
                    data-testid={`card-team-${team.id}`}
                  >
                    {/* Banner visual: team-specific photo if set, otherwise
                        the same gradient empty-state used by the team-page
                        hero so branding stays consistent. */}
                    <div className="relative h-20 bg-gradient-to-br from-primary/30 via-primary/10 to-primary/5">
                      {team.bannerUrl && (
                        <img
                          src={team.bannerUrl}
                          alt={`${team.name} background`}
                          className="absolute inset-0 w-full h-full object-cover"
                          data-testid={`img-team-banner-${team.id}`}
                        />
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="font-bold text-sm truncate group-hover:text-primary transition-colors">
                          {team.name}
                        </h3>
                        {team.sport && (
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase tracking-wider font-bold shrink-0"
                          >
                            {team.sport}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground mt-0.5">
                        <Users className="w-3 h-3" />
                        {team.followerCount ?? 0} Followers
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
          {hasOverflow && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted/40 border-t border-border transition-colors"
              data-testid="btn-toggle-teams-expand"
              aria-expanded={expanded}
            >
              {expanded ? "Show less" : `Show all ${teams.length} teams`}
              <ChevronDown
                className={`w-4 h-4 transition-transform ${
                  expanded ? "rotate-180" : ""
                }`}
                aria-hidden
              />
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function ArchivedTeamsCard({ teams }: { teams: TeamRailItem[] }) {
  return (
    <Card
      className="rounded-xl border border-border shadow-sm overflow-hidden"
      data-testid="section-archived-teams"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Archive className="w-5 h-5 text-muted-foreground shrink-0" />
          <h2 className="text-base font-black tracking-tight truncate">
            Archived teams
          </h2>
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wider font-bold"
          >
            {teams.length}
          </Badge>
        </div>
      </div>
      <CardContent className="p-2">
        <div className="flex flex-col divide-y divide-border">
          {teams.map((t) => (
            <Link key={t.id} href={`/teams/${t.id}`}>
              <div
                className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/40 rounded-lg cursor-pointer"
                data-testid={`card-archived-team-${t.id}`}
              >
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{t.name}</p>
                  {t.sport && (
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
                      {t.sport}
                    </p>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wider font-bold shrink-0"
                >
                  Archived
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
