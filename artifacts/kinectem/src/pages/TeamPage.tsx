import { useParams, Link } from "wouter";
import {
  useGetTeam,
  useGetTeamRoster,
  useGetTeamArticles,
  useGetTeamHighlights,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, Upload, Shield, Play, Trophy, UserPlus } from "lucide-react";
import { formatDate, getInitials } from "@/lib/format";
import type { RosterEntry } from "@workspace/api-client-react";

export default function TeamPage() {
  const params = useParams<{ teamId: string }>();
  const teamId = params.teamId;
  const { data, isLoading } = useGetTeam(teamId);
  const { data: roster } = useGetTeamRoster(teamId);
  const { data: articles } = useGetTeamArticles(teamId);
  const { data: highlights } = useGetTeamHighlights(teamId);

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const { team, organization } = data;
  const players: RosterEntry[] = (roster ?? []).filter((r) => r.role === "player");
  const coaches: RosterEntry[] = (roster ?? []).filter((r) => r.role === "coach");

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="rounded-xl border border-border shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
            <Link href={`/organizations/${organization.id}`}>
              <Badge
                variant="outline"
                className="bg-muted text-muted-foreground border-border font-bold px-2 py-0.5 text-xs uppercase tracking-wider cursor-pointer hover:bg-muted/80"
              >
                {organization.name}
              </Badge>
            </Link>
            {team.season && (
              <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-none font-bold">
                {team.season}
              </Badge>
            )}
          </div>
          <h1 className="text-4xl font-black tracking-tight leading-tight mb-3">
            {team.name}
          </h1>
          <div className="flex items-center gap-4 flex-wrap">
            {(team.wins !== undefined || team.losses !== undefined) && (
              <div className="font-bold text-foreground flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-md text-sm">
                <Trophy className="w-4 h-4 text-amber-500" />
                Record:{" "}
                <span>
                  {team.wins ?? 0}-{team.losses ?? 0}
                  {team.ties ? `-${team.ties}` : ""}
                </span>
              </div>
            )}
            {team.sport && (
              <span className="text-muted-foreground font-bold text-xs uppercase tracking-widest">
                {team.sport}
              </span>
            )}
          </div>

          <div className="flex gap-2 mt-6 flex-wrap">
            <Link href={`/articles/new?teamId=${team.id}`}>
              <Button className="bg-slate-900 hover:bg-slate-800 text-white font-bold">
                <FileText className="w-4 h-4 mr-2" /> Post Recap
              </Button>
            </Link>
            <Link href={`/highlights/new?teamId=${team.id}`}>
              <Button variant="outline" className="font-bold">
                <Upload className="w-4 h-4 mr-2" /> Highlight
              </Button>
            </Link>
            <Button variant="outline" size="icon" className="shrink-0">
              <UserPlus className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="roster">
        <TabsList className="bg-transparent h-auto p-0 gap-6 w-full justify-start border-b border-border rounded-none">
          <TabsTrigger
            value="roster"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none py-3 px-0 font-bold text-sm text-muted-foreground uppercase tracking-wide"
          >
            Roster
          </TabsTrigger>
          <TabsTrigger
            value="articles"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none py-3 px-0 font-bold text-sm text-muted-foreground uppercase tracking-wide"
          >
            Articles
          </TabsTrigger>
          <TabsTrigger
            value="highlights"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none py-3 px-0 font-bold text-sm text-muted-foreground uppercase tracking-wide"
          >
            Highlights
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="mt-6 space-y-6">
          <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow className="hover:bg-muted border-border">
                  <TableHead className="w-12 text-center text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    #
                  </TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Player
                  </TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider text-center">
                    Pos
                  </TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider text-right pr-4">
                    Grad
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {players.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-sm text-muted-foreground">
                      No players on roster.
                    </TableCell>
                  </TableRow>
                )}
                {players.map((p) => (
                  <TableRow key={p.id} className="hover:bg-muted/60 border-border/60">
                    <TableCell className="text-center font-bold text-muted-foreground">
                      {p.jerseyNumber ?? "—"}
                    </TableCell>
                    <TableCell className="py-3">
                      <Link href={`/users/${p.user.id}`}>
                        <div className="flex items-center gap-3 cursor-pointer">
                          <Avatar className="w-8 h-8 rounded-md">
                            {p.user.avatarUrl && <AvatarImage src={p.user.avatarUrl} />}
                            <AvatarFallback className="text-[10px] font-bold text-muted-foreground rounded-md">
                              {getInitials(p.user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium hover:text-primary">
                            {p.user.name}
                          </span>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-center">
                      {p.position && (
                        <Badge
                          variant="outline"
                          className="bg-muted text-muted-foreground border-border font-bold px-1.5 py-0 text-[10px]"
                        >
                          {p.position}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground pr-4">
                      {p.grade ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <div>
            <h3 className="text-sm font-black tracking-tight uppercase mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-muted-foreground" /> Coaching Staff
            </h3>
            <Card className="rounded-xl border border-border shadow-sm">
              <CardContent className="p-4 space-y-4">
                {coaches.length === 0 && (
                  <p className="text-sm text-muted-foreground">No coaches listed.</p>
                )}
                {coaches.map((c) => (
                  <Link key={c.id} href={`/users/${c.user.id}`}>
                    <div className="flex items-center gap-3 cursor-pointer hover-elevate rounded-lg -mx-2 px-2 py-1">
                      <Avatar className="w-10 h-10 border border-border">
                        {c.user.avatarUrl && <AvatarImage src={c.user.avatarUrl} />}
                        <AvatarFallback className="bg-muted text-muted-foreground font-bold">
                          {getInitials(c.user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-bold leading-none">{c.user.name}</p>
                        <p className="text-xs text-primary font-bold uppercase tracking-wider mt-1">
                          {c.position ?? "Coach"}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="articles" className="mt-6 space-y-3">
          {!articles?.length && (
            <Card className="rounded-xl border border-border">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No articles yet.
              </CardContent>
            </Card>
          )}
          {articles?.map((a) => (
            <Link key={a.id} href={`/articles/${a.id}`}>
              <Card className="rounded-xl border border-border shadow-sm hover:border-primary/50 transition-colors cursor-pointer group">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      {a.opponentName && <span>vs. {a.opponentName}</span>}
                      {a.gameDate && (
                        <>
                          <span className="w-1 h-1 rounded-full bg-border"></span>
                          <span>{formatDate(a.gameDate)}</span>
                        </>
                      )}
                    </div>
                    {a.gameScore && (
                      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none font-black px-2 py-0.5 text-xs">
                        {a.gameScore}
                      </Badge>
                    )}
                  </div>
                  <h4 className="font-bold group-hover:text-primary transition-colors mt-2 text-lg leading-tight">
                    {a.title}
                  </h4>
                  {a.snippet && (
                    <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{a.snippet}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </TabsContent>

        <TabsContent value="highlights" className="mt-6">
          {!highlights?.length && (
            <Card className="rounded-xl border border-border">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No highlights yet.
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {highlights?.map((h) => (
              <Link key={h.id} href={`/highlights/${h.id}`}>
                <Card className="overflow-hidden rounded-xl border border-border shadow-sm group cursor-pointer">
                  <div className="h-36 bg-slate-900 relative flex items-center justify-center">
                    {h.thumbnailUrl && (
                      <img src={h.thumbnailUrl} alt={h.title} className="absolute inset-0 w-full h-full object-cover opacity-60" />
                    )}
                    <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:brand-gradient transition-colors z-10">
                      <Play className="w-4 h-4 text-white ml-1" fill="currentColor" />
                    </div>
                  </div>
                  <CardContent className="p-3">
                    <h4 className="font-bold text-sm line-clamp-2 leading-snug">{h.title}</h4>
                    {h.taggedUsers && h.taggedUsers.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {h.taggedUsers.slice(0, 3).map((u) => (
                          <span key={u.id} className="text-[10px] font-bold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                            {u.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
