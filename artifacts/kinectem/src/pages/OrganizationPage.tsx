import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrganizationById,
  useListOrgTeams,
  useListOrgPosts,
  useListMembers,
  useFollowOrg,
  useUnfollowOrg,
  useGetLoggedInUser,
  getGetOrganizationByIdQueryKey,
  getListFeedQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useIsLg } from "@/hooks/use-mobile";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  ChevronDown,
  Pencil,
  Plus,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { AvatarLightbox } from "@/components/AvatarLightbox";
import { OrgAdminPanel } from "@/components/OrgAdminPanel";
import { CreateTeamDialog } from "@/components/CreateTeamDialog";
import { EditOrgDialog } from "@/components/EditOrgDialog";
import { FollowListDialog } from "@/components/FollowListDialog";
import { NewOrgPostDialog } from "@/components/NewOrgPostDialog";
import { ManageMembersDialog } from "@/components/ManageMembersDialog";
import { getInitials } from "@/lib/format";

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
  const [editOpen, setEditOpen] = useState(false);
  const [followersOpen, setFollowersOpen] = useState(false);
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [manageMembersOpen, setManageMembersOpen] = useState(false);
  const isLg = useIsLg();
  const { data: me } = useGetLoggedInUser();
  const { data: organization, isLoading } = useGetOrganizationById(orgId);
  const { data: teamsResp } = useListOrgTeams(orgId);
  const { data: postsResp } = useListOrgPosts(orgId);
  const { data: membersResp } = useListMembers(orgId);
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

  if (isLoading || !organization) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const teams = teamsResp?.data ?? [];
  const posts = postsResp?.data ?? [];
  const members = membersResp?.data ?? [];
  const isOrgManager =
    organization.role === "admin" || organization.role === "owner";

  return (
    <>
      <CreateTeamDialog
        orgId={orgId}
        open={createTeamOpen}
        onOpenChange={setCreateTeamOpen}
      />
      <NewOrgPostDialog
        orgId={orgId}
        orgName={organization.name}
        open={newPostOpen}
        onOpenChange={setNewPostOpen}
      />
      <FollowListDialog
        open={followersOpen}
        onOpenChange={setFollowersOpen}
        title={`${organization.name} followers`}
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
                    displayName={organization.name}
                    ariaLabel={`View ${organization.name}'s logo`}
                    triggerClassName="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    triggerTestId="btn-open-org-logo-lightbox"
                    dialogTestId="dialog-org-logo-lightbox"
                    imageTestId="img-org-logo-lightbox"
                  >
                    <div className="w-24 h-24 sm:w-36 sm:h-36 bg-card rounded-xl shadow-lg border-4 border-card flex items-center justify-center overflow-hidden">
                      {organization.logoUrl ? (
                        <img
                          src={organization.logoUrl}
                          alt={`${organization.name} logo`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-3xl sm:text-5xl font-black text-primary tracking-tighter">
                          {getInitials(organization.name)}
                        </div>
                      )}
                    </div>
                  </AvatarLightbox>
                </div>
                <div className="pb-1 sm:pb-2 min-w-0 flex-1">
                  <h1 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight sm:leading-none break-words">
                    {organization.name}
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
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                    {organization.description}
                  </p>
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

          {isOrgManager && <OrgAdminPanel orgId={orgId} />}

          {/* Teams: inline on mobile, in rail on lg+. The hook ensures
              only one instance mounts at a time so testids stay unique. */}
          {!isLg && (
            <TeamsRail
              teams={teams}
              canManage={isOrgManager}
              onAddTeam={() => setCreateTeamOpen(true)}
            />
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
                    <Settings className="w-4 h-4 mr-1" /> Manage members
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

          {/* Posts */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-black tracking-tight">Recent Posts</h2>
              {isOrgManager && (
                <Button
                  size="sm"
                  onClick={() => setNewPostOpen(true)}
                  className="font-bold rounded-full"
                  data-testid="btn-new-org-post"
                >
                  <Plus className="w-4 h-4 mr-1" /> New post
                </Button>
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
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <TeamsRail
              teams={teams}
              canManage={isOrgManager}
              onAddTeam={() => setCreateTeamOpen(true)}
            />
          </aside>
        )}
      </div>
    </>
  );
}

function TeamsRail({
  teams,
  canManage,
  onAddTeam,
}: {
  teams: TeamRailItem[];
  canManage: boolean;
  onAddTeam: () => void;
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
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
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
          <Button
            variant="brand"
            size="sm"
            onClick={onAddTeam}
            data-testid="btn-add-team"
          >
            <Plus className="w-4 h-4 mr-1" /> Add team
          </Button>
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
                ? "overflow-hidden"
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
