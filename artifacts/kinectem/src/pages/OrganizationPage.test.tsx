import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "@/test";
import { setMockSearch, wouterMock } from "@/test/mocks/wouter";
import { useToastMock } from "@/test/mocks/toast";

// ---------------------------------------------------------------------------
// Module mocks. vi.mock() is hoisted, but its factory runs lazily, so it can
// safely reference the imports above.
// ---------------------------------------------------------------------------

const ORG_ID = "org-1";

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
  OrgSetupChecklist: () => null,
  RolesPermissionsCard: () => null,
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
vi.mock("@/components/NewOrgPostDialog", () => ({
  NewOrgPostDialog: () => null,
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
  useListMembers: (...args: unknown[]) => useListMembersMock(...args),
  useFollowOrg: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnfollowOrg: () => ({ mutateAsync: vi.fn(), isPending: false }),
  queryOpts: <T,>(opts: T) => opts,
  getGetOrganizationByIdQueryKey: (orgId: string) => [
    `/api/v1/organizations/${orgId}`,
  ],
  getListFeedQueryKey: () => ["/api/v1/feed"],
}));

// Now safe to import the component under test.
import OrganizationPage from "./OrganizationPage";

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
}: {
  role: Role;
  extraAdmin?: boolean;
}) {
  useGetOrganizationByIdMock.mockReturnValue({
    data: organizationFixture(role),
    isLoading: false,
  });
  useListOrgTeamsMock.mockReturnValue({ data: { data: [] } });
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
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OrganizationPage — admin control gating", () => {
  it("shows the hero admin CTA, the Members 'Manage' button, and the empty-admins nudge for a sole owner", async () => {
    installHandlers({ role: "owner", extraAdmin: false });

    renderWithProviders(<OrganizationPage />);

    expect(
      await screen.findByTestId("btn-manage-admins-hero"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("btn-manage-members"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("card-empty-admins-nudge"),
    ).toBeInTheDocument();
  });

  it("shows the admin controls for an admin viewer and hides the nudge when another admin exists", async () => {
    installHandlers({ role: "admin", extraAdmin: true });

    renderWithProviders(<OrganizationPage />);

    expect(
      await screen.findByTestId("btn-manage-admins-hero"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("btn-manage-members"),
    ).toBeInTheDocument();

    // Members render before the empty-admins nudge would, so by the time the
    // Manage button is mounted any nudge derived from the same members list
    // has had a chance to render too. Asserting it's not present here proves
    // the gating condition (`adminCount > 1`) suppresses it.
    await waitFor(() => {
      expect(
        screen.queryByTestId("card-empty-admins-nudge"),
      ).not.toBeInTheDocument();
    });
  });

  it("hides every admin control from a non-member viewer", async () => {
    installHandlers({ role: null });

    renderWithProviders(<OrganizationPage />);

    // Wait for the org to load (the follow button appears for everyone).
    await screen.findByTestId("btn-follow-org");

    expect(
      screen.queryByTestId("btn-manage-admins-hero"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-manage-members")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("card-empty-admins-nudge"),
    ).not.toBeInTheDocument();
  });
});
