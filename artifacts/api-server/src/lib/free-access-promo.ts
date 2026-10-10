export const FREE2027_CODE = "free2027";
export const FREE2027_FIRST_CHARGE = "2027-08-01T04:00:00.000Z";
export const MIN_CHECKOUT_LEAD_MS = 49 * 60 * 60 * 1000;
export type FirstAnnualDiscount = { discountType: "percent" | "amount"; discountValue: number };
export function firstAnnualTerms(discount?: FirstAnnualDiscount | null): string {
  return discount
    ? `${discount.discountType === "percent" ? `${discount.discountValue}%` : `$${discount.discountValue}`} off the first annual invoice August 1, 2027; later annual renewals at full price${discount.discountType === "percent" && discount.discountValue === 100 ? " (first annual invoice $0)" : ""}`
    : "Full-price annual billing August 1, 2027; annual renewals at full price";
}

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
  { name: "2026-10-10-reviewed-promo-conversion", sql: `
    ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS first_annual_discount jsonb;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pending_promo_snapshot jsonb;
    ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS promo_snapshot jsonb;
    ALTER TABLE promo_usage ADD COLUMN IF NOT EXISTS first_annual_discount jsonb;
    CREATE TABLE IF NOT EXISTS promo_code_conversions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      promo_code_id uuid REFERENCES promo_codes(id) ON DELETE SET NULL,
      actor_user_id uuid NOT NULL, code text NOT NULL, code_fingerprint text NOT NULL,
      "grant" jsonb NOT NULL, settings jsonb NOT NULL, recipients jsonb NOT NULL,
      saved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
    UPDATE org_subscriptions s SET promo_snapshot = jsonb_build_object(
      'code', p.code, 'discountType', p.discount_type, 'discountValue', p.discount_value,
      'linkedOffer', p.linked_offer, 'freeUntil', p.free_until, 'firstAnnualDiscount', p.first_annual_discount
    ) FROM promo_codes p WHERE s.promo_code_id = p.id AND s.promo_snapshot IS NULL AND s.free_access_promo IS NULL;
    UPDATE organizations o SET pending_promo_snapshot = jsonb_build_object(
      'code', p.code, 'discountType', p.discount_type, 'discountValue', p.discount_value,
      'linkedOffer', p.linked_offer, 'freeUntil', p.free_until, 'firstAnnualDiscount', p.first_annual_discount
    ) FROM promo_codes p WHERE o.pending_promo_code_id = p.id AND o.pending_promo_snapshot IS NULL;
    CREATE OR REPLACE FUNCTION snapshot_staged_promo_terms() RETURNS trigger AS $$
    DECLARE p promo_codes%ROWTYPE;
    BEGIN
      IF NEW.pending_promo_code_id IS NULL THEN
        -- FK deletion removes a mutable source, not the granted terms.
        -- Explicit removal paths clear the snapshot themselves.
        RETURN NEW;
      ELSIF NEW.pending_promo_snapshot IS NULL OR
        (TG_OP = 'UPDATE' AND NEW.pending_promo_code_id IS DISTINCT FROM OLD.pending_promo_code_id) THEN
        SELECT * INTO p FROM promo_codes WHERE id = NEW.pending_promo_code_id;
        IF FOUND THEN NEW.pending_promo_snapshot := jsonb_build_object(
          'code', p.code, 'discountType', p.discount_type, 'discountValue', p.discount_value,
          'linkedOffer', p.linked_offer, 'freeUntil', p.free_until, 'firstAnnualDiscount', p.first_annual_discount
        ); END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS organizations_promo_snapshot ON organizations;
    CREATE TRIGGER organizations_promo_snapshot BEFORE INSERT OR UPDATE OF pending_promo_code_id, pending_promo_snapshot
      ON organizations FOR EACH ROW EXECUTE FUNCTION snapshot_staged_promo_terms();
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
