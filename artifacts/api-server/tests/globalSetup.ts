import { execSync } from "node:child_process";
import pg from "pg";

export default async function setup() {
  const sourceUrl =
    process.env["SOURCE_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (!sourceUrl) {
    throw new Error(
      "globalSetup: DATABASE_URL must be set to bootstrap the test database",
    );
  }
  const TEST_DB = process.env["API_TEST_DB_NAME"] ?? "kinectem_api_test";
  const testUrl = sourceUrl.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);

  const testDbName = decodeURIComponent(
    new URL(testUrl).pathname.replace(/^\//, "").split("?")[0],
  );
  const adminUrl = sourceUrl.replace(/\/[^/?]+(\?|$)/, `/postgres$1`);

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [testDbName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
    await admin.query(`CREATE DATABASE "${testDbName}"`);
  } finally {
    await admin.end();
  }

  // Mirror schema from the dev DB into the freshly created test DB. We use
  // pg_dump --schema-only so tests run against an exact copy of the live
  // Drizzle schema without requiring drizzle-kit at test time.
  execSync(
    `pg_dump --schema-only --no-owner --no-privileges "${sourceUrl}" | psql "${testUrl}" -v ON_ERROR_STOP=1 -q -X`,
    { stdio: ["ignore", "ignore", "inherit"], shell: "/bin/bash" },
  );
}
