---
name: Per-tier team cap enforcement
description: How org team caps are enforced race-safely on team creation, and where the limits live.
---

# Team cap enforcement

Plan team caps live in `artifacts/api-server/src/lib/plan-limits.ts`
(`PLAN_TEAM_LIMITS`: starter 15, pro 40, elite `null`=unlimited; `DEFAULT_PLAN`).
Orgs with no subscription fall back to `DEFAULT_PLAN`. Archived teams
(`archivedAt IS NOT NULL`) never count toward usage; existing teams are
grandfathered (the cap only blocks NEW creates).

**Rule: the authoritative cap check must run INSIDE the team-insert
transaction, not before it.** In `POST /organizations/:orgId/teams`
(`routes/teams.ts`) the tx takes `pg_advisory_xact_lock(hashtext(orgId))`,
re-counts active teams on the tx, then inserts; over-cap returns a sentinel
`{ limited: true }` mapped to `403 TEAM_LIMIT_REACHED { extras:{limit,plan} }`.

**Why:** a pre-transaction count-then-insert is a TOCTOU race — concurrent
creates each read "under cap" and all insert, overrunning the limit. The
per-org advisory lock serializes creates for one org so the re-count is
trustworthy. Verified: 14/15 then 5 parallel creates → exactly one 201.

**How to apply:** any future per-org quota gate on an insert (e.g. roster/
member caps) should follow the same lock-then-recount-in-tx pattern, not a
standalone pre-check. UI usage (used/limit/remaining) comes from
`GET /organizations/:orgId/subscription` `usage` block — best-effort display
only, never the enforcement point.
