# Kinectem — Go-Live Runbook (LAUNCH.md)

Operational runbook for the pre-launch hardening (Task #505). Built out phase by
phase; sections marked **TODO** are not done yet. Full spec: `.local/tasks/task-505.md`.

## Phase 1 — Managed Postgres cutover (Neon, pooled)

### Why
Under Replit Autoscale every running instance keeps its own DB connection pool,
so the real footprint is `instances × PG_POOL_MAX`. The Replit dev Postgres is
not sized or backed up for launch traffic. Move to a managed **Neon** Postgres
with automated backups + point-in-time recovery, connecting through Neon's
**pooled** endpoint.

### Connection budget
Keep this true at all times:

    (max Autoscale instances) × PG_POOL_MAX  ≤  Neon pooled connection limit

Tunables (Deployment Secrets / env), read in `lib/db/src/index.ts`:
- `PG_POOL_MAX` (default 10) — per-instance pool size. Keep single digits behind the pooler.
- `PG_POOL_IDLE_MS` (default 10000)
- `PG_POOL_CONNECT_TIMEOUT_MS` (default 10000) — fail fast instead of hanging when saturated.

### Cutover steps
1. Create a Neon project (region close to the deployment). Enable automated backups + PITR.
2. Copy the **pooled** connection string (host contains `-pooler`); ensure it ends with `?sslmode=require`.
3. Apply schema to Neon (migrations / `pnpm --filter @workspace/db run push` against the Neon URL).
4. Move data: `pg_dump` the current DB and restore into Neon (`--data-only` if schema already applied).
5. **Load-test the connection budget before flipping prod:**
   ```
   DATABASE_URL=<neon-pooled-url> pnpm --filter @workspace/scripts run db:load-check -- \
       --instances=<maxInstances> --pool-max=<PG_POOL_MAX> --duration=20
   ```
   Must report "connection budget holds" with 0 connection errors.
6. Set `DATABASE_URL` in **Deployment Secrets** to the Neon pooled URL (and `PG_POOL_MAX` if not default).
7. Publish (Publish button — user-initiated).
8. Prod smoke test: login, create a post, run a COPPA flow. Confirm the Neon dashboard shows backups + PITR enabled.

### Rollback
Revert `DATABASE_URL` in Deployment Secrets to the previous value and re-publish.
Keep the old database intact until Neon has been validated in prod for a few days.

## Phase 2 — Shared-state rate limiting (Redis) — TODO
Starts only **after Phase 1 is validated in production.** Move the in-memory
limiters (starting with the AI Assist / recap limiter in `artifacts/api-server/src/routes/ai.ts`)
to a shared store so limits hold across Autoscale instances, keeping the existing
limiter API in `artifacts/api-server/src/middlewares/rate-limit.ts` unchanged.

## Phases 3–5 — TODO
Object storage for uploads · scheduled COPPA + backfill jobs · custom domain + TLS.
