import { useEffect, useState } from "react";
import { Link } from "wouter";
import { formatOrgName } from "@/lib/format";
import {
  useGetLoggedInUser,
  useListUserOrganizations,
  queryOpts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, ChevronRight, Plus } from "lucide-react";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { CreateOrgDialog } from "@/components/CreateOrgDialog";

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

export default function MyOrgsPage() {
  const { data: me } = useGetLoggedInUser();
  const meId = me?.id;
  const { data, isLoading } = useListUserOrganizations(meId ?? "", undefined, {
    query: queryOpts({ enabled: !!meId }),
  });
  const orgs = data?.data ?? [];

  // Auto-open the Create Organization flow when we arrive with `?new=1`
  // (e.g. straight after an "Organization Admin" signup). Strip the param
  // afterward so a refresh doesn't re-trigger it.
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      setCreateOpen(true);
      params.delete("new");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : ""),
      );
    }
  }, []);

  return (
    <div className="space-y-6">
      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight">
            <span className="brand-gradient-text">My Organizations</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-medium">
            Organizations you belong to.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 mt-2">
          <Link
            href="/organizations"
            className="text-xs font-bold uppercase tracking-wider text-primary hover:underline"
            data-testid="link-discover-orgs"
          >
            Discover
          </Link>
          <Button
            size="sm"
            variant="brand"
            className="font-bold rounded-full"
            onClick={() => setCreateOpen(true)}
            data-testid="btn-new-org"
          >
            <Plus className="w-4 h-4 mr-1" /> New organization
          </Button>
        </div>
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
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                variant="brand"
                className="font-bold rounded-full"
                onClick={() => setCreateOpen(true)}
                data-testid="btn-empty-new-org"
              >
                <Plus className="w-4 h-4 mr-1" /> Create an organization
              </Button>
              <Link
                href="/organizations"
                className="text-xs font-bold uppercase tracking-wider text-primary hover:underline"
              >
                Discover organizations
              </Link>
            </div>
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
                          {formatOrgName(org.name)}
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
