---
name: Competition hub owner handoff
description: Visible ownership and platform-support access rules for competition organizer hubs.
---

Platform admins are support operators, not visible hub owners or admins. Their global role bypass remains active, but owner/admin list responses must omit platform-admin accounts.

When a platform-admin-owned hub sends an owner invitation, acceptance transfers the hub owner field to the recipient and does not create an admin membership. Any redundant platform-admin membership row is removed. A real non-platform owner is never silently replaced; ordinary invitations on already handed-off hubs continue to grant admin access.

**Why:** Platform staff may set up hubs before handoff, but the customer must become the visible and persisted owner while support retains backend access.

**How to apply:** Determine the promised role when the invitation is created and previewed, lock the hub row during acceptance, transfer only from a platform-admin placeholder owner, and keep platform bypass separate from visible membership.