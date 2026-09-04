import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";
import { setMockSearch, wouterMock } from "@/test/mocks/wouter";
import { useToastMock } from "@/test/mocks/toast";

// ---------------------------------------------------------------------------
// Module mocks. vi.mock() is hoisted, but its factory runs lazily, so it can
// safely reference the imports above.
// ---------------------------------------------------------------------------

const ORG_ID = "org-1";
const ORG_TOUR_STORAGE_KEY = "kinectem:org-tour-v3";

vi.mock("wouter", () => ({
  ...wouterMock,
  useParams: () => ({ orgId: ORG_ID }),
}));
vi.mock("@/hooks/use-toast", () => useToastMock);

// Force the mobile (single-column) layout so the TeamsRail only mounts once
// and the hero/empty-admins/members blocks all render inline.
vi.mock("@/hooks/use-mobile", () => ({
  useIsLg: () => false,
  useIsMobile: () => true,
}));

// Stub out heavy subcomponents that pull their own data or render unrelated
// surface area. The page's own admin controls are what we're locking down.
vi.mock("@/components/OrgAdminPanel", () => ({
  OrgAdminPanel: () => null,
}));
vi.mock("@/components/OrgSetupChecklist", () => ({
  OrgSetupChecklist: () => <div data-testid="mock-org-setup-checklist" />,
  RolesPermissionsCard: () => <div data-testid="mock-roles-permissions" />,
}));
vi.mock("@/components/ManageMembersDialog", () => ({
  ManageMembersDialog: () => null,
}));
vi.mock("@/components/EditOrgDialog", () => ({
  EditOrgDialog: () => null,
}));
vi.mock("@/components/CreateTeamDialog", () => ({
  CreateTeamDialog: () => null,
}));
vi.mock("@/components/BulkAddTeamsDialog", () => ({
  BulkAddTeamsDialog: () => null,
}));
vi.mock("@/components/NewOrgPostDialog", () => ({
  NewOrgPostDialog: () => null,
}));
vi.mock("@/components/NewsletterDialog", () => ({
  NewsletterDialog: () => null,
}));
vi.mock("@/components/FollowListDialog", () => ({
  FollowListDialog: () => null,
}));
vi.mock("@/components/PostCard", () => ({
  PostCard: () => null,
}));

// ---------------------------------------------------------------------------
// API-client mocks. The hooks the page consumes are mocked one-by-one so the
// test asserts only on rendered surface, not on react-query plumbing.
// ---------------------------------------------------------------------------

type Role = "owner" | "admin" | "member" | null;

interface OrgFixture {
  id: string;
  name: string;
  slug: string;
  role: Role;
  isFollowing: boolean;
  followerCount: number;
  description: null;
  website: null;
  logoUrl: null;
  city: null;
  state: null;
  zipCode: null;
}

const useGetLoggedInUserMock = vi.fn();
const useGetOrganizationByIdMock = vi.fn();
const useListOrgTeamsMock = vi.fn();
const useListArchivedOrgTeamsMock = vi.fn();
const useListOrgPostsMock = vi.fn();
const useListMembersMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useGetLoggedInUser: (...args: unknown[]) => useGetLoggedInUserMock(...args),
  useGetOrganizationById: (...args: unknown[]) =>
    useGetOrganizationByIdMock(...args),
  useListOrgTeams: (...args: unknown[]) => useListOrgTeamsMock(...args),
  useListArchivedOrgTeams: (...args: unknown[]) =>
    useListArchivedOrgTeamsMock(...args),
  useListOrgPosts: (...args: unknown[]) => useListOrgPostsMock(...args),
  listOrgPosts: () =>
    Promise.resolve({
      data: [],
      pagination: { hasMore: false, nextCursor: null },
    }),
  useListMembers: (...args: unknown[]) => useListMembersMock(...args),
  useListOrgJoinRequests: () => ({ data: { data: [] } }),
  useListOrgPostApprovals: () => ({ data: { data: [] } }),
  useFollowOrg: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnfollowOrg: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGetMyPinnedTeams: () => ({ data: { teamIds: [] } }),
  useUpdateMyPinnedTeams: () => ({ mutate: vi.fn(), isPending: false }),
  getGetMyPinnedTeamsQueryKey: () => ["/api/v1/users/me/pinned-teams"],
  queryOpts: <T,>(opts: T) => opts,
  getGetOrganizationByIdQueryKey: (orgId: string) => [
    `/api/v1/organizations/${orgId}`,
  ],
  getListFeedQueryKey: () => ["/api/v1/feed"],
  getListOrgPostsQueryKey: (orgId: string) => [
    `/api/v1/organizations/${orgId}/posts`,
  ],
}));

