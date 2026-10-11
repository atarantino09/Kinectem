import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { renderWithProviders } from "@/test";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const VIEWER_ID = "22222222-2222-4222-8222-222222222222";

const useGetUserByIdMock = vi.fn();
const useGetLoggedInUserMock = vi.fn();
const useListUserTeamsMock = vi.fn();
const useListUserOrganizationsMock = vi.fn();
const useGetUserSportsMock = vi.fn();

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
  useListUserChildren: () => ({ data: { data: [] } }),
  getListUserChildrenQueryKey: (id: string) => [`/api/v1/users/${id}/children`],
  useGetUserSports: (...args: unknown[]) => useGetUserSportsMock(...args),
  getGetUserSportsQueryKey: (id: string) => [`/api/v1/users/${id}/sports`],
  listUserPosts: vi.fn(),
  getListUserPostsQueryKey: (id: string) => [`/api/v1/users/${id}/posts`],
  useListUserOrganizations: (...args: unknown[]) => useListUserOrganizationsMock(...args),
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
  useListUserOrganizationsMock.mockReturnValue({ data: { data: [] } });
  useGetUserSportsMock.mockReturnValue({ data: { sports: [] } });
});

describe("UserProfilePage organizations", () => {
  const organizations = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `org-${i + 1}`,
      name: `Organization ${i + 1}`,
      logoUrl: null,
      role: "member",
      isMember: true,
      isFollowing: false,
    }));

  it("labels following-only organizations Follower and real memberships Member", () => {
    useGetUserByIdMock.mockReturnValue({ data: profileFixture(), isLoading: false });
    useGetLoggedInUserMock.mockReturnValue({ data: { id: PROFILE_ID, role: "athlete" } });
    const [memberOrg, followedOrg] = organizations(2);
    useListUserOrganizationsMock.mockReturnValue({
      data: { data: [memberOrg, { ...followedOrg, isMember: false, isFollowing: true }] },
    });
    renderWithProviders(<UserProfilePage />);
    const column = screen.getByTestId("affiliation-column-orgs");
    expect(within(column).getByText("Follower")).toBeInTheDocument();
    expect(within(column).getAllByText("member")).toHaveLength(1);
  });

  it("shows all seven organizations without a toggle", () => {
    useGetUserByIdMock.mockReturnValue({ data: profileFixture(), isLoading: false });
    useGetLoggedInUserMock.mockReturnValue({ data: { id: PROFILE_ID, role: "athlete" } });
    useListUserOrganizationsMock.mockReturnValue({ data: { data: organizations(7) } });

    renderWithProviders(<UserProfilePage />);

    const column = screen.getByTestId("affiliation-column-orgs");
    expect(within(column).getAllByRole("link")).toHaveLength(7);
    expect(within(column).queryByTestId("affiliation-toggle-orgs")).not.toBeInTheDocument();
  });

  it("shows seven initially and reveals remaining organizations on See more", () => {
    useGetUserByIdMock.mockReturnValue({ data: profileFixture(), isLoading: false });
    useGetLoggedInUserMock.mockReturnValue({ data: { id: PROFILE_ID, role: "athlete" } });
    useListUserOrganizationsMock.mockReturnValue({ data: { data: organizations(9) } });

    renderWithProviders(<UserProfilePage />);

    const column = screen.getByTestId("affiliation-column-orgs");
    const toggle = within(column).getByRole("button", { name: "See more (2)" });
    expect(within(column).getAllByRole("link")).toHaveLength(7);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(within(column).getAllByRole("link")).toHaveLength(9);
    expect(within(column).getByRole("button", { name: "See less" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(column).getByRole("button", { name: "See less" }));
    expect(within(column).getAllByRole("link")).toHaveLength(7);
  });
});

describe("UserProfilePage profile highlight action", () => {
  it("groups available about details in a wrapping row below the bio", () => {
    useGetUserByIdMock.mockReturnValue({
      data: profileFixture({
        bio: "A lifelong soccer fan.",
        dateOfBirth: "1988-05-12",
        city: "Roxbury",
        state: "NJ",
      }),
      isLoading: false,
    });
    useGetLoggedInUserMock.mockReturnValue({
      data: { id: PROFILE_ID, role: "athlete" },
    });
    useGetUserSportsMock.mockReturnValue({ data: { sports: ["Soccer"] } });

    renderWithProviders(<UserProfilePage />);

    const about = screen.getByTestId("user-profile-about");
    const facts = screen.getByTestId("user-profile-facts");
    expect(about).toContainElement(facts);
    expect(about).toHaveTextContent("A lifelong soccer fan.");
    expect(facts).toHaveClass("flex-wrap");
    expect(facts).toContainElement(screen.getByTestId("text-user-birthday"));
    expect(facts).toContainElement(screen.getByTestId("badge-user-sport-Soccer"));
    expect(facts).toContainElement(screen.getByTestId("text-user-location"));
    expect(screen.getByTestId("text-user-location")).toHaveTextContent("Roxbury, NJ");
  });

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