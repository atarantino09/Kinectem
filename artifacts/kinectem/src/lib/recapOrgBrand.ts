import { readOrgBrandColors, orgInviteHeaderStyle, type OrgBrandColors } from "@/lib/orgBrand";

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Keep the stronger treatment exclusive to regular and combined game recaps. */
export function isGameRecapForOrgBranding(post: unknown): boolean {
  const p = post as {
    id?: string;
    postType?: string;
    gameDate?: string | null;
    recapKind?: string | null;
    articleKind?: string | null;
  } | null;
  return Boolean(
    p?.id?.startsWith("article-") &&
    p.postType === "long" &&
    p.articleKind !== "practice_plan" &&
    (p.gameDate || p.recapKind === "combined"),
  );
}

export function validHex(value: unknown): string | null {
  return typeof value === "string" && HEX.test(value.trim()) ? value.trim() : null;
}

export type RecapOrgIdentity = {
  orgId: string;
  orgName: string;
  logoUrl: string | null;
  brand: OrgBrandColors | null;
  style: { background: string; color: string };
  accent: string;
};

/** Reads org identity off a post context. Returns null for org-less posts. */
export function readRecapOrgIdentity(context: unknown): RecapOrgIdentity | null {
  const c = context as {
    type?: string;
    orgId?: string | null;
    orgName?: string | null;
    orgAvatarUrl?: string | null;
    orgBrandPrimaryColor?: string | null;
    orgBrandSecondaryColor?: string | null;
    id?: string;
    name?: string | null;
    avatarUrl?: string | null;
  } | null;
  if (!c) return null;
  let orgId: string | null | undefined;
  let orgName: string | null | undefined;
  let logoUrl: string | null | undefined;
  if (c.type === "team") {
    orgId = c.orgId; orgName = c.orgName; logoUrl = c.orgAvatarUrl;
  } else if (c.type === "organization") {
    orgId = c.id; orgName = c.name; logoUrl = c.orgAvatarUrl ?? c.avatarUrl;
  }
  if (!orgId || !orgName) return null;
  const brand = readOrgBrandColors({
    brandPrimaryColor: validHex(c.orgBrandPrimaryColor),
    brandSecondaryColor: validHex(c.orgBrandSecondaryColor),
  });
  const style = brand
    ? orgInviteHeaderStyle(brand)
    : { background: "linear-gradient(135deg, #334155, #1e293b)", color: "#ffffff" };
  return {
    orgId, orgName, logoUrl: logoUrl || null, brand, style,
    accent: brand?.primary ?? "#64748b",
  };
}

export function orgInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "?";
}
