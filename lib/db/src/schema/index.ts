import { pgTable, text, integer, timestamp, uuid, pgEnum, boolean, primaryKey, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
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
export const tagSourceEnum = pgEnum("tag_source", ["manual", "auto"]);
export const assetStatusEnum = pgEnum("asset_status", ["pending", "confirmed"]);
export const orgMemberRoleEnum = pgEnum("org_member_role", ["owner", "admin", "member"]);
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
  // Task #472 — Org-owner archive / unarchive of a team. Recorded in
  // admin_activity_log so the org has a paper trail; the route handler
  // writes the row inline (logAdminAction is admin-typed only).
  "archive_team",
  "unarchive_team",
]);
export const adminTargetTypeEnum = pgEnum("admin_target_type", [
  "user",
  "article",
  "highlight",
  "org_post",
  "comment",
  "report",
  // Task #472 — target_type for archive/unarchive_team rows.
  "team",
]);

// Task #359 — COPPA Phase 1. Phase 2 (#363) adds `pending_revocation`
// for guardians who have asked to revoke consent but the grace period
// has not yet expired. Treated like `disabled` for sign-in.
export const accountStatusEnum = pgEnum("account_status", [
  "active",
  "pending_guardian",
  "disabled",
  "pending_revocation",
  // Task #367 — guardian has requested deletion. Account is locked
  // out the same way as `pending_revocation`/`disabled`; the operator
  // hard-delete script (`pnpm --filter @workspace/scripts coppa:delete`)
  // cascades the row removal once the 30-day window completes.
  "pending_deletion",
]);

// Task #367 — Profile visibility tier. Adult accounts default `public`
// (existing behavior); under-13 accounts are forced to `followers` at
// signup so a minor profile and their posts are only retrievable by
// the user themselves, their linked guardian, platform admins, an org
// admin sharing a team with the minor, or a follower whose follow edge
// has been guardian-approved. `private` is reserved for a future
// "guardian locked it down completely" mode.
export const profileVisibilityEnum = pgEnum("profile_visibility", [
  "public",
  "followers",
  "private",
]);

// Task #426 — Per-user visibility tier for the `dateOfBirth` field. The
// overall profile-visibility enum gates the whole profile; this column
// is a separate, narrower control specifically for sharing birthday
// (e.g. an adult who keeps `profileVisibility = public` but only wants
// approved followers to see their birthday). `private` is the default
// for everyone — birthday is only ever visible to self / linked
// guardian / platform admin in that mode. Minor accounts are forced to
// `private` on the server regardless of what is sent.
export const dateOfBirthVisibilityEnum = pgEnum("date_of_birth_visibility", [
  "private",
  "followers",
  "public",
]);

// Task #367 — Status of a photo-of-minor takedown request submitted by
// a guardian. While `pending` the targeted post is hidden from every
// listing.
export const takedownStatusEnum = pgEnum("takedown_status", [
  "pending",
  "approved",
  "declined",
]);

