---
name: Platform-admin manager bypass
description: users.role==='admin' passes canManageTeam/canManageOrganization/canAuthorRecapAnywhere everywhere; client mirrors via useWhoami.
---

Platform admins (users.role === "admin") are treated as managers of EVERY org and team.

**Where:** `isPlatformAdmin(userId)` short-circuits `canManageTeam`, `canManageOrganization`, and `canAuthorRecapAnywhere` in api-server permissions. Keep these three aligned — bypassing only the manage checks left admins with manager UI whose AI-assist/newsletter endpoints 403'd (`canAuthorRecapAnywhere` gates AI egress).

**Masquerade:** checks run on sessionUser, which during masquerade is the viewed user — admin powers do NOT carry through "View as". Client mirrors this with `who.isMasquerading ? viewingAs.role : realUser.role` from useWhoami.

**Client:** TeamPage and OrganizationPage OR `isPlatformAdmin` into their isAdmin/isManagerRole gates so manage UI (roster Invite, org member tools) appears. Owner-only actions (ownership transfer, archive) intentionally stay owner-only via getOrgRole — do not "fix" that.

**How to apply:** any new manager-gated feature gets platform-admin access for free via the permission helpers; if you add a NEW capability gate (like canAuthorRecapAnywhere was), decide explicitly whether platform admins pass and keep client gates mirrored.

## Platform admins are never auto-listed as creators
Creating an org or team as a platform admin does NOT insert the owner/follower or roster rows other users get — the org is born UNCLAIMED and teams start with an empty roster (hand-off model; real staff claim/join later).
**Why:** operators setting up pages for customers must not appear as org owner or team admin anywhere.
**How to apply:** never "fix" a missing creator-membership row for a role-admin user; tests exercising owner/roster-creator flows must log in as a NON-admin seed user (e.g. parent or coach@kinectem.demo), not sam@/andrew@ (both role admin).
