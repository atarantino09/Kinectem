---
name: Competition organizer hub
description: Parent-company hub grouping competitions; branding copy semantics + attach contract.
---

- **Branding is COPIED at creation, not referenced** — creating a competition under an organizer snapshots the hub's colors/logo/banner/website onto the tournament row.
  - **Why:** later hub rebrands must never silently restyle past competitions.
  - **How to apply:** never "fix" this by joining organizer branding at read time; detach keeps the copied branding on purpose.
- Attach/detach endpoint body is `{ competitionId, attach: boolean }` (not an `action` string); detach of an unattached competition → 409.
- Routes: public hub `/organizers/:slug`; in-app `/competitions/o/:slug` (must precede `/competitions/:id` in wouter, same trick as `/competitions/c/:slug`).
- Ownership: organizer has no createdBy/owner split — `ownerUserId` only; owner-or-platform-admin everywhere, mirroring canOperateCompetition.
