import { pgTable, text, integer, timestamp, date, uuid, pgEnum, boolean, primaryKey, uniqueIndex, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["athlete", "coach", "admin", "parent"]);
export const rosterRoleEnum = pgEnum("roster_role", ["player", "coach"]);
export const rosterStatusEnum = pgEnum("roster_status", ["pending", "accepted", "declined"]);
export const articleStatusEnum = pgEnum("article_status", ["draft", "pending_approval", "published"]);
export const inviteStatusEnum = pgEnum("invite_status", ["pending", "accepted", "expired", "revoked"]);
export const postKindEnum = pgEnum("post_kind", ["article", "highlight", "org_post"]);
export const orgPostStatusEnum = pgEnum("org_post_status", ["draft", "published"]);
export const highlightApprovalStatusEnum = pgEnum("highlight_approval_status", ["pending", "approved", "declined"]);
export const reactionTypeEnum = pgEnum("reaction_type", ["like"]);
export const conversationTypeEnum = pgEnum("conversation_type", ["direct", "user_to_org", "org_to_org"]);
export const participantTypeEnum = pgEnum("participant_type", ["user", "organization"]);
export const joinRequestStatusEnum = pgEnum("join_request_status", ["pending", "approved", "declined", "withdrawn"]);
export const orgClaimStatusEnum = pgEnum("org_claim_status", ["pending", "approved", "declined"]);
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
}, (t) => ({
  // Task #592 — trigram GIN indexes back the `ilike '%q%'` name/email
  // matches in cross-entity search so they stop scanning the whole
  // table. Requires the `pg_trgm` extension (created in the migration).
  nameTrgmIdx: index("users_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  emailTrgmIdx: index("users_email_trgm_idx").using("gin", sql`${t.email} gin_trgm_ops`),
}));

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
  // Task #610 — Per-org secret claim-invite token. Stored in plaintext
  // (like a shareable invite link, NOT a password) so the admin screen +
  // CSV can re-display it on demand for re-sending. Only ever issued for
  // ownerless (bulk-imported) pages; possessing the link is the
  // authorization to become the page owner. Nullable: orgs created the
  // normal way (with an owner) never get one.
  claimToken: text("claim_token"),
  // Operator outreach tracking for the admin claim-links screen — set when
  // the operator has messaged the org (e.g. on Facebook) to invite them to
  // claim their page. Nullable timestamp: NULL = not yet messaged. Operator
  // bookkeeping only; not exposed on any public org payload.
  outreachMessagedAt: timestamp("outreach_messaged_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // Task #592 — trigram GIN index for `ilike '%q%'` org-name search.
  nameTrgmIdx: index("organizations_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  // Task #610 — unique secret claim token; partial so the many orgs
  // without a token don't collide on NULL.
  claimTokenIdx: uniqueIndex("organizations_claim_token_idx")
    .on(t.claimToken)
    .where(sql`${t.claimToken} IS NOT NULL`),
}));

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
  // Task #548 — Per-user dismissal of the org setup checklist card.
  // NULL = checklist is shown on the org dashboard for this user;
  // non-NULL = user dismissed it at this time. Re-opening clears it.
  dismissedSetupAt: timestamp("dismissed_setup_at"),
}, (t) => ({
  pk: primaryKey({ columns: [t.organizationId, t.userId] }),
  // Task #592 — PK leads with organization_id, so "orgs this user
  // manages" lookups need an index on user_id.
  userIdIdx: index("organization_admins_user_id_idx").on(t.userId),
}));

