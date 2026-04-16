import type { users, organizations, teams, articles, highlights, rosterEntries } from "@workspace/db";

export function toUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    sport: u.sport ?? undefined,
    position: u.position ?? undefined,
    jerseyNumber: u.jerseyNumber ?? undefined,
    grade: u.grade ?? undefined,
    location: u.location ?? undefined,
    avatarUrl: u.avatarUrl ?? undefined,
    bio: u.bio ?? undefined,
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

export function toTeam(t: typeof teams.$inferSelect, extras?: { wins?: number; losses?: number; ties?: number }) {
  return {
    id: t.id,
    name: t.name,
    organizationId: t.organizationId,
    sport: t.sport ?? undefined,
    season: t.season ?? undefined,
    wins: extras?.wins,
    losses: extras?.losses,
    ties: extras?.ties,
  };
}

export function toTeamSummary(
  t: typeof teams.$inferSelect,
  extras: { organizationName: string; playerCount?: number; wins?: number; losses?: number; ties?: number },
) {
  return {
    id: t.id,
    name: t.name,
    organizationId: t.organizationId,
    organizationName: extras.organizationName,
    sport: t.sport ?? undefined,
    season: t.season ?? undefined,
    wins: extras.wins,
    losses: extras.losses,
    ties: extras.ties,
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
    createdAt: a.createdAt,
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
    position: r.position ?? undefined,
    jerseyNumber: r.jerseyNumber ?? undefined,
    grade: user.grade,
  };
}
