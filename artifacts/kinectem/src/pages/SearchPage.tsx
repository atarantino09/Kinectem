import { Link, useSearch } from "wouter";
import { formatOrgName } from "@/lib/format";
import { useCrossEntitySearch, queryOpts } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar, TeamAvatar } from "@/components/UserAvatar";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Medal,
  Search,
  Trophy,
  User as UserIcon,
} from "lucide-react";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import { BrandPageHeader } from "@/components/BrandPageHeader";
import { EmptyState } from "@/components/EmptyState";

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
        <BrandPageHeader
          eyebrow="Discover your community"
          title={<span className="brand-gradient-text">Search</span>}
          description="Type at least 3 characters to search athletes, teams, and organizations."
        />
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
  // Competitions ride on the same response as an extra key beyond the
  // locked openapi spec (recapKind precedent) — read via a narrow cast.
  const competitions =
    (
      data as
        | {
            competitions?: {
              data: Array<{
                id: string;
                slug: string;
                name: string;
                type: string;
                location: string | null;
                logoUrl: string | null;
                startDate: string;
                endDate: string;
              }>;
            };
          }
        | undefined
    )?.competitions?.data ?? [];

  return (
    <div className="max-w-3xl mx-auto space-y-8 py-4">
      <BrandPageHeader
        eyebrow="Search results"
        title={
          <>
            Results for <span className="brand-gradient-text">"{q}"</span>
          </>
        }
        description="Find the people, teams, organizations, and competitions that power your feed."
      />

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
                  <div className="app-surface-interactive flex items-center gap-3 rounded-lg p-3 hover:bg-muted/60 cursor-pointer">
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
                  <div className="app-surface-interactive flex items-center gap-3 rounded-lg p-3 hover:bg-muted/60 cursor-pointer">
                  <OrgLogo
                    logoUrl={o.avatarUrl}
                    name={o.name}
                    className="w-10 h-10 rounded-lg shrink-0"
                    imgClassName="w-10 h-10 rounded-lg object-contain bg-muted shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{formatOrgName(o.name)}</p>
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
                  <div className="app-surface-interactive flex items-center gap-3 rounded-lg p-3 hover:bg-muted/60 cursor-pointer">
                  <TeamAvatar
                    avatarUrl={t.avatarUrl}
                    displayName={t.name}
                    size="lg"
                    fallbackClassName="bg-slate-100 text-slate-800"
                  />
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{t.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {formatOrgName(t.organizationName)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </Section>

          <Section
            title="Competitions"
            icon={<Medal className="w-4 h-4" />}
            empty="No competitions found."
            count={competitions.length}
          >
            {competitions.map((c) => (
              <Link key={c.id} href={`/competitions/c/${encodeURIComponent(c.slug)}`}>
                <div
                  className="app-surface-interactive flex items-center gap-3 rounded-lg p-3 hover:bg-muted/60 cursor-pointer"
                  data-testid={`link-search-competition-${c.id}`}
                >
                  {c.logoUrl ? (
                    <img
                      src={c.logoUrl}
                      alt=""
                      className="w-10 h-10 rounded-lg object-contain bg-muted shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-800 flex items-center justify-center shrink-0">
                      <Medal className="w-5 h-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.type === "league" ? "League" : "Tournament"}
                      {c.location ? ` · ${c.location}` : ""} · {c.startDate}
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
    <Card className="app-surface">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2">
          {icon}
          <h3 className="app-section-heading text-base">{title}</h3>
          <Badge variant="secondary" className="brand-pill px-2 py-1">
            {count}
          </Badge>
        </div>
        {count === 0 ? (
          <EmptyState
            icon={<Search className="h-5 w-5" />}
            title={empty}
            className="min-h-28 py-5"
          />
        ) : (
          <div className="-mx-1">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}
