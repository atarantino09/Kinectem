import type {
  users,
  organizations,
  teams,
  articles,
  highlights,
  rosterEntries,
  rosterInvites,
  notifications,
} from "@workspace/db";

export function toUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    email: u.email ?? undefined,
    sport: u.sport ?? undefined,
    position: u.position ?? undefined,
    jerseyNumber: u.jerseyNumber ?? undefined,
    grade: u.grade ?? undefined,
    location: u.location ?? undefined,
    avatarUrl: u.avatarUrl ?? undefined,
    bio: u.bio ?? undefined,
    dateOfBirth: u.dateOfBirth ?? undefined,
    parentId: u.parentId ?? undefined,
    requireTagConsent: u.requireTagConsent,
  };
}

export function toOrganization(o: typeof organizations.$inferSelect) {
  return {
    id: o.id,
    name: o.name,
    sport: o.sport ?? undefined,
    location: o.location ?? undefined,
    description: o.description ?? undefined,
    logoUrl: o.logoUrl ?? undefined,
    bannerUrl: o.bannerUrl ?? undefined,
    followerCount: 0,
  };
}

export function toTeam(t: typeof teams.$inferSelect) {
  return {
    id: t.id,
    name: t.name,
    organizationId: t.organizationId,
    sport: t.sport ?? undefined,
    season: t.season ?? undefined,
  };
}

export function toTeamSummary(
  t: typeof teams.$inferSelect,
  extras: { organizationName: string; playerCount?: number },
) {
  return {
    id: t.id,
    name: t.name,
    organizationId: t.organizationId,
    organizationName: extras.organizationName,
    sport: t.sport ?? undefined,
    season: t.season ?? undefined,
    playerCount: extras.playerCount,
  };
}

export function scoreString(teamScore: number | null, opponentScore: number | null): string | undefined {
  if (teamScore == null || opponentScore == null) return undefined;
  return `${teamScore}-${opponentScore}`;
}

export function toArticle(
  a: typeof articles.$inferSelect,
  extras: {
    teamName?: string;
    taggedUsers?: ReturnType<typeof toUser>[];
    author?: ReturnType<typeof toUser>;
    coAuthors?: ReturnType<typeof toUser>[];
  },
) {
  return {
    id: a.id,
    title: a.title,
    teamId: a.teamId,
    teamName: extras.teamName,
    opponentName: a.opponentName ?? undefined,
    gameDate: a.gameDate ?? undefined,
    gameScore: scoreString(a.teamScore, a.opponentScore),
    snippet: a.summary ?? undefined,
    body: a.body,
    coverImageUrl: a.coverImageUrl ?? undefined,
    videoUrl: a.videoUrl ?? undefined,
    photoUrls: a.photoUrls ?? undefined,
    status: a.status,
    publishedAt: a.publishedAt ?? undefined,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    author: extras.author,
    coAuthors: extras.coAuthors,
    taggedUsers: extras.taggedUsers,
  };
}

export function toHighlight(
  h: typeof highlights.$inferSelect,
  extras: {
    teamName?: string;
    articleId?: string;
    articleTitle?: string;
    taggedUsers?: ReturnType<typeof toUser>[];
  },
) {
  return {
    id: h.id,
    title: h.title,
    teamId: h.teamId,
    teamName: extras.teamName,
    articleId: extras.articleId,
    articleTitle: extras.articleTitle,
    thumbnailUrl: h.thumbnailUrl ?? undefined,
    videoUrl: h.videoUrl,
    durationSeconds: h.durationSeconds ?? undefined,
    createdAt: h.createdAt,
    taggedUsers: extras.taggedUsers,
  };
}

export function toRosterEntry(
  r: typeof rosterEntries.$inferSelect,
  user: ReturnType<typeof toUser>,
) {
  return {
    id: r.id,
    teamId: r.teamId,
    user,
    role: r.role,
    status: r.status,
    position: r.position ?? undefined,
    jerseyNumber: r.jerseyNumber ?? undefined,
    grade: user.grade,
  };
}

export function toRosterInvite(i: typeof rosterInvites.$inferSelect) {
  return {
    id: i.id,
    token: i.token,
    teamId: i.teamId,
    invitedEmail: i.invitedEmail,
    invitedName: i.invitedName ?? undefined,
    role: i.role,
    position: i.position ?? undefined,
    jerseyNumber: i.jerseyNumber ?? undefined,
    grade: i.grade ?? undefined,
    status: i.status,
    createdAt: i.createdAt,
  };
}

export function toNotification(n: typeof notifications.$inferSelect) {
  return {
    id: n.id,
    kind: n.kind,
    message: n.message,
    link: n.link ?? undefined,
    read: n.read,
    createdAt: n.createdAt,
  };
}
