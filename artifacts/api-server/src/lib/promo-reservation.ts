import { db, organizations, promoCodes } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { availableFreeUntil } from "./free-access-promo";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Hold the code lock until the organization insert commits. Reservations
// and owner redemptions must measure the same committed + staged capacity.
export async function canReservePromo(tx: Tx, promoId: string): Promise<boolean> {
  const [promo] = await tx.select().from(promoCodes).where(eq(promoCodes.id, promoId)).for("update");
  if (!promo?.active || (promo.expiresAt && promo.expiresAt.getTime() <= Date.now())) return false;
  try { availableFreeUntil(promo); } catch { return false; }
  if (promo.maxRedemptions == null) return true;
  const [pending] = await tx.select({ count: sql<number>`count(*)::int` }).from(organizations)
    .where(eq(organizations.pendingPromoCodeId, promo.id));
  return promo.redemptionCount + Number(pending.count) < promo.maxRedemptions;
}