export const organizationFollowers = pgTable("organization_followers", {
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.organizationId, t.userId] }),
  // Task #592 — PK leads with organization_id; the feed fan-in needs
  // "orgs this user follows" keyed by user_id.
  userIdIdx: index("organization_followers_user_id_idx").on(t.userId),
}));

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
}, (t) => ({
  pk: primaryKey({ columns: [t.followingUserId, t.followerUserId] }),
  // Task #592 — PK leads with following_user_id; the feed needs "users
  // this user follows" keyed by follower_user_id.
  followerUserIdIdx: index("user_followers_follower_user_id_idx").on(t.followerUserId),
}));

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
  // Task #628 — nullable to support "solo teams" created by visiting coaches
  // through the tournament signup funnel. A solo team has NO organization
  // (`organization_id IS NULL`) and is managed by its `createdById` owner +
  // their coach roster entry. A real org can later adopt the team, which
  // sets `organization_id` (reparenting) and unlocks full features. Audit
  // any path that assumes a team always has an org (permissions, queries,
  // serializers, feed joins) and handle the null case.
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  // Task #628 — the user who created the team. For solo teams this is the
  // owner/manager (the visiting coach). Org-created teams may also stamp it.
  createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
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
  // Phase 2 — unguessable capability token for the team's read-only iCal
  // (.ics) subscription feed. NULL until first generated; coach/admin can
  // rotate it to revoke existing calendar subscriptions. The token alone
  // identifies the team on the public feed endpoint, so it must stay secret.
  scheduleFeedToken: text("schedule_feed_token").unique(),
  // Unguessable one-time capability token for the "invite your club to adopt
  // this team" link. A solo team's coach generates it and shares it with their
  // org admin, who opens `/adopt-team/<token>` and reparents the team into one
  // of their organizations. NULL until first generated; cleared on successful
  // adoption (one-time) and rotatable by the coach to revoke an outstanding
  // link. The token alone authorizes resolving the team on the public landing
  // page, so it must stay secret.
  adoptToken: text("adopt_token"),
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
}, (t) => ({
  // Task #592 — FK index for team→org joins (every team read path) and
  // a trigram GIN index for `ilike '%q%'` team-name search.
  organizationIdIdx: index("teams_organization_id_idx").on(t.organizationId),
  nameTrgmIdx: index("teams_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  adoptTokenIdx: uniqueIndex("teams_adopt_token_idx")
    .on(t.adoptToken)
    .where(sql`${t.adoptToken} IS NOT NULL`),
}));

export const teamFollowers = pgTable("team_followers", {
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.teamId, t.userId] }),
  // Task #592 — PK leads with team_id, so "teams this user follows"
  // (feed fan-in) needs its own index on user_id.
  userIdIdx: index("team_followers_user_id_idx").on(t.userId),
}));

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
}, (t) => ({
  // Task #592 — both FKs are filtered on hot paths: team_id on team
  // roster reads, user_id on "this user's teams" profile reads.
  teamIdIdx: index("roster_entries_team_id_idx").on(t.teamId),
  userIdIdx: index("roster_entries_user_id_idx").on(t.userId),
}));

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
}, (t) => ({
  // Task #592 — pending org invites are listed per org and looked up by
  // invitee email on accept.
  organizationIdIdx: index("organization_invites_organization_id_idx").on(t.organizationId),
  invitedEmailIdx: index("organization_invites_invited_email_idx").on(t.invitedEmail),
}));

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
}, (t) => ({
  // Task #592 — pending roster invites are listed per team and looked
  // up by invitee email when matching an invite to a signing-up user.
  teamIdIdx: index("roster_invites_team_id_idx").on(t.teamId),
  invitedEmailIdx: index("roster_invites_invited_email_idx").on(t.invitedEmail),
}));

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
  // Distinguishes a combined season/tournament recap (woven from many
  // game recaps) from a normal single-game recap. NULL = single game;
  // "combined" = multi-game recap. Drives a distinct post card pill.
  recapKind: text("recap_kind"),
  status: articleStatusEnum("status").notNull().default("published"),
  publishedAt: timestamp("published_at"),
  hiddenAt: timestamp("hidden_at"),
  hiddenByUserId: uuid("hidden_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // Task #592 — FK indexes: team_id (feed/team/org joins) and author_id
  // (profile "my recaps" + feed author fan-in).
  teamIdIdx: index("articles_team_id_idx").on(t.teamId),
  authorIdIdx: index("articles_author_id_idx").on(t.authorId),
  statusAuthorTeamIdx: index("articles_status_author_team_idx").on(
    t.status,
    t.authorId,
    t.teamId,
  ),
}));

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
  // Task #559 — highlights uploaded by players/parents enter "pending"
  // and stay hidden from public read paths until a staff member
  // (org admin, head/assistant coach, manager, or "author") approves
  // them. Highlights uploaded by staff are created as "approved" so
  // the existing publish-immediately behavior is preserved.
  approvalStatus: highlightApprovalStatusEnum("approval_status").notNull().default("approved"),
  approvedAt: timestamp("approved_at"),
  approvedByUserId: uuid("approved_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // Task #592 — FK indexes: team_id (feed/team/org joins) and
  // uploader_id (profile "my highlights" + feed uploader fan-in). The
  // existing `highlights_team_pending_idx` is a partial index for the
  // approval queue only; this is the general-purpose team_id index.
  teamIdIdx: index("highlights_team_id_idx").on(t.teamId),
  uploaderIdIdx: index("highlights_uploader_id_idx").on(t.uploaderId),
  uploaderApprovalTeamIdx: index("highlights_uploader_approval_team_idx").on(
    t.uploaderId,
    t.approvalStatus,
    t.teamId,
  ),
}));

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
}, (t) => ({
  // Task #592 — FK indexes: organization_id (followed-org feed fan-in)
  // and author_id (profile + feed author joins).
  organizationIdIdx: index("org_posts_organization_id_idx").on(t.organizationId),
  authorIdIdx: index("org_posts_author_id_idx").on(t.authorId),
}));

