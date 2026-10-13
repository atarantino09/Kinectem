---
name: Platform activity coverage
description: Coverage and privacy boundaries for the admin activity log.
---
The activity log combines existing admin audit history with successful authenticated account actions. “Admins” means platform admins; coaches and organization admins remain in “Users.” Attribute masquerading to the real admin.

Do not invent historical events for periods before general activity recording. Do not expand activity tracking into page-view or background-poll logging without explicit scope agreement. Never store raw request bodies, query strings, credentials, invitation tokens, or private message contents.

**Why:** The former log only recorded selected audit actions, so retrospective reconstruction cannot give complete or truthful history. Request-level activity is operational visibility, not a substitute for transactional moderation audits.

**How to apply:** Keep these boundaries when extending coverage or building exports and filters. Preserve legacy audit records and explain the recording boundary in the UI.
