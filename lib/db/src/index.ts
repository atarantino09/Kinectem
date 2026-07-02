import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Connection-pool sizing (Task #505 Phase 1). Under Replit Autoscale every
// running instance keeps its OWN pool, so the total connection footprint against
// Postgres is (number of instances) × PG_POOL_MAX. When cutting over to a
// managed provider, point DATABASE_URL at the POOLED endpoint (Neon: host
// contains `-pooler`, URL ends with `?sslmode=require`) and keep this budget
// under the provider's connection cap:
//
//     maxAutoscaleInstances × PG_POOL_MAX  ≤  provider pooled-connection limit
//
// Small PG_POOL_MAX (single digits) is correct behind a transaction pooler —
// the pooler multiplexes many client connections onto far fewer server ones.
// Defaults: max 10 and idle 10s match node-postgres' prior behaviour; the connect
// timeout is intentionally set to 10s (node-postgres default is 0 = wait forever)
// so a saturated pooler fails fast instead of hanging the request. All overridable.
const poolNum = (v: string | undefined, fallback: number): number => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolNum(process.env.PG_POOL_MAX, 10),
  idleTimeoutMillis: poolNum(process.env.PG_POOL_IDLE_MS, 10_000),
  connectionTimeoutMillis: poolNum(process.env.PG_POOL_CONNECT_TIMEOUT_MS, 10_000),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
