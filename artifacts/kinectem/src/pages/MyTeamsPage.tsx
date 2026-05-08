import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  useGetLoggedInUser,
  useListUserTeams,
  queryOpts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, UsersRound } from "lucide-react";
import { getInitials } from "@/lib/format";

function TeamLogoTile({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);
  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        onError={() => setFailed(true)}
        className="w-14 h-14 rounded-xl object-cover bg-muted shrink-0"
      />
    );
  }
  return (
    <div className="w-14 h-14 rounded-xl brand-gradient-dark flex items-center justify-center text-primary font-black shrink-0">
      {getInitials(name)}
    </div>
  );
}

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
          <span className="brand-gradient-text">Teams</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1 font-medium">
          Teams you&rsquo;re a member of.
        </p>
      </div>

      {isLoading || !meId ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <Card className="rounded-xl border border-border">
          <CardContent className="p-8 text-center">
            <UsersRound className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              You&rsquo;re not on any teams yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {teams.map((t) => (
            <Link key={t.teamId} href={`/teams/${t.teamId}`}>
              <Card className="rounded-xl border border-border shadow-sm hover:border-primary/50 transition-colors cursor-pointer group">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <TeamLogoTile
                      name={t.teamName}
                      avatarUrl={t.teamAvatarUrl ?? null}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-black text-base sm:text-lg leading-tight tracking-tight group-hover:text-primary transition-colors break-words min-w-0">
                          {t.teamName}
                        </h3>
                        <ChevronRight className="w-5 h-5 text-primary shrink-0" />
                      </div>
                      {t.organization?.name && (
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed truncate">
                          {t.organization.name}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-3">
                        {t.role && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-bold uppercase tracking-wider"
                          >
                            {t.role}
                          </Badge>
                        )}
                        {t.position && (
                          <Badge
                            variant="outline"
                            className="text-[10px] font-bold uppercase tracking-wider"
                          >
                            {t.position}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
