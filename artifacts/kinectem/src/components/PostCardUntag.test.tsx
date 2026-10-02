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
const shareSuccess = vi.hoisted(() => ({ current: (() => {}) as () => void }));

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
    useSharePost: (options: { mutation: { onSuccess: () => void } }) => {
      shareSuccess.current = options.mutation.onSuccess;
      return { mutate: vi.fn() };
    },
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

it("refreshes both destination lists after sharing direct school history and omits the team Media control", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const teamKey = ["/api/v1/teams/team-1/posts"];
  const orgKey = ["/api/v1/organizations/school-1/posts"];
  qc.setQueryData(teamKey, { data: [] });
  qc.setQueryData(orgKey, { data: [] });
  const post = {
    ...basePost({ id: "orgpost-history" }),
    recapKind: "historical",
    historical: { gameDate: null, year: 1974, newspaper: null, byline: null, publicationDate: null,
      rightsConfirmed: true, reviewed: true },
    context: { type: "organization", id: "school-1", name: "School" },
  } as unknown as PostResponse;
  render(<QueryClientProvider client={qc}><PostCard post={post} /></QueryClientProvider>);
  expect(screen.getByTestId("button-share-orgpost-history")).toBeTruthy();
  expect(screen.queryByTestId("button-album-orgpost-history")).toBeNull();
  shareSuccess.current();
  await waitFor(() => expect(qc.getQueryCache().find({ queryKey: orgKey })?.state.isInvalidated).toBe(true));
  expect(qc.getQueryCache().find({ queryKey: teamKey })?.state.isInvalidated).toBe(true);
});

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    qc,
    ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>),
  };
}

describe("Historical recap deletion", () => {
  beforeEach(() => {
    customFetchMock.mockReset().mockResolvedValue(null);
    toastMock.mockClear();
  });

  function historicalPost(id = "article-history", canEdit = true): PostResponse {
    return {
      ...basePost({ id, canEdit, canDelete: false }),
      recapKind: "historical",
      historical: {
        gameDate: null, year: 1974, newspaper: "Local Gazette",
        byline: null, publicationDate: null, rightsConfirmed: true, reviewed: true,
      },
      context: {
        ...basePost().context,
        ...(id.startsWith("orgpost-") ? { type: "organization", id: "school-1" } : {}),
      },
    } as unknown as PostResponse;
  }

  it.each(["article-history", "orgpost-history"])(
    "confirms deletion of %s and refreshes every historical post surface",
    async (id) => {
      const user = userEvent.setup();
      const { qc } = renderWithClient(<PostCard post={historicalPost(id)} />);
      const keys = [
        ["/api/v1/feed"],
        ["/api/v1/teams/team-1/posts", "infinite"],
        ["/api/v1/organizations/school-1/posts", "infinite"],
        ["/api/v1/users/user-1/posts"],
        ["/api/v1/posts/drafts"],
        ["/api/v1/posts/" + id],
      ];
      keys.forEach((key) => qc.setQueryData(key, { data: [] }));
      await user.click(screen.getByTestId(`btn-post-menu-${id}`));
      await user.click(screen.getByTestId(`menuitem-delete-historical-${id}`));
      expect(screen.getByRole("alertdialog")).toHaveTextContent("original newspaper clipping");
      expect(customFetchMock).not.toHaveBeenCalled();
      await user.click(screen.getByTestId(`confirm-delete-historical-${id}`));
      await waitFor(() => expect(customFetchMock).toHaveBeenCalledWith(
        `/api/v1/posts/${id}`, { method: "DELETE" },
      ));
      expect(screen.queryByTestId(`btn-post-menu-${id}`)).not.toBeInTheDocument();
      keys.forEach((key) =>
        expect(qc.getQueryCache().find({ queryKey: key })?.state.isInvalidated).toBe(true),
      );
    },
  );

  it("does not offer deletion to an ordinary viewer", async () => {
    const user = userEvent.setup();
    renderWithClient(<PostCard post={historicalPost("article-history", false)} />);
    await user.click(screen.getByTestId("btn-post-menu-article-history"));
    expect(screen.queryByTestId("menuitem-delete-historical-article-history")).not.toBeInTheDocument();
  });

  it("keeps the recap when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    renderWithClient(<PostCard post={historicalPost()} />);
    await user.click(screen.getByTestId("btn-post-menu-article-history"));
    await user.click(screen.getByTestId("menuitem-delete-historical-article-history"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(customFetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("btn-post-menu-article-history")).toBeInTheDocument();
  });

  it("keeps the recap and confirmation available if deletion fails", async () => {
    customFetchMock.mockRejectedValueOnce(new Error("Request failed"));
    const user = userEvent.setup();
    renderWithClient(<PostCard post={historicalPost()} />);
    await user.click(screen.getByTestId("btn-post-menu-article-history"));
    await user.click(screen.getByTestId("menuitem-delete-historical-article-history"));
    await user.click(screen.getByTestId("confirm-delete-historical-article-history"));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't delete the historical recap", variant: "destructive",
    })));
    expect(screen.getByTestId("btn-post-menu-article-history")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-delete-historical-article-history")).toBeEnabled();
  });
});

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

