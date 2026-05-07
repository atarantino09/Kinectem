import { Link, useSearch } from "wouter";
import { useCrossEntitySearch, queryOpts } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar, TeamAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Building2, Trophy, User as UserIcon } from "lucide-react";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";

export default function SearchPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const q = params.get("q")?.trim() ?? "";

  const enabled = q.length >= 3;
  const { data, isLoading } = useCrossEntitySearch(
    { q, limit: 8 },
    { query: queryOpts({ enabled }) },
  );

  if (!enabled) {
    return (
      <div className="max-w-3xl mx-auto py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight mb-2">Search</h1>
          <p className="text-sm text-muted-foreground">
            Type at least 3 characters to search athletes, teams, and organizations.
          </p>
        </div>
        <SuggestionsPanel
          heading="Suggested for you"
          subheading="Discover organizations, teams, and athletes to follow."
          hideWhenEmpty
        />
      </div>
    );
  }

  const users = data?.users?.data ?? [];
  const orgs = data?.organizations?.data ?? [];
  const teams = data?.teams?.data ?? [];

  return (
    <div className="max-w-3xl mx-auto space-y-8 py-4">
      <h1 className="text-2xl font-black tracking-tight">
        Results for <span className="text-primary">"{q}"</span>
      </h1>

      {isLoading ? (
        <>
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </>
      ) : (
        <>
          <Section
            title="Athletes & People"
            icon={<UserIcon className="w-4 h-4" />}
            empty="No people found."
            count={users.length}
          >
            {users.map((u) => (
              <Link key={u.id} href={`/users/${u.id}`}>
                <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/60 cursor-pointer">
                  <UserAvatar
                    avatarUrl={u.avatarUrl}
                    displayName={u.displayName}
                    size="lg"
                    fallbackClassName="bg-slate-900 text-primary-foreground"
                  />
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">
                      {u.displayName}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {u.entityType}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </Section>

          <Section
            title="Organizations"
            icon={<Building2 className="w-4 h-4" />}
            empty="No organizations found."
            count={orgs.length}
          >
            {orgs.map((o) => (
              <Link key={o.id} href={`/organizations/${o.id}`}>
                <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/60 cursor-pointer">
                  <TeamAvatar
                    avatarUrl={o.avatarUrl}
                    displayName={o.name}
                    size="lg"
                    fallbackClassName="bg-slate-100 text-slate-800"
                  />
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{o.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      /{o.slug}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </Section>

          <Section
            title="Teams"
            icon={<Trophy className="w-4 h-4" />}
            empty="No teams found."
            count={teams.length}
          >
            {teams.map((t) => (
              <Link key={t.id} href={`/teams/${t.id}`}>
                <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/60 cursor-pointer">
                  <TeamAvatar
                    avatarUrl={t.avatarUrl}
                    displayName={t.name}
                    size="lg"
                    fallbackClassName="bg-slate-100 text-slate-800"
                  />
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{t.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {t.organizationName}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </Section>

          <SuggestionsPanel
            heading="Suggested for you"
            subheading="Other organizations, teams, and athletes to follow."
            hideWhenEmpty
          />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  count,
  empty,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-xl border border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <h3 className="font-black tracking-tight text-base">{title}</h3>
          <Badge variant="secondary" className="text-[10px] font-bold">
            {count}
          </Badge>
        </div>
        {count === 0 ? (
          <p className="text-sm text-muted-foreground p-3">{empty}</p>
        ) : (
          <div className="-mx-1">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}
