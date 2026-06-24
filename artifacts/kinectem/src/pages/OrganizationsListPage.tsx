import { Link } from "wouter";
import { formatOrgName } from "@/lib/format";
import { useListOrganizations } from "@workspace/api-client-react";
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

export default function OrganizationsListPage() {
  const { data, isLoading } = useListOrganizations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-4xl font-black tracking-tight">
          <span className="brand-gradient-text">Organizations</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1 font-medium">
          Discover clubs, schools, and academies on Kinectem.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : !data || data.data.length === 0 ? (
        <Card className="rounded-xl border border-border">
          <CardContent className="p-8 text-center">
            <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No organizations yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.data.map((org) => (
            <Link key={org.id} href={`/organizations/${org.id}`}>
              <Card className="rounded-xl border border-border shadow-sm hover:border-primary/50 transition-colors cursor-pointer group">
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
