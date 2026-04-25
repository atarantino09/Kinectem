import { pgTable, text, integer, timestamp, uuid, pgEnum, boolean, primaryKey, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["athlete", "coach", "admin", "parent"]);
export const rosterRoleEnum = pgEnum("roster_role", ["player", "coach"]);
export const rosterStatusEnum = pgEnum("roster_status", ["pending", "accepted", "declined"]);
export const articleStatusEnum = pgEnum("article_status", ["draft", "pending_approval", "published"]);
export const inviteStatusEnum = pgEnum("invite_status", ["pending", "accepted", "expired", "revoked"]);
export const postKindEnum = pgEnum("post_kind", ["article", "highlight", "org_post"]);
export const orgPostStatusEnum = pgEnum("org_post_status", ["draft", "published"]);
export const reactionTypeEnum = pgEnum("reaction_type", ["like"]);
export const conversationTypeEnum = pgEnum("conversation_type", ["direct", "user_to_org", "org_to_org"]);
export const participantTypeEnum = pgEnum("participant_type", ["user", "organization"]);
export const joinRequestStatusEnum = pgEnum("join_request_status", ["pending", "approved", "declined", "withdrawn"]);
export const tagStatusEnum = pgEnum("tag_status", ["pending", "approved", "declined", "removed"]);
export const assetStatusEnum = pgEnum("asset_status", ["pending", "confirmed"]);
export const reportContentTypeEnum = pgEnum("report_content_type", ["article", "highlight", "org_post", "comment"]);
export const reportStatusEnum = pgEnum("report_status", ["open", "resolved", "dismissed"]);
export const adminActionTypeEnum = pgEnum("admin_action_type", [
  "hide_content",
  "unhide_content",
  "delete_content",
  "resolve_report",
  "dismiss_report",
  "create_user",
  "update_user",
  "soft_delete_user",
  "restore_user",
  "reset_password",
  "masquerade_start",
  "masquerade_stop",
]);
export const adminTargetTypeEnum = pgEnum("admin_target_type", [
  "user",
  "article",
  "highlight",
  "org_post",
  "comment",
  "report",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  name: text("name").notNull(),
  nickname: text("nickname"),
  role: userRoleEnum("role").notNull(),
  sport: text("sport"),
  position: text("position"),
  jerseyNumber: integer("jersey_number"),
  grade: text("grade"),
  location: text("location"),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  dateOfBirth: timestamp("date_of_birth"),
  parentId: uuid("parent_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  guardianEmail: text("guardian_email"),
  guardianConfirmToken: text("guardian_confirm_token"),
  guardianConfirmTokenExpiresAt: timestamp("guardian_confirm_token_expires_at"),
  guardianConfirmedAt: timestamp("guardian_confirmed_at"),
  guardianConfirmedByUserId: uuid("guardian_confirmed_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  guardianExpiredEmailSentAt: timestamp("guardian_expired_email_sent_at"),
  guardianExpiredEmailOptOut: boolean("guardian_expired_email_opt_out")
    .notNull()
    .default(false),
  requireTagConsent: boolean("require_tag_consent").notNull().default(false),
  lastSignInAt: timestamp("last_sign_in_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const passwordResets = pgTable("password_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  masqueradingAsUserId: uuid("masquerading_as_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sport: text("sport"),
  location: text("location"),
  city: text("city"),
  state: text("state"),
  description: text("description"),
  logoUrl: text("logo_url"),
  bannerUrl: text("banner_url"),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const organizationAdmins = pgTable("organization_admins", {
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.organizationId, t.userId] }) }));

export const organizationFollowers = pgTable("organization_followers", {
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.organizationId, t.userId] }) }));

// When a user manually unfollows an organization, we record an opt-out so
// that automatic follow flows (e.g. joining a team in the org) do not silently
// re-follow them. Cleared when the user explicitly follows again.
export const organizationFollowOptouts = pgTable("organization_follow_optouts", {
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  unfollowedAt: timestamp("unfollowed_at").defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.organizationId, t.userId] }) }));

export const userFollowers = pgTable("user_followers", {
  followingUserId: uuid("following_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  followerUserId: uuid("follower_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.followingUserId, t.followerUserId] }) }));

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  season: text("season"),
  sport: text("sport"),
  level: text("level"),
  description: text("description"),
  logoUrl: text("logo_url"),
  bannerUrl: text("banner_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const teamFollowers = pgTable("team_followers", {
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.teamId, t.userId] }) }));

