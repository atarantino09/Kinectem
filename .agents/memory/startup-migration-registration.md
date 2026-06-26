---
name: Startup migration registration
description: Schema changes need a registered entry in migrations.ts, not just a raw SQL apply to the dev DB.
---

# Startup migrations must be registered, not just dev-applied

The api-server applies schema via an **ordered startup-migration list** in
`artifacts/api-server/src/lib/migrations.ts` (`MIGRATIONS` array, run by
`runStartupMigrations()` on every boot). Each entry is `{ name, sql }` and the
SQL is run with `sql.raw` inside a try/catch (failures log loudly but don't
block boot).

**Rule:** any DB schema change (new table, new/altered column) must be added as
a new idempotent SQL const + appended to the `MIGRATIONS` array. `pnpm db push`
or a one-off raw SQL applied to the dev DB only mutates the *dev* database —
production and fresh test DBs get their schema **exclusively** from this list.

**Why:** Task #628 nearly shipped tournament tables that existed only in the dev
DB. The Drizzle schema (`lib/db/src/schema/index.ts`) had the tables, dev had
them applied, typecheck passed, the live app worked — but there was no
`MIGRATIONS` entry, so a production deploy would have had no tournament tables
and every funnel route would 500.

**How to apply:**
- Write SQL idempotently: `CREATE TABLE/INDEX IF NOT EXISTS`, guarded
  `CREATE TYPE` via `DO $migration$ ... pg_type` block, `ADD COLUMN IF NOT
  EXISTS`, and `ALTER COLUMN ... DROP NOT NULL` (a no-op when already nullable).
- Verify after restart in the api-server workflow log: every entry logs
  `Applied startup migration { migration: "<name>" }`.
- Confirm the column/table landed with an `information_schema.columns` query.
