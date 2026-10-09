import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { users, teams } from "./index";

/** Receipts for a parent's creation intent, not a name-based identity index. */
export const familyPlayerSetups = pgTable("family_player_setups", {
  parentId: uuid("parent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull(),
  childId: uuid("child_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  nameKey: text("name_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.parentId, t.requestId] })]);

export const insertFamilyPlayerSetupSchema = createInsertSchema(familyPlayerSetups).omit({ createdAt: true });
export type FamilyPlayerSetup = typeof familyPlayerSetups.$inferSelect;
export type InsertFamilyPlayerSetup = typeof familyPlayerSetups.$inferInsert;
