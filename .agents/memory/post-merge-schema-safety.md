---
name: Post-merge schema safety
description: Why the post-merge setup avoids forced database pushes
---

Post-merge setup must not run a forced schema push against populated tables. Schema changes belong in the registered, idempotent API startup migrations; workflow reconciliation restarts the API after dependency setup.

**Why:** In non-interactive post-merge setup, a forced Drizzle push still asked whether to truncate a populated table for a unique constraint, then exited successfully without applying that change. Both accepting the prompt automatically and treating its exit code as proof of a migration would be unsafe.

**How to apply:** Add new schema changes to the API startup migration registry and check API startup logs after a merge. Keep dependency installation frozen against a synchronized workspace lockfile; never substitute a forced push to make setup appear green.