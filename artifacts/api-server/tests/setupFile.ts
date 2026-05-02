import { afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { seedIfEmpty } from "../src/lib/seed";
import { resetAllRateLimits } from "../src/middlewares/rate-limit";

const ALL_TABLES = [
  "parent_child_notification_reads",
  "article_tags",
  "highlight_tags",
  "article_authors",
  "highlights",
  "articles",
  "messages",
  "conversation_participants",
  "conversations",
  "notifications",
  "roster_invites",
  "roster_entries",
  "organization_followers",
  "organization_admins",
  "teams",
  "organizations",
  "message_assets",
  "assets",
  "api_keys",
  "refresh_tokens",
  "sessions",
  "users",
];

beforeEach(async () => {
  resetAllRateLimits();
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