// Task #363 — COPPA Phase 2 gating status used on `user_followers`,
// `post_comments`, `messages` rows where one end of the interaction is
// a minor. `approved` is the existing default and what every adult-side
// row carries (so Phase 2 is invisible for non-minor accounts). New
// minor-targeted writes start `pending` and a guardian flips them to
// `approved` or `declined` from the family dashboard.
export const minorGateStatusEnum = pgEnum("minor_gate_status", [
  "pending",
  "approved",
  "declined",
]);
export const parentalConsentStateEnum = pgEnum("parental_consent_state", [
  "pending_notice",
  "pending_followup",
  "finalized",
  "revoked",
  "expired",
]);
export const consentAuditEventEnum = pgEnum("consent_audit_event", [
  "age_gate_attempt",
  "age_gate_blocked",
  "child_signup",
  "guardian_email_sent",
  "guardian_notice_viewed",
  "guardian_first_consent",
  "guardian_followup_sent",
  "guardian_finalized",
  "guardian_revoked",
  "minor_blocked_action",
  "exif_stripped",
  "deletion_scheduled",
  // Task #363 — COPPA Phase 2 events.
  "child_pending_follow",
  "child_pending_dm",
  "child_pending_comment",
  "child_pending_tag",
  "guardian_approved_follow",
  "guardian_declined_follow",
  "guardian_approved_dm",
  "guardian_declined_dm",
  "guardian_approved_comment",
  "guardian_declined_comment",
  "guardian_approved_tag",
  "guardian_declined_tag",
  "guardian_dm_allowlist_add",
  "guardian_dm_allowlist_remove",
  "guardian_data_exported",
  "guardian_revoke_requested",
  "guardian_consent_regranted",
  // Task #367 — COPPA Phase 3 launch readiness events.
  "guardian_deletion_requested",
  "guardian_data_deleted",
  "guardian_takedown_requested",
  "guardian_takedown_approved",
  "guardian_takedown_declined",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull(),
  sport: text("sport"),
  position: text("position"),
  jerseyNumber: integer("jersey_number"),
  grade: text("grade"),
  location: text("location"),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  // Task #349 — Optional city / US state on a user profile. `state` is
  // stored as a 2-letter postal code (50 states + DC), mirroring the
  // shape used by organizations. Both columns are nullable; existing
  // users without a location simply have NULL on both fields.
  city: text("city"),
  state: text("state"),
  dateOfBirth: timestamp("date_of_birth"),
  parentId: uuid("parent_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  guardianEmail: text("guardian_email"),
  // Task #32 — Guardian-confirmation tokens are stored as SHA-256
  // hashes (`hashToken(raw)` in `lib/passwords.ts`). The raw value
  // exists only inside the email we send the parent. Looking up a
  // confirmation request requires hashing the submitted token first.
  guardianConfirmTokenHash: text("guardian_confirm_token_hash"),
  guardianConfirmTokenExpiresAt: timestamp("guardian_confirm_token_expires_at"),
  guardianConfirmedAt: timestamp("guardian_confirmed_at"),
  guardianConfirmedByUserId: uuid("guardian_confirmed_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  guardianExpiredEmailSentAt: timestamp("guardian_expired_email_sent_at"),
  guardianExpiredEmailOptOut: boolean("guardian_expired_email_opt_out")
    .notNull()
    .default(false),
  // Task #359 — COPPA Phase 1.
  // `isMinor` is true when the account belongs to a user under 13. Stored
  // as a snapshot at signup time (we don't recompute on every request).
  isMinor: boolean("is_minor").notNull().default(false),
  // `accountStatus` gates sign-in. `pending_guardian` means signup
  // happened but verifiable parental consent isn't finalized yet;
  // `disabled` means a guardian revoked consent (account is frozen but
  // not deleted, awaiting review).
  accountStatus: accountStatusEnum("account_status")
    .notNull()
    .default("active"),
  consentFinalizedAt: timestamp("consent_finalized_at"),
  consentRevokedAt: timestamp("consent_revoked_at"),
  // Task #367 — COPPA Phase 3.
  // Profile-visibility tier — `public` for adults, `followers` for
  // minors (set at signup time so an adult who later flips a child
  // visibility back to public has a single column to flip).
  profileVisibility: profileVisibilityEnum("profile_visibility")
    .notNull()
    .default("public"),
  // Task #426 — Per-field visibility for `dateOfBirth`. Defaults to
  // `private` for every account; minors are forced to `private` on the
  // server even if a different value is sent. See `dateOfBirthVisibilityEnum`
  // for the full discussion.
  dateOfBirthVisibility: dateOfBirthVisibilityEnum("date_of_birth_visibility")
    .notNull()
    .default("private"),
  // Stamped when a guardian (or the user themselves) submits a
  // right-to-delete request. The hard-delete script keys off this
  // column once the cooling-off window passes.
  deletionRequestedAt: timestamp("deletion_requested_at"),
  // COPPA Phase 1 (task #359) — when a guardian revokes consent we
  // disable the account immediately and set this timestamp 30 days
  // out. The Phase-1 deliverable wires only the schedule + audit
  // event; the actual purge worker is tracked separately so the data
  // isn't dropped before a human reviews edge cases (linked guardian
  // accounts, in-flight team transfers, etc).
  deletionScheduledAt: timestamp("deletion_scheduled_at"),
  // Per-recipient opt-out for the in-app "X shared your recap" bell
  // notification (task #167). Default false → recap authors get bell-
  // notified on every fresh share. Set true → POST /posts/:postId/share
  // skips the insert for this user. Mirrors guardianExpiredEmailOptOut.
  shareNotificationsOptOut: boolean("share_notifications_opt_out")
    .notNull()
    .default(false),
  requireTagConsent: boolean("require_tag_consent").notNull().default(false),
  // Task #520 — Adult-only "private account" toggle. When true, new
  // incoming follow edges land as `pending` (same enum + column used
  // by the COPPA minor-gating flow) and the followed user reviews
  // them from /follow-requests. Minors are forced to false; the
  // toggle is hidden in the client and rejected server-side.
  requiresFollowApproval: boolean("requires_follow_approval")
    .notNull()
    .default(false),
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

// Task #355 — Refresh tokens for the bearer-token auth flow used by the
// mobile app and other non-browser clients. Issued by `POST /auth/token`,
// rotated by `POST /auth/refresh`, and revoked by `POST /auth/logout`.
// The plaintext token is never stored — only its sha256 hash (same scheme
// used for password-reset and guardian tokens). Cookie sessions remain
// the only storage for browser logins; this table is purely additive.
export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  // Optional human label the client can pass at issue time (e.g. an
  // iPhone model or app version) so a future "active sessions" UI can
  // tell devices apart. Not surfaced anywhere yet.
  deviceLabel: text("device_label"),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  lastUsedAt: timestamp("last_used_at"),
});

// Task #358 — Long-lived API keys for third-party developer integrations.
// Plaintext keys are issued exactly once at create time and never stored
// (only their sha256 hash). Keys are presented as
// `Authorization: Bearer <key>` and distinguished from short-lived access
// tokens by the leading `kk_` prefix. The `prefix` column stores the
// first ~12 characters so the dev portal can render a recognizable
// fingerprint (e.g. "kk_live_a1b2…") on the listing page without ever
// touching the secret tail.
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  // Free-form scope labels (e.g. "read", "write"). Stored so a future
  // scope-aware authorization layer has the data it needs; the current
  // server treats every non-revoked key as full-access on the owner's
  // behalf, identical to a bearer access token.
  scopes: text("scopes").array().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sport: text("sport"),
  location: text("location"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  description: text("description"),
  // Task #290 — Org website. Stored as a normalized URL (always
  // http:// or https://). Bare domains entered by the user are
  // promoted to https:// before being persisted.
  website: text("website"),
  logoUrl: text("logo_url"),
  bannerUrl: text("banner_url"),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Despite the legacy table name, this records every member of an
// organization — owners and admins (who can manage the org) as well as
// regular members who joined without manage privileges. The `role`
// column is the source of truth; `canManageOrganization` filters to
// owner/admin. Each org has exactly one row with role 'owner'.
export const organizationAdmins = pgTable("organization_admins", {
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: orgMemberRoleEnum("role").notNull().default("admin"),
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
  // Task #363 — COPPA Phase 2 minor-gating. Adult-to-adult follows are
  // always 'approved'. Follows whose `followingUserId` is a minor start
  // 'pending' until the linked guardian approves or declines from the
  // family dashboard. `decidedByGuardianId` + `decidedAt` are stamped
  // on transition out of `pending`.
  moderationStatus: minorGateStatusEnum("moderation_status")
    .notNull()
    .default("approved"),
  decidedByGuardianId: uuid("decided_by_guardian_id").references(
    (): AnyPgColumn => users.id,
    { onDelete: "set null" },
  ),
  decidedAt: timestamp("decided_at"),
}, (t) => ({ pk: primaryKey({ columns: [t.followingUserId, t.followerUserId] }) }));

// Task #504 — Per-user sports list backing the multi-select picker on
// EditProfileDialog (Task #500). Self-only on read + write at the
// route layer; the composite primary key is the natural dedupe so no
// surrogate id and no separate unique index are needed.
export const userSports = pgTable("user_sports", {
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  sport: text("sport").notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.sport] }) }));

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  season: text("season"),
  sport: text("sport"),
  level: text("level"),
  gender: text("gender"),
  description: text("description"),
  // Task #293 — Optional team website / link. Stored as a normalized
  // URL (always http:// or https://). Bare domains entered by the user
  // are promoted to https:// before being persisted.
  website: text("website"),
  logoUrl: text("logo_url"),
  bannerUrl: text("banner_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Task #472 — Soft "archive" state. `archivedAt IS NOT NULL` is the
  // archived flag; `archivedByUserId` records the org owner who took
  // the action. Hidden from non-managers on every read/discovery
  // surface; writes (new posts/invites/follows) are blocked.
  archivedAt: timestamp("archived_at"),
  archivedByUserId: uuid("archived_by_user_id").references(
    (): AnyPgColumn => users.id,
    { onDelete: "set null" },
  ),
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
  invitedById: uuid("invited_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Task #541 — Email/admin invites at the organization level. Mirrors
// rosterInvites but for org membership (not team roster). Token is
// hashed at rest (`hashToken`); raw token only ever leaves the server
// in the invitee's email. The DB enum reuses `invite_status`; we map
// the wire "withdrawn" state to DB "revoked" at the route boundary,
// matching the team-roster invite convention.
export const organizationInvites = pgTable("organization_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  invitedById: uuid("invited_by_id").references(() => users.id, { onDelete: "set null" }),
  invitedEmail: text("invited_email").notNull(),
  role: orgMemberRoleEnum("role").notNull().default("admin"),
  note: text("note"),
  tokenHash: text("token_hash").notNull().unique(),
  status: inviteStatusEnum("status").notNull().default("pending"),
  resolvedUserId: uuid("resolved_user_id").references(() => users.id, { onDelete: "set null" }),
  withdrawnAt: timestamp("withdrawn_at"),
  acceptedAt: timestamp("accepted_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  // Task #510 — nullable to support "Just my profile" highlights that
  // are scoped to the uploader only (no team / org). Read paths must
  // use leftJoin against `teams` and treat null team/org as a
  // user-context post.
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
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
  source: tagSourceEnum("source").notNull().default("manual"),
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

// Re-shares of game-recap articles or highlights to the sharer's
// own profile/feed. Polymorphic over (postKind, postRefId) — only
// `article` and `highlight` are valid at write time; org posts
// are rejected at the API layer per task #190. (postKind,
// postRefId, sharerUserId) is unique so toggling acts idempotently
// and a user can only share each post once.
export const postShares = pgTable("post_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  postKind: postKindEnum("post_kind").notNull(),
  postRefId: uuid("post_ref_id").notNull(),
  sharerUserId: uuid("sharer_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqPostSharer: uniqueIndex("post_shares_kind_ref_sharer_uniq").on(t.postKind, t.postRefId, t.sharerUserId),
}));

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
  // Task #363 — COPPA Phase 2: comments left by adults on a minor-owned
  // post start `pending` until the minor's guardian approves them. Other
  // comments default to `approved` so non-minor flows are unaffected.
  moderationStatus: minorGateStatusEnum("moderation_status")
    .notNull()
    .default("approved"),
  decidedByGuardianId: uuid("decided_by_guardian_id").references(
    (): AnyPgColumn => users.id,
    { onDelete: "set null" },
  ),
  decidedAt: timestamp("decided_at"),
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
  // Task #363 — COPPA Phase 2: messages whose recipient is a minor (and
  // whose sender is not on that minor's DM allowlist) start `pending`
  // until the linked guardian approves. Adult↔adult messages keep the
  // `approved` default so existing conversations are unaffected.
  moderationStatus: minorGateStatusEnum("moderation_status")
    .notNull()
    .default("approved"),
  decidedByGuardianId: uuid("decided_by_guardian_id").references(
    (): AnyPgColumn => users.id,
    { onDelete: "set null" },
  ),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Task #363 — DM allowlist for minor accounts. When `(childId, otherId)`
// is present, messages from `otherId` to the child bypass guardian
// approval and land directly in the conversation. The guardian is the
// only one who can add/remove entries; the minor cannot self-allow.
export const dmAllowlist = pgTable(
  "dm_allowlist",
  {
    childUserId: uuid("child_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    counterpartyUserId: uuid("counterparty_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedByGuardianId: uuid("added_by_guardian_id").references(
      (): AnyPgColumn => users.id,
      { onDelete: "set null" },
    ),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.childUserId, t.counterpartyUserId] }),
  }),
);

