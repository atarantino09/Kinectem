import type { Response } from "express";
import {
  db,
  users,
  organizations,
  teams,
  rosterEntries,
  rosterInvites,
  articles,
  highlights,
  orgPosts,
  notifications,
  conversations,
  messages,
  postComments,
  organizationJoinRequests,
  assets,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Standard API error envelope
// ---------------------------------------------------------------------------

export const ErrorCodes = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  GONE: "GONE",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNPROCESSABLE: "UNPROCESSABLE",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ---------------------------------------------------------------------------
// Avatar URL guard
// ---------------------------------------------------------------------------
//
// Avatar URLs in this codebase are stored either as ordinary `http(s)://` URLs
// or as inline `data:<mime>;base64,...` payloads (the asset upload flow stores
// the latter). Because a user's `avatarUrl` is fanned out across many list
// responses (feed, posts, comments, mentions, message threads, search,
// follow lists, ...), shipping a multi-megabyte data URL on every list item
// produces a perceptible "blank then pop" — the browser has to decode the
// data URL each time the avatar mounts, and Radix's Avatar primitive renders
// nothing while it's still loading.
//
// The cap below is the maximum length we are willing to ship for an inline
// data URL. Anything larger is treated as missing at egress, which makes the
// client render the initials fallback instead of an empty circle. The cap
// is intentionally well above a reasonable square-cropped JPEG/WebP avatar
// (~tens of KB) but well below the 10 MB asset ceiling used elsewhere.
//
// `data:` URLs are length-checked because their length is what costs us on
// the wire and at decode time. `http(s)://` URLs are passed through as-is
// regardless of length — they're fetched separately by the browser and
// don't bloat the JSON response.
export const MAX_AVATAR_DATA_URL_LENGTH = 512 * 1024;

export function safeAvatarUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.startsWith("data:") && raw.length > MAX_AVATAR_DATA_URL_LENGTH) {
    return null;
  }
  return raw;
}

function defaultCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ErrorCodes.VALIDATION_ERROR;
    case 401:
      return ErrorCodes.AUTH_REQUIRED;
    case 403:
      return ErrorCodes.FORBIDDEN;
    case 404:
      return ErrorCodes.NOT_FOUND;
    case 409:
      return ErrorCodes.CONFLICT;
    case 410:
      return ErrorCodes.GONE;
    case 413:
      return ErrorCodes.PAYLOAD_TOO_LARGE;
    case 422:
      return ErrorCodes.UNPROCESSABLE;
    case 429:
      return ErrorCodes.RATE_LIMITED;
    default:
      return ErrorCodes.INTERNAL_ERROR;
  }
}

/**
 * Send a standardized API error response.
 *
 * Body shape: `{ error, code, ...extras }` — matches the `ErrorResponse`
 * schema in `lib/api-spec/openapi.yaml`. Returns the Express response so
 * callers can do `return apiError(...)`.
 *
 * Pass `extras` for fields that some endpoints carry alongside the error
 * (e.g. `pendingGuardianConfirmation` on the guardian-gated login path).
 */
export function apiError(
  res: Response,
  status: number,
  message: string,
  options: { code?: ErrorCode | string; extras?: Record<string, unknown> } = {},
): Response {
  return res.status(status).json({
    error: message,
    code: options.code ?? defaultCodeForStatus(status),
    ...(options.extras ?? {}),
  });
}

type UserRow = typeof users.$inferSelect;
type OrgRow = typeof organizations.$inferSelect;
type TeamRow = typeof teams.$inferSelect;
type RosterRow = typeof rosterEntries.$inferSelect;
type InviteRow = typeof rosterInvites.$inferSelect;
type ArticleRow = typeof articles.$inferSelect;
type HighlightRow = typeof highlights.$inferSelect;
type OrgPostRow = typeof orgPosts.$inferSelect;
type NotificationRow = typeof notifications.$inferSelect;

// ---------------------------------------------------------------------------
// Synthetic field helpers (DB has `name`, spec wants firstName/lastName/slug)
// ---------------------------------------------------------------------------

export function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  const idx = trimmed.indexOf(" ");
  if (idx < 0) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1) };
}

export function displayName(u: Pick<UserRow, "name">): string {
  return u.name;
}

