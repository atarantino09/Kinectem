export const FREE2027_CODE = "free2027";
export const FREE2027_FIRST_CHARGE = "2027-08-01T04:00:00.000Z";
export const MIN_CHECKOUT_LEAD_MS = 49 * 60 * 60 * 1000;

export function isFree2027Offer(promo?: { code: string; linkedOffer?: string | null } | null): boolean {
  return Boolean(promo && (promo.code.toLowerCase() === FREE2027_CODE || promo.linkedOffer === FREE2027_CODE));
}

export function validateLinkedTerms(input: {
  linkedOffer?: string | null; discountType?: string; discountValue?: number; freeUntil?: string | null;
}): boolean {
  return input.linkedOffer !== FREE2027_CODE ||
    ((input.discountType === undefined || input.discountType === "free_until") &&
     (input.discountValue === undefined || input.discountValue === 0) &&
     (input.freeUntil === undefined || input.freeUntil === FREE2027_FIRST_CHARGE));
}

export function availableFreeUntil(
  promo: { discountType: string; freeUntil?: Date | null },
  now = new Date(),
): Date | null {
  if (promo.discountType !== "free_until") return null;
  if (!promo.freeUntil || !Number.isFinite(promo.freeUntil.getTime()) ||
    promo.freeUntil.getTime() <= now.getTime() + MIN_CHECKOUT_LEAD_MS) {
    throw new Error("This free-access offer is too close to its billing date or has expired.");
  }
  return promo.freeUntil;
}

export const FREE_ACCESS_SCHEMA_MIGRATIONS = [
  { name: "2026-10-10-linked-free2027-offers", sql: `
    ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS linked_offer text;
    ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS free_access_promo jsonb;
  ` },
  { name: "2026-10-10-free-access-promo-enum",
    sql: "ALTER TYPE promo_discount_type ADD VALUE IF NOT EXISTS 'free_until';" },
  { name: "2026-10-10-free-access-promo-dates", sql: `
    ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS free_until timestamptz;
    ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS free_until timestamptz;
    ALTER TABLE promo_usage ADD COLUMN IF NOT EXISTS free_until timestamptz;
  ` },
  { name: "2026-10-10-create-free2027-once", sql: `
    CREATE TABLE IF NOT EXISTS one_time_migration_markers (
      name text PRIMARY KEY, applied_at timestamp NOT NULL DEFAULT now()
    );
    DO $migration$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM one_time_migration_markers WHERE name = 'create-free2027') THEN
        INSERT INTO promo_codes (code, description, discount_type, discount_value, free_until)
        VALUES ('free2027', 'Free through July 31, 2027; full-price annual billing August 1, 2027.',
          'free_until', 0, '2027-08-01T04:00:00Z')
        ON CONFLICT (code) DO NOTHING;
        INSERT INTO one_time_migration_markers (name) VALUES ('create-free2027');
      END IF;
    END$migration$;
  ` },
];