// Task #367 — COPPA Phase 3 photo-of-minor takedown queue. A guardian
// flags an article or highlight that contains an unapproved image of
// their child; while `status='pending'` the post is hidden from every
// listing and 404s on direct fetch (except for the requesting guardian
// and platform admins, who can resolve it). `status` transitions to
// `approved` (post stays hidden + tag(s) torn down) or `declined`
// (post becomes visible again). `postKind` is restricted to
// `article|highlight` at the API layer (org_post takedowns are out of
// scope for the launch-readiness MVP).
export const takedownRequests = pgTable("takedown_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  childUserId: uuid("child_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  requestedByGuardianId: uuid("requested_by_guardian_id").references(
    (): AnyPgColumn => users.id,
    { onDelete: "set null" },
  ),
  postKind: postKindEnum("post_kind").notNull(),
  postRefId: uuid("post_ref_id").notNull(),
  reason: text("reason"),
  status: takedownStatusEnum("status").notNull().default("pending"),
  decidedByUserId: uuid("decided_by_user_id").references(
    (): AnyPgColumn => users.id,
    { onDelete: "set null" },
  ),
  decidedAt: timestamp("decided_at"),
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

// Task #535 — Fan photo album entries attached to a post. Polymorphic
// over (postKind, postRefId) to match the existing post_comments /
// post_shares / post_reactions convention so the client can keep
// passing the prefixed post id (`article-<uuid>`, `highlight-<uuid>`,
// `orgpost-<uuid>`) and the server `parsePostId`s it at the boundary.
// Each row points at a confirmed `assets` row (the actual image bytes)
// and records the uploader's display name + optional caption.
// `uploaderUserId` is nullable so an unauthenticated future flow can
// still post (today's implementation always populates it from the
// session).
export const albumPhotos = pgTable("album_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  postKind: postKindEnum("post_kind").notNull(),
  postRefId: uuid("post_ref_id").notNull(),
  uploaderUserId: uuid("uploader_user_id").references(() => users.id, { onDelete: "set null" }),
  uploaderName: text("uploader_name").notNull(),
  caption: text("caption").notNull().default(""),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  // Optional actor — recorded so we can dispatch destructive actions from
  // the family dashboard (e.g. delete the matching follow / like row when
  // a parent removes a follow/like notification on their child's behalf).
  // Existing notification kinds that never had an actor remain NULL here.
  actorUserId: uuid("actor_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Per-child soft-hide for an individual message. Used when a parent
// removes a `message:<id>` from the family dashboard: the message stays
// in the database (and visible to the sender), but disappears from the
// child's conversation view.
export const messageChildHides = pgTable(
  "message_child_hides",
  {
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }).notNull(),
    childId: uuid("child_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    hiddenByUserId: uuid("hidden_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    hiddenAt: timestamp("hidden_at").defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.messageId, t.childId] }) }),
);

