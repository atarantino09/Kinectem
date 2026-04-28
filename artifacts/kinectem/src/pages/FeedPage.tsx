import { useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetLoggedInUser,
  useListOrganizations,
  useListFeed,
  useListUserOrganizations,
  useListUserTeams,
  useListOrgTeams,
  queryOpts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Building2, ChevronRight, Users } from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import { getInitials } from "@/lib/format";

export default function FeedPage() {
  const [, setLocation] = useLocation();
  const { data: me } = useGetLoggedInUser();
  const { data: myOrgs } = useListUserOrganizations(me?.id ?? "", undefined, {
    query: queryOpts({ enabled: !!me?.id }),
  });
  const { data: myTeams } = useListUserTeams(me?.id ?? "", undefined, {
    query: queryOpts({ enabled: !!me?.id }),
  });
  const memberTeamsByOrg = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>();
    for (const t of myTeams?.data ?? []) {
      const arr = map.get(t.organization.id) ?? [];
      arr.push({ id: t.teamId, name: t.teamName });
      map.set(t.organization.id, arr);
    }
    return map;
  }, [myTeams]);
  const { data: orgs } = useListOrganizations();
  const { data: feed, isLoading: feedLoading } = useListFeed();
  const [openOrgId, setOpenOrgId] = useState<string | null>(null);

  const handleOrgClick = (orgId: string) => {
    if (openOrgId === orgId) {
      setLocation(`/organizations/${orgId}`);
    } else {
      setOpenOrgId(orgId);
    }
  };

  const displayName = me ? `${me.firstName} ${me.lastName}` : "";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_300px] gap-6">
      {/* Left sidebar */}
      <aside className="hidden lg:block space-y-4">
        {me && (
          <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="h-16 brand-gradient-cover" />
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

        {myOrgs && myOrgs.data.length > 0 && (
          <Card className="rounded-xl border border-border shadow-sm">
            <CardContent className="p-4">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground mb-3">
                Your Organizations
              </h4>
              <div className="space-y-1">
                {myOrgs.data.map((org) => {
                  const isOrgAdmin =
                    org.role === "owner" || org.role === "admin";
                  return (
                    <OrgRow
                      key={org.id}
                      orgId={org.id}
                      orgName={org.name}
                      orgLogoUrl={org.logoUrl ?? null}
                      isOpen={openOrgId === org.id}
                      onClick={() => handleOrgClick(org.id)}
                      isOrgAdmin={isOrgAdmin}
                      memberTeams={memberTeamsByOrg.get(org.id) ?? []}
                    />
                  );
                })}
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

      {/* Right sidebar: suggestions + orgs */}
      <aside className="hidden lg:block space-y-4">
        <SuggestionsPanel
          variant="compact"
          heading="People to follow"
          perSectionLimit={3}
          hideWhenEmpty
        />
        {orgs && (
          <Card className="rounded-xl border border-border shadow-sm">
            <CardContent className="p-4">
              <div className="mb-3">
                <span className="brand-pill">Featured Organizations</span>
              </div>
              <div className="space-y-3">
                {orgs.data.slice(0, 5).map((org) => (
                  <Link key={org.id} href={`/organizations/${org.id}`}>
                    <div className="flex items-start gap-3 cursor-pointer hover:bg-muted/50 -mx-2 px-2 py-1 rounded">
                      <FeaturedOrgLogoTile
                        name={org.name}
                        logoUrl={org.logoUrl ?? null}
                      />
                      <div className="min-w-0">
                        <p className="font-bold text-sm leading-tight truncate">
                          {org.name}
                        </p>
                        {org.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                            {org.description}
                          </p>
                        )}
                        {org.isMember && (
                          <Badge
                            variant="secondary"
                            className="mt-1 text-[10px] font-bold"
                          >
                            Member
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </aside>
    </div>
  );
}

function OrgRow({
  orgId,
  orgName,
  orgLogoUrl,
  isOpen,
  onClick,
  isOrgAdmin,
  memberTeams,
}: {
  orgId: string;
  orgName: string;
  orgLogoUrl: string | null;
  isOpen: boolean;
  onClick: () => void;
  isOrgAdmin: boolean;
  memberTeams: { id: string; name: string }[];
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => {
    setLogoFailed(false);
  }, [orgLogoUrl]);
  const { data: teamsResp } = useListOrgTeams(orgId, undefined, {
    query: queryOpts({ enabled: isOpen && isOrgAdmin }),
  });
  const teams = isOrgAdmin
    ? (teamsResp?.data ?? []).map((t) => ({ id: t.id, name: t.name }))
    : memberTeams;
  const isLoading = isOrgAdmin && teamsResp === undefined;
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        data-testid={`button-org-${orgId}`}
        className="w-full flex items-center gap-2 text-sm font-semibold hover:text-primary cursor-pointer py-1.5 px-1 rounded-md hover:bg-muted/50 text-left"
        title={
          isOpen
            ? "Click again to open organization"
            : "Click to view teams"
        }
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        {orgLogoUrl && !logoFailed ? (
          <img
            src={orgLogoUrl}
            alt=""
            onError={() => setLogoFailed(true)}
            className="w-5 h-5 rounded-md object-cover bg-muted shrink-0"
          />
        ) : (
          <div className="w-5 h-5 rounded-md bg-muted flex items-center justify-center shrink-0">
            <Building2 className="w-3 h-3 text-muted-foreground" />
          </div>
        )}
        <span className="truncate flex-1">{orgName}</span>
        {isOpen && teams.length > 0 && (
          <span
            data-testid={`badge-org-${orgId}-team-count`}
            className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full"
          >
            {teams.length}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="ml-5 mt-1 mb-2 border-l-2 border-border pl-3 space-y-0.5">
          {isLoading ? (
            <p className="text-xs text-muted-foreground py-1.5 italic">
              Loading…
            </p>
          ) : teams.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1.5 italic">
              No teams yet
            </p>
          ) : (
            teams.map((t) => (
              <Link
                key={t.id}
                href={`/teams/${t.id}`}
                data-testid={`link-team-${t.id}`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary cursor-pointer py-1.5 px-1.5 rounded-md hover:bg-muted/50">
                  <Users className="w-3 h-3 shrink-0" />
                  <span className="truncate">{t.name}</span>
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FeaturedOrgLogoTile({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);
  if (logoUrl && !logoFailed) {
    return (
      <img
        src={logoUrl}
        alt=""
        onError={() => setLogoFailed(true)}
        className="w-9 h-9 rounded-lg object-cover bg-muted shrink-0"
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-lg brand-gradient-dark flex items-center justify-center text-primary font-black text-xs shrink-0">
      {getInitials(name)}
    </div>
  );
}