// Now safe to import the component under test.
import OrganizationPage, { ArchivedTeamsCard } from "./OrganizationPage";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function organizationFixture(role: Role): OrgFixture {
  return {
    id: ORG_ID,
    name: "Westfield Athletic Club",
    slug: "westfield",
    role,
    isFollowing: false,
    followerCount: 0,
    description: null,
    website: null,
    logoUrl: null,
    city: null,
    state: null,
    zipCode: null,
  };
}

function membersFixture(opts: { extraAdmin?: boolean } = {}) {
  const members: Array<{
    userId: string;
    displayName: string;
    role: "owner" | "admin" | "member";
  }> = [
    { userId: "user-owner", displayName: "Owen Owner", role: "owner" },
    { userId: "user-member", displayName: "Mia Member", role: "member" },
  ];
  if (opts.extraAdmin) {
    members.push({
      userId: "user-admin-2",
      displayName: "Ada Admin",
      role: "admin",
    });
  }
  return { data: members };
}

function installHandlers({
  role,
  extraAdmin = false,
  teams = [],
}: {
  role: Role;
  extraAdmin?: boolean;
  teams?: Array<{
    id: string;
    name: string;
    sport?: string | null;
    bannerUrl?: string | null;
    followerCount?: number | null;
  }>;
}) {
  useGetOrganizationByIdMock.mockReturnValue({
    data: organizationFixture(role),
    isLoading: false,
  });
  useListOrgTeamsMock.mockReturnValue({ data: { data: teams } });
  useListArchivedOrgTeamsMock.mockReturnValue({ data: { data: [] } });
  useListOrgPostsMock.mockReturnValue({ data: { data: [] } });
  useListMembersMock.mockReturnValue({
    data: membersFixture({ extraAdmin }),
  });
}

beforeEach(() => {
  useGetLoggedInUserMock.mockReturnValue({
    data: { id: "user-owner", role: "user" },
    isLoading: false,
  });
});