// Per-parent read state for the unified "child notifications" stream on
// /family. Items in that stream are aggregated on the fly from many tables
// (notifications, article_tags, post_comments, messages, roster_entries),
// so they share no single primary key. The parent's seen-state is keyed by
// a composite (parentId, childId, itemKey) where itemKey is "<kind>:<id>"
// (e.g. "tag:<articleTagId>"). The child's own read flags are unaffected.
export const parentChildNotificationReads = pgTable(
  "parent_child_notification_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    childId: uuid("child_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    itemKey: text("item_key").notNull(),
    readAt: timestamp("read_at").defaultNow().notNull(),
    // Optional Approve/Remove decision the parent made on this item.
    // NULL means the row was created by the legacy "mark as seen" path
    // (which still satisfies the read overlay and the unread bell count).
    // "approved" / "removed" carry the parent's explicit verdict so we can
    // surface the badge briefly on the family dashboard and keep the item
    // out of the default feed on subsequent fetches.
    decision: text("decision"),
    decidedAt: timestamp("decided_at"),
    // Snapshot of the underlying source row's status at the moment the
    // decision was recorded. Today only used by `tag` items: if a
    // highlight or article tag was already `approved` (auto-approved
    // for a child with `requireTagConsent = false`, or approved earlier
    // by the child / parent) when the parent hits Remove, we capture
    // "approved" here so an Undo can restore it to `approved` instead
    // of demoting it back to `pending`. Other kinds leave this NULL.
    priorStatus: text("prior_status"),
  },
  (t) => ({
    uniq: uniqueIndex("pc_notif_reads_parent_child_key_unique").on(
      t.parentId,
      t.childId,
      t.itemKey,
    ),
  }),
);

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