export const rosterEntries = pgTable("roster_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: rosterRoleEnum("role").notNull(),
  status: rosterStatusEnum("status").notNull().default("accepted"),
  position: text("position"),
  jerseyNumber: integer("jersey_number"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const rosterInvites = pgTable("roster_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).notNull(),
  invitedEmail: text("invited_email"),
  invitedName: text("invited_name"),
  role: rosterRoleEnum("role").notNull(),
  position: text("position"),
  jerseyNumber: integer("jersey_number"),
  grade: text("grade"),
  status: inviteStatusEnum("status").notNull().default("pending"),
  invitedById: uuid("invited_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const articles = pgTable("articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).notNull(),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  summary: text("summary"),
  body: text("body").notNull().default(""),
  coverImageUrl: text("cover_image_url"),
  videoUrl: text("video_url"),
  photoUrls: text("photo_urls").array(),
  opponentName: text("opponent_name"),
  teamScore: integer("team_score"),
  opponentScore: integer("opponent_score"),
  gameDate: timestamp("game_date"),
  status: articleStatusEnum("status").notNull().default("published"),
  publishedAt: timestamp("published_at"),
  hiddenAt: timestamp("hidden_at"),
  hiddenByUserId: uuid("hidden_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const articleAuthors = pgTable("article_authors", {
  articleId: uuid("article_id").references(() => articles.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.articleId, t.userId] }) }));

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
  hiddenAt: timestamp("hidden_at"),
  hiddenByUserId: uuid("hidden_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orgPosts = pgTable("org_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  coverImageUrl: text("cover_image_url"),
  videoUrl: text("video_url"),
  photoUrls: text("photo_urls").array(),
  status: orgPostStatusEnum("status").notNull().default("published"),
  publishedAt: timestamp("published_at"),
  hiddenAt: timestamp("hidden_at"),
  hiddenByUserId: uuid("hidden_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const articleTags = pgTable("article_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  articleId: uuid("article_id").references(() => articles.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  taggerUserId: uuid("tagger_user_id").references(() => users.id, { onDelete: "set null" }),
  status: tagStatusEnum("status").notNull().default("approved"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const highlightTags = pgTable("highlight_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  highlightId: uuid("highlight_id").references(() => highlights.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  taggerUserId: uuid("tagger_user_id").references(() => users.id, { onDelete: "set null" }),
  status: tagStatusEnum("status").notNull().default("approved"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const postReactions = pgTable("post_reactions", {
  postKind: postKindEnum("post_kind").notNull(),
  postRefId: uuid("post_ref_id").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  reactionType: reactionTypeEnum("reaction_type").notNull().default("like"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.postKind, t.postRefId, t.userId] }) }));

export const postComments = pgTable("post_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  postKind: postKindEnum("post_kind").notNull(),
  postRefId: uuid("post_ref_id").notNull(),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  deletedAt: timestamp("deleted_at"),
  hiddenAt: timestamp("hidden_at"),
  hiddenByUserId: uuid("hidden_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contentReports = pgTable("content_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterUserId: uuid("reporter_user_id").references(() => users.id, { onDelete: "set null" }),
  contentType: reportContentTypeEnum("content_type").notNull(),
  contentId: uuid("content_id").notNull(),
  reason: text("reason").notNull(),
  note: text("note"),
  status: reportStatusEnum("status").notNull().default("open"),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at"),
  resolvedByUserId: uuid("resolved_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const adminActivityLog = pgTable("admin_activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminUserId: uuid("admin_user_id").references(() => users.id, { onDelete: "set null" }),
  actionType: adminActionTypeEnum("action_type").notNull(),
  targetType: adminTargetTypeEnum("target_type"),
  targetId: uuid("target_id"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: conversationTypeEnum("type").notNull().default("direct"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const conversationParticipants = pgTable("conversation_participants", {
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  participantType: participantTypeEnum("participant_type").notNull(),
  participantId: uuid("participant_id").notNull(),
  lastReadAt: timestamp("last_read_at"),
  leftAt: timestamp("left_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.conversationId, t.participantType, t.participantId] }) }));

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  senderUserId: uuid("sender_user_id").references(() => users.id, { onDelete: "set null" }),
  senderOrgId: uuid("sender_org_id").references(() => organizations.id, { onDelete: "set null" }),
  body: text("body"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  fileName: text("file_name"),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size"),
  url: text("url"),
  status: assetStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messageAssets = pgTable("message_assets", {
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }).notNull(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
  displayOrder: integer("display_order").notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.messageId, t.assetId] }) }));

export const organizationJoinRequests = pgTable("organization_join_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  status: joinRequestStatusEnum("status").notNull().default("pending"),
  decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  link: text("link"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many, one }) => ({
  rosterEntries: many(rosterEntries),
  articleTags: many(articleTags),
  highlightTags: many(highlightTags),
  parent: one(users, { fields: [users.parentId], references: [users.id], relationName: "parent_child" }),
}));

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  teams: many(teams),
  admins: many(organizationAdmins),
  createdBy: one(users, { fields: [organizations.createdById], references: [users.id] }),
  posts: many(orgPosts),
}));

export const orgPostsRelations = relations(orgPosts, ({ one }) => ({
  organization: one(organizations, { fields: [orgPosts.organizationId], references: [organizations.id] }),
  author: one(users, { fields: [orgPosts.authorId], references: [users.id] }),
}));

export const organizationAdminsRelations = relations(organizationAdmins, ({ one }) => ({
  organization: one(organizations, { fields: [organizationAdmins.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [organizationAdmins.userId], references: [users.id] }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  organization: one(organizations, { fields: [teams.organizationId], references: [organizations.id] }),
  rosterEntries: many(rosterEntries),
  articles: many(articles),
  highlights: many(highlights),
  invites: many(rosterInvites),
}));

export const rosterEntriesRelations = relations(rosterEntries, ({ one }) => ({
  team: one(teams, { fields: [rosterEntries.teamId], references: [teams.id] }),
  user: one(users, { fields: [rosterEntries.userId], references: [users.id] }),
}));

export const rosterInvitesRelations = relations(rosterInvites, ({ one }) => ({
  team: one(teams, { fields: [rosterInvites.teamId], references: [teams.id] }),
  invitedBy: one(users, { fields: [rosterInvites.invitedById], references: [users.id] }),
}));

export const articlesRelations = relations(articles, ({ one, many }) => ({
  team: one(teams, { fields: [articles.teamId], references: [teams.id] }),
  author: one(users, { fields: [articles.authorId], references: [users.id] }),
  tags: many(articleTags),
  coAuthors: many(articleAuthors),
}));

export const articleAuthorsRelations = relations(articleAuthors, ({ one }) => ({
  article: one(articles, { fields: [articleAuthors.articleId], references: [articles.id] }),
  user: one(users, { fields: [articleAuthors.userId], references: [users.id] }),
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

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));
