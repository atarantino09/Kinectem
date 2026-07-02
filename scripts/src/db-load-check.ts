// Task #505 Phase 1 — Multi-instance DB connection-limit load check.
//
// Simulates several Replit Autoscale instances hitting Postgres at once. Under
// Autoscale every running instance keeps its OWN connection pool, so the real
// connection footprint against the database is (instances × pool-max). This
// harness spins up N independent pools (one per simulated instance), each capped
// at --pool-max, fires concurrent queries for --duration seconds, then reports
// success/error counts and latency percentiles. Point DATABASE_URL at the target
// (dev DB now, or the Neon POOLED endpoint before cutover) and confirm there are
// no connection errors at the intended peak.
//
// Read-only by default (SELECT 1); safe to run against any environment. Exits
// non-zero if any query errors, so it can gate the cutover.
//
// Examples:
//   DATABASE_URL=... pnpm --filter @workspace/scripts run db:load-check
//   DATABASE_URL=<neon-pooled-url> pnpm --filter @workspace/scripts run db:load-check -- \
//       --instances=10 --pool-max=5 --duration=20

import pg from "pg";

const { Pool } = pg;

type Args = {
  instances: number;
  poolMax: number;
  duration: number;
  concurrencyPerInstance: number;
  sql: string;
};

function parseArgs(): Args {
  const get = (name: string): string | undefined => {
    const pref = `--${name}=`;
    const hit = process.argv.find((a) => a.startsWith(pref));
    return hit ? hit.slice(pref.length) : undefined;
  };
  const numArg = (name: string, fallback: number): number => {
    const v = get(name);
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    instances: numArg("instances", 5),
    poolMax: numArg("pool-max", Number(process.env.PG_POOL_MAX) || 10),
    duration: numArg("duration", 15),
    concurrencyPerInstance: numArg("concurrency", 0), // 0 = one query per pooled conn
    sql: get("sql") ?? "select 1",
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must be set.");
    process.exit(2);
  }
  const args = parseArgs();
  const perInstance = args.concurrencyPerInstance || args.poolMax;
  console.log(
    `DB load check: ${args.instances} simulated instances × pool-max ${args.poolMax} ` +
      `(peak ${args.instances * args.poolMax} server connections), ` +
      `${perInstance} concurrent queries/instance, ${args.duration}s, sql="${args.sql}"`,
  );

  const pools = Array.from(
    { length: args.instances },
    () =>
      new Pool({
        connectionString: process.env.DATABASE_URL,
        max: args.poolMax,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 10_000,
      }),
  );

  const latencies: number[] = [];
  let ok = 0;
  let errors = 0;
  const errorSamples = new Map<string, number>();
  const deadline = Date.now() + args.duration * 1000;
  let stop = false;

  const worker = async (pool: pg.Pool): Promise<void> => {
    while (!stop && Date.now() < deadline) {
      const started = Date.now();
      try {
        await pool.query(args.sql);
        latencies.push(Date.now() - started);
        ok += 1;
      } catch (err) {
        errors += 1;
        const msg = err instanceof Error ? err.message : String(err);
        errorSamples.set(msg, (errorSamples.get(msg) ?? 0) + 1);
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (const pool of pools) {
    for (let i = 0; i < perInstance; i++) workers.push(worker(pool));
  }
  await Promise.all(workers);
  stop = true;

  await Promise.all(pools.map((p) => p.end().catch(() => {})));

  latencies.sort((a, b) => a - b);
  const total = ok + errors;
  const rps = total / args.duration;
  console.log("");
  console.log(`Total queries:   ${total}  (~${rps.toFixed(0)}/s)`);
  console.log(`Succeeded:       ${ok}`);
  console.log(`Errored:         ${errors}`);
  console.log(
    `Latency ms:      p50 ${percentile(latencies, 50)}  ` +
      `p95 ${percentile(latencies, 95)}  p99 ${percentile(latencies, 99)}  ` +
      `max ${latencies[latencies.length - 1] ?? 0}`,
  );

  if (errors > 0) {
    console.log("\nError breakdown:");
    for (const [msg, count] of [...errorSamples.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${count}× ${msg}`);
    }
    console.log(
      "\nConnection errors at this level mean (instances × pool-max) exceeds the " +
        "database's connection cap — lower PG_POOL_MAX, cap Autoscale max instances, " +
        "or move to a larger pooled tier.",
    );
    process.exit(1);
  }
  console.log("\nNo connection errors at peak — connection budget holds.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
