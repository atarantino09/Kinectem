-- Legacy organizations that existed before the billing-floor rollout cannot
-- receive their first annual charge before November 1, 2026.
--
-- Idempotent: only trialing subscription rows below the floor are changed.
-- Post-cutoff organizations and active/canceled subscriptions are untouched.
UPDATE org_subscriptions s
SET billing_starts_at = '2026-11-01 00:00:00'::timestamp,
    updated_at = NOW()
FROM organizations o
WHERE o.id = s.organization_id
  AND o.created_at < '2026-08-20 00:00:00'::timestamp
  AND s.status = 'trialing'
  AND (
    s.billing_starts_at IS NULL
    OR s.billing_starts_at < '2026-11-01 00:00:00'::timestamp
  );