---
name: Team removal safety
description: Authority and roster boundary for deleting or archiving organization team pages.
---

Organization owners, organization admins, and platform admins may permanently delete a team only when it has zero roster rows. If any player or staff roster row exists, the team must be archived instead. Import provenance does not affect this rule.

**Why:** Claimed organizations need a fast way to remove mistaken empty team pages created during setup, but existing team membership makes permanent deletion too destructive.

**How to apply:** Enforce the roster check in the same locked transaction as deletion, not only in the client. Show the applicable action and reason clearly on the team page. Organization admins may archive and unarchive; ordinary members may not.