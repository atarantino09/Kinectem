---
name: Platform-admin manager bypass
description: users.role==='admin' passes canManageTeam/canManageOrganization/canAuthorRecapAnywhere everywhere; client mirrors via useWhoami.
---

Platform admins (users.role === "admin") are treated as managers of EVERY org and team.

**Where:** `isPlatformAdmin(userId)` short-circuits `canManageTeam`, `canManageOrganization`, and `canAuthorRecapAnywhere` in api-server permissions. Keep these three aligned — bypassing only the manage checks left admins with manager UI whose AI-assist/newsletter endpoints 403'd (`canAuthorRecapAnywhere` gates AI egress).

**Masquerade:** checks run on sessionUser, which during masquerade is the viewed user — admin powers do NOT carry through "View as". Client mirrors this with `who.isMasquerading ? viewingAs.role : realUser.role` from useWhoami.

**Client:** TeamPage and OrganizationPage OR `isPlatformAdmin` into their isAdmin/isManagerRole gates so manage UI (roster Invite, org member tools) appears. Owner-only actions (ownership transfer, archive) intentionally stay owner-only via getOrgRole — do not "fix" that.

**How to apply:** any new manager-gated feature gets platform-admin access for free via the permission helpers; if you add a NEW capability gate (like canAuthorRecapAnywhere was), decide explicitly whether platform admins pass and keep client gates mirrored.

## Organization ownership follows creation intent, not platform role
Regular in-app organization creation grants its authenticated creator ownership and follow state, including platform admins. Dedicated admin quick setup, claim-link creation, and bulk import remain ownerless handoff flows. Platform-admin team creation still leaves the roster empty.
**Why:** the app promises personal creators ownership; customer handoff setup must not list the operator as owner or follower. Platform role alone cannot distinguish these intents.
**How to apply:** keep creation flows explicit and separate. Never broadly backfill platform-admin-created organizations; repair an existing page only after identifying it, verifying its creator and personal-creation intent, and confirming no owner exists.
