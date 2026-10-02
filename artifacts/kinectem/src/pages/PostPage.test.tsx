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
  GamePhotoAlbum: () => <div data-testid="game-photo-album" />,
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
  it("does not imply a team album on a direct school historical recap", async () => {
    customFetchMock.mockResolvedValue({
      ...(postFixture({ canEdit: true, canDelete: true }, "orgpost-history") as object),
      recapKind: "historical",
      historical: { gameDate: null, year: 1974, newspaper: "Gazette", byline: null, publicationDate: null,
        rightsConfirmed: true, reviewed: true },
      context: { type: "organization", id: "school-1", name: "School" },
    });
    renderWithProviders(<PostPage />);
    expect(await screen.findByText("Match recap")).toBeTruthy();
    expect(screen.queryByTestId("game-photo-album")).toBeNull();
    expect(screen.getByText(/1974/)).toBeTruthy();
  });

  it("leaves ordinary organization Update albums unchanged", async () => {
    customFetchMock.mockResolvedValue({
      ...(postFixture({ canEdit: true, canDelete: true }, "orgpost-update") as object),
      context: { type: "organization", id: "school-1", name: "School" },
    });
    renderWithProviders(<PostPage />);
    expect(await screen.findByTestId("game-photo-album")).toBeTruthy();
  });
  beforeEach(() => {
    customFetchMock.mockReset();
    deleteMutateAsyncMock.mockReset().mockResolvedValue(undefined);
    resetToastMock();
  });

  afterEach(() => cleanup());

  it("uses the compact shared section rhythm for every post detail type", async () => {
    customFetchMock.mockResolvedValue(
      postFixture({ canEdit: false, canDelete: false }),
    );

    renderWithProviders(<PostPage />);

    expect(await screen.findByTestId("post-detail-layout")).toHaveClass(
      "space-y-4",
    );
    expect(screen.getByTestId("post-detail-layout")).not.toHaveClass(
      "space-y-6",
    );
  });

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

    await screen.findByRole("heading", { name: "Match recap" });
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

    await screen.findByRole("heading", { name: "Match recap" });
    expect(screen.queryByTestId("button-delete-post")).not.toBeInTheDocument();
  });

  it("keeps the published title on one fitted line", async () => {
    customFetchMock.mockResolvedValue(
      postFixture({ canEdit: false, canDelete: false }),
    );

    renderWithProviders(<PostPage />);

    const title = await screen.findByRole("heading", { name: "Match recap" });
    expect(title.lastElementChild).toHaveClass(
      "overflow-hidden",
      "text-ellipsis",
      "whitespace-nowrap",
    );
  });
});