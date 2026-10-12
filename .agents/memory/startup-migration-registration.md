---
name: Managed schema migration boundary
description: Use the development schema and Publish for managed production migrations, not new startup DDL
---

For this project's managed PostgreSQL, schema changes belong in the schema
source and development database. Publish computes and applies the
development-to-production schema diff. Existing startup migration code is
legacy infrastructure, not a reason to add new deployment-time schema patches.

**Why:** Publish's migration validation reads the actual development schema and
tests the generated changes on a disposable production fork. An earlier memory
incorrectly claimed production and test schemas came exclusively from startup
registrations.

**How to apply:** Follow the database skill, verify development changes, inspect
the pending diff, and have the user retry Publish. Do not add production push
scripts, build hooks, or startup-time DDL to bypass that flow. Production
inspection is read-only. Keep equivalent existing bootstrap definitions aligned
when needed without introducing another schema-application path.