// ---------------------------------------------------------------------------
// Minor name masking (Task #414)
// ---------------------------------------------------------------------------
//
// Per the parental-consent text in `coppa.ts`, an under-13 user's identity
// must not be surfaced to strangers beyond first initial / sport / jersey
// number. The implementation today returns the FULL "First Last" name in
// every embed (post author chip, comment author, tag chip, sharedBy chip,
// follower lists, search rows). That contradicts the consent the parent
// signed.
//
// This helper masks the last name down to its first initial when:
//   - the target user has `isMinor === true`, AND
//   - the viewer is NOT in the privileged set for that target.
//
// Privileged viewers (full name still shown):
//   - The minor themselves (`viewerId === target.id`)
//   - The minor's linked guardian (`users.parentId === viewerId`)
//   - A platform admin (`viewer.role === "admin"`)
//   - Anyone sharing an accepted `roster_entries` team with the minor
//
// The mask only applies to **embeds** (post author, comment author, tag
// chip, sharedBy, follower lists, search rows). The minor's own profile
// resource (`GET /users/:userId`) and team roster listings always carry
// the full name — those are explicitly carved out in the consent text.
//
// `coppa.ts` is locked, so the helpers live here and the relationship
// lookups happen alongside the other read-time transforms.
export type MinorNameViewerContext = {
  viewerId: string | null;
  viewerRole: string | null;
  // Set of minor user-ids the viewer is privileged to see un-masked.
  // Admins short-circuit by setting `bypass: true`.
  privilegedTargetIds: ReadonlySet<string>;
  bypass?: boolean;
};

// Sentinel "mask everyone" context for explicit stranger-surface use.
export const ANON_MINOR_NAME_CONTEXT: MinorNameViewerContext = {
  viewerId: null,
  viewerRole: null,
  privilegedTargetIds: new Set<string>(),
};

// Sentinel "bypass masking" context — explicitly opted in by a call
// site that knows its surface is already privileged (e.g. drafts only
// shown to the author, child-conversations only shown to the linked
// guardian, admin tooling, or write-time response echoes where the
// viewer is the author). Behaves like an admin: never masks. NEVER
// use this on a stranger-visible surface — the whole point of
// flipping the default to `ANON_MINOR_NAME_CONTEXT` (Task #414) was
// to make a missed call site fail-safe (over-mask) rather than
// fail-open (leak a minor's last name).
export const TRUSTED_MINOR_NAME_CONTEXT: MinorNameViewerContext = {
  viewerId: null,
  viewerRole: null,
  privilegedTargetIds: new Set<string>(),
  bypass: true,
};

