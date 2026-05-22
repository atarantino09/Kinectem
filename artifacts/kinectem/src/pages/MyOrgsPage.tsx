import { Link } from "wouter";
import {
  useGetLoggedInUser,
  useListUserOrganizations,
  queryOpts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2, ChevronRight } from "lucide-react";
import { OrgLogo } from "@/components/OrgLogoFallback";

function OrgLogoTile({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null;
}) {
  return (
    <OrgLogo
      logoUrl={logoUrl}
      name={name}
      className="w-14 h-14 rounded-xl shrink-0"
      imgClassName="w-14 h-14 rounded-xl object-cover bg-muted shrink-0"
    />
  );
}

export default function MyOrgsPage() {
  const { data: me } = useGetLoggedInUser();
  const meId = me?.id;
  const { data, isLoading } = useListUserOrganizations(meId ?? "", undefined, {
    query: queryOpts({ enabled: !!meId }),
  });
  const orgs = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight">
            <span className="brand-gradient-text">My Organizations</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">
            Organizations you belong to.
          </p>
        </div>
        <Link
          href="/organizations"
          className="text-xs font-bold uppercase tracking-wider text-primary hover:underline shrink-0 mt-2"
          data-testid="link-discover-orgs"
        >
          Discover
        </Link>
      </div>

      {isLoading || !meId ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <Card className="rounded-xl border border-border" data-testid="my-orgs-empty">
          <CardContent className="p-8 text-center">
            <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              You're not a member of any organizations yet.
            </p>
            <Link
              href="/organizations"
              className="inline-block mt-3 text-xs font-bold uppercase tracking-wider text-primary hover:underline"
            >
              Discover organizations
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {orgs.map((org) => (
            <Link key={org.id} href={`/organizations/${org.id}`}>
              <Card
                className="rounded-xl border border-border shadow-sm hover:border-primary/50 transition-colors cursor-pointer group"
                data-testid={`card-my-org-${org.id}`}
              >
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <OrgLogoTile name={org.name} logoUrl={org.logoUrl ?? null} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-black text-base sm:text-lg leading-tight tracking-tight group-hover:text-primary transition-colors break-words min-w-0">
                          {org.name}
                        </h3>
                        <ChevronRight className="w-5 h-5 text-primary shrink-0" />
                      </div>
                      {org.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                          {org.description}
                        </p>
                      )}
                      {org.role && (
                        <div className="flex items-center gap-2 mt-3">
                          <Badge
                            variant="outline"
                            className="text-[10px] font-bold uppercase tracking-wider"
                          >
                            {org.role}
                          </Badge>
                        </div>
                      )}
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
