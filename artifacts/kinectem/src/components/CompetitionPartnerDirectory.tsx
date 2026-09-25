import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueries } from "@tanstack/react-query";
import { ArrowRight, Building2, ChevronDown, MapPin, Search, Users } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatOrgName } from "@/lib/format";

export type CompetitionPartnerPage = {
  slug: string;
  officialName: string;
  associationLabel: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
};

type PartnerOrganization = {
  id: string;
  name: string;
  location: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  canRequestClaim: boolean;
  owner: { displayName: string; userId: string | null } | null;
  teams: Array<{ id: string; name: string }>;
};

type PartnerDirectoryResponse = {
  data: {
    organizations: PartnerOrganization[];
  };
};

function locationOf(org: PartnerOrganization) {
  return (
    [org.city, org.state].filter(Boolean).join(", ") ||
    org.location ||
    "Location coming soon"
  );
}

export function readablePartnerText(background: string): "#111827" | "#ffffff" {
  const match = /^#?([0-9a-f]{6})$/i.exec(background.trim());
  if (!match) return "#ffffff";
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  const contrastWithDark = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  return contrastWithDark >= contrastWithWhite ? "#111827" : "#ffffff";
}

export function CompetitionPartnerDirectory({
  partners,
  signedIn,
}: {
  partners: CompetitionPartnerPage[];
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const directoryQueries = useQueries({
    queries: partners.map((partner) => ({
      queryKey: ["partner-page", partner.slug],
      queryFn: () =>
        customFetch<PartnerDirectoryResponse>(
          `/api/v1/partner-pages/${encodeURIComponent(partner.slug)}`,
          { method: "GET" },
        ),
      staleTime: 60_000,
      retry: 1,
      enabled: open,
    })),
  });

  const organizations = useMemo(() => {
    const byId = new Map<
      string,
      PartnerOrganization & { partner: CompetitionPartnerPage }
    >();
    directoryQueries.forEach((result, index) => {
      const partner = partners[index];
      if (!partner) return;
      for (const organization of result.data?.data.organizations ?? []) {
        if (!byId.has(organization.id)) {
          byId.set(organization.id, { ...organization, partner });
        }
      }
    });
    return [...byId.values()];
  }, [directoryQueries, partners]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return organizations.filter(
      (organization) =>
        !needle ||
        `${organization.name} ${locationOf(organization)}`
          .toLowerCase()
          .includes(needle),
    );
  }, [organizations, query]);

  const lead = partners[0];
  if (!lead) return null;
  const loading = directoryQueries.some((result) => result.isLoading);
  const failedCount = directoryQueries.filter((result) => result.isError).length;
  const allFailed = failedCount === directoryQueries.length;
  const createPath = "/organizations/mine?new=1";
  const createHref = signedIn
    ? createPath
    : `/login?signup=1&returnTo=${encodeURIComponent(createPath)}`;

  return (
    <section
      className="overflow-hidden rounded-[2rem] border bg-white shadow-sm"
      data-testid="competition-partner-directory"
    >
      <div
        className="relative overflow-hidden px-5 py-7 text-white sm:px-8"
        style={{
          background: `linear-gradient(120deg, rgba(15,23,42,.68), rgba(15,23,42,.58)), linear-gradient(120deg, ${lead.primaryColor}, ${lead.secondaryColor})`,
        }}
      >
        <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full border-[28px] border-white/10" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white p-2 shadow-lg">
              {lead.logoUrl ? (
                <img
                  src={lead.logoUrl}
                  alt={`${lead.officialName} logo`}
                  className="h-full w-full object-contain"
                />
              ) : (
                <Building2 className="h-8 w-8 text-slate-500" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-white">
                Connected partnership
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-tight">
                Find your club
              </h2>
              <p className="mt-1 text-sm font-semibold text-white">
                Explore clubs from{" "}
                {partners.map((partner) => partner.officialName).join(" and ")}.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {partners.map((partner) => (
              <Link key={partner.slug} href={`/partners/${partner.slug}`}>
                <Button
                  className="rounded-full bg-white font-black text-slate-900 hover:bg-white/90"
                  data-testid={`link-competition-partner-${partner.slug}`}
                >
                  View {partner.officialName}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            ))}
            <Button
              type="button"
              variant="outline"
              className="rounded-full border-white/50 bg-white/10 font-bold text-white hover:bg-white/20 hover:text-white"
              aria-expanded={open}
              aria-controls="competition-partner-clubs"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "Hide clubs" : "Show clubs"}
              <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </Button>
          </div>
        </div>
      </div>

      {open && <CardContent id="competition-partner-clubs" className="space-y-5 p-5 sm:p-8">
        <div className="relative max-w-xl">
          <Search className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-12 rounded-xl bg-slate-50 pl-12"
            placeholder="Search club name or location"
            aria-label="Search partnership clubs"
          />
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((item) => (
              <div key={item} className="h-44 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : allFailed ? (
          <div
            className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-950"
            role="alert"
          >
            We couldn&apos;t load the club directory. Please try again shortly or
            open the partnership page above.
          </div>
        ) : filtered.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {filtered.map((org) => {
              const partnerHref = `/partners/${org.partner.slug}`;
              const accessHref = org.canRequestClaim
                ? `${partnerHref}?view=clubs&claimOrg=${encodeURIComponent(org.id)}`
                : `${partnerHref}?accessRequestOrg=${encodeURIComponent(org.id)}`;
              return (
                <Card
                  key={org.id}
                  className="rounded-2xl border-slate-200 shadow-none transition hover:-translate-y-0.5 hover:shadow-md"
                  data-testid={`competition-partner-club-${org.id}`}
                >
                  <CardContent className="flex h-full flex-col p-5">
                    <div className="flex items-start gap-3">
                      <OrgLogo
                        name={org.name}
                        logoUrl={org.logoUrl}
                        className="h-14 w-14 rounded-xl"
                      />
                      <div className="min-w-0">
                        <h3 className="font-black text-slate-900">
                          {formatOrgName(org.name)}
                        </h3>
                        <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          {locationOf(org)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-4 text-sm text-slate-500">
                      {org.teams.slice(0, 3).map((team) => team.name).join(" · ") ||
                        "Team pages are ready to explore"}
                      {org.teams.length > 3 ? ` +${org.teams.length - 3} more` : ""}
                    </p>
                    <div className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-500">
                      <Users className="h-3.5 w-3.5" />
                      {org.owner
                        ? `Managed by ${org.owner.displayName}`
                        : "Ownership access available"}
                    </div>
                    <div className="mt-auto flex flex-wrap gap-2 pt-5">
                      <Link href={`/organizations/${org.id}?showAround=1`}>
                        <Button variant="outline" size="sm" className="font-bold">
                          View club page
                        </Button>
                      </Link>
                      <Link href={accessHref}>
                        <Button
                          size="sm"
                          className="font-bold"
                          style={{
                            background: lead.primaryColor,
                            color: readablePartnerText(lead.primaryColor),
                          }}
                          data-testid={`competition-partner-access-${org.id}`}
                        >
                          {org.canRequestClaim
                            ? "Request ownership access"
                            : "Request admin access"}
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed bg-slate-50 p-10 text-center text-slate-500">
            No clubs match that search.
          </div>
        )}

        {failedCount > 0 && !allFailed ? (
          <p className="text-sm font-semibold text-amber-700" role="status">
            Some partnership clubs could not be loaded. The available clubs are
            still shown.
          </p>
        ) : null}

        <div className="flex flex-col gap-4 rounded-2xl bg-slate-950 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-black">Don&apos;t see your club?</p>
            <p className="mt-1 text-sm text-white/70">
              Create its Kinectem page or ask us for help at competitions@kinectem.com.
            </p>
          </div>
          <Link href={createHref}>
            <Button className="w-full rounded-xl bg-white font-black text-slate-900 hover:bg-white/90 sm:w-auto">
              Create your club <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardContent>}
    </section>
  );
}