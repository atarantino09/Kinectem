import { Link } from "wouter";
import {
  useGetLoggedInUser,
  useListOrganizations,
  useListFeed,
  useListUserOrganizations,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { getInitials } from "@/lib/format";

export default function FeedPage() {
  const { data: me } = useGetLoggedInUser();
  const { data: myOrgs } = useListUserOrganizations(me?.id ?? "", undefined, {
    query: { enabled: !!me?.id } as never,
  });
  const { data: orgs } = useListOrganizations();
  const { data: feed, isLoading: feedLoading } = useListFeed();

  const displayName = me ? `${me.firstName} ${me.lastName}` : "";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_300px] gap-6">
      {/* Left sidebar */}
      <aside className="hidden lg:block space-y-4">
        {me && (
          <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="h-16 brand-gradient" />
            <CardContent className="p-4 -mt-8">
              <Link href={`/users/${me.id}`}>
                <Avatar className="w-16 h-16 border-4 border-card cursor-pointer">
                  {me.avatarUrl && <AvatarImage src={me.avatarUrl} />}
                  <AvatarFallback className="bg-slate-100 text-slate-800 font-bold">
                    {getInitials(displayName)}
                  </AvatarFallback>
                </Avatar>
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
              <div className="space-y-2">
                {myOrgs.data.slice(0, 4).map((org) => (
                  <Link key={org.id} href={`/organizations/${org.id}`}>
                    <div className="flex items-center gap-2 text-sm font-semibold hover:text-primary cursor-pointer">
                      <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="truncate">{org.name}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </aside>

      {/* Center feed */}
      <div className="space-y-4">
        <h2 className="text-2xl font-black tracking-tight">Latest Activity</h2>
        {feedLoading ? (
          <>
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </>
        ) : !feed || feed.data.length === 0 ? (
          <Card className="rounded-xl border border-border">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Your feed is quiet. Follow organizations or athletes to see updates here.
            </CardContent>
          </Card>
        ) : (
          feed.data.map((post: (typeof feed.data)[number]) => (
            <PostCard key={post.id} post={post} />
          ))
        )}
      </div>

      {/* Right sidebar: orgs */}
      <aside className="hidden lg:block space-y-4">
        {orgs && (
          <Card className="rounded-xl border border-border shadow-sm">
            <CardContent className="p-4">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground mb-3">
                Featured Organizations
              </h4>
              <div className="space-y-3">
                {orgs.data.slice(0, 5).map((org) => (
                  <Link key={org.id} href={`/organizations/${org.id}`}>
                    <div className="flex items-start gap-3 cursor-pointer hover:bg-muted/50 -mx-2 px-2 py-1 rounded">
                      <div className="w-9 h-9 rounded-lg brand-gradient-dark flex items-center justify-center text-primary font-black text-xs shrink-0">
                        {getInitials(org.name)}
                      </div>
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
