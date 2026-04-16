import { useParams, Link } from "wouter";
import {
  useGetTeamById,
  useListTeamMembers,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Shield, Trophy, UserPlus } from "lucide-react";
import { formatDate, getInitials } from "@/lib/format";

export default function TeamPage() {
  const params = useParams<{ teamId: string }>();
  const teamId = params.teamId;
  const { data: team, isLoading } = useGetTeamById(teamId);
  const { data: membersResp } = useListTeamMembers(teamId);

  if (isLoading || !team) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const allMembers = membersResp?.data ?? [];
  const players = allMembers.filter((m) => m.position === "player");
  const staff = allMembers.filter((m) => m.position !== "player");

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="rounded-xl border border-border shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
            <Link href={`/organizations/${team.organization.id}`}>
              <Badge
                variant="outline"
                className="bg-muted text-muted-foreground border-border font-bold px-2 py-0.5 text-xs uppercase tracking-wider cursor-pointer hover:bg-muted/80"
              >
                {team.organization.name}
              </Badge>
            </Link>
            {team.currentSeason && (
              <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-none font-bold">
                {team.currentSeason.name}
              </Badge>
            )}
          </div>
          <h1 className="text-4xl font-black tracking-tight leading-tight mb-3">
            {team.name}
          </h1>
          <div className="flex items-center gap-4 flex-wrap">
            {team.sport && (
              <div className="font-bold text-foreground flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-md text-sm">
                <Trophy className="w-4 h-4 text-amber-500" />
                {team.sport}
              </div>
            )}
            {team.level && (
              <div className="font-bold text-muted-foreground text-sm uppercase tracking-wider">
                {team.level}
              </div>
            )}
            <div className="ml-auto">
              <Button className="bg-primary text-primary-foreground font-bold rounded-full px-5">
                {team.isFollowing ? "Following" : "Follow"} ({team.followerCount})
              </Button>
            </div>
          </div>
          {team.description && (
            <p className="text-sm text-muted-foreground mt-4 leading-relaxed max-w-3xl">
              {team.description}
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="roster">
        <TabsList>
          <TabsTrigger value="roster" className="font-bold">
            Roster
          </TabsTrigger>
          <TabsTrigger value="staff" className="font-bold">
            Staff
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="mt-4">
          <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-black text-sm uppercase tracking-wider">
                Players
              </h3>
              <Button size="sm" variant="outline" className="font-bold">
                <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Invite
              </Button>
            </div>
            <CardContent className="p-0">
              {players.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No players on the roster yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {players.map((m) => (
                      <TableRow key={m.userId}>
                        <TableCell>
                          <Link href={`/users/${m.userId}`}>
                            <div className="flex items-center gap-3 cursor-pointer hover:text-primary">
                              <div className="w-8 h-8 rounded-full bg-slate-900 text-primary-foreground flex items-center justify-center text-[10px] font-bold">
                                {getInitials(m.displayName)}
                              </div>
                              <span className="font-semibold">
                                {m.displayName}
                              </span>
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm capitalize">
                          {m.position?.replace(/_/g, " ") ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
                          {m.role}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(m.joinedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="staff" className="mt-4">
          <Card className="rounded-xl border border-border shadow-sm">
            <CardContent className="p-5">
              {staff.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Shield className="w-4 h-4" />
                  No coaches or staff listed.
                </div>
              ) : (
                <div className="space-y-3">
                  {staff.map((m) => (
                    <Link key={m.userId} href={`/users/${m.userId}`}>
                      <div className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer">
                        <div className="w-9 h-9 rounded-full bg-slate-900 text-primary-foreground flex items-center justify-center text-[10px] font-bold">
                          {getInitials(m.displayName)}
                        </div>
                        <div className="flex-1">
                          <p className="font-bold text-sm">{m.displayName}</p>
                          <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                            {m.position?.replace(/_/g, " ")} • {m.role}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
