import { useParams, Link } from "wouter";
import {
  useGetUser,
  useGetUserTaggedContent,
} from "@workspace/api-client-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, MapPin, UserPlus, MessageSquare } from "lucide-react";
import { formatDate, getInitials } from "@/lib/format";

export default function UserProfilePage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const { data, isLoading } = useGetUser(userId);
  const { data: tagged } = useGetUserTaggedContent(userId);

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const { user, teams, stats } = data;
  const highlights = tagged?.highlights ?? [];
  const articles = tagged?.articles ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      {/* Left: profile card */}
      <aside className="space-y-4">
        <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="h-24 bg-gradient-to-r from-slate-900 to-blue-900 relative">
            <div className="absolute top-3 right-3 flex gap-2">
              <Button size="icon" variant="secondary" className="rounded-full bg-white/20 text-white hover:bg-white/30 border-none backdrop-blur-md w-8 h-8">
                <MessageSquare className="w-3.5 h-3.5" />
              </Button>
              <Button size="icon" variant="secondary" className="rounded-full bg-white/20 text-white hover:bg-white/30 border-none backdrop-blur-md w-8 h-8">
                <UserPlus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          <CardContent className="p-5 -mt-10">
            <Avatar className="w-20 h-20 border-4 border-card shadow-sm">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
              <AvatarFallback className="bg-muted text-foreground text-2xl font-bold">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <h1 className="text-2xl font-black tracking-tight mt-3">{user.name}</h1>
            {user.role === "athlete" && user.position && (
              <p className="text-primary font-bold text-sm tracking-wide mt-0.5">
                {user.jerseyNumber ? `#${user.jerseyNumber} • ` : ""}
                {user.position.toUpperCase()}
              </p>
            )}
            {user.role === "coach" && (
              <p className="text-primary font-bold text-sm tracking-wide mt-0.5 uppercase">
                Coach
              </p>
            )}
            {user.location && (
              <div className="flex items-center gap-1.5 text-muted-foreground text-sm mt-2 font-medium">
                <MapPin className="w-3.5 h-3.5" />
                {user.location}
              </div>
            )}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {user.grade && (
                <Badge variant="secondary" className="bg-primary/10 text-primary border-none">
                  Class of {user.grade}
                </Badge>
              )}
              {user.sport && (
                <Badge variant="secondary" className="bg-muted text-foreground border-none">
                  {user.sport}
                </Badge>
              )}
            </div>
            {user.bio && (
              <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{user.bio}</p>
            )}
          </CardContent>

          {stats && (stats.gamesPlayed !== undefined || stats.primaryStatValue) && (
            <div className="grid grid-cols-3 border-t border-border">
              <div className="text-center py-4">
                <div className="text-2xl font-black">{stats.gamesPlayed ?? 0}</div>
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">
                  Games
                </div>
              </div>
              {stats.primaryStatValue && (
                <div className="text-center py-4 border-l border-border">
                  <div className="text-2xl font-black text-primary">{stats.primaryStatValue}</div>
                  <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">
                    {stats.primaryStatLabel}
                  </div>
                </div>
              )}
              {stats.secondaryStatValue && (
                <div className="text-center py-4 border-l border-border">
                  <div className="text-2xl font-black">{stats.secondaryStatValue}</div>
                  <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">
                    {stats.secondaryStatLabel}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Teams */}
        <Card className="rounded-xl border border-border shadow-sm">
          <CardContent className="p-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">
              Teams
            </h3>
            <div className="space-y-2">
              {teams.length === 0 && (
                <p className="text-sm text-muted-foreground">No teams yet.</p>
              )}
              {teams.map((t) => (
                <Link key={t.id} href={`/teams/${t.id}`}>
                  <div className="flex items-center gap-3 cursor-pointer hover:bg-muted -mx-2 px-2 py-2 rounded-lg">
                    <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{t.name}</p>
                      {t.season && (
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          {t.season}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </aside>

      {/* Right: content */}
      <div className="space-y-8 min-w-0">
        <section>
          <h2 className="text-xl font-black tracking-tight mb-4">Highlights</h2>
          {highlights.length === 0 ? (
            <Card className="rounded-xl border border-border">
              <CardContent className="p-6 text-sm text-muted-foreground text-center">
                No highlights yet.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {highlights.map((h) => (
                <Link key={h.id} href={`/highlights/${h.id}`}>
                  <Card className="rounded-xl border border-border shadow-sm overflow-hidden group cursor-pointer">
                    <div className="h-40 bg-gradient-to-tr from-slate-900 to-slate-800 relative flex items-center justify-center">
                      {h.thumbnailUrl && (
                        <img src={h.thumbnailUrl} alt={h.title} className="absolute inset-0 w-full h-full object-cover opacity-60" />
                      )}
                      <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-primary transition-colors z-10">
                        <Play className="w-5 h-5 text-white ml-1" fill="currentColor" />
                      </div>
                      {h.durationSeconds && (
                        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                          {Math.floor(h.durationSeconds / 60)}:{String(h.durationSeconds % 60).padStart(2, "0")}
                        </div>
                      )}
                    </div>
                    <CardContent className="p-3">
                      <h3 className="font-bold text-sm truncate">{h.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{formatDate(h.createdAt)}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-xl font-black tracking-tight mb-4">Articles & Recaps</h2>
          {articles.length === 0 ? (
            <Card className="rounded-xl border border-border">
              <CardContent className="p-6 text-sm text-muted-foreground text-center">
                No articles yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {articles.map((a) => (
                <Link key={a.id} href={`/articles/${a.id}`}>
                  <Card className="rounded-xl border border-border shadow-sm cursor-pointer hover:border-primary/50 transition-colors group">
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-none text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider">
                          Game Recap
                        </Badge>
                        <span className="text-xs text-muted-foreground font-medium">
                          {formatDate(a.createdAt)}
                        </span>
                      </div>
                      <h3 className="font-bold mb-1.5 group-hover:text-primary transition-colors">
                        {a.title}
                      </h3>
                      {a.snippet && (
                        <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                          {a.snippet}
                        </p>
                      )}
                      {a.teamName && (
                        <Badge variant="secondary" className="mt-3 bg-muted text-foreground border-none font-medium text-[10px]">
                          {a.teamName}
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