// ---------------------------------------------------------------------------
// Task #359 — COPPA Phase 1: parental consent records + audit log.
// ---------------------------------------------------------------------------
//
// `parentalConsents` is one row per consent ceremony (a fresh attempt by a
// guardian). It snapshots the exact notice text shown so we can prove later
// what the parent agreed to. The "email-plus" verifiable consent flow walks
// the row through pending_notice → pending_followup → finalized; revoke
// flips it to revoked and disables the child's account.
export const parentalConsents = pgTable("parental_consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  childUserId: uuid("child_user_id")
    .notNull()
    .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
  guardianEmail: text("guardian_email").notNull(),
  guardianUserId: uuid("guardian_user_id").references(
    (): AnyPgColumn => users.id,
    { onDelete: "set null" },
  ),
  state: parentalConsentStateEnum("state").notNull().default("pending_notice"),
  // FTC verifiable parental consent method actually used for this row.
  // Phase 1 only ships "email-plus" (a second emailed action), but this
  // column lets us add credit-card / signed-form / video-call methods
  // later without losing legal traceability of older records.
  method: text("method").notNull().default("email-plus"),
  noticeVersion: text("notice_version").notNull(),
  noticeText: text("notice_text").notNull(),
  // First-step token: the link in the original guardian email. Single-use
  // sha256 hash. Cleared once the guardian completes the notice + checkbox.
  firstTokenHash: text("first_token_hash").unique(),
  firstTokenExpiresAt: timestamp("first_token_expires_at"),
  firstConsentAt: timestamp("first_consent_at"),
  firstConsentIp: text("first_consent_ip"),
  // Follow-up token: emailed after a short delay so the guardian must take
  // a second action from a different email (FTC "email plus"). Independent
  // hash + expiry from the first.
  followupTokenHash: text("followup_token_hash").unique(),
  followupTokenExpiresAt: timestamp("followup_token_expires_at"),
  followupSentAt: timestamp("followup_sent_at"),
  finalizedAt: timestamp("finalized_at"),
  finalizedIp: text("finalized_ip"),
  // Revocation token: emailed at finalize time so the guardian can revoke
  // any time without logging in. Stored as a sha256 hash; never expires.
  revokeTokenHash: text("revoke_token_hash").unique(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Task #543 — Founding 100 signup capture. Standalone table for the
// marketing site's "Join the Founding 100" CTA. No FK to users — these
// are pre-launch prospects, not platform accounts. Email is stored
// lower-cased + unique so a re-submit updates the existing row instead
// of creating a duplicate.
export const foundingSignups = pgTable("founding_signups", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgName: text("org_name").notNull(),
  adminName: text("admin_name").notNull(),
  adminEmail: text("admin_email").notNull().unique(),
  roleTitle: text("role_title").notNull(),
  estimatedTeams: integer("estimated_teams").notNull(),
  estimatedPlayers: integer("estimated_players").notNull(),
  sport: text("sport"),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Append-only audit log for every consent-relevant event. Used to satisfy
// the FTC requirement that the operator retain proof of consent and to
// give parents a transparent history.
export const consentAuditLog = pgTable("consent_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  childUserId: uuid("child_user_id").references(
    (): AnyPgColumn => users.id,
    { onDelete: "set null" },
  ),
  consentId: uuid("consent_id").references(
    (): AnyPgColumn => parentalConsents.id,
    { onDelete: "set null" },
  ),
  event: consentAuditEventEnum("event").notNull(),
  actorEmail: text("actor_email"),
  actorIp: text("actor_ip"),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
