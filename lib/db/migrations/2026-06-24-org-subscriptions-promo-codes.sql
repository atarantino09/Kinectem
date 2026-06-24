-- Org subscriptions + promo codes
--
-- Multi-tier annual plans (mirrors the marketing pricing page). Stripe is not
-- wired up yet; these tables capture the org's plan selection and any applied
-- promo code so checkout runs end-to-end now and connects to Stripe later
-- (the nullable stripe_* columns are the future hook). Applied via
-- `pnpm --filter @workspace/db run push`; this file is the audit record.

DO $$ BEGIN
  CREATE TYPE plan_tier AS ENUM ('starter', 'pro', 'elite');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE promo_discount_type AS ENUM ('percent', 'amount');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text,
  discount_type promo_discount_type NOT NULL,
  discount_value integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  max_redemptions integer,
  redemption_count integer NOT NULL DEFAULT 0,
  expires_at timestamp,
  created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  plan plan_tier NOT NULL,
  status subscription_status NOT NULL DEFAULT 'trialing',
  promo_code_id uuid REFERENCES promo_codes(id) ON DELETE SET NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  billing_starts_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
