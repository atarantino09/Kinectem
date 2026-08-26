---
name: lib/db project-reference build trap
description: Editing lib/db/src schema doesn't reach api-server typecheck until lib/db is rebuilt; plus an any-typed req.body narrowing gotcha with drizzle eq().
---

Adding/changing an export in `lib/db/src/schema/index.ts` (e.g. a new table or column) is invisible to `artifacts/api-server`'s typecheck until `lib/db`'s build output is refreshed — api-server's `tsc` resolves `@workspace/db` via TS project references, which read `lib/db/dist/*.d.ts`, not live `src`. A batch of "does not exist on type" errors for a symbol you just added is usually this, not a real bug.

**Why:** project-reference builds are incremental and don't watch sibling packages' `src` in this monorepo setup; only `dist/*.d.ts` is on the resolution path.

**How to apply:** after editing `lib/db/src/**`, run `npx tsc --build lib/db` (or the repo's `typecheck:libs` script if present) before trusting api-server typecheck output that references the new export.

Related gotcha: assigning an `any`-typed value (e.g. `req.body.listId`) directly into a `string | null` variable and then passing that variable to drizzle's `eq()` does not get narrowed correctly by TS in some cases. Fix by assigning to an explicitly-typed `const requestedListId: string = req.body.listId` first, then deriving the nullable value from that.
