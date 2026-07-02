# Kinectem — Go-Live Runbook (LAUNCH.md)

Operational runbook for the pre-launch hardening (Task #505). Built out phase by
phase; sections marked **TODO** are not done yet. Full spec: `.local/tasks/task-505.md`.

## Phase 1 — Managed Postgres cutover (Neon, pooled)

### Why
Under Replit Autoscale every running instance keeps its own DB connection pool,
so the real footprint is `instances × PG_POOL_MAX`. The Replit dev/prod Postgres
is not sized or backed up for launch traffic. Move to a managed **Neon** Postgres
with automated backups + point-in-time recovery, connecting through Neon's
**pooled** endpoint.

### Planned sizing (decided)
- Max Autoscale instances: **5**
- `PG_POOL_MAX`: **10**
- Peak server connections: **5 × 10 = 50** — must stay under Neon's pooled cap.

Tunables (Deployment Secrets / env), read in `lib/db/src/index.ts`:
- `PG_POOL_MAX` (default 10) — per-instance pool size.
- `PG_POOL_IDLE_MS` (default 10000)
- `PG_POOL_CONNECT_TIMEOUT_MS` (default 10000) — fail fast instead of hanging when saturated.

> The DB cutover happens the moment `DATABASE_URL` in **Deployment Secrets** points
> at Neon and you Publish. Because the current **live data** is in the existing
> prod DB, validate Neon and load its data *before* that swap — otherwise the app
> goes live against an empty database.

### Cutover steps
1. **Provision Neon.** Create a project (region near the deployment). Enable automated backups + PITR. Copy the **pooled** connection string (host contains `-pooler`, ends with `?sslmode=require`).
2. **Pre-flight load check** (no schema/data needed — uses `select 1`):
   ```
   DATABASE_URL='<neon-pooled-url>' pnpm --filter @workspace/scripts run db:load-check -- \
       --instances=5 --pool-max=10 --duration=30
   ```
   Must report "connection budget holds" with 0 connection errors.
3. **Create schema on Neon:**
   ```
   DATABASE_URL='<neon-pooled-url>' pnpm --filter @workspace/db run push
   ```
   (The api-server also auto-applies registered migrations at boot, but pushing now lets you load data before Publish.)
4. **Copy live data** from the current prod DB into Neon (schema already present):
   ```
   pg_dump --data-only --no-owner '<current-prod-DATABASE_URL>' | psql '<neon-pooled-url>'
   ```
   Do this in a short low-traffic window to minimize drift.
5. **Cut over:** set `DATABASE_URL` (and `PG_POOL_MAX=10` if not default) in **Deployment Secrets** → **Publish** (user-initiated).
6. **Prod smoke test:** login, create a post, run a COPPA flow. Confirm the Neon dashboard shows backups + PITR enabled.

### Rollback
Revert `DATABASE_URL` in Deployment Secrets to the previous value and re-publish.
Keep the old database intact until Neon has been validated in prod for a few days.

## Phase 2 — Shared-state rate limiting (Postgres-backed) — TODO
Starts only **after Phase 1 is validated in production.** Replace the in-memory
limiters (starting with the AI Assist / recap limiter in
`artifacts/api-server/src/routes/ai.ts`) with a **Postgres-backed** counter store
so limits hold across Autoscale instances — reusing the Neon DB, no new service.
Keep the existing limiter API in `artifacts/api-server/src/middlewares/rate-limit.ts`
unchanged so route handlers don't change. (Redis remains a later option if
rate-limit latency ever becomes a bottleneck.)

## Phases 3–5 — TODO
Object storage for uploads · scheduled COPPA + backfill jobs · custom domain + TLS.