afterEach(() => {
  setMockSearch("");
  localStorage.removeItem(ORG_TOUR_STORAGE_KEY);
  sessionStorage.clear();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OrganizationPage — admin control gating", () => {
  it("keeps archived team names tucked away until a manager opens the section", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ArchivedTeamsCard
        teams={[
          {
            id: "archived-team-1",
            name: "EP3 U17B National 1",
            sport: "Soccer",
            bannerUrl: null,
            followerCount: 0,
          },
        ]}
      />,
    );

    const toggle = screen.getByTestId("btn-toggle-archived-teams");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("EP3 U17B National 1")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("EP3 U17B National 1")).toBeInTheDocument();
  });

  it("gives the organization identity a full hero row for a prominent name", async () => {
    installHandlers({ role: "owner" });

    renderWithProviders(<OrganizationPage />);

    const identity = await screen.findByTestId("org-header-identity");
    expect(identity).toHaveClass("w-full");
    const heading = screen.getByRole("heading", {
      name: "WESTFIELD ATHLETIC CLUB",
    });
    const visibleName = heading.querySelector("span:not([aria-hidden])");
    if (!visibleName) throw new Error("Organization name text did not render");
    expect(visibleName).toHaveStyle({ fontSize: "36px" });
  });

  it("groups a manager's controls into color-coded menus", async () => {
    const user = userEvent.setup();
    installHandlers({ role: "owner", extraAdmin: false });

    renderWithProviders(<OrganizationPage />);

    const communityActions = await screen.findByTestId("org-community-actions");
    const managerActions = screen.getByTestId("org-manager-actions");
    const communicationActions = screen.getByTestId("org-communication-actions");
    const guidesActions = screen.getByTestId("org-guides-actions");
    const headerActions = screen.getByTestId("org-header-action-menus");
    expect(headerActions).toHaveClass("justify-end");
    expect(headerActions.firstElementChild).toBe(communityActions);
    expect(communityActions.nextElementSibling).toBe(guidesActions);
    expect(guidesActions.nextElementSibling).toBe(managerActions);
    expect(managerActions.nextElementSibling).toBe(communicationActions);
    expect(within(communityActions).getByTestId("btn-org-community-menu")).toHaveTextContent(
      "Community",
    );
    expect(communityActions.innerHTML).toContain("brand-community-trigger");
    expect(within(managerActions).getByTestId("btn-org-manage-menu")).toHaveTextContent(
      "Manage",
    );
    expect(managerActions.innerHTML).toContain("purple");
    expect(
      within(communicationActions).getByTestId("btn-org-communication-menu"),
    ).toHaveTextContent("Communication");
    expect(communicationActions.innerHTML).toContain("bg-blue-700");
    expect(guidesActions.innerHTML).toContain("blue");

    await user.click(screen.getByTestId("btn-org-community-menu"));
    expect(screen.getByTestId("btn-follow-org")).toBeInTheDocument();
    expect(
      screen.getByTestId("btn-view-org-followers"),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("btn-org-manage-menu"));
    const editOrg = screen.getByTestId("btn-edit-org");
    const manageMembers = screen.getByTestId("btn-manage-admins-hero");
    const adminQueue = screen.getByTestId("btn-org-admin-queue");
    expect(editOrg.compareDocumentPosition(manageMembers)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(manageMembers.compareDocumentPosition(adminQueue)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByText("Roster outreach")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("btn-org-communication-menu"));
    expect(screen.getByTestId("btn-org-pre-invite")).toBeInTheDocument();
    const preInvite = screen.getByTestId("btn-org-pre-invite");
    expect(preInvite).toHaveClass(
      "hover:bg-purple-100",
      "focus:bg-purple-100",
      "data-[highlighted]:bg-purple-100",
    );
    const rosterOutreach = screen.getByTestId("btn-org-roster-outreach");
    expect(rosterOutreach).toHaveClass("gap-2");
    const announcement = screen.getByTestId("btn-org-broadcast");
    const sharePage = screen.getByTestId("btn-share-org-page");
    expect(preInvite.compareDocumentPosition(rosterOutreach)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(rosterOutreach.compareDocumentPosition(announcement)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(announcement.compareDocumentPosition(sharePage)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("btn-org-guides-menu"));
    expect(screen.getByTestId("btn-org-setup-guide")).toBeInTheDocument();
    expect(screen.getByTestId("btn-org-roles-guide")).toBeInTheDocument();
    expect(screen.getByTestId("btn-org-replay-tour")).toBeInTheDocument();
    expect(screen.getByTestId("link-org-getting-started")).toBeInTheDocument();

    await user.click(screen.getByTestId("btn-org-setup-guide"));
    expect(screen.getByTestId("dialog-org-setup-guide")).toBeInTheDocument();
    expect(screen.getByTestId("mock-org-setup-checklist")).toBeInTheDocument();
    expect(
      screen.queryByTestId("card-org-setup-checklist"),
    ).not.toBeInTheDocument();
  });

  it("shows management, communication, and guides menus for an admin viewer", async () => {
    installHandlers({ role: "admin", extraAdmin: true });

    renderWithProviders(<OrganizationPage />);

    expect(
      await screen.findByTestId("btn-org-manage-menu"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("btn-org-communication-menu")).toBeInTheDocument();
    expect(screen.getByTestId("btn-org-guides-menu")).toBeInTheDocument();
  });

  it("ends the manager tour with pre-invite, bulk coaches, then roster outreach", async () => {
    const user = userEvent.setup();
    installHandlers({ role: "owner" });
    localStorage.removeItem(ORG_TOUR_STORAGE_KEY);

    renderWithProviders(<OrganizationPage />);

    expect(await screen.findByTestId("team-tour")).toBeInTheDocument();
    for (let step = 0; step < 5; step += 1) {
      await user.click(screen.getByTestId("btn-tour-next"));
    }

    expect(
      await screen.findByText("Prepare your pre-invite message"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("btn-org-communication-menu")).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );

    await user.click(screen.getByTestId("btn-tour-next"));
    expect(await screen.findByText("Bulk add coaches")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("btn-org-communication-menu")).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );

    await user.click(screen.getByTestId("btn-tour-next"));
    expect(await screen.findByText("Invite every team")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("btn-org-communication-menu")).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );

    await user.click(screen.getByTestId("btn-tour-next"));
    await waitFor(() =>
      expect(screen.getByTestId("btn-org-communication-menu")).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );
  });

  it("hides every admin control from a non-member viewer", async () => {
    installHandlers({ role: null });

    renderWithProviders(<OrganizationPage />);

    // Wait for the org to load (the community menu appears for everyone).
    await screen.findByTestId("btn-org-community-menu");

    const communityActions = screen.getByTestId("org-community-actions");
    expect(screen.getByTestId("org-header-action-menus")).toHaveClass("justify-end");
    expect(within(communityActions).getByTestId("btn-org-community-menu")).toBeInTheDocument();
    expect(
      screen.queryByTestId("btn-manage-admins-hero"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-org-manage-menu")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("btn-org-communication-menu"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-share-org-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-org-pre-invite")).not.toBeInTheDocument();
    expect(screen.queryByTestId("org-manager-actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("org-guides-actions")).not.toBeInTheDocument();
  });

  it("opens the create/claim pre-invite once, then continues the existing prompt sequence", async () => {
    const user = userEvent.setup();
    installHandlers({ role: "owner", teams: [{ id: "team-1", name: "U12 Blue" }] });
    sessionStorage.setItem(`kinectem:pre-invite-org:${ORG_ID}`, "1");
    sessionStorage.setItem(`kinectem:coach-setup:${ORG_ID}`, "1");

    renderWithProviders(<OrganizationPage />);
    expect(await screen.findByTestId("dialog-org-pre-invite")).toBeInTheDocument();
    expect(screen.queryByTestId("dialog-coach-setup")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(`kinectem:pre-invite-org:${ORG_ID}`)).toBeNull();

    await user.click(screen.getByTestId("btn-dismiss-org-pre-invite"));
    await waitFor(() => expect(screen.getByTestId("dialog-coach-setup")).toBeInTheDocument());
    expect(screen.queryByTestId("dialog-org-pre-invite")).not.toBeInTheDocument();
  });

  it("starts the approved-owner handoff from its email link", async () => {
    installHandlers({ role: "owner" });
    localStorage.setItem(ORG_TOUR_STORAGE_KEY, "1");
    setMockSearch("ownerSetup=1");

    renderWithProviders(<OrganizationPage />);

    expect(await screen.findByTestId("dialog-org-pre-invite")).toBeInTheDocument();
    expect(localStorage.getItem(ORG_TOUR_STORAGE_KEY)).toBeNull();
    expect(
      sessionStorage.getItem(`kinectem:coach-setup:${ORG_ID}`),
    ).toBe("1");
  });

  it("lets a manager manually reopen the pre-invite message", async () => {
    const user = userEvent.setup();
    installHandlers({ role: "admin" });
    localStorage.setItem(ORG_TOUR_STORAGE_KEY, "1");
    renderWithProviders(<OrganizationPage />);
    await user.click(await screen.findByTestId("btn-org-communication-menu"));
    await user.click(screen.getByTestId("btn-org-pre-invite"));
    expect(await screen.findByTestId("dialog-org-pre-invite")).toBeInTheDocument();
    expect(
      (screen.getByTestId("text-org-pre-invite-message") as HTMLTextAreaElement)
        .value,
    ).toContain("Westfield Athletic Club");
  });

  it("shows the existing eight-step manager tour after arriving from a partner club link", async () => {
    vi.useFakeTimers();
    try {
      setMockSearch("showAround=1");
      installHandlers({ role: "owner" });

      renderWithProviders(<OrganizationPage />);

      expect(screen.getByTestId("btn-org-manage-menu")).toBeInTheDocument();
      expect(screen.queryByTestId("team-tour")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2999);
      });
      expect(screen.queryByTestId("team-tour")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByTestId("team-tour")).toBeInTheDocument();
      expect(screen.getByText("Manage admins & members")).toBeInTheDocument();
      expect(screen.getByText("Step 1 of 8")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

});
