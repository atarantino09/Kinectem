import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, type AnchorHTMLAttributes } from "react";

import { renderWithProviders } from "@/test";
import {
  getMockLocation,
  setMockSearch,
  wouterMock,
} from "@/test/mocks/wouter";
import { useToastMock } from "@/test/mocks/toast";

// ---------------------------------------------------------------------------
// Module mocks. vi.mock() is hoisted, but its factory runs lazily, so it can
// safely reference the imports above.
// ---------------------------------------------------------------------------

const ORG_ID = "org-1";
const ORG_TOUR_STORAGE_KEY = "kinectem:org-tour-v3";

vi.mock("wouter", () => ({
  ...wouterMock,
  Link: forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
    (props, ref) => <a ref={ref} {...props} />,
  ),
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
  RolesPermissionsCard: () => <div data-testid="mock-roles-permissions" />,
}));
vi.mock("@/components/ManageMembersDialog", () => ({
  ManageMembersDialog: ({
    open,
    ownershipHandoff,
    onOpenChange,
  }: {
    open: boolean;
    ownershipHandoff?: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="dialog-manage-members">
        {ownershipHandoff && (
          <div data-testid="ownership-handoff-message">
            You are now the owner of this entire organization. Because
            unclaimed organizations do not yet have rostered players or staff,
            you can delete incorrect teams already listed, edit team names,
            and create additional teams. Once a team has rostered members,
            archive it instead of deleting it.
          </div>
        )}
        <button type="button" onClick={() => onOpenChange(false)}>
          Close member management
        </button>
      </div>
    ) : null,
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
  NewOrgPostDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="mock-new-org-post-dialog" /> : null,
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
  city: string | null;
  state: string | null;
  zipCode: string | null;
  brandPrimaryColor?: string | null;
  brandSecondaryColor?: string | null;
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
  organization = {},
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
  organization?: Partial<OrgFixture>;
}) {
  useGetOrganizationByIdMock.mockReturnValue({
    data: { ...organizationFixture(role), ...organization },
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
  it("puts historical recaps and drafts in New post instead of standalone page links", async () => {
    installHandlers({ role: "admin" });
    const user = userEvent.setup();
    renderWithProviders(<OrganizationPage />);
    expect(screen.queryByTestId("link-historical-recap-org")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("btn-new-org-post"));
    expect(screen.getByTestId("menu-new-org-announcement")).toBeInTheDocument();
    expect(screen.getByTestId("link-historical-recap-org")).toHaveAttribute(
      "href", "/historical-recap?organizationId=org-1",
    );
    expect(screen.getByTestId("link-historical-drafts-org")).toHaveAttribute("href", "/drafts");
  });

  it("lets the first-post prompt open the same post choices", async () => {
    installHandlers({ role: "admin" });
    const user = userEvent.setup();
    renderWithProviders(<OrganizationPage />);
    await user.click(screen.getByTestId("btn-empty-new-org-post"));
    expect(screen.getByTestId("link-historical-recap-org")).toBeInTheDocument();
  });

  it("still opens the regular announcement composer from New post", async () => {
    installHandlers({ role: "admin" });
    const user = userEvent.setup();
    renderWithProviders(<OrganizationPage />);
    await user.click(screen.getByTestId("btn-new-org-post"));
    await user.click(screen.getByTestId("menu-new-org-announcement"));
    expect(screen.getByTestId("mock-new-org-post-dialog")).toBeInTheDocument();
  });

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

  it("keeps the default hero title below the branding boundary while only the logo overlaps", async () => {
    installHandlers({ role: "owner" });

    renderWithProviders(<OrganizationPage />);

    const identity = await screen.findByTestId("org-header-identity");
    expect(identity).toHaveClass("w-full");
    expect(identity).toHaveClass("items-start");
    expect(screen.getByTestId("org-hero-default-gradient")).toBeInTheDocument();
    expect(screen.getByTestId("org-header-content")).not.toHaveClass("-mt-16");
    expect(screen.getByTestId("org-header-content")).not.toHaveClass("sm:-mt-20");
    expect(screen.getByTestId("org-header-logo")).toHaveClass("-mt-12");
    expect(screen.getByTestId("org-header-logo")).toHaveClass("sm:-mt-16");
    expect(screen.getByTestId("org-header-title")).toHaveClass("pt-3");
    expect(screen.getByTestId("org-header-title")).toHaveClass("sm:pt-4");
    const heading = screen.getByRole("heading", {
      name: "WESTFIELD ATHLETIC CLUB",
    });
    const visibleName = heading.querySelector("span:not([aria-hidden])");
    if (!visibleName) throw new Error("Organization name text did not render");
    expect(visibleName).toHaveStyle({ fontSize: "36px" });
  });

  it("keeps a long branded organization name in the readable content region", async () => {
    installHandlers({
      role: "owner",
      organization: {
        name: "Rutgers Prep Argonauts",
        slug: "rutgers-prep-argonauts",
        city: "Somerset",
        state: "NJ",
        zipCode: "08873",
        brandPrimaryColor: "#9d003d",
        brandSecondaryColor: "#8b7b6c",
      },
    });

    renderWithProviders(<OrganizationPage />);

    expect(await screen.findByTestId("org-hero-brand-gradient")).toBeInTheDocument();
    const titleRegion = screen.getByTestId("org-header-title");
    expect(titleRegion).toHaveClass("min-w-0", "flex-1", "pt-3", "sm:pt-4");
    expect(
      within(titleRegion).getByRole("heading", {
        name: "RUTGERS PREP ARGONAUTS",
      }),
    ).toBeInTheDocument();
    expect(within(titleRegion).getByText("@rutgers-prep-argonauts")).toBeInTheDocument();
    expect(within(titleRegion).getByTestId("text-org-address")).toHaveTextContent(
      "Somerset, NJ 08873",
    );
    expect(screen.getByTestId("persona-pill-organization")).toHaveTextContent(
      "ORGANIZATION",
    );
    expect(screen.getByTestId("org-header-action-menus")).toHaveClass("justify-end");
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
    expect(screen.getByTestId("post-claim-setup-guide")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open pre-invite message" }),
    ).toBeInTheDocument();
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

  it("allows a read-only visual preview of the setup guide in development", async () => {
    installHandlers({ role: null, teams: [{ id: "team-1", name: "U12 Blue" }] });
    setMockSearch("previewSetupGuide=1");

    renderWithProviders(<OrganizationPage />);

    expect(await screen.findByTestId("dialog-org-setup-guide")).toBeInTheDocument();
    expect(screen.getByTestId("post-claim-setup-guide")).toBeInTheDocument();
  });

  it("keeps the post-claim setup reminder on the org page until the owner marks it complete", async () => {
    const user = userEvent.setup();
    installHandlers({ role: "owner" });
    localStorage.setItem(`kinectem:org-setup-active:${ORG_ID}`, "1");

    renderWithProviders(<OrganizationPage />);

    const reminder = await screen.findByTestId("banner-org-setup-guide");
    expect(reminder).toHaveTextContent(
      /Finish setting up Westfield Athletic Club/i,
    );
    expect(reminder).toHaveTextContent(
      "Keep this reminder here until your club is ready.",
    );

    await user.click(screen.getByTestId("btn-continue-org-setup"));
    expect(screen.getByTestId("dialog-org-setup-guide")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByTestId("btn-finish-org-setup"));
    expect(screen.queryByTestId("banner-org-setup-guide")).not.toBeInTheDocument();
    expect(
      localStorage.getItem(`kinectem:org-setup-active:${ORG_ID}`),
    ).toBeNull();
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
    const user = userEvent.setup();
    installHandlers({ role: "owner" });
    localStorage.setItem(ORG_TOUR_STORAGE_KEY, "1");
    setMockSearch("ownerSetup=1");

    renderWithProviders(<OrganizationPage />);

    expect(await screen.findByTestId("dialog-owner-approval")).toBeInTheDocument();
    expect(screen.getByTestId("dialog-owner-approval")).toHaveTextContent(
      "Your organization claim is approved",
    );
    expect(screen.getByTestId("dialog-owner-approval")).toHaveTextContent(
      "delete incorrect teams already listed",
    );
    expect(screen.getByTestId("dialog-owner-approval")).toHaveTextContent(
      "edit team names",
    );
    expect(screen.getByTestId("dialog-owner-approval")).toHaveTextContent(
      "create additional teams",
    );
    expect(screen.getByTestId("dialog-owner-approval")).toHaveTextContent(
      "archive it instead of deleting it",
    );
    expect(screen.queryByTestId("team-tour")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dialog-org-pre-invite")).not.toBeInTheDocument();
    expect(localStorage.getItem(ORG_TOUR_STORAGE_KEY)).toBeNull();
    expect(
      sessionStorage.getItem(`kinectem:coach-setup:${ORG_ID}`),
    ).toBe("1");

    await user.click(screen.getByTestId("btn-dismiss-owner-approval"));
    expect(await screen.findByTestId("dialog-org-setup-guide")).toBeInTheDocument();
    expect(screen.getByTestId("setup-step-claim-complete")).toHaveTextContent(
      "Complete",
    );
  });

  it("opens the setup guide after a secure claim and routes directly to Roster Outreach", async () => {
    const user = userEvent.setup();
    installHandlers({
      role: "owner",
      teams: [{ id: "team-1", name: "U12 Blue" }],
    });
    sessionStorage.setItem(`kinectem:ownership-handoff:${ORG_ID}`, "1");
    sessionStorage.setItem(
      `kinectem:post-claim-setup-guide:${ORG_ID}`,
      "1",
    );
    sessionStorage.setItem(`kinectem:pre-invite-org:${ORG_ID}`, "1");
    sessionStorage.setItem(`kinectem:coach-setup:${ORG_ID}`, "1");

    renderWithProviders(<OrganizationPage />);
    expect(await screen.findByTestId("dialog-owner-approval")).toBeInTheDocument();
    expect(screen.queryByTestId("team-tour")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("btn-dismiss-owner-approval"));

    expect(await screen.findByTestId("dialog-org-setup-guide")).toBeInTheDocument();
    expect(
      localStorage.getItem(`kinectem:org-setup-active:${ORG_ID}`),
    ).toBe("1");
    expect(
      sessionStorage.getItem(`kinectem:pre-invite-org:${ORG_ID}`),
    ).toBeNull();
    expect(
      sessionStorage.getItem(`kinectem:coach-setup:${ORG_ID}`),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Open Roster Outreach" }),
    );
    expect(getMockLocation()).toBe(
      `/organizations/${ORG_ID}/roster-outreach`,
    );
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
