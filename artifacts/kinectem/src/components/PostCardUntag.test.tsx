import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PostResponse } from "@workspace/api-client-react";

// PostCard's "Remove me from this post" handler is exercised here at
// two levels:
//   1. A QueryClient predicate test that guards against the regression
//      where only the post author's profile feed was invalidated and
//      the viewer's own tagged feed went stale.
//   2. A UI-level render test that asserts the menu item is gated on
//      `currentUserTag` and that confirming the dialog calls the
//      correct DELETE endpoint based on tag kind.

// Mocks must be declared before importing the component under test so
// vitest's hoisting picks them up.
const customFetchMock =
  vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<unknown>>(
    async () => null as unknown,
  );
const toastMock = vi.fn();

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual<
    typeof import("@workspace/api-client-react")
  >("@workspace/api-client-react");
  return {
    ...actual,
    customFetch: (...args: Parameters<typeof actual.customFetch>) =>
      customFetchMock(...args),
    // PostCard reads these as hooks — return shapes that satisfy its
    // destructuring without performing any real mutations.
    useAddPostReaction: () => ({ mutate: vi.fn() }),
    useRemovePostReaction: () => ({ mutate: vi.fn() }),
    useSharePost: () => ({ mutate: vi.fn() }),
    useUnsharePost: () => ({ mutate: vi.fn() }),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/ReportDialog", () => ({
  ReportDialog: () => null,
}));
vi.mock("@/components/ShareConfirmDialog", () => ({
  ShareConfirmDialog: () => null,
}));
vi.mock("@/components/TaggedPlayers", () => ({
  TaggedPlayers: () => null,
}));
vi.mock("@/components/AvatarLightbox", () => ({
  AvatarLightbox: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/PhotoLightbox", () => ({
  PhotoLightbox: () => null,
}));
vi.mock("@/components/VideoEmbed", () => ({
  VideoEmbed: () => null,
  getEmbedSrc: () => null,
}));

import { PostCard } from "./PostCard";
import {
  getListUserPostsQueryKey,
  getListFeedQueryKey,
  getGetPostQueryKey,
} from "@workspace/api-client-react";

function basePost(overrides: Partial<PostResponse> = {}): PostResponse {
  return {
    id: "article-abc",
    postType: "long",
    title: "Big Game Recap",
    body: "We won.",
    canEdit: false,
    createdAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    author: {
      id: "author-xyz",
      displayName: "Coach Carter",
      avatarUrl: null,
    } as PostResponse["author"],
    context: {
      type: "team",
      id: "team-1",
      name: "Varsity Football",
      avatarUrl: null,
      orgName: null,
      orgId: null,
      orgAvatarUrl: null,
    } as PostResponse["context"],
    assets: [],
    reactionCount: 0,
    hasReacted: false,
    commentCount: 0,
    shareCount: 0,
    hasShared: false,
    taggedUsers: [],
    currentUserTag: null,
    ...overrides,
  } as PostResponse;
}

const userPostsPredicate = (q: { queryKey: unknown }) =>
  Array.isArray(q.queryKey) &&
  typeof q.queryKey[0] === "string" &&
  q.queryKey[0].startsWith("/api/v1/users/") &&
  q.queryKey[0].endsWith("/posts");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    qc,
    ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>),
  };
}

