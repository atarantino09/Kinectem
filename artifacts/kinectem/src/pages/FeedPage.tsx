import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronRight, ChevronDown } from "lucide-react";
import {
  useGetLoggedInUser,
  useListFeed,
  useListUserOrganizations,
  useListUserTeams,
  queryOpts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UserAvatar, TeamAvatar } from "@/components/UserAvatar";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { PostCard } from "@/components/PostCard";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";

type SidebarTeam = {
  id: string;
  name: string;
  logoUrl: string | null;
  orgName: string;
};

type SidebarOrg = {
  id: string;
  name: string;
  logoUrl: string | null;
  teams: SidebarTeam[];
};

export default function FeedPage() {
  const { data: me } = useGetLoggedInUser();
  const { data: myOrgs } = useListUserOrganizations(me?.id ?? "", undefined, {
    query: queryOpts({ enabled: !!me?.id }),
  });
  const { data: myTeams } = useListUserTeams(me?.id ?? "", undefined, {
    query: queryOpts({ enabled: !!me?.id }),
  });

  const { orgGroups, orphanTeams } = useMemo(() => {
    const teamsByOrg = new Map<string, SidebarTeam[]>();
    for (const t of myTeams?.data ?? []) {
      const arr = teamsByOrg.get(t.organization.id) ?? [];
      arr.push({
        id: t.teamId,
        name: t.teamName,
        logoUrl: t.teamAvatarUrl ?? null,
        orgName: t.organization.name,
      });
      teamsByOrg.set(t.organization.id, arr);
    }
    const orgIds = new Set<string>();
    const orgGroups: SidebarOrg[] = (myOrgs?.data ?? []).map((org) => {
      orgIds.add(org.id);
      return {
        id: org.id,
        name: org.name,
        logoUrl: org.logoUrl ?? null,
        teams: teamsByOrg.get(org.id) ?? [],
      };
    });
    const orphanTeams: SidebarTeam[] = [];
    for (const [orgId, teams] of teamsByOrg) {
      if (!orgIds.has(orgId)) orphanTeams.push(...teams);
    }
    return { orgGroups, orphanTeams };
  }, [myOrgs, myTeams]);

  const hasSidebarItems = orgGroups.length > 0 || orphanTeams.length > 0;
  const [expandedOrgs, setExpandedOrgs] = useState<Record<string, boolean>>({});
  const toggleOrg = (orgId: string) =>
    setExpandedOrgs((prev) => ({ ...prev, [orgId]: !prev[orgId] }));
  const { data: feed, isLoading: feedLoading } = useListFeed();

  const displayName = me ? `${me.firstName} ${me.lastName}` : "";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_300px] gap-6">
      {/* Left sidebar */}
      <aside className="hidden lg:block lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100vh-4rem-1.5rem)] lg:overflow-y-auto space-y-4">
        {me && (
          <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="h-16 brand-gradient-cover relative">
              <div
                aria-hidden="true"
                className="brand-banner-pattern absolute inset-0 pointer-events-none"
              />
            </div>
            <CardContent className="p-4 -mt-8">
              <Link href={`/users/${me.id}`}>
                <UserAvatar
                  avatarUrl={me.avatarUrl}
                  displayName={displayName}
                  size="2xl"
                  className="border-4 border-card cursor-pointer"
                  fallbackClassName="bg-slate-100 text-slate-800"
                />
              </Link>
              <h3 className="font-black text-base tracking-tight mt-3">
                {displayName}
              </h3>
              {me.bio && (
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-3">
                  {me.bio}
                </p>
              )}
              <Link href={`/users/${me.id}`}>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-4 font-bold"
                >
                  View Profile
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {hasSidebarItems && (
          <Card className="rounded-xl border border-border shadow-sm">
            <CardContent className="p-4">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground mb-3">
                Your Orgs and Teams
              </h4>
              <div className="space-y-1">
                {orgGroups.map((org) => {
                  const hasTeams = org.teams.length > 0;
                  const isExpanded = !!expandedOrgs[org.id];
                  return (
                    <div key={org.id}>
                      <OrgLinkRow
                        orgId={org.id}
                        orgName={org.name}
                        orgLogoUrl={org.logoUrl}
                        hasTeams={hasTeams}
                        isExpanded={isExpanded}
                        onToggle={() => toggleOrg(org.id)}
                      />
                      {hasTeams && isExpanded && (
                        <div className="ml-5 mt-1 mb-2 border-l-2 border-border pl-3 space-y-0.5">
                          {org.teams.map((t) => (
                            <TeamLinkRow
                              key={t.id}
                              teamId={t.id}
                              teamName={t.name}
                              teamLogoUrl={t.logoUrl}
                              hideAvatar
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {orphanTeams.length > 0 && (
                  <div className="space-y-0.5">
                    {orphanTeams.map((t) => (
                      <TeamLinkRow
                        key={t.id}
                        teamId={t.id}
                        teamName={t.name}
                        teamLogoUrl={t.logoUrl}
                        subtitle={t.orgName}
                      />
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </aside>

      {/* Center feed */}
      <div className="space-y-4">
        <h2 className="text-3xl font-black tracking-tight">
          Latest <span className="brand-gradient-text">Activity</span>
        </h2>
        {feedLoading ? (
          <>
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </>
        ) : !feed || feed.data.length === 0 ? (
          <SuggestionsPanel />
        ) : (
          feed.data.map((post: (typeof feed.data)[number]) => (
            <PostCard key={post.id} post={post} />
          ))
        )}
      </div>

      {/* Right sidebar: three single-type "to follow" cards */}
      <aside className="hidden lg:block lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100vh-4rem-1.5rem)] lg:overflow-y-auto space-y-4">
        <SuggestionsPanel
          variant="compact"
          section="users"
          heading="People to follow"
          perSectionLimit={3}
          hideWhenEmpty
        />
        <SuggestionsPanel
          variant="compact"
          section="organizations"
          heading="Organizations to follow"
          perSectionLimit={3}
          hideWhenEmpty
        />
        <SuggestionsPanel
          variant="compact"
          section="teams"
          heading="Teams to follow"
          perSectionLimit={3}
          hideWhenEmpty
        />
      </aside>
    </div>
  );
}

function OrgLinkRow({
  orgId,
  orgName,
  orgLogoUrl,
  hasTeams,
  isExpanded,
  onToggle,
}: {
  orgId: string;
  orgName: string;
  orgLogoUrl: string | null;
  hasTeams: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="w-full flex items-center gap-1 py-1.5 px-1 rounded-md hover:bg-muted/50">
      {hasTeams ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={isExpanded ? `Collapse ${orgName}` : `Expand ${orgName}`}
          aria-expanded={isExpanded}
          data-testid={`toggle-org-${orgId}`}
          className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground"
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>
      ) : (
        <span className="shrink-0 w-[18px]" aria-hidden="true" />
      )}
      <Link
        href={`/organizations/${orgId}`}
        data-testid={`link-org-${orgId}`}
        className="flex-1 min-w-0"
      >
        <div className="flex items-center gap-2 text-sm font-semibold hover:text-primary cursor-pointer">
          <OrgLogo
            logoUrl={orgLogoUrl}
            name={orgName}
            className="w-5 h-5 rounded-lg shrink-0"
            imgClassName="w-5 h-5 rounded-lg object-cover shrink-0"
          />
          <span className="truncate flex-1">{orgName}</span>
        </div>
      </Link>
    </div>
  );
}

function TeamLinkRow({
  teamId,
  teamName,
  teamLogoUrl,
  subtitle,
  hideAvatar,
}: {
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  subtitle?: string;
  hideAvatar?: boolean;
}) {
  return (
    <Link href={`/teams/${teamId}`} data-testid={`link-team-${teamId}`}>
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary cursor-pointer py-1.5 px-1.5 rounded-md hover:bg-muted/50">
        {!hideAvatar && (
          <TeamAvatar
            avatarUrl={teamLogoUrl}
            displayName={teamName}
            size="xs"
            rounded="lg"
            className="w-5 h-5 shrink-0"
            fallbackClassName="bg-muted text-muted-foreground"
          />
        )}
        <span className="truncate flex-1 min-w-0">
          <span className="truncate">{teamName}</span>
          {subtitle && (
            <span className="ml-1 text-[10px] font-medium text-muted-foreground/80">
              · {subtitle}
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}

