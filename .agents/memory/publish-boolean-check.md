---
name: Publish boolean check expressions
description: Bare boolean checks can be misread during publish schema introspection even though PostgreSQL accepts them
---

For non-null boolean singleton keys, prefer an explicit comparison such as
`CHECK (id = true)` over a bare `CHECK (id)` when schemas pass through Publish.

**Why:** PostgreSQL accepted the bare-column check, but the actual
development-to-production diff double-wrapped it as `CHECK (CHECK (id))`.
An equivalent explicit comparison round-tripped correctly.

**How to apply:** Inspect both the stored constraint definition and expression
before blaming source SQL. Keep source definitions aligned, change the
development constraint atomically without deleting rows, recompute the Publish
diff, and validate its generated DDL with a temporary rolled-back probe.
Production schema changes still go through Publish.
