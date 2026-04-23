import { afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { seedIfEmpty } from "../src/lib/seed";

const ALL_TABLES = [
  "article_tags",
  "highlight_tags",
  "article_authors",
  "highlights",
  "articles",
  "notifications",
  "roster_invites",
  "roster_entries",
  "organization_followers",
  "organization_admins",
  "teams",
  "organizations",
  "sessions",
  "users",
];

beforeEach(async () => {
  await db.execute(
    sql.raw(
      `TRUNCATE TABLE ${ALL_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
    ),
  );
  await seedIfEmpty();
});

afterAll(async () => {
  await pool.end();
});
