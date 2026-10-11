import { pgTable, uuid, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { users, articles } from "./index";

// Keep a tombstone when an article is deleted: an old retry must not recreate it.
export const recapCreationRequests = pgTable("recap_creation_requests", {
  actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestKey: text("request_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.actorId, t.requestKey] })]);
