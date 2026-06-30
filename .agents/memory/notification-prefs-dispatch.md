---
name: Notification email preferences & dispatch gate
description: COPPA-safe email dispatch gate over in-app notifications, and the lazy-create test pitfall when asserting suppression.
---

# Notification email preferences & dispatch gate

Engagement/marketing email is layered on top of in-app notifications and routed through a single
gate: `dispatchNotificationEmail({ userId, category, build })`. Transactional/essential email
(password reset, guardian-confirm, consent) is NOT an `EmailCategory` and bypasses the gate entirely.

## Durable rules
- **Gate on the *resolved recipient's* prefs, never the minor's.** For a minor (`users.isMinor`),
  email routes to the linked guardian (`parentId`) and is gated on the guardian's `pauseAll` +
  per-category flag. No guardian → suppress (no send). `dispatchNotificationEmail` overwrites any
  builder-provided `to` so a minor can never be emailed directly.
- **Keep all gated categories behind the dispatch gate** (and the scripts' `resolveRecipient`).
  Never call `sendEmail` directly for an `EmailCategory` — that bypasses COPPA routing + unsubscribe.
- **Every gated email carries a no-login unsubscribe link** backed by a 256-bit `unsubscribe_token`;
  the public unsubscribe route is rate-limited and must not disclose account existence (friendly 200
  even on nonmatching token).

## Test pitfall (cost >2 attempts) — lazy-create defeats "set flag false" suppression tests
`getOrCreatePreferences()` lazily mints an **all-on** row on first read. In suppression tests you
must seed the row with `getOrCreatePreferences(id)` and *then* `UPDATE ... set({ flag: false })`.

**Why:** an early test helper that DELETEs the prefs row first means the subsequent UPDATE hits 0
rows; dispatch then lazily recreates an all-on row → the email sends → false test failure.
**How to apply:** before any `UPDATE notification_preferences SET <flag>=false`, ensure the row
exists via `getOrCreatePreferences(userId)`. Note the seed sets a minor's `parentId` but NOT
`isMinor` — set `isMinor: true` explicitly in minor-routing tests. Test DB is schema-only + reseeded
each test; `notification_preferences` is cascade-truncated so it's fresh per test.
