import type {
  users,
  organizations,
  teams,
  rosterEntries,
  rosterInvites,
  articles,
  highlights,
  notifications,
} from "@workspace/db";

type UserRow = typeof users.$inferSelect;
type OrgRow = typeof organizations.$inferSelect;
type TeamRow = typeof teams.$inferSelect;
type RosterRow = typeof rosterEntries.$inferSelect;
type InviteRow = typeof rosterInvites.$inferSelect;
type ArticleRow = typeof articles.$inferSelect;
type HighlightRow = typeof highlights.$inferSelect;
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
export function parsePostId(postId: string): { kind: "article" | "highlight"; id: string } | null {
  if (postId.startsWith("article-")) return { kind: "article", id: postId.slice(8) };
  if (postId.startsWith("highlight-")) return { kind: "highlight", id: postId.slice(10) };
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

export function toPublicUser(u: UserRow, opts: { isOwnProfile?: boolean; isFollowing?: boolean } = {}) {
  const { firstName, lastName } = splitName(u.name);
  return {
    id: u.id,
    firstName,
    lastName,
    nickname: null as string | null,
    bio: u.bio ?? null,
    avatarUrl: u.avatarUrl ?? null,
    coverPhotoUrl: null as string | null,
    isOwnProfile: opts.isOwnProfile ?? false,
    isFollowing: opts.isFollowing ?? false,
    isConnection: false,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.createdAt.toISOString(),
  };
}

export function toPrivateUser(u: UserRow) {
  return {
    ...toPublicUser(u, { isOwnProfile: true }),
    email: u.email ?? "",
    dateOfBirth: u.dateOfBirth ? u.dateOfBirth.toISOString().slice(0, 10) : null,
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
  } = {},
) {
  return {
    id: o.id,
    name: o.name,
    slug: slugify(o.name),
    description: o.description ?? null,
    website: null as string | null,
    city: o.city ?? null,
    state: o.state ?? null,
    isMember: opts.isMember ?? false,
    role: opts.role ?? null,
    isFollowing: opts.isFollowing ?? false,
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
    description: null as string | null,
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
};
function rosterPositionToSpec(role: string, position: string | null): string {
  if (role === "coach") {
    if (position?.toLowerCase().includes("assistant")) return "assistant_coach";
    if (position?.toLowerCase().includes("manager")) return "manager";
    return "coach";
  }
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
  team: TeamRow;
  org: OrgRow;
  author: UserRow | null;
  reactionCount?: number;
  hasReacted?: boolean;
  commentCount?: number;
  recentReactorName?: string | null;
}

export function articleToPost(a: ArticleRow, extras: PostExtras) {
  const assets = a.coverImageUrl
    ? [
        {
          id: `cover-${a.id}`,
          fileType: "image/jpeg",
          url: a.coverImageUrl,
          displayOrder: 0,
        },
      ]
    : [];
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
    extras,
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
  extras: PostExtras;
}) {
  const author = p.extras.author
    ? toPostAuthor(p.extras.author)
    : { id: "system", displayName: "System", avatarUrl: null };
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
    author,
    context: {
      type: "team" as const,
      id: p.extras.team.id,
      name: p.extras.team.name,
      slug: slugify(p.extras.team.name),
      orgSlug: slugify(p.extras.org.name),
      avatarUrl: p.extras.team.logoUrl ?? null,
    },
    assets: p.assets,
    reactionCount: p.extras.reactionCount ?? 0,
    hasReacted: p.extras.hasReacted ?? false,
    commentCount: p.extras.commentCount ?? 0,
    recentReactorName: p.extras.recentReactorName ?? null,
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
