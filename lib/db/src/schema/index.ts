import { pgTable, text, integer, timestamp, uuid, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["athlete", "coach", "admin"]);
export const rosterRoleEnum = pgEnum("roster_role", ["player", "coach"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull(),
  sport: text("sport"),
  position: text("position"),
  jerseyNumber: integer("jersey_number"),
  grade: text("grade"),
  location: text("location"),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sport: text("sport"),
  location: text("location"),
  description: text("description"),
  logoUrl: text("logo_url"),
  bannerUrl: text("banner_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  season: text("season"),
  sport: text("sport"),
  level: text("level"),
  logoUrl: text("logo_url"),
  bannerUrl: text("banner_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const rosterEntries = pgTable("roster_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: rosterRoleEnum("role").notNull(),
  position: text("position"),
  jerseyNumber: integer("jersey_number"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const articles = pgTable("articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).notNull(),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  summary: text("summary"),
  body: text("body").notNull(),
  coverImageUrl: text("cover_image_url"),
  opponentName: text("opponent_name"),
  teamScore: integer("team_score"),
  opponentScore: integer("opponent_score"),
  gameDate: timestamp("game_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const highlights = pgTable("highlights", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).notNull(),
  articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
  uploaderId: uuid("uploader_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  videoUrl: text("video_url").notNull().default(""),
  thumbnailUrl: text("thumbnail_url"),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const articleTags = pgTable("article_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  articleId: uuid("article_id").references(() => articles.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
});

export const highlightTags = pgTable("highlight_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  highlightId: uuid("highlight_id").references(() => highlights.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  rosterEntries: many(rosterEntries),
  articleTags: many(articleTags),
  highlightTags: many(highlightTags),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  teams: many(teams),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  organization: one(organizations, { fields: [teams.organizationId], references: [organizations.id] }),
  rosterEntries: many(rosterEntries),
  articles: many(articles),
  highlights: many(highlights),
}));

export const rosterEntriesRelations = relations(rosterEntries, ({ one }) => ({
  team: one(teams, { fields: [rosterEntries.teamId], references: [teams.id] }),
  user: one(users, { fields: [rosterEntries.userId], references: [users.id] }),
}));

export const articlesRelations = relations(articles, ({ one, many }) => ({
  team: one(teams, { fields: [articles.teamId], references: [teams.id] }),
  author: one(users, { fields: [articles.authorId], references: [users.id] }),
  tags: many(articleTags),
}));

export const highlightsRelations = relations(highlights, ({ one, many }) => ({
  team: one(teams, { fields: [highlights.teamId], references: [teams.id] }),
  uploader: one(users, { fields: [highlights.uploaderId], references: [users.id] }),
  tags: many(highlightTags),
}));

export const articleTagsRelations = relations(articleTags, ({ one }) => ({
  article: one(articles, { fields: [articleTags.articleId], references: [articles.id] }),
  user: one(users, { fields: [articleTags.userId], references: [users.id] }),
}));

export const highlightTagsRelations = relations(highlightTags, ({ one }) => ({
  highlight: one(highlights, { fields: [highlightTags.highlightId], references: [highlights.id] }),
  user: one(users, { fields: [highlightTags.userId], references: [users.id] }),
}));
