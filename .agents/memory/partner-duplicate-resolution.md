---
name: Partner duplicate resolution safety
description: Durable boundaries between directory identity resolution and destructive organization cleanup.
---

Treat duplicate resolution as choosing which existing identity a directory displays, not as merging organizations. Name similarity is evidence only; a person must explicitly choose whether two records represent the same club.

**Why:** A directory can safely point at a canonical record without altering either organization. Destructive cleanup is different: concurrent activity or an overlooked dependency can turn deletion into data loss.

**How to apply:** Attach the chosen identity before removing the duplicate listing. Delete only records proven to be disposable staging data after locked, transactional checks; otherwise retain the record and perform directory-only replacement. Keep decisions scoped, reversible, and idempotent.