import { useParams, Link } from "wouter";
import {
  useGetUserById,
  useListUserPosts,
  useListUserOrganizations,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building2 } from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { getInitials } from "@/lib/format";

export default function UserProfilePage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const { data: user, isLoading } = useGetUserById(userId);
  const { data: postsResp } = useListUserPosts(userId);
  const { data: orgsResp } = useListUserOrganizations(userId);

  if (isLoading || !user) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const displayName = `${user.firstName} ${user.lastName}`;
  const posts = postsResp?.data ?? [];
  const orgs = orgsResp?.data ?? [];

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
        <div className="px-6 pb-6 -mt-12 flex items-end justify-between gap-4 flex-wrap">
          <div className="flex items-end gap-4">
            <Avatar className="w-24 h-24 border-4 border-card shadow-lg">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
              <AvatarFallback className="bg-slate-900 text-primary-foreground font-black text-2xl">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="pb-2">
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
          {!user.isOwnProfile && (
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-full px-6">
              {user.isFollowing ? "Following" : "Follow"}
            </Button>
          )}
        </div>
        {user.bio && (
          <div className="px-6 pb-6">
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              {user.bio}
            </p>
          </div>
        )}
      </div>

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
        <h2 className="text-xl font-black tracking-tight mb-4">Posts</h2>
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
