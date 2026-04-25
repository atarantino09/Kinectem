import type { Response } from "express";
import type {
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
  } = {},
) {
  const { firstName, lastName } = splitName(u.name);
  return {
    id: u.id,
    firstName,
    lastName,
    nickname: u.nickname ?? null,
    bio: u.bio ?? null,
    avatarUrl: u.avatarUrl ?? null,
    coverPhotoUrl: null as string | null,
    isOwnProfile: opts.isOwnProfile ?? false,
    isFollowing: opts.isFollowing ?? false,
    isConnection: false,
    followerCount: opts.followerCount ?? 0,
    followingCount: opts.followingCount ?? 0,
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
    }),
    email: u.email ?? "",
    dateOfBirth: u.dateOfBirth ? u.dateOfBirth.toISOString().slice(0, 10) : null,
    role: u.role,
    parentId: u.parentId ?? null,
  };
}

export function toPostAuthor(u: UserRow) {
  return {
    id: u.id,
    displayName: displayName(u),
    avatarUrl: u.avatarUrl ?? null,
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
    avatarUrl: o.logoUrl ?? null,
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
    avatarUrl: u.avatarUrl ?? null,
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
  opts: { followerCount?: number; isFollowing?: boolean; memberCount?: number } = {},
) {
  return {
    id: t.id,
    organization: toOrganizationEmbed(org),
    name: t.name,
    slug: slugify(t.name),
    description: t.description ?? null,
    sport: t.sport ?? null,
    level: t.level ?? null,
    avatarUrl: t.logoUrl ?? null,
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
    avatarUrl: u.avatarUrl ?? null,
    teamId: r.teamId,
    seasonId: r.teamId,
    role: (r.role === "coach" ? "admin" : "member") as "owner" | "admin" | "member",
    position: rosterPositionToSpec(r.role, r.position) as
      | "player"
      | "coach"
      | "assistant_coach"
      | "manager"
      | "parent",
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
      | "manager"
      | "parent"
      | null,
    role: (i.role === "coach" ? "admin" : "member") as "owner" | "admin" | "member",
    status: i.status as "pending" | "accepted" | "declined" | "expired" | "withdrawn" | "resolved",
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
    ? toPostAuthor(p.extras.author)
    : { id: "system", displayName: "System", avatarUrl: null };
  const team = p.extras.team;
  const context = team
    ? {
        type: "team" as const,
        id: team.id,
        name: team.name,
        slug: slugify(team.name),
        orgSlug: slugify(p.extras.org.name),
        avatarUrl: team.logoUrl ?? null,
      }
    : {
        type: "organization" as const,
        id: p.extras.org.id,
        name: p.extras.org.name,
        slug: slugify(p.extras.org.name),
        orgSlug: null,
        avatarUrl: p.extras.org.logoUrl ?? null,
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
      avatarUrl: participant.avatarUrl,
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
    senderAvatarUrl: sender?.avatarUrl ?? null,
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
      displayName: author ? displayName(author) : "Deleted user",
      avatarUrl: author?.avatarUrl ?? null,
    },
    reactionCount,
    hasReacted,
    recentReactorName: null as string | null,
    createdAt: c.createdAt.toISOString(),
  };
}

export function toJoinRequest(
  r: JoinReqRow,
  user: UserRow | null,
) {
  return {
    id: r.id,
    orgId: r.organizationId,
    userId: r.userId,
    user: user
      ? {
          id: user.id,
          displayName: displayName(user),
          avatarUrl: user.avatarUrl ?? null,
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
