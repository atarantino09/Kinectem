---
name: Updates-only family contacts
description: Security boundary between read-only family updates and guardian or team permissions
---

An accepted updates-only contact is not a guardian and must never gain guardian, consent, account-management, roster, coaching, or private practice-plan rights. Grant child/team activity on explicit read paths only; schedule email audiences can include active contacts of accepted rostered children, but generic team membership cannot.

**Why:** Active guardian links confer broad child-account rights. The existing schedule-view permission helper is also called from mutation routes, so adding contacts there silently permits writes.

**How to apply:** For future child/team update surfaces, check the active contact relationship and accepted roster membership only on the relevant read/notification path. Keep guardian links, primary-parent mirrors, and generic team management/member checks unchanged.