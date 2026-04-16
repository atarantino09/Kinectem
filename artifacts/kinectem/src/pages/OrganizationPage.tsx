import { useParams, Link } from "wouter";
import {
  useGetOrganization,
  useGetOrganizationActivity,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Users, ChevronRight, Building2 } from "lucide-react";
import { FeedItemCard } from "@/components/FeedItemCard";
import { getInitials } from "@/lib/format";

export default function OrganizationPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const { data, isLoading } = useGetOrganization(orgId);
  const { data: activity } = useGetOrganizationActivity(orgId);

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  const { organization, teams } = data;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="rounded-xl overflow-hidden border border-border bg-card shadow-sm">
        <div className="h-40 bg-gradient-to-tr from-slate-900 via-blue-900 to-slate-800 relative">
          {organization.bannerUrl && (
            <img src={organization.bannerUrl} alt="" className="w-full h-full object-cover opacity-80" />
          )}
        </div>
        <div className="px-6 pb-6 -mt-10 flex items-end justify-between gap-4 flex-wrap">
          <div className="flex items-end gap-4">
            <div className="w-20 h-20 bg-card rounded-xl shadow-lg border-4 border-card flex items-center justify-center shrink-0 overflow-hidden">
              {organization.logoUrl ? (
                <img src={organization.logoUrl} alt={organization.name} className="w-full h-full object-cover" />
              ) : (
                <div className="text-2xl font-black text-primary tracking-tighter">
                  {getInitials(organization.name)}
                </div>
              )}
            </div>
            <div className="pb-2">
              <h1 className="text-3xl font-black tracking-tight leading-none">{organization.name}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2 font-medium">
                {organization.location && (
                  <>
                    <MapPin className="w-3.5 h-3.5" /> {organization.location}
                  </>
                )}
                {organization.followerCount !== undefined && (
                  <>
                    <span className="opacity-50">•</span>
                    <span className="font-bold text-foreground">
                      {organization.followerCount.toLocaleString()} FOLLOWERS
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-full px-6">
            Follow
          </Button>
        </div>
        {organization.description && (
          <div className="px-6 pb-6">
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              {organization.description}
            </p>
            {organization.sport && (
              <Badge variant="secondary" className="mt-3 font-semibold">
                {organization.sport}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Teams */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black tracking-tight">Active Teams</h2>
          <span className="text-sm font-bold text-muted-foreground">{teams.length} teams</span>
        </div>
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
                      {team.season && (
                        <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-none text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider">
                          {team.season}
                        </Badge>
                      )}
                      {(team.wins !== undefined || team.losses !== undefined) && (
                        <span className="text-xs font-bold text-muted-foreground">
                          {team.wins ?? 0}-{team.losses ?? 0}
                          {team.ties ? `-${team.ties}` : ""}
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-base mb-2 group-hover:text-primary transition-colors">
                      {team.name}
                    </h3>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Users className="w-3.5 h-3.5" /> {team.playerCount ?? 0} Players
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

      {/* Recent activity */}
      <section>
        <h2 className="text-xl font-black tracking-tight mb-4">Recent Activity</h2>
        <div className="space-y-3">
          {activity && activity.length > 0 ? (
            activity.map((item) => <FeedItemCard key={item.id} item={item} />)
          ) : (
            <Card className="rounded-xl border border-border">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No recent activity.
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
