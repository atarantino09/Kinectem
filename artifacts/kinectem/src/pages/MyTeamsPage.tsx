import { Link } from "wouter";
import { formatOrgName } from "@/lib/format";
import {
  useGetLoggedInUser,
  useListUserTeams,
  queryOpts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { UsersRound } from "lucide-react";
import { OrgLogo } from "@/components/OrgLogoFallback";

export default function MyTeamsPage() {
  const { data: me } = useGetLoggedInUser();
  const meId = me?.id;
  const { data, isLoading } = useListUserTeams(meId ?? "", undefined, {
    query: queryOpts({ enabled: !!meId }),
  });
  const teams = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-4xl font-black tracking-tight">
          <span className="brand-gradient-text">My Teams</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1 font-medium">
          Teams you're on. Tap a card to open it.
        </p>
      </div>

      {isLoading || !meId ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <Card className="rounded-xl border border-border" data-testid="my-teams-empty">
          <CardContent className="p-8 text-center">
            <UsersRound className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              You're not on any teams yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {teams.map((t) => {
            const isPending = t.status === "pending";
            return (
              <Link key={t.id} href={`/teams/${t.teamId}`}>
                <Card
                  className="rounded-xl border border-border shadow-sm hover:border-primary/50 transition-colors cursor-pointer"
                  data-testid={`card-my-team-${t.teamId}`}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="relative w-16 h-12 rounded-md overflow-hidden border border-border shrink-0 bg-gradient-to-br from-primary/30 via-primary/10 to-primary/5">
                      {t.teamBannerUrl && (
                        <img
                          src={t.teamBannerUrl}
                          alt={`${t.teamName} background`}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <p className="font-bold text-sm truncate">{t.teamName}</p>
                        <span className="text-xs font-bold text-muted-foreground shrink-0">
                          {t.jerseyNumber ? `#${t.jerseyNumber}` : "—"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1"
                        >
                          <OrgLogo
                            logoUrl={t.organization?.logoUrl ?? null}
                            name={t.organization?.name ?? "Independent"}
                            alt=""
                            className="w-3 h-3 rounded-sm shrink-0"
                            imgClassName="w-3 h-3 rounded-sm object-cover bg-muted shrink-0"
                          />
                          {t.organization
                            ? formatOrgName(t.organization.name)
                            : "Independent"}
                        </Badge>
                        {t.position === "parent" && (
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase tracking-wider font-bold"
                          >
                            Parent
                          </Badge>
                        )}
                        {isPending && (
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase tracking-wider font-bold border-amber-500 text-amber-700 dark:text-amber-400"
                          >
                            Pending
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