export const articleTags = pgTable("article_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  articleId: uuid("article_id").references(() => articles.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  taggerUserId: uuid("tagger_user_id").references(() => users.id, { onDelete: "set null" }),
  status: tagStatusEnum("status").notNull().default("approved"),
  source: tagSourceEnum("source").notNull().default("manual"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // Task #592 — article_id (tagged users for a post) and user_id (feed
  // "articles tagging users I follow") are both filtered hot paths.
  articleIdIdx: index("article_tags_article_id_idx").on(t.articleId),
  userIdIdx: index("article_tags_user_id_idx").on(t.userId),
}));

export const highlightTags = pgTable("highlight_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  highlightId: uuid("highlight_id").references(() => highlights.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  taggerUserId: uuid("tagger_user_id").references(() => users.id, { onDelete: "set null" }),
  status: tagStatusEnum("status").notNull().default("approved"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // Task #592 — highlight_id (tagged users for a highlight) and user_id
  // (feed "highlights tagging users I follow") are both filtered.
  highlightIdIdx: index("highlight_tags_highlight_id_idx").on(t.highlightId),
  userIdIdx: index("highlight_tags_user_id_idx").on(t.userId),
}));

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
  // Task #592 — the unique index leads with post_kind, so the feed's
  // "shares by me or users I follow" (filtered on sharer_user_id alone)
  // needs its own index.
  sharerUserIdIdx: index("post_shares_sharer_user_id_idx").on(t.sharerUserId),
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
}, (t) => ({
  // Task #592 — comment listing + stat counts filter on
  // (post_kind, post_ref_id); this index serves those lookups.
  postRefIdx: index("post_comments_kind_ref_idx").on(t.postKind, t.postRefId),
}));

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

export const organizationClaimRequests = pgTable("organization_claim_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  status: orgClaimStatusEnum("status").notNull().default("pending"),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // At most one pending claim per (org, user). Defends against duplicate
  // submissions racing past the application-level check.
  uniquePendingPerUser: uniqueIndex("org_claim_unique_pending_per_user")
    .on(t.organizationId, t.requestedByUserId)
    .where(sql`${t.status} = 'pending'`),
  byOrg: index("org_claim_by_org").on(t.organizationId),
  byStatus: index("org_claim_by_status").on(t.status),
}));

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
}, (t) => ({
  // Task #592 — the notification bell lists/counts by user_id ordered
  // by created_at desc; a composite index serves both shapes.
  userCreatedIdx: index("notifications_user_id_created_at_idx").on(t.userId, t.createdAt.desc()),
}));

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

