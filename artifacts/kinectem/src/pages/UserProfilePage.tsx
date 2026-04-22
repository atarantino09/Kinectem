import { useState, useMemo } from "react";
import { useParams, Link } from "wouter";
import {
  useGetUserById,
  useListUserPosts,
  useListUserOrganizations,
  useListUserTeams,
} from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building2, Tag, Users } from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { getInitials } from "@/lib/format";

export default function UserProfilePage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const { data: user, isLoading } = useGetUserById(userId);
  const { data: postsResp } = useListUserPosts(userId);
  const { data: orgsResp } = useListUserOrganizations(userId);
  const { data: teamsResp } = useListUserTeams(userId);
  const [teamFilter, setTeamFilter] = useState<string>("all");

  const allPosts = postsResp?.data ?? [];
  const posts = useMemo(() => {
    if (teamFilter === "all") return allPosts;
    return allPosts.filter(
      (p) => p.context?.type === "team" && p.context.id === teamFilter,
    );
  }, [allPosts, teamFilter]);

  if (isLoading || !user) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const displayName = `${user.firstName} ${user.lastName}`;
  const orgs = orgsResp?.data ?? [];
  const teams = teamsResp?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-xl border border-border shadow-sm overflow-hidden bg-card">
        <div className="h-36 brand-gradient relative">
          {user.coverPhotoUrl && (
            <img
              src={user.coverPhotoUrl}
              alt=""
              className="w-full h-full object-cover opacity-90"
            />
          )}
        </div>
        <div className="px-6 pb-6 -mt-12">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <Avatar className="w-24 h-24 border-4 border-card shadow-lg">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
              <AvatarFallback className="bg-slate-900 text-primary-foreground font-black text-2xl">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            {user.isOwnProfile && "email" in user ? (
              <div className="mt-14 flex items-center gap-2">
                <Link href="/me/tags">
                  <Button
                    variant="outline"
                    className="font-bold rounded-full"
                    data-testid="link-manage-tags"
                  >
                    <Tag className="w-4 h-4 mr-1.5" />
                    Manage Tags
                  </Button>
                </Link>
                <EditProfileDialog user={user} />
              </div>
            ) : (
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-full px-6 mt-14">
                {user.isFollowing ? "Following" : "Follow"}
              </Button>
            )}
          </div>
          <div className="mt-3">
            <h1 className="text-3xl font-black tracking-tight leading-none">
              {displayName}
            </h1>
            {user.nickname && (
              <p className="text-sm font-bold text-primary uppercase tracking-wider mt-2">
                @{user.nickname}
              </p>
            )}
          </div>
        </div>
        {user.bio && (
          <div className="px-6 pb-6">
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              {user.bio}
            </p>
          </div>
        )}
      </div>

      {/* Linked accounts (parent ↔ child) */}
      {(() => {
        const linked = (user as { linkedAccounts?: { parents?: Array<{ id: string; firstName: string; lastName: string; role: string; avatarUrl: string | null }>; children?: Array<{ id: string; firstName: string; lastName: string; role: string; avatarUrl: string | null }> } }).linkedAccounts;
        const parents = linked?.parents ?? [];
        const children = linked?.children ?? [];
        if (parents.length === 0 && children.length === 0) return null;
        const all = [
          ...parents.map((p) => ({ ...p, relation: "Parent / Guardian" as const })),
          ...children.map((c) => ({ ...c, relation: "Child" as const })),
        ];
        return (
          <section>
            <h2 className="text-xl font-black tracking-tight mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" /> Family
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {all.map((m) => {
                const name = `${m.firstName} ${m.lastName}`.trim();
                return (
                  <Link key={`${m.relation}-${m.id}`} href={`/users/${m.id}`}>
                    <Card
                      className="rounded-xl border border-border shadow-sm hover:border-primary/50 transition-colors cursor-pointer"
                      data-testid={`card-linked-${m.id}`}
                    >
                      <CardContent className="p-4 flex items-center gap-3">
                        <Avatar className="w-10 h-10">
                          {m.avatarUrl && <AvatarImage src={m.avatarUrl} />}
                          <AvatarFallback className="bg-slate-900 text-primary-foreground font-black text-xs">
                            {getInitials(name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-sm truncate">{name}</p>
                          <Badge
                            variant="outline"
                            className="mt-1 text-[10px] uppercase tracking-wider font-bold"
                          >
                            {m.relation}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* Organizations */}
      {orgs.length > 0 && (
        <section>
          <h2 className="text-xl font-black tracking-tight mb-4">
            Organizations
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {orgs.map((org) => (
              <Link key={org.id} href={`/organizations/${org.id}`}>
                <Card className="rounded-xl border border-border shadow-sm hover:border-primary/50 transition-colors cursor-pointer">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg brand-gradient-dark flex items-center justify-center text-primary font-black text-xs">
                      {getInitials(org.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm truncate">{org.name}</p>
                      {org.role && (
                        <Badge
                          variant="outline"
                          className="mt-1 text-[10px] uppercase tracking-wider font-bold"
                        >
                          {org.role}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Posts */}
      <section>
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-xl font-black tracking-tight">Posts</h2>
          {teams.length > 0 && (
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger
                className="w-56 font-bold"
                data-testid="select-team-filter"
              >
                <SelectValue placeholder="All teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.teamId} value={t.teamId}>
                    {t.teamName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-3">
          {posts.length > 0 ? (
            posts.map((p) => <PostCard key={p.id} post={p} />)
          ) : (
            <Card className="rounded-xl border border-border">
              <CardContent className="p-8 text-center">
                <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No posts yet.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
