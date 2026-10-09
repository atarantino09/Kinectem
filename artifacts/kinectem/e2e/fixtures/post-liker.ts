import type { PostResponse } from "@workspace/api-client-react";

export function likerPost(
  overrides: Partial<PostResponse> = {},
): PostResponse & { articleStatus: string; albumPhotoCount: number } {
  return {
    id: "article-layout",
    postType: "long",
    title: "Layout regression recap",
    body: "A published game recap.",
    createdAt: "2026-10-01T12:00:00Z",
    publishedAt: "2026-10-01T12:00:00Z",
    gameDate: "2026-10-01",
    author: { id: "coach-layout", displayName: "Coach", avatarUrl: null },
    context: {
      type: "team", id: "team-layout", name: "Varsity",
      avatarUrl: null, orgName: null, orgId: null, orgAvatarUrl: null,
    },
    assets: [],
    reactionCount: 4,
    recentReactorName: "Alex Supporter",
    hasReacted: false,
    commentCount: 2,
    shareCount: 1,
    hasShared: false,
    canEdit: false,
    taggedUsers: [],
    currentUserTag: null,
    articleStatus: "published",
    albumPhotoCount: 3,
    ...overrides,
  } as PostResponse & { articleStatus: string; albumPhotoCount: number };
}
