---
name: Admin content inventory
description: Scope and geographic meaning of the platform-wide admin post browser
---

The platform admin's post inventory is a read-only view across all users and
post types, including drafts, pending/hidden content, and private practice
plans. It is not a public or organization-member feed.

**Why:** The user requested one place in the admin panel to see all post types
across the platform and filter or sort by sport, location, organization, and
post type. Restricting it to already-public content would omit work needing
administrative attention.

**How to apply:** Keep this inventory strictly platform-admin-only, including
the requirement to exit masquerade. Do not reuse its unrestricted inventory
queries for public pages or ordinary staff views. Keep public practice-plan
privacy rules unchanged when adding new post sources.

Location means the organization's home community, falling back to the author
for profile-only or independent content without organization location data.
It does not mean the competition venue or where a coach happened to write.

**Why:** A team's post belongs to its home sports community even when a game
was played away. Inferring geography from a story or posting date would make
the requested location browsing unreliable.

**How to apply:** Preserve this distinction if venue/location fields are added
later; explain the difference rather than silently changing filter semantics.
