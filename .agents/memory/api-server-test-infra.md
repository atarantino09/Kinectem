---
name: api-server test infra & baseline failures
description: How api-server vitest builds its DB, which tests fail pre-existing, and vitest/background-run gotchas — read before attributing test failures to your changes.
---

# api-server test infrastructure

- The test DB (`kinectem_api_test`) is **rebuilt from the live DB via `pg_dump --schema-only` in `tests/globalSetup.ts`**, NOT from the Drizzle schema file. Consequences:
  - Editing `lib/db/src/schema/index.ts` alone does **not** reach the tests. The new schema must be applied to the live `DATABASE_URL` (migration or `drizzle-kit push`) first, then `pg_dump` copies it.
  - `pg_dump` runs with `ON_ERROR_STOP=1`, so a successful test run proves the schema (incl. extensions like `pg_trgm` and trigram GIN indexes) reproduces cleanly.

## Pre-existing failing tests (this environment) — do NOT attribute to your changes
- `tests/posts.test.ts`: 17/56 fail on a **clean HEAD checkout** — mostly `expected 401 to be 204/403/404` (auth) plus a few missing-content assertions. Verified by reverting changes to HEAD and re-running.
- `tests/tag-emails.test.ts`: ~2 fail with `SendGrid email delivery failed (401)` — invalid SendGrid key in dev/test env.
- **Why:** the repo is mid-development; the API suite is not fully green in this environment. Verify a baseline (revert your files via `git show HEAD:path > path`, run, then restore) before assuming you broke something.
- The whole api-server also has pervasive pre-existing TS errors (TS7030 "Not all code paths return a value", `string|string[]` arg mismatches) — a separate "fix backend type errors" concern, not caused by feature edits.

## vitest / background-run gotchas
- **vitest 4 removed `--reporter=basic`** — passing it throws a "Failed to load custom Reporter" startup error. Use `default`, `dot`, `tap`, `json`, `junit`, `verbose`.
- The suite has `fileParallelism: false` (serial) + 39 files, so a full run exceeds the 120s bash limit. Run synchronously per-file or use `--shard=N/3`.
- **Background `nohup`/`setsid` vitest gets reaped** when the bash tool call's process group ends — output never flushes. Prefer synchronous `timeout 115 ... 2>&1 | grep ...` runs, sharded.

## Test gotcha: looking up a seed user by name search is non-deterministic
- The `/api/v1/users` route reads `req.query["search"]`, NOT `q`. Tests that hit `/users?q=Name` pass an IGNORED param → the filter becomes `ilike '%%'` and returns ALL users, in heap order (no ORDER BY). `data[0]` is whichever row Postgres returns first (usually first-seeded = Marcus), so picking `data[0]?.id` silently grabs the wrong user.
- This made `teams.test.ts > blocks demoting or removing the last accepted Admin` flaky: it added the wrong user as the 2nd admin, then logged in as Daniela to accept → 403 (accept requires entry.userId === me.id). Fix: resolve the invitee id via `loginAs(email)` (returns the real user) instead of a name search. Several other tests still use `?q=Marcus` and only pass because Marcus happens to be first-seeded — fragile.
