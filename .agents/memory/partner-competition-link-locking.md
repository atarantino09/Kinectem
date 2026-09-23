---
name: Partner competition link locking
description: Concurrency rule for partnership-page to competition relationships edited from two admin surfaces.
---

All writers for partnership-page competition links must use one locking protocol: serialize by partnership page, lock every involved competition in deterministic order, then lock and reread the page before writing. Merge the legacy singular relationship with the array and filter deleted competitions.

**Why:** The relationship can be changed from both the partnership editor and competition console. Independent read-modify-write flows can overwrite each other, while competition deletion can otherwise clean a link only for a concurrent writer to restore the deleted UUID in the unconstrained array.

**How to apply:** Any new route, bulk action, import, or cleanup that changes partnership competition links must use the shared transactional protocol and coordinate with the competition-deletion lock.