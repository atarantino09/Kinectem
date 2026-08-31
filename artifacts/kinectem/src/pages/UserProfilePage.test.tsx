import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "@/test";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const VIEWER_ID = "22222222-2222-4222-8222-222222222222";

const useGetUserByIdMock = vi.fn();
const useGetLoggedInUserMock = vi.fn();
const useListUserTeamsMock = vi.fn();

vi.mock("wouter", () => ({
  useParams: () => ({ userId: PROFILE_ID }),
  useLocation: () => ["/users/" + PROFILE_ID, vi.fn()],
  Link: ({
    href,
    children,
  }: {
    href: string;
    children: ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useInfiniteQuery: () => ({
      data: {
        pages: [
          {
            data: [],
            pagination: { hasMore: false, nextCursor: null },
          },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
    }),
  };
});

vi.mock("@workspace/api-client-react", () => ({
  useGetUserById: (...args: unknown[]) => useGetUserByIdMock(...args),
  useGetLoggedInUser: (...args: unknown[]) =>
    useGetLoggedInUserMock(...args),
  useGetUserSports: () => ({ data: { sports: [] } }),
  getGetUserSportsQueryKey: (id: string) => [`/api/v1/users/${id}/sports`],
  listUserPosts: vi.fn(),
  getListUserPostsQueryKey: (id: string) => [`/api/v1/users/${id}/posts`],
  useListUserOrganizations: () => ({ data: { data: [] } }),
  useListUserTeams: (...args: unknown[]) => useListUserTeamsMock(...args),
  useFollowUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnfollowUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateConversation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  getGetUserByIdQueryKey: (id: string) => [`/api/v1/users/${id}`],
  getListFeedQueryKey: () => ["/api/v1/feed"],
  getListConversationsQueryKey: () => ["/api/v1/conversations"],
  getGetUnreadMessageCountQueryKey: () => [
    "/api/v1/conversations/unread-count",
  ],
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsLg: () => false,
}));

vi.mock("@/hooks/usePinnedTeams", () => ({
  usePinnedTeams: () => ({
    pinnedSet: new Set<string>(),
    pinnedIds: [],
    togglePin: vi.fn(),
    enabled: false,
  }),
}));

vi.mock("@/hooks/useInfiniteScrollSentinel", () => ({
  useInfiniteScrollSentinel: () => vi.fn(),
}));

vi.mock("@/components/PostCard", () => ({
  PostCard: () => null,
}));

vi.mock("@/components/EditProfileDialog", () => ({
  EditProfileDialog: () => <button type="button">Edit profile</button>,
}));

vi.mock("@/components/FollowListDialog", () => ({
  FollowListDialog: () => null,
}));

vi.mock("@/components/AvatarLightbox", () => ({
  AvatarLightbox: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import UserProfilePage from "./UserProfilePage";

function profileFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    firstName: "Taylor",
    lastName: "Player",
    displayName: "Taylor Player",
    email: "taylor@example.test",
    role: "athlete",
    avatarUrl: null,
    coverPhotoUrl: null,
    bio: null,
    city: null,
    state: null,
    parentId: null,
    isMinor: true,
    isOwnProfile: true,
    isFollowing: false,
    followerCount: 0,
    followingCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useListUserTeamsMock.mockReturnValue({ data: { data: [] } });
});

describe("UserProfilePage profile highlight action", () => {
  it("lets a signed-in child launch a profile-only highlight from their own profile", () => {
    useGetUserByIdMock.mockReturnValue({
      data: profileFixture(),
      isLoading: false,
    });
    useGetLoggedInUserMock.mockReturnValue({
      data: { id: PROFILE_ID, role: "athlete" },
    });
    useListUserTeamsMock.mockReturnValue({
      data: { data: [{ teamId: "team-1", teamName: "Team One" }] },
    });

    renderWithProviders(<UserProfilePage />);

    const action = screen.getByTestId("btn-post-profile-highlight");
    expect(action).toHaveTextContent("Post highlight");
    expect(action.closest("section")).toContainElement(
      screen.getByRole("heading", { name: "Posts" }),
    );
    expect(action.closest("section")).toContainElement(
      screen.getByTestId("select-team-filter"),
    );
    expect(action.closest("a")).toHaveAttribute(
      "href",
      `/posts/new?type=short&profileOnly=1&from=${encodeURIComponent(`/users/${PROFILE_ID}`)}`,
    );
  });

  it("does not let a guardian post from the child's profile", () => {
    useGetUserByIdMock.mockReturnValue({
      data: profileFixture({
        isOwnProfile: false,
        parentId: VIEWER_ID,
      }),
      isLoading: false,
    });
    useGetLoggedInUserMock.mockReturnValue({
      data: { id: VIEWER_ID, role: "parent" },
    });

    renderWithProviders(<UserProfilePage />);

    expect(
      screen.queryByTestId("btn-post-profile-highlight"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("parent-actions")).toBeInTheDocument();
  });
});