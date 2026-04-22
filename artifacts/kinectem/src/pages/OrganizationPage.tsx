import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetOrganizationById,
  useListOrgTeams,
  useListOrgPosts,
  useListMembers,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, ChevronRight, Plus } from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { OrgAdminPanel } from "@/components/OrgAdminPanel";
import { CreateTeamDialog } from "@/components/CreateTeamDialog";
import { getInitials } from "@/lib/format";

export default function OrganizationPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const { data: organization, isLoading } = useGetOrganizationById(orgId);
  const { data: teamsResp } = useListOrgTeams(orgId);
  const { data: postsResp } = useListOrgPosts(orgId);
  const { data: membersResp } = useListMembers(orgId);

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

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-xl border border-border shadow-sm overflow-hidden bg-card">
        <div className="h-32 brand-gradient relative" />
        <div className="px-6 pb-6 -mt-10 flex items-end justify-between gap-4 flex-wrap relative z-10">
          <div className="flex items-end gap-4">
            <div className="w-20 h-20 bg-card rounded-xl shadow-lg border-4 border-card flex items-center justify-center shrink-0 overflow-hidden">
              <div className="text-2xl font-black text-primary tracking-tighter">
                {getInitials(organization.name)}
              </div>
            </div>
            <div className="pb-2">
              <h1 className="text-3xl font-black tracking-tight leading-none">
                {organization.name}
              </h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2 font-medium">
                <span className="font-bold text-foreground">@{organization.slug}</span>
                {organization.role && (
                  <>
                    <span className="opacity-50">•</span>
                    <span className="font-bold uppercase tracking-wider">
                      {organization.role}
                    </span>
                  </>
                )}
                {((organization as { city?: string | null }).city ||
                  (organization as { state?: string | null }).state) && (
                  <>
                    <span className="opacity-50">•</span>
                    <span className="font-medium">
                      {[
                        (organization as { city?: string | null }).city,
                        (organization as { state?: string | null }).state,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-full px-6">
            {organization.isMember ? "Following" : "Follow"}
          </Button>
        </div>
        {organization.description && (
          <div className="px-6 pb-6">
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              {organization.description}
            </p>
            {organization.website && (
              <a
                href={organization.website}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-primary mt-2 inline-block hover:underline"
              >
                {organization.website}
              </a>
            )}
          </div>
        )}
      </div>

      {(organization.role === "admin" || organization.role === "owner") && (
        <OrgAdminPanel orgId={orgId} />
      )}

      {/* Teams */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black tracking-tight">Teams</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-muted-foreground">
              {teams.length} teams
            </span>
            {(organization.role === "admin" || organization.role === "owner") && (
              <Button
                size="sm"
                onClick={() => setCreateTeamOpen(true)}
                className="font-bold rounded-full"
                data-testid="btn-add-team"
              >
                <Plus className="w-4 h-4 mr-1" /> Add team
              </Button>
            )}
          </div>
        </div>
        <CreateTeamDialog
          orgId={orgId}
          open={createTeamOpen}
          onOpenChange={setCreateTeamOpen}
        />
        {teams.length === 0 ? (
          <Card className="rounded-xl border border-border">
            <CardContent className="p-8 text-center">
              <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No teams yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {teams.map((team) => (
              <Link key={team.id} href={`/teams/${team.id}`}>
                <Card className="rounded-xl border border-border shadow-sm hover:border-primary/50 transition-colors cursor-pointer group">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      {team.sport && (
                        <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-none text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider">
                          {team.sport}
                        </Badge>
                      )}
                      {team.level && (
                        <span className="text-xs font-bold text-muted-foreground">
                          {team.level}
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-base mb-2 group-hover:text-primary transition-colors">
                      {team.name}
                    </h3>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Users className="w-3.5 h-3.5" />{" "}
                        {team.followerCount ?? 0} Followers
                      </div>
                      <ChevronRight className="w-4 h-4 text-primary" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Members preview */}
      {members.length > 0 && (
        <section>
          <h2 className="text-xl font-black tracking-tight mb-4">Members</h2>
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
        <h2 className="text-xl font-black tracking-tight mb-4">Recent Posts</h2>
        <div className="space-y-3">
          {posts.length > 0 ? (
            posts.map((p) => <PostCard key={p.id} post={p} />)
          ) : (
            <Card className="rounded-xl border border-border">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No posts yet.
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