// Shared, Postgres-backed store for the rate-limit middleware (code
// review S6). Replaces a per-process in-memory Map so abuse protections
// survive restarts and apply across Autoscale instances. Keyed by
// (name, key_hash); `key_hash` is a sha256 of the raw limiter key so raw
// IPs / emails are never stored at rest.
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    count: integer("count").notNull().default(0),
    resetAt: timestamp("reset_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.name, t.keyHash] }),
    resetAtIdx: index("rate_limit_buckets_reset_at_idx").on(t.resetAt),
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

// Admin-entered AI provider credentials that power the "AI Assist" post
// composer. One row per provider (e.g. "anthropic"). The raw API key is
// never stored in plaintext: `keyCiphertext` holds an AES-256-GCM payload
// (see src/lib/secret-crypto.ts on the api-server) and `keyLast4` is kept
// only so the admin UI can show which key is configured without exposing it.
export const aiProviderKeys = pgTable("ai_provider_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().unique(),
  model: text("model"),
  // Optional admin-authored "context & personality" instruction. Prepended
  // to the system prompt of every AI Assist generation so an operator can
  // tune the assistant's voice, values, and organization-specific context.
  systemContext: text("system_context"),
  keyCiphertext: text("key_ciphertext").notNull(),
  keyLast4: text("key_last4").notNull(),
  createdById: uuid("created_by_id").references(
    (): AnyPgColumn => users.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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

// ---------------------------------------------------------------------------
// Org subscriptions + promo codes
//
// Multi-tier annual plans (mirrors the marketing pricing page). Stripe is not
// wired up yet — these tables capture the org's plan selection and any applied
// promo code so the checkout flow can run end-to-end now and be connected to
// Stripe later (the nullable stripe* columns are the future hook).
// ---------------------------------------------------------------------------
export const planTierEnum = pgEnum("plan_tier", ["starter", "pro", "elite"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
]);
export const promoDiscountTypeEnum = pgEnum("promo_discount_type", ["percent", "amount"]);

// Admin-managed discount codes. `discountValue` is interpreted by
// `discountType`: a percent (0–100) for "percent", or a number of whole US
// dollars off the annual price for "amount". `code` is stored lowercased and
// is matched case-insensitively at validation time.
export const promoCodes = pgTable("promo_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  description: text("description"),
  discountType: promoDiscountTypeEnum("discount_type").notNull(),
  discountValue: integer("discount_value").notNull(),
  active: boolean("active").notNull().default(true),
  // Optional redemption cap. Null = unlimited. `redemptionCount` tracks how
  // many times the code has been applied to a subscription.
  maxRedemptions: integer("max_redemptions"),
  redemptionCount: integer("redemption_count").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  createdById: uuid("created_by_id").references(
    (): AnyPgColumn => users.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// One subscription record per organization (the org's chosen plan). Created /
// updated from the post-creation checkout page. During the free launch window
// the status stays "trialing" and `billingStartsAt` marks when real billing
// begins (2026-10-01 at launch).
export const orgSubscriptions = pgTable("org_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  plan: planTierEnum("plan").notNull(),
  status: subscriptionStatusEnum("status").notNull().default("trialing"),
  promoCodeId: uuid("promo_code_id").references((): AnyPgColumn => promoCodes.id, {
    onDelete: "set null",
  }),
  // Future Stripe hooks — populated when card payments are connected.
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  billingStartsAt: timestamp("billing_starts_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Task #628 — Tournament signup funnel. An operator uploads a pre-made
// tournament schedule (CSV of match slots) which becomes a public funnel:
// visiting coaches create a SOLO team (no organization), claim an unclaimed
// team-name participant slot, and get a temporary team page so they can write
// game recaps WHILE the tournament is active. After `end_date` recap creation
// is locked until they create / get adopted by a real organization.
// ---------------------------------------------------------------------------
export const tournaments = pgTable("tournaments", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Unguessable-ish public slug used in the funnel URL (`/t/<slug>`).
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // Active window for recap authoring. Stored as plain calendar dates
  // (YYYY-MM-DD); the recap gate compares against today's date inclusive.
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  location: text("location"),
  description: text("description"),
  // Operator who created/uploaded the tournament (platform admin).
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// One row per unique team-name in a tournament, scoped by division + bracket
// (derived from the Home Team / Away Team CSV columns). Unclaimed until a
// visiting coach claims it, at which point `teamId` links their solo team and
// `claimedByUserId` / `claimedAt` are stamped. Owner-exclusive: a partial
// unique constraint on (tournament, division, bracket, nameKey) dedupes the
// slot, and claim is a conditional UPDATE ... WHERE team_id IS NULL.
export const tournamentParticipants = pgTable("tournament_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").references(() => tournaments.id, { onDelete: "cascade" }).notNull(),
  // Display name (original CSV casing) + a lowercased key used for dedupe
  // and case-insensitive matching across CSV re-uploads.
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),
  // Normalized to "" (never null) so the unique slot index treats missing
  // division/bracket as a single distinct value rather than SQL NULLs.
  division: text("division").notNull().default(""),
  bracket: text("bracket").notNull().default(""),
  age: text("age"),
  gender: text("gender"),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  claimedByUserId: uuid("claimed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  claimedAt: timestamp("claimed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byTournament: index("tournament_participants_tournament_id_idx").on(t.tournamentId),
  byTeam: index("tournament_participants_team_id_idx").on(t.teamId),
  uniqueSlot: uniqueIndex("tournament_participants_unique_slot").on(
    t.tournamentId,
    t.division,
    t.bracket,
    t.nameKey,
  ),
}));

// One row per CSV match-slot row. Idempotent on re-upload via the unique
// (tournament, matchNumber) index. Home/away participants are resolved to
// `tournament_participants` rows; imported scores are stored as-is.
export const tournamentMatches = pgTable("tournament_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").references(() => tournaments.id, { onDelete: "cascade" }).notNull(),
  matchNumber: text("match_number").notNull(),
  matchDate: date("match_date"),
  startTime: text("start_time"),
  age: text("age"),
  gender: text("gender"),
  division: text("division").notNull().default(""),
  bracket: text("bracket").notNull().default(""),
  venue: text("venue"),
  venueState: text("venue_state"),
  field: text("field"),
  homeParticipantId: uuid("home_participant_id").references((): AnyPgColumn => tournamentParticipants.id, { onDelete: "set null" }),
  awayParticipantId: uuid("away_participant_id").references((): AnyPgColumn => tournamentParticipants.id, { onDelete: "set null" }),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  byTournament: index("tournament_matches_tournament_id_idx").on(t.tournamentId),
  uniqueNumber: uniqueIndex("tournament_matches_unique_number").on(
    t.tournamentId,
    t.matchNumber,
  ),
}));

// ---------------------------------------------------------------------------
// Team Schedule. Coaches and org admins post practices/games to a team;
// rostered members + their parents view them read-only. Visibility is
// members-only (never part of the public team page). Recurring weekly
// practices are expanded into concrete `scheduleEvents` rows that share one
// `recurrenceId` — no virtual/computed events.
// ---------------------------------------------------------------------------
export const scheduleEventTypeEnum = pgEnum("schedule_event_type", [
  "practice",
  "game",
  "scrimmage",
  "tournament",
  "other",
]);
export const scheduleHomeAwayEnum = pgEnum("schedule_home_away", [
  "home",
  "away",
  "neutral",
]);
export const scheduleEventStatusEnum = pgEnum("schedule_event_status", [
  "scheduled",
  "canceled",
  "postponed",
  "completed",
]);
export const scheduleFrequencyEnum = pgEnum("schedule_frequency", ["weekly"]);

export const scheduleRecurrences = pgTable("schedule_recurrences", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).notNull(),
  frequency: scheduleFrequencyEnum("frequency").notNull().default("weekly"),
  // ISO weekday numbers (0=Sun .. 6=Sat) the practice repeats on.
  daysOfWeek: integer("days_of_week").array().notNull(),
  // Local wall-clock "HH:MM" (24h). Concrete occurrences carry the resolved
  // start_at/end_at; these are retained so "edit whole series" can rebuild.
  startTime: text("start_time").notNull(),
  endTime: text("end_time"),
  seriesStartDate: text("series_start_date").notNull(),
  seriesEndDate: text("series_end_date").notNull(),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  teamIdIdx: index("schedule_recurrences_team_id_idx").on(t.teamId),
}));

