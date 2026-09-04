import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { renderWithProviders } from "@/test";
import { wouterMock } from "@/test/mocks/wouter";
import { resetToastMock, useToastMock } from "@/test/mocks/toast";

const POST_ID = "article-post-1";
const customFetchMock = vi.fn();
const deleteMutateAsyncMock = vi.fn();

vi.mock("wouter", () => ({
  ...wouterMock,
  useParams: () => ({ postId: POST_ID }),
}));
vi.mock("@/hooks/use-toast", () => useToastMock);

vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => customFetchMock(...args),
  getGetPostQueryKey: (postId: string) => ["post", postId],
  getListFeedQueryKey: () => ["feed"],
  getListOrgPostApprovalsQueryKey: (orgId: string) => ["org-approvals", orgId],
  getListOrgPostsQueryKey: (orgId: string) => ["org-posts", orgId],
  getListTeamPostsQueryKey: (teamId: string) => ["team-posts", teamId],
  getListUserPostsQueryKey: (userId: string) => ["user-posts", userId],
  useApproveOrgPostApproval: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeclineOrgPostApproval: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeletePost: () => ({
    isPending: false,
    mutateAsync: deleteMutateAsyncMock,
  }),
  useListOrgPostApprovals: () => ({ data: { data: [] } }),
  useUpdatePost: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("@/components/PostInteractions", () => ({
  PostInteractions: () => null,
}));
vi.mock("@/components/GamePhotoAlbum", () => ({
  GamePhotoAlbum: () => null,
}));
vi.mock("@/components/AvatarLightbox", () => ({
  AvatarLightbox: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/VideoEmbed", () => ({ VideoEmbed: () => null }));
vi.mock("@/components/TaggedPlayers", () => ({ TaggedPlayers: () => null }));
vi.mock("@/components/TakedownDialog", () => ({ TakedownDialog: () => null }));
vi.mock("@/components/share-image/ShareRecapImageDialog", () => ({
  ShareRecapImageDialog: () => null,
}));

import PostPage from "./PostPage";

const postFixture = (
  permissions: { canEdit: boolean; canDelete: boolean },
  id = POST_ID,
) =>
  ({
    id,
    postType: "article",
    title: "Match recap",
    description: null,
    body: "A recap body",
    createdAt: "2025-01-01T00:00:00.000Z",
    isEdited: false,
    canEdit: permissions.canEdit,
    canDelete: permissions.canDelete,
    author: {
      id: "author-1",
      displayName: "Author",
      avatarUrl: null,
    },
    context: {
      id: "user-1",
      type: "user",
      name: "Author",
    },
    ...(id.startsWith("news-")
      ? {
          newsLink: {
            url: "https://example.com/news",
            sourceName: "Example News",
          },
        }
      : {}),
    assets: [],
  }) as never;

describe("PostPage delete permissions", () => {
  beforeEach(() => {
    customFetchMock.mockReset();
    deleteMutateAsyncMock.mockReset().mockResolvedValue(undefined);
    resetToastMock();
  });

  afterEach(() => cleanup());

  it("gives a delete-only moderator the existing confirmation and DELETE mutation", async () => {
    customFetchMock.mockResolvedValue(
      postFixture({ canEdit: false, canDelete: true }),
    );
    const user = userEvent.setup();

    renderWithProviders(<PostPage />);

    await screen.findByTestId("button-delete-post");
    expect(screen.queryByTestId("button-edit-post")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("button-delete-post"));
    await user.click(await screen.findByTestId("button-delete-post-confirm"));

    await waitFor(() =>
      expect(deleteMutateAsyncMock).toHaveBeenCalledWith({ postId: POST_ID }),
    );
  });

  it("does not offer edit or delete to an unauthorized viewer", async () => {
    customFetchMock.mockResolvedValue(
      postFixture({ canEdit: false, canDelete: false }),
    );

    renderWithProviders(<PostPage />);

    await screen.findByText("Match recap");
    expect(screen.queryByTestId("button-edit-post")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-delete-post")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("button-post-actions-menu"),
    ).not.toBeInTheDocument();
  });

  it("does not offer the generic delete action for news posts", async () => {
    customFetchMock.mockResolvedValue(
      postFixture({ canEdit: false, canDelete: true }, "news-news-1"),
    );

    renderWithProviders(<PostPage />);

    await screen.findByText("Match recap");
    expect(screen.queryByTestId("button-delete-post")).not.toBeInTheDocument();
  });
});