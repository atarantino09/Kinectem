import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ACHIEVEMENT_SETTINGS_SCHEMA_UPGRADE } from "../../../lib/db/src/achievement-settings-schema-upgrade";

// This runs only in the development post-merge setup, never in an API startup
// or deployment build. Publish applies the resulting dev/prod schema diff.
if (process.env.NODE_ENV === "production" || process.argv[2] !== "--development") {
  throw new Error("Achievement schema sync is development-only.");
}
try {
  await db.execute(sql.raw(ACHIEVEMENT_SETTINGS_SCHEMA_UPGRADE));
  console.log("Development achievement settings schema synchronized.");
} finally {
  await pool.end();
}
