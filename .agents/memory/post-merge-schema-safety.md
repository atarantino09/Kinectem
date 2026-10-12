---
name: Post-merge schema safety
description: Why the post-merge setup avoids forced database pushes
---

Post-merge setup must not run a broad forced schema push against populated tables. Apply narrowly scoped, idempotent DEVELOPMENT schema updates at post-merge when necessary; managed Publish remains the production schema migration path. Do not add new startup-time DDL to repair production.

**Why:** In non-interactive post-merge setup, a forced Drizzle push still asked whether to truncate a populated table for a unique constraint, then exited successfully without applying that change. Both accepting the prompt automatically and treating its exit code as proof of a migration would be unsafe.

**How to apply:** Keep the Drizzle source and actual development schema aligned, including changes to existing defaults and constraints. A revised CREATE TABLE IF NOT EXISTS definition does not upgrade an existing table. Test the old schema through the same development upgrade path. Keep dependency installation frozen against a synchronized workspace lockfile; never substitute a broad forced push to make setup appear green.