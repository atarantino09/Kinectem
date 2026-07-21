---
name: Stripe org billing (card-on-file, deferred charge)
description: How Kinectem org subscriptions wire to Stripe — card-on-file now, first charge Nov 1; connector has no webhook secret so reconcile-on-return is the source of truth.
---

# Stripe org billing

Kinectem orgs choose a plan **card-free** at signup. Putting a card on file is a
separate, opt-in step that does NOT charge anything today — the first yearly
charge runs automatically on **Nov 1 2026** (set via Stripe Checkout
`trial_end`). This is a product decision, not a temporary state.

## Key constraints / non-obvious decisions

- **The Replit `stripe` connector exposes only `settings.secret` + `settings.publishable` — NO `webhook_secret`.**
  - **Why:** an earlier attempt used `stripe-replit-sync` for managed webhooks; the managed-webhook-secret story was too awkward, so it was removed.
  - **How to apply:** treat the Checkout **return URL → `POST .../billing/reconcile`** flow as the source of truth for persisting `stripeCustomerId`/`stripeSubscriptionId`. The `stripe-webhook.ts` route is belt-and-suspenders only and stays gated behind a `STRIPE_WEBHOOK_SECRET` **env var** (not the connector). Don't assume a webhook secret exists.

- **`stripe` is a dependency of `artifacts/api-server`, not root.** pnpm workspace packages don't inherit root deps; a runtime import must be declared in that package. Don't `pnpm add -w stripe`.

- **Plan prices & promo coupons are auto-provisioned in Stripe at runtime** by stable lookup keys (`kinectem_<plan>_yearly`; percent coupon id `kinectem_promo_<code>_y1`, amount coupon id `kinectem_promo_<code>`) — no manual dashboard setup. Retrieving a coupon returns `Stripe.Coupon` without a typed `deleted` field; cast to `Stripe.Coupon & { deleted?: boolean }` (NOT `Stripe.DeletedCoupon`, which TS rejects as a non-overlapping cast).

- **`hasCardOnFile` = `org_subscriptions.stripe_subscription_id != null`.** Same predicate drives the Oct-15 reminder query (reminder targets orgs where it IS null).

- **Promo discounts are first-year only.** Plans bill yearly, so a `duration:"once"` subscription coupon discounts exactly the first invoice (year 1) even with the Nov-1 `trial_end`; renewals bill at list price.
  - **Why:** product decision — the referral discount shouldn't compound forever; early builds used `duration:"forever"`, so percent coupon ids were versioned to `_y1` to guarantee legacy forever coupons never get reattached.
  - **How to apply:** never change percent coupons back to forever/repeating; `scripts/src/fix-promo-coupon-durations.ts` (idempotent, `--dry-run`) swaps forever coupons on live subs — run before the first invoice so year-1 pricing is preserved; it refuses to remove a discount it can't replace. Stripe SDK v22 moved the coupon to `discount.source.coupon` (expand `discounts.source.coupon`) — `discount.coupon` no longer typechecks.

- **Oct-15 reminder is a self-contained script** (`scripts/src/send-billing-reminders.ts`), NOT in the app. Leaf workspace scripts can't import api-server's `email.ts`, so the SendGrid send + the approved campaign copy are duplicated there. It is **not idempotent** (re-runs re-send) — always `--dry-run` first. Schedule once for 2026-10-15.
