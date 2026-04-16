import { Link } from "wouter";
import { useListOrganizations } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Users } from "lucide-react";
import { getInitials } from "@/lib/format";

export default function OrganizationsListPage() {
  const { data, isLoading } = useListOrganizations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Organizations</h1>
        <p className="text-muted-foreground mt-1">Browse youth athletic programs and teams.</p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && data && data.length === 0 && (
        <Card className="rounded-xl border border-border">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No organizations yet.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.map((org) => (
          <Link key={org.id} href={`/organizations/${org.id}`}>
            <Card className="rounded-xl border border-border shadow-sm hover:border-primary/50 transition-colors cursor-pointer group h-full">
              <CardContent className="p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 rounded-lg bg-slate-900 flex items-center justify-center shrink-0 text-primary font-black text-sm tracking-tighter">
                    {org.logoUrl ? (
                      <img src={org.logoUrl} alt={org.name} className="w-full h-full object-cover rounded-lg" />
                    ) : (
                      getInitials(org.name)
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-base group-hover:text-primary transition-colors truncate">
                      {org.name}
                    </h3>
                    {org.location && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5 font-medium">
                        <MapPin className="w-3 h-3" /> {org.location}
                      </div>
                    )}
                  </div>
                </div>
                {org.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{org.description}</p>
                )}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {org.sport && (
                    <Badge variant="secondary" className="font-semibold text-xs">{org.sport}</Badge>
                  )}
                  {org.followerCount !== undefined && (
                    <span className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                      <Users className="w-3 h-3" /> {org.followerCount.toLocaleString()}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
