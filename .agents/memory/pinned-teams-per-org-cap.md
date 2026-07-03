---
name: Pinned-teams per-org cap
description: The team-pin limit is 5 PER organization, not 5 total; bucket-key semantics must match client and server.
---

# Pinned teams are capped 5 PER organization (not 5 total)

The viewer's pinned-teams limit is **5 per organization**. Independent/solo
teams (no org) share a single `"__independent__"` bucket, also capped at 5.
Orgs themselves stay capped at 5 (separate feature, unchanged).

**Why:** users belong to teams across many orgs; a global cap of 5 was too
small once org-scoped pins existed. The OpenAPI `UpdatePinnedTeamsRequest`
`maxItems` is only a **global safety cap** (50) — the real rule is enforced in
the `PUT /users/me/pinned-teams` handler by grouping the submitted team ids by
`teams.organizationId`.

**How to apply:**
- The bucket key is `orgId ?? "__independent__"`. This derivation must stay
  identical on the server (per-org enforcement) and every client call site, or
  the client will block/allow pins the server disagrees with.
- `usePinnedTeams().togglePin(teamId, groupTeamIds)` takes the sibling team ids
  of the toggled team's bucket; the hook counts pinned members of that group to
  enforce the cap of 5. Every caller must pass the correct bucket:
  - Org team rows → that org's full team list.
  - OrganizationPage → all of that one org's teams.
  - UserProfilePage → teams sharing the row's `organization?.id` bucket.
  - FeedPage orphan/independent group → **filter by the team's real `orgId`**,
    NOT the whole orphan list. The orphan list mixes solo teams (null org) AND
    teams whose org isn't in the viewer's own org list, so it can span several
    real orgs; `SidebarTeam.orgId` carries the real id for this reason.
