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
- **Self-send via routing is the recurring trap.** A raw `ownerId !== me.id` (or actor-filter on raw
  ids) is NOT enough: a minor target resolves to its guardian, so when the actor IS that guardian
  (guardian likes/comments/follows/invites/tags/broadcasts to their own child) the email routes back
  to the actor. **Every actor-driven dispatch must pass `excludeRecipientUserId = actor` so
  suppression happens on the RESOLVED recipient.** Self-directed sends (welcome, "your first recap"
  milestone) and actorless system sends (schedule reminder, game-recap reminder) intentionally pass
  nothing.
  **Why:** raw-id checks run before COPPA routing; the collapse onto the actor happens after.
- **Fan-out must dedupe by RESOLVED recipient, not raw target.** Guardians auto-follow a child's
  team, so a child-follower row and the guardian's own follower row both resolve to the guardian —
  resolve first, key a map by resolved recipient id, then send once. Deduping raw user ids before
  routing still double-sends to the guardian.

## Test pitfall (cost >2 attempts) — lazy-create defeats "set flag false" suppression tests
`getOrCreatePreferences()` lazily mints an **all-on** row on first read. In suppression tests you
must seed the row with `getOrCreatePreferences(id)` and *then* `UPDATE ... set({ flag: false })`.

**Why:** an early test helper that DELETEs the prefs row first means the subsequent UPDATE hits 0
rows; dispatch then lazily recreates an all-on row → the email sends → false test failure.
**How to apply:** before any `UPDATE notification_preferences SET <flag>=false`, ensure the row
exists via `getOrCreatePreferences(userId)`. Note the seed sets a minor's `parentId` but NOT
`isMinor` — set `isMinor: true` explicitly in minor-routing tests. Test DB is schema-only + reseeded
each test; `notification_preferences` is cascade-truncated so it's fresh per test.