export function maskedDisplayName(u: Pick<UserRow, "name">): string {
  const parts = (u.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return u.name ?? "";
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`;
}

export function shouldMaskMinorName(
  target: Pick<UserRow, "id" | "isMinor">,
  ctx: MinorNameViewerContext,
): boolean {
  if (!target.isMinor) return false;
  if (ctx.bypass) return false;
  if (ctx.viewerRole === "admin") return false;
  if (ctx.viewerId && ctx.viewerId === target.id) return false;
  if (ctx.privilegedTargetIds.has(target.id)) return false;
  return true;
}

export function displayNameForViewer(
  u: Pick<UserRow, "id" | "name" | "isMinor">,
  // Task #414 — fail-safe default: when a call site forgets to pass a
  // context, we mask. Locked / privileged surfaces (drafts, child-
  // conversations, parent-inbox, masquerade, write-time echoes where
  // the viewer is the author) MUST explicitly pass
  // `TRUSTED_MINOR_NAME_CONTEXT` to opt out.
  ctx: MinorNameViewerContext = ANON_MINOR_NAME_CONTEXT,
): string {
  return shouldMaskMinorName(u, ctx) ? maskedDisplayName(u) : u.name;
}

// Batched async builder. Resolves the privileged-target set in a single
// query: linked-child rows + accepted-roster intersection. Admins
// short-circuit; anonymous viewers get an empty set.
export async function buildMinorNameContext(
  viewer: { id: string | null; role: string | null },
  candidateMinorIds: Iterable<string>,
): Promise<MinorNameViewerContext> {
  const role = viewer.role ?? null;
  if (role === "admin") {
    return {
      viewerId: viewer.id,
      viewerRole: role,
      privilegedTargetIds: new Set<string>(),
      bypass: true,
    };
  }
  if (!viewer.id) {
    return {
      viewerId: null,
      viewerRole: null,
      privilegedTargetIds: new Set<string>(),
    };
  }
  const ids = Array.from(new Set(candidateMinorIds));
  const privileged = new Set<string>();
  if (ids.length === 0) {
    return {
      viewerId: viewer.id,
      viewerRole: role,
      privilegedTargetIds: privileged,
    };
  }
  // 1) Self
  if (ids.includes(viewer.id)) privileged.add(viewer.id);
  // 2) Linked children of the viewer.
  const childRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.parentId, viewer.id)));
  for (const r of childRows) privileged.add(r.id);
  // 3) Shared accepted roster entries — anyone the viewer shares an
  //    accepted roster team with is "inside the team" and gets the
  //    full name.
  const remaining = ids.filter((id) => !privileged.has(id));
  if (remaining.length > 0) {
    const sharedTeamRows = await db.execute<{ user_id: string }>(sql`
      select distinct mine_others.user_id
      from ${rosterEntries} as mine
      inner join ${rosterEntries} as mine_others
        on mine_others.team_id = mine.team_id
      where mine.user_id = ${viewer.id}
        and mine.status = 'accepted'
        and mine_others.status = 'accepted'
        and mine_others.user_id in (${sql.join(
          remaining.map((id) => sql`${id}`),
          sql`, `,
        )})
    `);
    for (const r of (sharedTeamRows.rows ?? sharedTeamRows) as { user_id: string }[]) {
      privileged.add(r.user_id);
    }
  }
  return {
    viewerId: viewer.id,
    viewerRole: role,
    privilegedTargetIds: privileged,
  };
}

// Convenience: caller supplies an arbitrary list of users (some may not
// be minors) and we collect just the minor ids before delegating.
export async function buildMinorNameContextFromUsers(
  viewer: { id: string | null; role: string | null },
  candidates: ReadonlyArray<Pick<UserRow, "id" | "isMinor"> | null | undefined>,
): Promise<MinorNameViewerContext> {
  const ids: string[] = [];
  for (const c of candidates) {
    if (c && c.isMinor) ids.push(c.id);
  }
  return buildMinorNameContext(viewer, ids);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 50) || "x";
}

// ---------------------------------------------------------------------------
// Posts: unify articles + highlights as spec posts
// ---------------------------------------------------------------------------

export function articlePostId(id: string): string {
  return `article-${id}`;
}
export function highlightPostId(id: string): string {
  return `highlight-${id}`;
}
export function orgPostPostId(id: string): string {
  return `orgpost-${id}`;
}
export type PostKind = "article" | "highlight" | "org_post";
export function parsePostId(postId: string): { kind: PostKind; id: string } | null {
  if (postId.startsWith("article-")) return { kind: "article", id: postId.slice(8) };
  if (postId.startsWith("highlight-")) return { kind: "highlight", id: postId.slice(10) };
  if (postId.startsWith("orgpost-")) return { kind: "org_post", id: postId.slice(8) };
  return null;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export function emptyPagination() {
  return { nextCursor: null, hasMore: false, totalCount: 0 };
}

export function paginate<T>(data: T[], totalCount?: number) {
  return {
    data,
    pagination: { nextCursor: null, hasMore: false, totalCount: totalCount ?? data.length },
  };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function toPublicUser(
  u: UserRow,
  opts: {
    isOwnProfile?: boolean;
    isFollowing?: boolean;
    followerCount?: number;
    followingCount?: number;
    // Task #421 — when this minor row is being projected onto a
    // stranger-visible surface (e.g. /posts/follow-suggestions card,
    // follower lists), pass a viewer context so the last name is
    // masked to its first initial. Privileged viewers (self, linked
    // guardian, shared-roster teammate, admin) get the full name.
    // Omitting this opt preserves the legacy "full name" behavior
    // for surfaces that have already been audited (e.g. the user's
    // own profile resource where the carve-out applies).
    minorNameCtx?: MinorNameViewerContext;
    // Task #426 — When the viewer satisfies the profile owner's
    // `dateOfBirthVisibility` tier, GET /users/:userId passes the
    // ISO date string here so the public response includes it. Omit
    // (or pass `null`) to keep birthday hidden — the default for
    // every other surface that projects a public user (search,
    // post-author cards, follower lists, etc.).
    dateOfBirth?: string | null;
  } = {},
) {
  const masked =
    opts.minorNameCtx !== undefined &&
    shouldMaskMinorName(u, opts.minorNameCtx);
  const { firstName, lastName } = splitName(
    masked ? maskedDisplayName(u) : u.name,
  );
  return {
    id: u.id,
    firstName,
    lastName,
    bio: u.bio ?? null,
    // Task #349 — Optional city + 2-letter US state postal code surfaced
    // on the profile hero. Both nullable; existing rows with no location
    // simply ship null.
    city: u.city ?? null,
    state: u.state ?? null,
    avatarUrl: safeAvatarUrl(u.avatarUrl),
    coverPhotoUrl: null as string | null,
    isOwnProfile: opts.isOwnProfile ?? false,
    isFollowing: opts.isFollowing ?? false,
    isConnection: false,
    // Task #367 — non-PII boolean exposed on every public profile so
    // the SPA can mount <NoIndex/> as a belt-and-braces against the
    // X-Robots-Tag header. Public listings of minors are already
    // suppressed by `filterOutMinors`, so the only callers that see
    // this true are viewers who passed the minor profile carve-out.
    isMinor: !!u.isMinor,
    followerCount: opts.followerCount ?? 0,
    followingCount: opts.followingCount ?? 0,
    // Task #426 — Birthday is opt-in per `dateOfBirthVisibility`. Only
    // emitted when the calling route has resolved the viewer is
    // allowed; everywhere else this is null so we never accidentally
    // leak DOB through search / post-author / follower-list surfaces.
    dateOfBirth: opts.dateOfBirth ?? null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.createdAt.toISOString(),
  };
}

export function toPrivateUser(
  u: UserRow,
  opts: {
    followerCount?: number;
    followingCount?: number;
    /**
     * Whether the caller is viewing their OWN profile. Defaults to true
     * because the most common caller is `GET /users/me`, but a linked
     * parent viewing their child's profile also receives the private
     * response and must pass `false` so the frontend doesn't render
     * self-only UI (Manage Tags, etc.).
     */
    isOwnProfile?: boolean;
    isFollowing?: boolean;
  } = {},
) {
  return {
    ...toPublicUser(u, {
      isOwnProfile: opts.isOwnProfile ?? true,
      isFollowing: opts.isFollowing ?? false,
      followerCount: opts.followerCount,
      followingCount: opts.followingCount,
      // Task #426 — Self / linked guardian always sees the actual
      // birthday on the private response, regardless of the owner's
      // chosen `dateOfBirthVisibility` tier (the tier only gates
      // strangers viewing the public response).
      dateOfBirth: u.dateOfBirth
        ? u.dateOfBirth.toISOString().slice(0, 10)
        : null,
    }),
    email: u.email ?? "",
    role: u.role,
    // Task #359 — surface so the web client can hide UI for blocked
    // actions the server also enforces. Falsy on legacy rows that
    // haven't been touched since the migration backfill.
    isMinor: !!u.isMinor,
    accountStatus: u.accountStatus ?? "active",
    parentId: u.parentId ?? null,
    // Task #426 — Per-field birthday visibility. Minor accounts are
    // forced to `private` server-side regardless of what is stored.
    dateOfBirthVisibility: u.isMinor
      ? "private"
      : (u.dateOfBirthVisibility ?? "private"),
  };
}

// Allowed values for the optional authorRole label on a post author. Mirrors
// the `PostAuthor.authorRole` enum in the OpenAPI spec and the
// `AuthorRoleLabel` type in `permissions.ts` — kept here as a structural
// mirror so this module doesn't have to import permissions.
export type PostAuthorRoleLabel = "Coach" | "Author" | "Owner" | "Admin";

export function toPostAuthor(
  u: UserRow,
  opts: {
    authorRole?: PostAuthorRoleLabel | null;
    minorNameCtx?: MinorNameViewerContext;
  } = {},
) {
  return {
    id: u.id,
    displayName: displayNameForViewer(u, opts.minorNameCtx),
    avatarUrl: safeAvatarUrl(u.avatarUrl),
    // Task #367 — same rationale as toPublicUser.isMinor: the SPA
    // PostPage uses this to mount <NoIndex/> when the post author is
    // a minor, in addition to the X-Robots-Tag header the API sets.
    isMinor: !!u.isMinor,
    // Article-backed long-form posts populate this with the author's
    // strongest team-relevant role (Coach > Author > Owner > Admin) so
    // the recap header can render "Jane Doe · Coach". Highlights, org
    // posts, sharedBy authors, and any caller that doesn't pass an
    // opt-in default to null.
    authorRole: opts.authorRole ?? null,
  };
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export function toOrganization(
  o: OrgRow,
  opts: {
    isMember?: boolean;
    role?: "owner" | "admin" | "member" | null;
    isFollowing?: boolean;
    followerCount?: number;
  } = {},
) {
  return {
    id: o.id,
    name: o.name,
    slug: slugify(o.name),
    description: o.description ?? null,
    website: o.website ?? null,
    city: o.city ?? null,
    state: o.state ?? null,
    zipCode: o.zipCode ?? null,
    logoUrl: o.logoUrl ?? null,
    isMember: opts.isMember ?? false,
    role: opts.role ?? null,
    isFollowing: opts.isFollowing ?? false,
    followerCount: opts.followerCount ?? 0,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.createdAt.toISOString(),
  };
}

export function toOrganizationEmbed(o: OrgRow) {
  return { id: o.id, name: o.name, slug: slugify(o.name), avatarUrl: o.logoUrl ?? null };
}

export function toMember(u: UserRow, role: "owner" | "admin" | "member", joinedAt: Date) {
  return {
    userId: u.id,
    displayName: displayName(u),
    avatarUrl: safeAvatarUrl(u.avatarUrl),
    role,
    joinedAt: joinedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export function toTeam(
  t: TeamRow,
  org: OrgRow,
  opts: {
    followerCount?: number;
    isFollowing?: boolean;
    memberCount?: number;
    canAuthorRecaps?: boolean;
  } = {},
) {
  return {
    id: t.id,
    organization: toOrganizationEmbed(org),
    name: t.name,
    slug: slugify(t.name),
    description: t.description ?? null,
    // Task #293 — Optional team website / link. Always a normalized
    // http(s):// URL when set, since the create/edit endpoints run
    // input through normalizeWebsite() before storing.
    website: t.website ?? null,
    sport: t.sport ?? null,
    level: t.level ?? null,
    gender: (t.gender as "boys" | "girls" | "coed" | null) ?? null,
    avatarUrl: t.logoUrl ?? null,
    bannerUrl: t.bannerUrl ?? null,
    currentSeason: t.season
      ? {
          id: t.id,
          name: t.season,
          startDate: null as string | null,
          endDate: null as string | null,
          status: "active" as const,
          createdAt: t.createdAt.toISOString(),
        }
      : null,
    followerCount: opts.followerCount ?? opts.memberCount ?? 0,
    isFollowing: opts.isFollowing ?? false,
    canAuthorRecaps: opts.canAuthorRecaps ?? false,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.createdAt.toISOString(),
  };
}

const POSITION_MAP: Record<string, string> = {
  player: "player",
  coach: "coach",
  parent: "parent",
  athlete: "player",
};
function rosterPositionToSpec(role: string, position: string | null): string {
  if (position?.toLowerCase() === "admin") return "admin";
  if (role === "coach") {
    if (position?.toLowerCase().includes("assistant")) return "assistant_coach";
    if (position?.toLowerCase().includes("manager")) return "manager";
    return "coach";
  }
  const p = position?.toLowerCase() ?? "";
  if (p === "author" || role === "parent") return "author";
  if (p === "manager") return "manager";
  return POSITION_MAP[role] ?? "player";
}

export function toTeamMember(r: RosterRow, u: UserRow) {
  return {
    id: r.id,
    userId: u.id,
    displayName: displayName(u),
    avatarUrl: safeAvatarUrl(u.avatarUrl),
    teamId: r.teamId,
    seasonId: r.teamId,
    role: (r.role === "coach" ? "admin" : "member") as "owner" | "admin" | "member",
    position: rosterPositionToSpec(r.role, r.position) as
      | "player"
      | "coach"
      | "assistant_coach"
      | "admin"
      | "manager"
      | "parent",
    jerseyNumber: r.jerseyNumber ?? null,
    status: (r.status === "accepted" ? "active" : "pending") as "active" | "pending",
    joinedAt: r.createdAt.toISOString(),
  };
}

export function toInvite(i: InviteRow, invitedBy: UserRow | null) {
  return {
    id: i.id,
    token: i.token,
    invitedName: i.invitedName ?? null,
    email: i.invitedEmail,
    position: rosterPositionToSpec(i.role, i.position) as
      | "player"
      | "coach"
      | "assistant_coach"
      | "admin"
      | "manager"
      | "parent"
      | null,
    role: (i.role === "coach" ? "admin" : "member") as "owner" | "admin" | "member",
    // The DB enum is `pending|accepted|expired|revoked`; the OpenAPI
    // surface speaks `pending|accepted|declined|expired|withdrawn|resolved`.
    // Translate the one mismatched value here so every consumer of the
    // invite payload sees the spec vocabulary.
    status: (i.status === "revoked" ? "withdrawn" : i.status) as
      | "pending"
      | "accepted"
      | "declined"
      | "expired"
      | "withdrawn"
      | "resolved",
    invitedBy: {
      id: invitedBy?.id ?? "system",
      displayName: invitedBy ? displayName(invitedBy) : "System",
    },
    seasonId: i.teamId,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Posts (unified from articles + highlights)
// ---------------------------------------------------------------------------

interface PostExtras {
  team?: TeamRow | null;
  org: OrgRow;
  author: UserRow | null;
  reactionCount?: number;
  hasReacted?: boolean;
  commentCount?: number;
  recentReactorName?: string | null;
  // Set per-viewer by GET /posts/:postId and the post-list endpoints
  // (feed, team posts, profile posts, org posts) so the 3-dot menu's
  // "Edit post" item can be rendered everywhere a post card appears.
  canEdit?: boolean;
  // Set per-viewer alongside `canEdit`. True only when the requesting
  // user is the original author of an article-backed post — co-authors,
  // team coaches, and org admins (who can still edit) do NOT get
  // delete permission. Drives the "Delete post" item in the 3-dot
  // menu. Defaults to false; populated for article posts only.
  canDelete?: boolean;
  shareCount?: number;
  hasShared?: boolean;
  sharedBy?: { id: string; displayName: string; avatarUrl: string | null } | null;
  sharedAt?: string | null;
  // The strongest team-relevant role that authorized this article's
  // author to write the recap, computed at read time. Article-backed
  // posts populate it (or pass null when no role applies); highlight /
  // org posts leave it undefined and the response ships null.
  authorRole?: PostAuthorRoleLabel | null;
  // People tagged on this post that the requesting viewer is allowed
  // to see. Approved tags are visible to everyone; pending tags are
  // only included for the post author and the tagged player themselves
  // (mirroring the recap consent rules). Currently populated only for
  // highlight posts; other paths leave it undefined and the response
  // omits the field.
  taggedUsers?: PostTaggedUserView[];
  // Task #344 — The viewer's own tag row on this post (article or
  // highlight), surfaced so the 3-dot menu can render "Remove me from
  // this post". Only set when the viewer has an `approved` or
  // `pending` tag on this post; declined / removed tags and
  // unauthenticated viewers leave this undefined and the response
  // ships null. Org-post paths never populate it.
  currentUserTag?: CurrentUserTagView | null;
  // Task #414 — Optional viewer context used to mask under-13 last
  // names on embed surfaces (post author, sharedBy chip). Pass-through
  // only; if undefined, names are masked for any minor target.
  minorNameCtx?: MinorNameViewerContext;
}

export interface PostTaggedUserView {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  tagStatus: "approved" | "pending";
}

export interface CurrentUserTagView {
  id: string;
  kind: "article" | "highlight";
  status: "approved" | "pending";
}

export function articleToPost(a: ArticleRow, extras: PostExtras) {
  const photos = Array.isArray(a.photoUrls) && a.photoUrls.length > 0
    ? a.photoUrls
    : a.coverImageUrl
      ? [a.coverImageUrl]
      : [];
  const assets = photos.map((url, i) => ({
    id: `photo-${a.id}-${i}`,
    fileType: "image/jpeg",
    url,
    displayOrder: i,
  }));
  if (a.videoUrl) {
    assets.push({
      id: `video-${a.id}`,
      fileType: "video/mp4",
      url: a.videoUrl,
      displayOrder: assets.length,
    });
  }
  return basePost({
    id: articlePostId(a.id),
    postType: "long" as const,
    title: a.title,
    description: a.summary ?? null,
    body: a.body || null,
    assets,
    isEdited: a.updatedAt.getTime() > a.createdAt.getTime() + 1000,
    createdAt: (a.publishedAt ?? a.createdAt).toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    gameDate: a.gameDate ? a.gameDate.toISOString() : null,
    extras,
  });
}

export function orgPostToPost(p: OrgPostRow, extras: PostExtras) {
  const photos = Array.isArray(p.photoUrls) && p.photoUrls.length > 0
    ? p.photoUrls
    : p.coverImageUrl
      ? [p.coverImageUrl]
      : [];
  const assets = photos.map((url, i) => ({
    id: `photo-${p.id}-${i}`,
    fileType: "image/jpeg",
    url,
    displayOrder: i,
  }));
  if (p.videoUrl) {
    assets.push({
      id: `video-${p.id}`,
      fileType: "video/mp4",
      url: p.videoUrl,
      displayOrder: assets.length,
    });
  }
  return basePost({
    id: orgPostPostId(p.id),
    postType: "long" as const,
    title: p.title,
    description: null,
    body: p.body || null,
    assets,
    isEdited: p.updatedAt.getTime() > p.createdAt.getTime() + 1000,
    createdAt: (p.publishedAt ?? p.createdAt).toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    extras: { ...extras, team: null },
  });
}

export function highlightToPost(h: HighlightRow, extras: PostExtras) {
  const assets = h.thumbnailUrl
    ? [
        {
          id: `thumb-${h.id}`,
          fileType: "image/jpeg",
          url: h.thumbnailUrl,
          displayOrder: 0,
        },
      ]
    : [];
  if (h.videoUrl) {
    assets.push({
      id: `video-${h.id}`,
      fileType: "video/mp4",
      url: h.videoUrl,
      displayOrder: 1,
    });
  }
  return basePost({
    id: highlightPostId(h.id),
    postType: "short" as const,
    title: h.title,
    description: h.description ?? null,
    body: null,
    assets,
    isEdited: false,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.createdAt.toISOString(),
    extras,
  });
}

function basePost(p: {
  id: string;
  postType: "short" | "long";
  title: string | null;
  description: string | null;
  body: string | null;
  assets: { id: string; fileType: string; url: string; displayOrder: number }[];
  isEdited: boolean;
  createdAt: string;
  updatedAt: string;
  // Only article-backed long-form posts ever carry this. Short-form
  // (highlight) and org posts pass undefined and the response just
  // omits the field downstream consumers expect to see as null.
  gameDate?: string | null;
  extras: PostExtras;
}) {
  const author = p.extras.author
    ? toPostAuthor(p.extras.author, {
        authorRole: p.extras.authorRole ?? null,
        minorNameCtx: p.extras.minorNameCtx,
      })
    : { id: "system", displayName: "System", avatarUrl: null, authorRole: null };
  const team = p.extras.team;
  const context = team
    ? {
        type: "team" as const,
        id: team.id,
        name: team.name,
        slug: slugify(team.name),
        orgSlug: slugify(p.extras.org.name),
        orgId: p.extras.org.id,
        orgName: p.extras.org.name,
        avatarUrl: team.logoUrl ?? null,
        // Team posts carry the parent org's logo so PostCard can show
        // the org logo as the team's avatar. Null when the parent org
        // also has no logo set.
        orgAvatarUrl: p.extras.org.logoUrl ?? null,
      }
    : {
        type: "organization" as const,
        id: p.extras.org.id,
        name: p.extras.org.name,
        slug: slugify(p.extras.org.name),
        orgSlug: null,
        orgId: null,
        orgName: null,
        avatarUrl: p.extras.org.logoUrl ?? null,
        orgAvatarUrl: null,
      };
  return {
    id: p.id,
    postType: p.postType,
    title: p.title,
    description: p.description,
    body: p.body,
    bodyTruncated: false,
    isEdited: p.isEdited,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    gameDate: p.gameDate ?? null,
    author,
    context,
    assets: p.assets,
    reactionCount: p.extras.reactionCount ?? 0,
    hasReacted: p.extras.hasReacted ?? false,
    commentCount: p.extras.commentCount ?? 0,
    recentReactorName: p.extras.recentReactorName ?? null,
    // Default false. GET /posts/:postId and the post-list endpoints
    // (feed, team posts, profile posts, org posts) compute this
    // per-viewer so the 3-dot menu's "Edit post" item can be
    // rendered everywhere a post card appears.
    canEdit: p.extras.canEdit ?? false,
    // Default false. Only set true for article-backed posts where the
    // viewer is the original author. Co-authors / coaches / org admins
    // who can still PATCH (`canEdit`) the post intentionally do not
    // get this — deletion is reserved for the original author.
    canDelete: p.extras.canDelete ?? false,
    shareCount: p.extras.shareCount ?? 0,
    hasShared: p.extras.hasShared ?? false,
    sharedBy: p.extras.sharedBy ?? null,
    sharedAt: p.extras.sharedAt ?? null,
    // Only emit the field when the caller populated it. Highlight
    // routes pass an array (possibly empty) so the client knows the
    // tag set was loaded; recap / org-post routes leave it undefined
    // and the spec-allowed omission keeps payloads quiet.
    ...(p.extras.taggedUsers !== undefined
      ? { taggedUsers: p.extras.taggedUsers }
      : {}),
    // Task #344 — Surface the viewer's own tag row when one exists
    // so PostCard can render "Remove me from this post" without an
    // extra round-trip. Article and highlight routes both populate
    // this; org-post routes never do (no tag concept).
    currentUserTag: p.extras.currentUserTag ?? null,
  };
}

// ---------------------------------------------------------------------------
// Conversations & Messages
// ---------------------------------------------------------------------------

type ConvRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type CommentRow = typeof postComments.$inferSelect;
type JoinReqRow = typeof organizationJoinRequests.$inferSelect;

export interface ConversationParticipantInfo {
  id: string;
  type: "user" | "organization";
  displayName: string;
  avatarUrl: string | null;
}

export function toConversation(
  c: ConvRow,
  participant: ConversationParticipantInfo,
  lastMessage: MessageRow | null,
  lastMessageSenderName: string | null,
  unreadCount: number,
  lastMessageHasAttachments = false,
) {
  return {
    id: c.id,
    type: c.type,
    participant: {
      id: participant.id,
      type: participant.type,
      displayName: participant.displayName,
      avatarUrl: safeAvatarUrl(participant.avatarUrl),
    },
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          senderDisplayName: lastMessageSenderName ?? "Unknown",
          bodyPreview: lastMessage.deletedAt
            ? null
            : (lastMessage.body ?? "").slice(0, 200),
          hasAttachments: lastMessageHasAttachments,
          createdAt: lastMessage.createdAt.toISOString(),
        }
      : undefined,
    unreadCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

type AssetRow = typeof assets.$inferSelect;

export function toMessageAsset(a: AssetRow) {
  return {
    id: a.id,
    fileName: a.fileName ?? "",
    mimeType: a.fileType,
    size: a.fileSize ?? 0,
    url: a.url ?? null,
  };
}

export function toMessage(
  m: MessageRow,
  sender: { id: string; displayName: string; avatarUrl: string | null } | null,
  assetRows: AssetRow[] = [],
) {
  if (m.deletedAt) {
    return {
      id: m.id,
      deleted: true as const,
      createdAt: m.createdAt.toISOString(),
    };
  }
  return {
    id: m.id,
    senderId: sender?.id ?? m.senderUserId ?? "00000000-0000-0000-0000-000000000000",
    senderDisplayName: sender?.displayName ?? "Unknown",
    senderAvatarUrl: safeAvatarUrl(sender?.avatarUrl ?? null),
    body: m.body ?? "",
    assets: assetRows.map(toMessageAsset),
    createdAt: m.createdAt.toISOString(),
  };
}

export function toAssetResponse(a: AssetRow) {
  return {
    id: a.id,
    createdBy: a.ownerId ?? "00000000-0000-0000-0000-000000000000",
    fileType: a.fileType,
    fileSize: a.fileSize,
    originalFilename: a.fileName,
    status: a.status,
    url: a.url ?? null,
    urlExpiresAt: null as string | null,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toComment(
  c: CommentRow,
  author: UserRow | null,
  reactionCount = 0,
  hasReacted = false,
  minorNameCtx?: MinorNameViewerContext,
) {
  return {
    id: c.id,
    postId:
      c.postKind === "article"
        ? articlePostId(c.postRefId)
        : c.postKind === "highlight"
          ? highlightPostId(c.postRefId)
          : orgPostPostId(c.postRefId),
    body: c.deletedAt ? "" : c.body,
    author: {
      id: author?.id ?? null,
      displayName: author ? displayNameForViewer(author, minorNameCtx) : "Deleted user",
      avatarUrl: safeAvatarUrl(author?.avatarUrl ?? null),
    },
    reactionCount,
    hasReacted,
    recentReactorName: null as string | null,
    createdAt: c.createdAt.toISOString(),
    // Task #363 — surface moderation state so the commenter / guardian
    // UI can render an "awaiting parental review" badge on pending rows.
    moderationStatus: (c as { moderationStatus?: string | null })
      .moderationStatus ?? "approved",
  };
}

export function toJoinRequest(
  r: JoinReqRow,
  user: UserRow | null,
  minorNameCtx?: MinorNameViewerContext,
) {
  return {
    id: r.id,
    orgId: r.organizationId,
    userId: r.userId,
    user: user
      ? {
          id: user.id,
          displayName: displayNameForViewer(user, minorNameCtx),
          avatarUrl: safeAvatarUrl(user.avatarUrl),
        }
      : null,
    status: r.status,
    decidedBy: r.decidedById ?? null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function toNotification(n: NotificationRow) {
  return {
    id: n.id,
    type: n.kind,
    title: n.message,
    body: null as string | null,
    data: n.link ? { link: n.link } : null,
    isRead: n.read,
    readAt: null as string | null,
    createdAt: n.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Common 404 response — small wrapper around apiError so route handlers can
// uniformly write `return notFound(res)` instead of repeating the literal.
// ---------------------------------------------------------------------------

export function notFound(res: Response) {
  return apiError(res, 404, "Not found");
}
