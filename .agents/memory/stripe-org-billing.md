---
name: Stripe org billing (card-on-file, deferred charge)
description: Organization billing product rules, first-year discounts, and the FREE2027 fixed-date offer.
---

# Stripe org billing

Kinectem orgs choose a plan **card-free** at signup. Putting a card on file is a
separate, opt-in step that does NOT charge anything immediately. Ordinary
organizations receive a rolling 90-day free period; legacy organizations retain
their applicable first-charge floor. Do not treat November 1, 2026 as a universal
first-charge date.

## FREE2027 offer
The user specified the public promo code **FREE2027**: an organization redeeming
it gets free access until **August 1, 2027**, when its first annual payment must
be the selected plan's **full price, with no discount**.

The user also approved applying FREE2027 to existing organizations, individually,
in selected batches, or through saved lists. Eligibility includes every org that
has not paid, whether or not it has a card on file; already-paid orgs are excluded.
The fixed charge instant is midnight America/New_York on August 1, 2027.

**Why:** This is a fixed-date offer, not another rolling 90-day trial. The user
explicitly chose unpaid organizations with and without saved cards.

**How to apply:** Preserve the granted date independently of later promo edits.
Verify Stripe payment history before changing saved-card billing; if verification
fails or conflicting invoices/subscriptions exist, report a blocked org rather
than claiming its billing was successfully postponed.

**Why:** The requested benefit is free access before a fixed date, not a
discounted annual invoice or an additional free year starting on that date.

**How to apply:** Defer billing for this offer rather than attaching a 100%
discount coupon. Make the access end and first full-price charge date agree in
customer messaging and billing. This documents the requested product policy,
not proof that a live promo has been provisioned.

## Key constraints / non-obvious decisions

- **Competition attribution is separate from FREE2027.** The user wants competitions to retain referral credit during free access so commission can be calculated when full-price billing starts August 1, 2027.
  - **Why:** One shared free-access code cannot distinguish which competition referred an org, and switching away from a competition's discount code must not lose that credit.
  - **How to apply:** Keep referral identity independent of the promotion. Count signups separately from collected-payment commissions; free signup is not commission earned. Use one competition per org and preserve the first attribution rather than silently overwriting it.

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