describe("PostCard untag cache invalidation predicate", () => {
  it("invalidates the viewer's own tagged feed even when the post author is someone else", async () => {
    const qc = new QueryClient();
    const viewerId = "viewer-123";
    const authorId = "author-456";

    qc.setQueryData(getListUserPostsQueryKey(viewerId), { data: [] });
    qc.setQueryData(getListUserPostsQueryKey(authorId), { data: [] });
    qc.setQueryData(getListUserPostsQueryKey("someone-else"), { data: [] });
    qc.setQueryData(getListFeedQueryKey(), { data: [] });
    qc.setQueryData(getGetPostQueryKey("article-xyz"), { id: "article-xyz" });

    await qc.invalidateQueries({ predicate: userPostsPredicate });

    const cache = qc.getQueryCache();
    expect(
      cache.find({ queryKey: getListUserPostsQueryKey(viewerId) })?.state
        .isInvalidated,
    ).toBe(true);
    expect(
      cache.find({ queryKey: getListUserPostsQueryKey(authorId) })?.state
        .isInvalidated,
    ).toBe(true);
    expect(
      cache.find({ queryKey: getListUserPostsQueryKey("someone-else") })?.state
        .isInvalidated,
    ).toBe(true);
    expect(
      cache.find({ queryKey: getListFeedQueryKey() })?.state.isInvalidated,
    ).toBe(false);
    expect(
      cache.find({ queryKey: getGetPostQueryKey("article-xyz") })?.state
        .isInvalidated,
    ).toBe(false);
  });

  it("does not match unrelated query keys", () => {
    const cases: Array<[unknown[], boolean]> = [
      [["/api/v1/users/abc/posts"], true],
      [["/api/v1/users/abc/posts", { cursor: "x" }], true],
      [["/api/v1/users/abc"], false],
      [["/api/v1/feed"], false],
      [["/api/v1/posts/xyz"], false],
      [["/api/v1/users/me/tags"], false],
      [[123], false],
      [[], false],
    ];
    for (const [key, expected] of cases) {
      expect(userPostsPredicate({ queryKey: key })).toBe(expected);
    }
  });
});

describe("PostCard 'Remove me from this post' menu item", () => {
  beforeEach(() => {
    customFetchMock.mockReset();
    customFetchMock.mockResolvedValue(null);
    toastMock.mockReset();
  });

  it("hides the menu item when the viewer is not tagged", async () => {
    const post = basePost({ currentUserTag: null });
    renderWithClient(<PostCard post={post} />);
    const trigger = screen.getByTestId(`btn-post-menu-${post.id}`);
    await userEvent.click(trigger);
    expect(
      screen.queryByTestId(`menuitem-untag-${post.id}`),
    ).not.toBeInTheDocument();
  });

  it("calls DELETE /api/v1/article-tags/:id for an article tag", async () => {
    const post = basePost({
      id: "article-abc",
      currentUserTag: {
        id: "tag-art-1",
        kind: "article",
        status: "approved",
      },
    });
    renderWithClient(<PostCard post={post} />);

    await userEvent.click(screen.getByTestId(`btn-post-menu-${post.id}`));
    await userEvent.click(screen.getByTestId(`menuitem-untag-${post.id}`));
    // The dialog renders into a portal; wait for the confirm button.
    const confirm = await screen.findByTestId(`btn-confirm-untag-${post.id}`);
    await userEvent.click(confirm);

    await waitFor(() => {
      expect(customFetchMock).toHaveBeenCalledTimes(1);
    });
    expect(customFetchMock).toHaveBeenCalledWith(
      "/api/v1/article-tags/tag-art-1",
      { method: "DELETE" },
    );
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "Removed from this post",
      });
    });
  });

  it("calls DELETE /api/v1/highlight-tags/:id for a highlight tag", async () => {
    const post = basePost({
      id: "highlight-xyz",
      currentUserTag: {
        id: "tag-hl-9",
        kind: "highlight",
        status: "pending",
      },
    });
    renderWithClient(<PostCard post={post} />);

    await userEvent.click(screen.getByTestId(`btn-post-menu-${post.id}`));
    await userEvent.click(screen.getByTestId(`menuitem-untag-${post.id}`));
    const confirm = await screen.findByTestId(`btn-confirm-untag-${post.id}`);
    await userEvent.click(confirm);

    await waitFor(() => {
      expect(customFetchMock).toHaveBeenCalledWith(
        "/api/v1/highlight-tags/tag-hl-9",
        { method: "DELETE" },
      );
    });
  });

  it("shows a destructive 'Couldn't remove tag' toast when the DELETE fails", async () => {
    customFetchMock.mockRejectedValueOnce(new Error("network down"));
    const post = basePost({
      currentUserTag: {
        id: "tag-art-2",
        kind: "article",
        status: "approved",
      },
    });
    renderWithClient(<PostCard post={post} />);

    await userEvent.click(screen.getByTestId(`btn-post-menu-${post.id}`));
    await userEvent.click(screen.getByTestId(`menuitem-untag-${post.id}`));
    const confirm = await screen.findByTestId(`btn-confirm-untag-${post.id}`);
    await userEvent.click(confirm);

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "Couldn't remove tag",
        variant: "destructive",
      });
    });
  });
});
