// Task #733 — Org brand colors. Owners/admins can pick two hex colors that
// gradient into each other; the org page hero renders a soft gradient of the
// pair and each of the org's team pages shows a thin full-strength brand
// strip. The fields ride BEYOND the locked OpenAPI spec (recapKind
// precedent), so they're read off responses via the narrow cast below.

export type OrgBrandColors = {
  primary: string;
  secondary: string;
};

// Read the extra brand-color fields off an org (or org-embed) payload.
// Returns null when no branding is set — callers fall back to the default
// generic gradient / no strip. If only one color is set, both stops use it
// (solid color), so a half-configured org still renders sensibly.
export function readOrgBrandColors(
  org: unknown,
): OrgBrandColors | null {
  const o = org as {
    brandPrimaryColor?: string | null;
    brandSecondaryColor?: string | null;
  } | null;
  const primary = o?.brandPrimaryColor ?? null;
  const secondary = o?.brandSecondaryColor ?? null;
  if (!primary && !secondary) return null;
  return {
    primary: primary ?? secondary!,
    secondary: secondary ?? primary!,
  };
}

// Expand #abc to #aabbcc so an alpha suffix can be appended.
function expandHex(hex: string): string {
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

function withAlpha(hex: string, alphaHex: string): string {
  return `${expandHex(hex)}${alphaHex}`;
}

// Hero gradient for the org page header. Full-strength brand colors (same
// visual language as the team-page strip); the org page layers a
// bottom-fade-to-card overlay on top so overlapping name text stays
// readable on any color pair.
export function orgHeroGradient(colors: OrgBrandColors): string {
  return `linear-gradient(135deg, ${expandHex(colors.primary)} 0%, ${withAlpha(colors.primary, "d9")} 45%, ${expandHex(colors.secondary)} 100%)`;
}

// Full-strength thin strip gradient (team pages + Edit-dialog preview).
// Same visual language as the competition brand strip.
export function orgStripGradient(colors: OrgBrandColors): string {
  return `linear-gradient(135deg, ${expandHex(colors.primary)} 0%, ${expandHex(colors.primary)} 40%, ${expandHex(colors.secondary)} 100%)`;
}