export const scheduleEvents = pgTable("schedule_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).notNull(),
  // Denormalized parent org so org-admin permission checks and org-scoped
  // reads don't need a teams join on every row.
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  eventType: scheduleEventTypeEnum("event_type").notNull(),
  // Required only for "other"; games surface the opponent instead.
  title: text("title"),
  opponent: text("opponent"),
  homeAway: scheduleHomeAwayEnum("home_away"),
  locationName: text("location_name"),
  locationAddress: text("location_address"),
  // Field / court / diamond number within the venue (e.g. "Field 3", "Court 2").
  locationField: text("location_field"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }),
  allDay: boolean("all_day").notNull().default(false),
  notes: text("notes"),
  status: scheduleEventStatusEnum("status").notNull().default("scheduled"),
  // Short coach/admin reason shown to families when canceled/postponed.
  statusReason: text("status_reason"),
  // Set when generated from a recurring weekly practice; all occurrences in
  // one series share the same recurrenceId.
  recurrenceId: uuid("recurrence_id").references((): AnyPgColumn => scheduleRecurrences.id, { onDelete: "set null" }),
  // Set when a coach publishes a game recap from this event; flips status to
  // completed and links back to the article.
  gameRecapId: uuid("game_recap_id").references((): AnyPgColumn => articles.id, { onDelete: "set null" }),
  // Phase 2 — final score for completed game/scrimmage events (members-only
  // Season Results). Nullable: a game can be completed without a recorded score.
  scoreTeam: integer("score_team"),
  scoreOpponent: integer("score_opponent"),
  // Stamped once the "write your game recap" reminder notification has been
  // sent (a couple hours after a game's start) so the durable sweep never
  // double-notifies.
  recapReminderSentAt: timestamp("recap_reminder_sent_at", { withTimezone: true }),
  // Phase 2 — stamped once the durable ~24h-before reminder email has been
  // fanned out, so the hourly sweep never double-sends. NULL = not yet sent.
  reminder24hSentAt: timestamp("reminder_24h_sent_at", { withTimezone: true }),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  teamStartIdx: index("schedule_events_team_start_idx").on(t.teamId, t.startAt),
  organizationIdIdx: index("schedule_events_organization_id_idx").on(t.organizationId),
  recurrenceIdIdx: index("schedule_events_recurrence_id_idx").on(t.recurrenceId),
}));

