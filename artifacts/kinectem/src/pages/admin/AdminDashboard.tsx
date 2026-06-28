import { useQuery } from "@tanstack/react-query";
import { formatOrgName } from "@/lib/format";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Analytics = {
  totals: {
    users: number;
    athletes: number;
    parents: number;
    coaches: number;
    admins: number;
    deletedUsers: number;
    organizations: number;
    teams: number;
    articles: number;
    hiddenArticles: number;
    highlights: number;
    hiddenHighlights: number;
    orgPosts: number;
    comments: number;
    messages: number;
    follows: number;
    userFollows: number;
    orgFollows: number;
    teamFollows: number;
    openReports: number;
    activeUsersLast30d: number;
  };
  series: {
    newUsersByDay: Array<{ day: string; count: number }>;
    newPostsByDay: Array<{ day: string; count: number }>;
    commentsByDay: Array<{ day: string; count: number }>;
    activeSessionsByDay: Array<{ day: string; count: number }>;
    newOrgsByWeek: Array<{ week: string; count: number }>;
    newTeamsByWeek: Array<{ week: string; count: number }>;
    gameRecapsByWeek: Array<{ week: string; count: number }>;
  };
  top: {
    followedOrganizations: Array<{ orgId: string; name: string; count: number }>;
    followedUsers: Array<{ userId: string; name: string; email: string; count: number }>;
    postersThisWeek: Array<{ userId: string; name: string; email: string; count: number }>;
  };
};

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className="text-3xl font-black mt-1">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Sparkline({ data }: { data: Array<{ day: string; count: number }> }) {
  if (data.length === 0) {
    return <div className="text-sm text-muted-foreground">No activity yet.</div>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-1 h-24">
      {data.map((d) => (
        <div
          key={d.day}
          className="flex-1 bg-primary/70 rounded-t"
          style={{ height: `${(d.count / max) * 100}%` }}
          title={`${d.day}: ${d.count}`}
        />
      ))}
    </div>
  );
}

function WeeklyBars({ data }: { data: Array<{ week: string; count: number }> }) {
  if (data.length === 0) {
    return <div className="text-sm text-muted-foreground">No activity yet.</div>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  const fmt = (week: string) => {
    const d = new Date(`${week}T00:00:00`);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-2 h-32 min-w-full">
        {data.map((d) => (
          <div
            key={d.week}
            className="flex-1 min-w-[2.25rem] flex flex-col items-center gap-1 h-full justify-end"
          >
            <div className="text-xs font-bold text-foreground">{d.count}</div>
            <div
              className="w-full bg-primary/70 rounded-t min-h-[2px]"
              style={{ height: `${(d.count / max) * 100}%` }}
              title={`Week of ${d.week}: ${d.count}`}
            />
            <div className="text-[10px] text-muted-foreground whitespace-nowrap">{fmt(d.week)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { data, isLoading } = useQuery<Analytics>({
    queryKey: ["admin", "analytics"],
    queryFn: () => customFetch<Analytics>("/api/v1/admin/analytics", { method: "GET" }),
  });

  return (
    <AdminLayout>
      <h1 className="text-2xl font-black mb-4">Dashboard</h1>
      {isLoading || !data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mt-2 mb-2">
            People
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              label="Users"
              value={data.totals.users}
              hint={`${data.totals.deletedUsers} deactivated`}
            />
            <Stat label="Active 30d" value={data.totals.activeUsersLast30d} />
            <Stat label="Athletes" value={data.totals.athletes} />
            <Stat label="Parents" value={data.totals.parents} />
            <Stat label="Coaches" value={data.totals.coaches} />
            <Stat label="Admins" value={data.totals.admins} />
            <Stat label="Organizations" value={data.totals.organizations} />
            <Stat label="Teams" value={data.totals.teams} />
          </div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mt-6 mb-2">
            Content & engagement
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              label="Articles"
              value={data.totals.articles}
              hint={`${data.totals.hiddenArticles} hidden`}
            />
            <Stat
              label="Highlights"
              value={data.totals.highlights}
              hint={`${data.totals.hiddenHighlights} hidden`}
            />
            <Stat label="Org posts" value={data.totals.orgPosts} />
            <Stat label="Comments" value={data.totals.comments} />
            <Stat label="Messages" value={data.totals.messages} />
            <Stat
              label="Follows"
              value={data.totals.follows}
              hint={`${data.totals.userFollows} user · ${data.totals.orgFollows} org · ${data.totals.teamFollows} team`}
            />
            <Stat label="Open reports" value={data.totals.openReports} />
          </div>

          <div className="grid md:grid-cols-2 gap-3 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">New users (last 30 days)</CardTitle>
              </CardHeader>
              <CardContent>
                <Sparkline data={data.series.newUsersByDay} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">New posts (last 30 days)</CardTitle>
              </CardHeader>
              <CardContent>
                <Sparkline data={data.series.newPostsByDay} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">New comments (last 30 days)</CardTitle>
              </CardHeader>
              <CardContent>
                <Sparkline data={data.series.commentsByDay} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Active sessions (last 30 days)</CardTitle>
              </CardHeader>
              <CardContent>
                <Sparkline data={data.series.activeSessionsByDay} />
              </CardContent>
            </Card>
          </div>

          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mt-6 mb-2">
            Growth (last 12 weeks)
          </h2>
          <div className="grid md:grid-cols-3 gap-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">New organizations per week</CardTitle>
              </CardHeader>
              <CardContent>
                <WeeklyBars data={data.series.newOrgsByWeek} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">New teams per week</CardTitle>
              </CardHeader>
              <CardContent>
                <WeeklyBars data={data.series.newTeamsByWeek} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Game recaps per week</CardTitle>
              </CardHeader>
              <CardContent>
                <WeeklyBars data={data.series.gameRecapsByWeek} />
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-3 gap-3 mt-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Most-followed organizations</CardTitle>
              </CardHeader>
              <CardContent>
                {data.top.followedOrganizations.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No data.</div>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.top.followedOrganizations.map((o) => (
                      <li key={o.orgId} className="flex justify-between">
                        <span>{formatOrgName(o.name) || "Unknown"}</span>
                        <span className="text-muted-foreground">
                          {o.count} follower{o.count === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Most-followed users</CardTitle>
              </CardHeader>
              <CardContent>
                {data.top.followedUsers.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No data.</div>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.top.followedUsers.map((u) => (
                      <li key={u.userId} className="flex justify-between">
                        <span>{u.name ?? u.email ?? "Unknown"}</span>
                        <span className="text-muted-foreground">
                          {u.count} follower{u.count === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Most active posters this week</CardTitle>
              </CardHeader>
              <CardContent>
                {data.top.postersThisWeek.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No posts this week.</div>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.top.postersThisWeek.map((u) => (
                      <li key={u.userId} className="flex justify-between">
                        <span>{u.name ?? u.email ?? "Unknown"}</span>
                        <span className="text-muted-foreground">{u.count} posts</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </AdminLayout>
  );
}
