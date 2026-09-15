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