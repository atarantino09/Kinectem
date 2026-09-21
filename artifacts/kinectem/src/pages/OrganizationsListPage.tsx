import { Link } from "wouter";
import { formatOrgName } from "@/lib/format";
import { useListOrganizations } from "@workspace/api-client-react";
import type { OrganizationResponse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2, ChevronRight, Compass, Star } from "lucide-react";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { BrandPageHeader } from "@/components/BrandPageHeader";
import { EmptyState } from "@/components/EmptyState";

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
      imgClassName="w-14 h-14 rounded-xl object-contain bg-muted shrink-0"
    />
  );
}

type OrgListItem = OrganizationResponse;

function OrgCard({ org }: { org: OrgListItem }) {
  return (
    <Link href={`/organizations/${org.id}`}>
      <Card className="app-surface app-surface-interactive cursor-pointer group">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3 sm:gap-4">
            <OrgLogoTile name={org.name} logoUrl={org.logoUrl ?? null} />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-black text-base sm:text-lg leading-tight tracking-tight group-hover:text-primary transition-colors break-words min-w-0">
                  {formatOrgName(org.name)}
                </h3>
                <ChevronRight className="w-5 h-5 text-primary shrink-0" />
              </div>
              {org.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                  {org.description}
                </p>
              )}
              <div className="flex items-center gap-2 mt-3">
                {org.isMember && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-bold uppercase tracking-wider"
                  >
                    Member
                  </Badge>
                )}
                {org.role && (
                  <Badge
                    variant="outline"
                    className="text-[10px] font-bold uppercase tracking-wider"
                  >
                    {org.role}
                  </Badge>
                )}
                {!org.isMember && org.isFollowing && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-bold uppercase tracking-wider"
                  >
                    Following
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function OrganizationsListPage() {
  const { data, isLoading } = useListOrganizations();

  const orgs = data?.data ?? [];
  // "Yours" = member of the org or following it; everything else is discover.
  const yourOrgs = orgs.filter((o) => o.isMember || o.isFollowing);
  const discoverOrgs = orgs.filter((o) => !o.isMember && !o.isFollowing);

  return (
    <div className="space-y-6 sm:space-y-8">
      <BrandPageHeader
        eyebrow="Find your community"
        title={<span className="brand-gradient-text">Organizations</span>}
        description="Discover clubs, schools, and academies on Kinectem."
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <Card className="app-surface">
          <CardContent className="p-0">
            <EmptyState
              icon={<Building2 className="h-5 w-5" />}
              title="No organizations yet"
              description="Clubs, schools, and academies will appear here as they join Kinectem."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {yourOrgs.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-muted-foreground">
                <Star className="w-4 h-4" /> Your organizations
              </h2>
              <div
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
                data-testid="section-your-orgs"
              >
                {yourOrgs.map((org) => (
                  <OrgCard key={org.id} org={org} />
                ))}
              </div>
            </section>
          )}

          {discoverOrgs.length > 0 && (
            <section className="space-y-3">
              {yourOrgs.length > 0 && (
                <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-muted-foreground">
                  <Compass className="w-4 h-4" /> Discover
                </h2>
              )}
              <div
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
                data-testid="section-discover-orgs"
              >
                {discoverOrgs.map((org) => (
                  <OrgCard key={org.id} org={org} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
