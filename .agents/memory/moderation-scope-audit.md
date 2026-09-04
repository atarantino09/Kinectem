---
name: Moderation scope and audit atomicity
description: Durable authorization and audit rules for manager-initiated removals.
---

Moderation authority must be derived from the persisted target's organization/team scope, never from scope identifiers supplied by the client. Platform admins are global, organization owners/admins inherit authority across their organization, and accepted team coaches/admins remain team-scoped.

**Why:** Client-provided scope can be forged, and a destructive write that commits separately from its audit insert can leave an uninvestigable moderation action if logging fails.

**How to apply:** For any new manager removal, load the canonical target and scope first, apply the shared scope policy, then transaction-wrap the destructive mutation and privacy-safe audit insert. Preserve author self-service and family/legal relationships unless the endpoint explicitly manages those relationships.