---
name: One-time data migrations via marker table
description: Startup migrations re-run every boot; destructive/one-shot data cleanups must be gated on a one_time_migration_markers row.
---

Startup migrations (MIGRATIONS array) execute on EVERY boot — there is no applied-name tracking. Schema changes survive this via IF NOT EXISTS, but a one-shot data cleanup (e.g. deleting legacy membership rows) would keep re-deleting matching rows forever, silently destroying future legitimate data.

**Why:** the task-819 cleanup removes platform-admin org/roster rows that existed before the hand-off change; an admin could later legitimately join, and an unguarded delete-on-boot would remove them again.

**How to apply:** wrap one-shot data migrations in a `DO` block gated on `one_time_migration_markers` (table exists; `name text PRIMARY KEY`): run only if no marker row, then insert the marker inside the same block. Pair with a dry-run-capable script in `scripts/src/` for dev verification, keeping criteria/allowlists in sync. Since the agent can't run scripts in prod, the marker-gated boot migration is the prod execution vehicle (runs once at next publish).

**Policy-change corollary:** a later corrective migration is not sufficient when an earlier startup entry still matches the same rows. Audit and narrow every older entry that touches the policy sentinel, then test the relevant ordered sequence twice; otherwise boot can undo/reapply the correction or churn `updated_at` forever.
