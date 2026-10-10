import { createHash } from "node:crypto";
import { db, organizations, orgSubscriptions, promoCodes, type FreeAccessGrant, type PromoGrantSnapshot } from "@workspace/db";
import { eq } from "drizzle-orm";
import { PLAN_YEARLY_USD } from "./stripe-billing";
import { firstAnnualTerms, FREE2027_FIRST_CHARGE } from "./free-access-promo";

export function promoSnapshot(promo: typeof promoCodes.$inferSelect): PromoGrantSnapshot {
  return {
    code: promo.code, linkedOffer: promo.linkedOffer, discountType: promo.discountType,
    discountValue: promo.discountValue, freeUntil: promo.freeUntil?.toISOString() ?? null,
    firstAnnualDiscount: promo.firstAnnualDiscount,
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function codeFingerprint(promo: typeof promoCodes.$inferSelect): string {
  // Redemption totals can change without changing the reviewed offer.
  const { redemptionCount: _count, ...terms } = promo;
  return hash(terms);
}
export function recipientFingerprint(org: typeof organizations.$inferSelect, sub: typeof orgSubscriptions.$inferSelect | undefined, source: typeof promoCodes.$inferSelect): string {
  return hash({
    pendingPromoCodeId: org.pendingPromoCodeId,
    pendingPromoSnapshot: org.pendingPromoSnapshot ?? (org.pendingPromoCodeId === source.id ? promoSnapshot(source) : null),
    // Null -> equivalent original snapshot backfills are not billing changes.
    sub: sub ? { id: sub.id, plan: sub.plan, promoCodeId: sub.promoCodeId, status: sub.status,
      stripeCustomerId: sub.stripeCustomerId, stripeSubscriptionId: sub.stripeSubscriptionId,
      freeUntil: sub.freeUntil, freeAccessPromo: sub.freeAccessPromo,
      promoSnapshot: sub.promoSnapshot ?? sub.freeAccessPromo ?? (sub.promoCodeId === source.id ? promoSnapshot(source) : null),
      billingStartsAt: sub.billingStartsAt, updatedAt: sub.updatedAt } : null,
  });
}
export async function readRecipient(orgId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  const [sub] = await db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, orgId));
  return { org, sub };
}
export function grantMatches(org: typeof organizations.$inferSelect, sub: typeof orgSubscriptions.$inferSelect | undefined, grant: FreeAccessGrant): boolean {
  const actual = sub ? sub.freeAccessPromo : org.pendingPromoSnapshot;
  return Boolean(actual && actual.code === grant.code && actual.discountType === "free_until" &&
    actual.freeUntil === grant.freeUntil &&
    JSON.stringify(actual.firstAnnualDiscount ?? null) === JSON.stringify(grant.firstAnnualDiscount ?? null) &&
    (!sub || sub.freeUntil?.toISOString() === grant.freeUntil));
}
export function currentTerms(org: typeof organizations.$inferSelect, sub: typeof orgSubscriptions.$inferSelect | undefined, source: typeof promoCodes.$inferSelect): string {
  const snapshot = sub?.freeAccessPromo ?? sub?.promoSnapshot ?? org.pendingPromoSnapshot ?? promoSnapshot(source);
  const date = sub?.freeUntil ?? sub?.billingStartsAt;
  const offer = snapshot.discountType === "free_until"
    ? `Free until August 1, 2027; ${firstAnnualTerms(snapshot.firstAnnualDiscount)}`
    : `${snapshot.discountType === "percent" ? `${snapshot.discountValue}%` : `$${snapshot.discountValue}`} off first year`;
  return `${sub ? `${sub.plan}: ` : "No plan yet: "}${offer}${date && snapshot.discountType !== "free_until" ? `; billing ${date.toISOString().slice(0, 10)}` : ""}`;
}
export function proposedTerms(grant: FreeAccessGrant, plan?: "starter" | "pro" | "elite"): string {
  const price = plan ? PLAN_YEARLY_USD[plan] : null;
  const d = grant.firstAnnualDiscount;
  const first = price == null ? null : !d ? price : d.discountType === "percent"
    ? Math.round(price * (1 - d.discountValue / 100)) : Math.max(0, price - d.discountValue);
  return `Free through July 31, 2027; ${firstAnnualTerms(d)}${first == null ? "; owner chooses a plan later" : ` ($${first.toLocaleString("en-US")} first annual invoice; $${price!.toLocaleString("en-US")} annual renewals)`}.`;
}
export function conversionGrant(source: typeof promoCodes.$inferSelect, pricing: "full_price" | "keep_discount"): FreeAccessGrant {
  const discount = source.firstAnnualDiscount ?? (source.discountType !== "free_until"
    ? { discountType: source.discountType, discountValue: source.discountValue } : null);
  if (pricing === "keep_discount" && !discount) throw new Error("This code has no existing discount to keep.");
  return {
    code: source.code, linkedOffer: "free2027", discountType: "free_until", discountValue: 0,
    freeUntil: FREE2027_FIRST_CHARGE, firstAnnualDiscount: pricing === "keep_discount" ? discount : null,
  };
}
