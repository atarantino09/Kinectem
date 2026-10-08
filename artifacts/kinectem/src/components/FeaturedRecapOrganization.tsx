import { FitText } from "@/components/FitText";

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
      className="flex min-w-0 items-center gap-2.5 px-3 py-1.5"
      data-testid="featured-recap-organization"
      style={{
        borderBottom: `3px solid ${primary}`,
        background: `linear-gradient(120deg, color-mix(in srgb, ${primary} 32%, transparent), color-mix(in srgb, ${secondary} 24%, transparent))`,
      }}
    >
      {org?.logoUrl ? (
        <img
          src={org.logoUrl}
          alt={`${org.name || "Organization"} logo`}
          className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain p-1 shadow-sm"
          loading="lazy"
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-base font-black text-slate-800 shadow-sm" aria-hidden="true">
          {(org?.name || teamName).trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        {org?.name ? (
          <FitText as="p" max={12} min={11} lineHeight={1.2} className="font-semibold text-black dark:text-white" data-testid="featured-recap-organization-name">
            {org.name}
          </FitText>
        ) : null}
        <FitText as="p" max={14} min={12} lineHeight={1.2} className="font-black text-black dark:text-white" data-testid="featured-recap-team-name">
          {teamName}
        </FitText>
      </div>
    </div>
  );
}
