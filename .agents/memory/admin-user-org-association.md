---
name: Admin user organization association
description: Meaning of organization membership in the admin Users list
---

The admin Users list treats an organization as associated with someone if they have a direct organization membership, an accepted roster spot on one of its teams, or an active guardian link to a child with an accepted roster spot. Show each organization only once even if several of these paths apply. Following an organization alone is not membership; pending team invites and revoked guardian links do not count.

**Why:** Admins need to see which organization each account is actually connected to, including parent accounts, without confusing an ordinary follower with a member.

**How to apply:** Keep this distinction when adding filters or exports to the admin Users view. Do not silently reuse the public profile organization endpoint, which also includes followed organizations.