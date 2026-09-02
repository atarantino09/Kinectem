---
name: Partner landing membership
description: Durable ownership and import boundaries for branded partner organization directories.
---

Partner landing pages use an independent membership relationship. Attaching an organization must never change its owner, teams, posts, billing, branding, promo state, or direct claim token. Claimed clubs stay attached and render identically to ownerless clubs.

**Why:** Partner directories represent a complete league roster, while organization ownership is a separate lifecycle. Real leagues also contain duplicate names, so name similarity is evidence for an admin warning, never an automatic merge or import blocker.

**How to apply:** Keep membership attach/detach idempotent and ownership-neutral. Preserve each import column as a separate organization unless an admin explicitly selects an existing record. Keep shared partner-page claims review-gated; direct secret claim links retain their separate instant-handoff trust model.