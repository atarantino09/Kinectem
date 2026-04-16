import { useGetFeed, useListOrganizations, useGetCurrentUser } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Plus, Building2, Trophy, MapPin } from "lucide-react";
import { FeedItemCard } from "@/components/FeedItemCard";
import { getInitials } from "@/lib/format";

export default function FeedPage() {
  const { data: feed, isLoading } = useGetFeed();
  const { data: orgs } = useListOrganizations();
  const { data: me } = useGetCurrentUser();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_300px] gap-6">
      {/* Left sidebar: profile card */}
      <aside className="hidden lg:block space-y-4">
        {me && (
          <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="h-16 brand-gradient" />
            <CardContent className="p-4 -mt-8">
              <Link href={`/users/${me.id}`}>
                <Avatar className="w-16 h-16 border-4 border-card cursor-pointer">
                  {me.avatarUrl && <AvatarImage src={me.avatarUrl} />}
                  <AvatarFallback className="bg-slate-100 text-slate-800 font-bold">
                    {getInitials(me.name)}
                  </AvatarFallback>
                </Avatar>
              </Link>
              <h3 className="font-black text-base tracking-tight mt-3">{me.name}</h3>
              {me.position && (
                <p className="text-xs font-bold text-primary uppercase tracking-wider mt-0.5">
                  {me.jerseyNumber ? `#${me.jerseyNumber} • ` : ""}
                  {me.position}
                </p>
              )}
              {me.location && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2 font-medium">
                  <MapPin className="w-3 h-3" /> {me.location}
                </div>
              )}
              <Link href={`/users/${me.id}`}>
                <Button variant="outline" size="sm" className="w-full mt-3 font-semibold">
                  View Profile
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        <Card className="rounded-xl border border-border shadow-sm">
          <CardContent className="p-4">
            <h4 className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">
              Quick Actions
            </h4>
            <div className="space-y-2">
              <Link href="/articles/new">
                <Button variant="ghost" size="sm" className="w-full justify-start font-semibold">
                  <Plus className="w-4 h-4 mr-2" /> New Recap
                </Button>
              </Link>
              <Link href="/highlights/new">
                <Button variant="ghost" size="sm" className="w-full justify-start font-semibold">
                  <Plus className="w-4 h-4 mr-2" /> New Highlight
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </aside>

      {/* Center feed */}
      <section className="space-y-4 min-w-0">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black tracking-tight">Your Feed</h1>
          <Badge variant="outline" className="font-bold">
            {feed?.length ?? 0} posts
          </Badge>
        </div>

        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        )}

        {!isLoading && feed && feed.length === 0 && (
          <Card className="rounded-xl border border-border">
            <CardContent className="p-10 text-center">
              <Trophy className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-bold">No posts yet</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Follow teams or organizations to see activity here.
              </p>
            </CardContent>
          </Card>
        )}

        {feed?.map((item) => (
          <FeedItemCard key={item.id} item={item} />
        ))}
      </section>

      {/* Right sidebar: orgs */}
      <aside className="hidden lg:block space-y-4">
        <Card className="rounded-xl border border-border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                Organizations
              </h4>
              <Building2 className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="space-y-3">
              {orgs?.slice(0, 6).map((org) => (
                <Link key={org.id} href={`/organizations/${org.id}`}>
                  <div className="flex items-center gap-3 cursor-pointer hover:bg-muted/60 -mx-2 px-2 py-2 rounded-lg">
                    <div className="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center shrink-0 text-primary font-black text-xs tracking-tighter">
                      {getInitials(org.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{org.name}</p>
                      {org.sport && (
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          {org.sport}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
              {!orgs?.length && (
                <p className="text-xs text-muted-foreground">No organizations yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
