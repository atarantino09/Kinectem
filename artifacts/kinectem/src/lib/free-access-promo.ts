export const FREE2027_FIRST_CHARGE = "2027-08-01T04:00:00.000Z";
export type PromoDiscountType = "percent" | "amount" | "free_until";
export function freeAccessDate(value?: string | null): string {
  return new Date(value ?? FREE2027_FIRST_CHARGE).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York",
  });
}
export function promoOfferLabel(promo: { discountType: string; discountValue: number; freeUntil?: string | null }): string {
  if (promo.discountType === "free_until") return `Free until ${freeAccessDate(promo.freeUntil)}; then full annual price`;
  return promo.discountType === "percent" ? `${promo.discountValue}% off` : `$${promo.discountValue} off`;
}
