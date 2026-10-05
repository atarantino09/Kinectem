---
name: Partner duplicate resolution safety
description: Durable boundaries between directory identity resolution and destructive organization cleanup.
---

Treat duplicate resolution as choosing which existing identity a directory displays, not as merging organizations. Name similarity is evidence only; a person must explicitly choose whether two records represent the same club.

**Why:** A directory can safely point at a canonical record without altering either organization. Destructive cleanup is different: concurrent activity or an overlooked dependency can turn deletion into data loss.

**How to apply:** Attach the chosen identity before removing the duplicate listing. Delete only records proven to be disposable staging data after locked, transactional checks; otherwise retain the record and perform directory-only replacement. Keep decisions scoped, reversible, and idempotent.

Partner landing preparation may intentionally create a separate staging organization even when a similarly named organization exists. Platform admins must have an explicit override in the Admin Organizations bulk importer; the default remains blocking. Replacing the eventual directory entry is a two-step approval: an admin of the established organization requests the swap, then a platform admin approves or denies it.

**Why:** Partner organizers need to publish imported club lists before every club has reconciled its Kinectem identity, while established club admins must be able to claim the correct directory slot without an automatic merge changing teams, schedules, ownership, posts, billing, branding, or competition data.

**How to apply:** Keep intentional duplicate creation behind the explicit “create separate organizations” bulk-import override, never implicit. Changing the option requires revalidation. In partner-directory review, platform admins search claimed organizations by name and explicitly preview a directory-only replacement. A later public swap request changes no membership immediately; approval revalidates requester authority and import provenance under locks, then swaps only the partner membership. Competition schedule claiming remains separate.

In partner imports, choosing to create a new organization despite a possible match is a `keep_distinct` decision, not the automatic `create` default.

**Why:** The importer rechecks collisions transactionally and rejects ambiguous `create` requests. A human's explicit choice must survive serialization, or a valid-looking selection becomes a conflict at submission.

**How to apply:** Require an explicit choice for every credible match and send `keep_distinct` only for deliberate separate creation. Preserve the preview and choices on rejection and show the error next to the import action.

Moving teams between imported organizations requires immutable provenance on each team itself. Matching organization or directory-membership provenance is not enough because teams can be created later. Revalidate team, source, and target provenance under locks; update denormalized organization-scoped workflow rows, but leave team-scoped records attached through their team ID.

**Why:** Treating every team inside an imported organization as imported can move later user-created data. Blindly rewriting organization IDs on team-scoped records can also violate one-scope-only invariants.

**How to apply:** Allow moves only when the team, source organization membership, source organization, target membership, and target organization all carry the same non-null import operation. Keep ordinary ownerless-team deletion as a separate permission with explicit impact confirmation.