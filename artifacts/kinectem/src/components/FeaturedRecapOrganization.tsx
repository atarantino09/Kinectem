export type FeaturedRecapOrg = {
  id: string;
  name: string | null;
  logoUrl: string | null;
  brandPrimaryColor: string | null;
  brandSecondaryColor: string | null;
};

export function featuredOrgPalette(org?: FeaturedRecapOrg | null) {
  const primary = org?.brandPrimaryColor || org?.brandSecondaryColor || "#64748b";
  return { primary, secondary: org?.brandSecondaryColor || primary };
}

// The tournament strip identifies the event; this larger identity identifies
// the organization whose team wrote the recap. Do not substitute event logos.
export function FeaturedRecapOrganization({ org, teamName }: { org?: FeaturedRecapOrg | null; teamName: string }) {
  const { primary, secondary } = featuredOrgPalette(org);
  return (
    <div
      className="flex min-w-0 items-center gap-3 px-4 py-2.5"
      data-testid="featured-recap-organization"
      style={{
        borderBottom: `2px solid ${primary}`,
        background: `linear-gradient(120deg, color-mix(in srgb, ${primary} 14%, transparent), color-mix(in srgb, ${secondary} 10%, transparent))`,
      }}
    >
      {org?.logoUrl ? (
        <img
          src={org.logoUrl}
          alt={`${org.name || "Organization"} logo`}
          className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain p-1 shadow-sm"
          loading="lazy"
        />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white text-lg font-black text-slate-800 shadow-sm" aria-hidden="true">
          {(org?.name || teamName).trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase()}
        </span>
      )}
      <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
        {org?.name ? <p className="text-[11px] font-semibold leading-snug text-muted-foreground">{org.name}</p> : null}
        <p className="text-sm font-black leading-snug text-foreground" data-testid="featured-recap-team-name">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Team:</span>{" "}
          {teamName}
        </p>
      </div>
    </div>
  );
}