export const scheduleRsvpStatusEnum = pgEnum("schedule_rsvp_status", [
  "going",
  "maybe",
  "out",
]);

// Per-athlete availability for a single schedule event. One row per
// (event, athlete) — the unique index makes a re-submit a last-write-wins
// upsert. `athleteId` is the rostered player; `respondedById` records who
// actually answered (the athlete themselves OR their linked parent).
export const scheduleEventRsvps = pgTable("schedule_event_rsvps", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").references(() => scheduleEvents.id, { onDelete: "cascade" }).notNull(),
  athleteId: uuid("athlete_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  respondedById: uuid("responded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  status: scheduleRsvpStatusEnum("status").notNull(),
  note: text("note"),
  respondedAt: timestamp("responded_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  eventAthleteUq: uniqueIndex("schedule_event_rsvps_event_athlete_uq").on(t.eventId, t.athleteId),
  eventIdIdx: index("schedule_event_rsvps_event_id_idx").on(t.eventId),
  athleteIdIdx: index("schedule_event_rsvps_athlete_id_idx").on(t.athleteId),
}));

export const announcementLevelEnum = pgEnum("announcement_level", [
  "info",
  "warning",
  "success",
]);

// Platform-wide announcements shown as an in-app banner to every logged-in
// user. Authored by platform admins. `active` plus the optional startsAt/endsAt
// window control visibility; per-user dismissal is client-side (localStorage).
export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  level: announcementLevelEnum("level").notNull().default("info"),
  active: boolean("active").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  activeIdx: index("announcements_active_idx").on(t.active),
}));

// ---------------------------------------------------------------------------
// Broadcasts (bulk messaging) — distinct from platform `announcements` above.
// An org owner/admin broadcasts to every team's coaches + accepted players +
// their parents (no replies). A team admin/coach/manager broadcasts to that
// team's accepted players + their parents (parents may reply). Minors receive
// a read-only copy alongside their parents; only `parent` recipients may reply.
// ---------------------------------------------------------------------------
export const broadcastScopeEnum = pgEnum("broadcast_scope", ["organization", "team"]);
export const broadcastRecipientRoleEnum = pgEnum("broadcast_recipient_role", [
  "coach",
  "player",
  "parent",
]);

export const broadcasts = pgTable("broadcasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: broadcastScopeEnum("scope").notNull(),
  // Exactly one of organizationId / teamId is set, matching `scope`.
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
  senderUserId: uuid("sender_user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  allowReplies: boolean("allow_replies").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  organizationIdIdx: index("broadcasts_organization_id_idx").on(t.organizationId),
  teamIdIdx: index("broadcasts_team_id_idx").on(t.teamId),
}));

// One row per delivered recipient. `recipientRole` records why they received
// it (only `parent` rows may reply). `childUserId` links a parent row back to
// the player it covers (NULL for coach/player rows). PK dedupes a user who
// would otherwise be delivered twice (role priority resolved at write time).
export const broadcastRecipients = pgTable("broadcast_recipients", {
  broadcastId: uuid("broadcast_id").references(() => broadcasts.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  recipientRole: broadcastRecipientRoleEnum("recipient_role").notNull(),
  childUserId: uuid("child_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.broadcastId, t.userId] }),
  userIdIdx: index("broadcast_recipients_user_id_idx").on(t.userId),
}));

// Private per-family reply threads on a team broadcast. `familyParentUserId`
// is the thread key (the parent's user id); team staff see every thread, a
// parent sees only their own.
export const broadcastReplies = pgTable("broadcast_replies", {
  id: uuid("id").primaryKey().defaultRandom(),
  broadcastId: uuid("broadcast_id").references(() => broadcasts.id, { onDelete: "cascade" }).notNull(),
  familyParentUserId: uuid("family_parent_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  senderUserId: uuid("sender_user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  threadIdx: index("broadcast_replies_thread_idx").on(t.broadcastId, t.familyParentUserId),
}));