describe("PostCard news chronology", () => {
  it("labels the Kinectem posting date separately from the game date", () => {
    const post = basePost({
      id: "news-article-1",
      title: "Wolves take the playoff opener",
      createdAt: "2026-08-23T14:00:00.000Z",
      gameDate: "2026-08-16T00:00:00.000Z",
    }) as PostResponse & {
      newsLink: { url: string; sourceName: string | null };
    };
    post.newsLink = {
      url: "https://localpaper.example/sports/wolves-win",
      sourceName: "Local Paper",
    };

    renderWithClient(<PostCard post={post} />);

    expect(screen.getByTestId("news-dates-news-article-1")).toHaveTextContent(
      "Posted on Kinectem: Aug 23, 2026",
    );
    expect(screen.getByTestId("news-dates-news-article-1")).toHaveTextContent(
      "Game played: Aug 16, 2026",
    );
  });

  it("keeps legacy news cards readable when no game date was saved", () => {
    const post = basePost({
      id: "news-article-legacy",
      title: "Wolves in the community",
      createdAt: "2026-08-23T14:00:00.000Z",
      gameDate: null,
    }) as PostResponse & {
      newsLink: { url: string; sourceName: string | null };
    };
    post.newsLink = {
      url: "https://localpaper.example/sports/wolves-community",
      sourceName: null,
    };

    renderWithClient(<PostCard post={post} />);

    const dates = screen.getByTestId("news-dates-news-article-legacy");
    expect(dates).toHaveTextContent("Posted on Kinectem: Aug 23, 2026");
    expect(dates).not.toHaveTextContent("Game played:");
  });
});

describe("PostCard compact mobile header", () => {
  const longContext = {
    type: "team",
    id: "team-with-a-long-name",
    name: "2014 Boys Premier National Championship Soccer Team",
    avatarUrl: null,
    orgName: "Parsippany Soccer Club and Community Athletic Organization",
    orgId: "org-with-a-long-name",
    orgAvatarUrl: null,
  } as PostResponse["context"];

  const cases = [
    {
      name: "ordinary update",
      post: () =>
        basePost({
          id: "orgpost-mobile-update",
          postType: "long",
          gameDate: null,
          context: longContext,
        }),
      badge: "Update",
    },
    {
      name: "highlight",
      post: () =>
        basePost({
          id: "highlight-mobile",
          postType: "short",
          context: longContext,
        }),
      badge: "Highlight",
    },
    {
      name: "news article",
      post: () => {
        const post = basePost({
          id: "news-mobile",
          context: longContext,
        }) as PostResponse & {
          newsLink: { url: string; sourceName: string | null };
        };
        post.newsLink = {
          url: "https://localpaper.example/long-team-story",
          sourceName: "Local Paper",
        };
        return post;
      },
      badge: "In the News",
    },
    {
      name: "shared post",
      post: () =>
        ({
          ...basePost({
            id: "highlight-mobile-shared",
            postType: "short",
            context: longContext,
          }),
          sharedBy: {
            id: "sharing-user",
            displayName: "A Supporter With A Long Display Name",
          },
        }) as Parameters<typeof PostCard>[0]["post"],
      badge: "Highlight",
    },
  ];

  it.each(cases)(
    "reserves the mobile upper-right controls for a $name while restoring the inline desktop layout",
    ({ post: makePost, badge }) => {
      const post = makePost();
      renderWithClient(<PostCard post={post} />);

      expect(
        screen.getByTestId(`post-header-${post.id}`),
      ).toHaveClass("relative");
      expect(
        screen.getByTestId(`post-header-identity-${post.id}`),
      ).toHaveClass("w-full", "pt-7", "sm:w-auto", "sm:pt-0");
      expect(
        screen.getByTestId(`post-header-actions-${post.id}`),
      ).toHaveClass("absolute", "right-4", "top-2", "sm:static");
      expect(
        screen.getByTestId(`text-post-parent-org-${post.id}`),
      ).toHaveTextContent(
        "PARSIPPANY SOCCER CLUB AND COMMUNITY ATHLETIC ORGANIZATION",
      );
      expect(
        screen.getByText("2014 Boys Premier National Championship Soccer Team"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(`link-post-author-${post.id}`),
      ).toHaveTextContent("Coach Carter");
      expect(
        screen.getByTestId(`badge-post-type-${post.id}`),
      ).toHaveTextContent(badge);
      expect(
        screen.getByTestId(`btn-post-menu-${post.id}`),
      ).toHaveAccessibleName("Post actions");
    },
  );
});
