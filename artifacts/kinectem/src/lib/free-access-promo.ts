export const FREE2027_FIRST_CHARGE = "2027-08-01T04:00:00.000Z";
export type PromoDiscountType = "percent" | "amount" | "free_until";
export type FirstAnnualDiscount = { discountType: "percent" | "amount"; discountValue: number };
export function firstAnnualChargeLabel(promo?: { firstAnnualDiscount?: FirstAnnualDiscount | null } | null): string {
  const d = promo?.firstAnnualDiscount;
  return d ? `${d.discountType === "percent" ? `${d.discountValue}%` : `$${d.discountValue}`} off the first annual invoice${d.discountType === "percent" && d.discountValue === 100 ? " ($0)" : ""}; later renewals at full price`
    : "full annual price";
}
export function isFree2027Offer(promo?: { code: string; linkedOffer?: string | null } | null): boolean {
  return Boolean(promo && (promo.code.toLowerCase() === "free2027" || promo.linkedOffer === "free2027"));
}
export function freeAccessDate(value?: string | null): string {
  return new Date(value ?? FREE2027_FIRST_CHARGE).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York",
  });
}
export function promoOfferLabel(promo: { discountType: string; discountValue: number; freeUntil?: string | null; firstAnnualDiscount?: FirstAnnualDiscount | null }): string {
  if (promo.discountType === "free_until") return `Free until ${freeAccessDate(promo.freeUntil)}; then ${firstAnnualChargeLabel(promo)}`;
  return promo.discountType === "percent" ? `${promo.discountValue}% off` : `$${promo.discountValue} off`;
}
