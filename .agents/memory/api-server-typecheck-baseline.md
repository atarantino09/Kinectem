---
name: api-server typecheck baseline is broken (express 5 types)
description: pnpm run typecheck fails massively in api-server at baseline; how to tell your errors from the noise
---

`pnpm --filter @workspace/api-server run typecheck` reports **hundreds of pre-existing errors** across nearly every route file — this is the baseline, NOT something you introduced.

The recurring baseline patterns (caused by Express 5 `@types` drift + drizzle overload resolution) are:
- `TS7030: Not all code paths return a value` — on virtually every `asyncHandler(async (req,res) => ...)` handler.
- `TS2769: No overload matches this call` — on drizzle `.from()/.where()/.values()` query builders.
- `TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'` — on `req.params.*` / `req.query.*` passed to helpers.
- `TS2322: 'AuthorRoleLabel | null' is not assignable to 'PostAuthorRoleLabel | null'` — author-role label widening.

**How to tell your own errors from the baseline:** pick a route file you did NOT touch (e.g. `assets.ts`) — it already shows TS7030/TS2769 on its handlers. Anything matching the four patterns above on your new handler is baseline, not a regression. Look instead for *novel* error shapes referencing your new symbols (new table/column names, your helper names, missing required fields).

**Why:** `lib`/`kinectem`/`typecheck:libs` all pass clean; only api-server's leaf typecheck is broken, and it predates current work. Do not try to "fix" the whole file — scope your verification to net-new error categories on the lines you added.

**RateLimitOptions requires `name`:** when adding a `rateLimit({...})` limiter, the required fields are `name: string`, `windowMs`, `max`, `keys: (req) => Array<string|null|undefined>`. Omitting `name` yields a TS2345 on the whole options object that looks like a generic Request-type mismatch — the real cause is the missing `name`. Mirror the `founding-signups.ts` precedent (`keys: (req) => [ipKey(req)]`).
