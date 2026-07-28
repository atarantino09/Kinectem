---
name: Drizzle sql`` renders columns unqualified
description: Why joins inside raw sql`` subqueries break with ambiguous column errors
---
Inside raw ``sql`...` `` templates, drizzle renders `${table.column}` as just `"column"` — NOT `"table"."column"`. Any join between tables sharing column names (`id`, `status`, `team_id`, ...) then fails at runtime with `column reference "id" is ambiguous`, usually surfacing as a 500 only once real data exercises the join (e.g. org setup-status broke in prod on orgs that had teams + roster rows).

**Why:** `${teams.id}` looks qualified in source but isn't in generated SQL; tests with empty joins can still pass, hiding the bug.

**How to apply:** in raw sql`` subqueries that join tables, write literal qualified identifiers with aliases (`inner join teams t on t.id = re.team_id`) instead of `${table.column}` interpolation. Parameter values (`${orgId}`) are fine.
