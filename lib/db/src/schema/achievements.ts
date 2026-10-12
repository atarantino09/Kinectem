import { pgTable, text, uuid, timestamp, boolean, integer, date, primaryKey, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users, teams, organizations, articles } from "./index";

export const achievementRollout = pgTable("achievement_rollout", {
  id: boolean("id").primaryKey().default(true),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  backfillDone: boolean("backfill_done").notNull().default(false),
// Explicit comparison keeps the constraint expression round-trippable by
// schema introspection/diff tools; a bare boolean column can be double-wrapped.
}, (t) => [check("achievement_rollout_id_check", sql`${t.id} = true`)]);
export const achievementContributions = pgTable("achievement_contributions", {
  kind: text("kind").notNull(), refId: uuid("ref_id").notNull(),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  category: text("category").notNull(), eligibleAt: timestamp("eligible_at", { withTimezone: true }).notNull(),
  personalEligible: boolean("personal_eligible").notNull().default(false),
  backfilled: boolean("backfilled").notNull().default(false),
  orgAttributionCaptured: boolean("org_attribution_captured").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.kind, t.refId] }),
  index("achievement_contributions_team").on(t.teamId),
  index("achievement_contributions_author").on(t.authorId),
  index("achievement_contributions_org").on(t.organizationId)]);
export const achievementAwards = pgTable("achievement_awards", {
  subject: text("subject").notNull(), subjectId: uuid("subject_id").notNull(), key: text("key").notNull(),
  tier: integer("tier").notNull(), threshold: integer("threshold").notNull(),
  earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
  celebrated: boolean("celebrated").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.subject, t.subjectId, t.key, t.tier] })]);
export const achievementSettings = pgTable("achievement_settings", {
  subject: text("subject").notNull(), subjectId: uuid("subject_id").notNull(),
  visibility: text("visibility").notNull().default("public"),
  featured: text("featured").array().notNull().default(sql`'{}'::text[]`),
}, (t) => [primaryKey({ columns: [t.subject, t.subjectId] }),
  check("achievement_settings_visibility_check", sql`${t.visibility} IN ('private','public')`)]);
export const achievementStreaks = pgTable("achievement_streaks", {
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  contributorId: text("contributor_id").notNull(),
  currentCount: integer("current_count").notNull().default(0), best: integer("best").notNull().default(0),
  lastDay: date("last_day"), deadline: timestamp("deadline", { withTimezone: true }),
  paused: boolean("paused").notNull().default(false), resumed: boolean("resumed").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.teamId, t.contributorId] })]);
export const achievementStreakEvents = pgTable("achievement_streak_events", {
  articleId: uuid("article_id").primaryKey().references(() => articles.id, { onDelete: "cascade" }),
});
export const achievementPauses = pgTable("achievement_pauses", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  attestedBy: uuid("attested_by").references(() => users.id, { onDelete: "set null" }),
  attestedAt: timestamp("attested_at", { withTimezone: true }).notNull().defaultNow(),
});
