import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import TeamPage from "./TeamPage";

const state = vi.hoisted(() => ({
  role: "admin", orgRole: null as string | null, masquerading: false,
  viewingRole: "coach", archived: true, solo: false, position: "player",
  navigate: vi.fn(), fetch: vi.fn(), toast: vi.fn(),
}));
vi.mock("wouter", async (original) => ({
  ...await original<typeof import("wouter")>(),
  useParams: () => ({ teamId: "team-1" }),
  useSearch: () => "",
  useLocation: () => ["/teams/team-1", state.navigate],
}));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  customFetch: state.fetch,
  useGetTeamById: () => ({ data: {
    id: "team-1", name: "Gold U12", organization: state.solo ? null : { id: "org-1" },
    archivedAt: state.archived ? "2026-10-09" : null, memberCount: 5,
  } }),
  useGetOrganizationById: () => ({ data: { id: "org-1", role: state.orgRole } }),
  useGetLoggedInUser: () => ({ data: { id: "viewer" } }),
  useListTeamMembers: () => ({ data: { data: [
    { id: "member", userId: "viewer", displayName: "Viewer", status: "active", position: state.position },
  ] } }),
  useListRosterInvites: () => ({ data: { data: [] } }),
  listTeamPosts: async () => ({ data: [], pagination: { hasMore: false } }),
  useFollowTeam: () => ({}),
  useUnfollowTeam: () => ({}),
  useGetOrCreateTeamJoinLink: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveTeam: () => ({ mutate: vi.fn(), isPending: false }),
  useUnarchiveTeam: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useWhoami", () => ({
  useWhoami: () => ({ data: {
    realUser: { role: state.role }, isMasquerading: state.masquerading,
    viewingAs: { role: state.viewingRole },
  } }),
}));
vi.mock("@/hooks/useFamilyContacts", () => ({ useFamilyContactInvitations: () => ({}) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsLg: () => false }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/components/team-page/TeamHeaderCard", () => ({
  TeamHeaderCard: ({ isAdmin, onSetExpanded }: { isAdmin: boolean; onSetExpanded: (value: string) => void }) =>
    isAdmin ? <button onClick={() => onSetExpanded("admin")}>Admin Tools</button> : null,
}));
vi.mock("@/components/competition-album/TeamCompetitionPhotos", () => ({ TeamCompetitionPhotos: () => null }));
vi.mock("@/components/competition-results/TeamRecapCards", () => ({ TeamRecapCards: () => null }));
vi.mock("@/components/team-page/TeamPostsSection", () => ({ TeamPostsSection: () => null }));
vi.mock("@/components/team-page/PracticePlansSection", () => ({ PracticePlansSection: () => null }));
vi.mock("@/components/team-page/TeamRosterTabs", () => ({ TeamRosterTabs: () => null }));
vi.mock("@/components/team-page/TeamRosterRail", () => ({ TeamRosterRail: () => null }));
vi.mock("@/components/team-page/schedule/ScheduleUpNext", () => ({ ScheduleUpNext: () => null }));
vi.mock("@/components/team-page/schedule/TeamSchedulePanel", () => ({ TeamSchedulePanel: () => null }));
vi.mock("@/components/team-page/TournamentScheduleCard", () => ({ TournamentScheduleCard: () => null }));
vi.mock("@/components/team-page/SpotlightTour", () => ({ SpotlightTour: () => null }));
vi.mock("@/components/team-page/TeamWelcomeDialog", () => ({ TeamWelcomeDialog: () => null }));
vi.mock("@/components/team-page/AdoptTeamDialog", () => ({ AdoptTeamDialog: () => null }));
vi.mock("@/components/team-page/AdoptLinkCard", () => ({ AdoptLinkCard: () => null }));
vi.mock("@/components/team-page/ClaimCompetitionDialog", () => ({ ClaimCompetitionDialog: () => null }));
vi.mock("@/components/CreateOrgDialog", () => ({ CreateOrgDialog: () => null }));
vi.mock("@/components/EditTeamDialog", () => ({ EditTeamDialog: () => null }));
vi.mock("@/components/InviteRosterDialog", () => ({ InviteRosterDialog: () => null }));
vi.mock("@/components/FollowListDialog", () => ({ FollowListDialog: () => null }));
vi.mock("@/components/broadcasts/BroadcastComposeDialog", () => ({ BroadcastComposeDialog: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { role: "admin", orgRole: null, masquerading: false, viewingRole: "coach", archived: true, solo: false, position: "player" });
  state.fetch.mockResolvedValue(undefined);
  localStorage.setItem("kinectem:team-tour-v1:viewer", "1");
});

describe("TeamPage removal permission wiring", () => {
  it.each(["platform", "owner", "admin"])("offers archived-team removal to %s authority", async (authority) => {
    if (authority !== "platform") Object.assign(state, { role: "coach", orgRole: authority });
    renderWithProviders(<TeamPage />);
    await userEvent.click(screen.getByRole("button", { name: "Admin Tools" }));
    expect(screen.getByTestId("button-unarchive-team")).toBeVisible();
    expect(screen.getByTestId("button-delete-archived-team")).toBeVisible();
  });

  it("offers archive, but not delete, to a platform-only admin on an active team", async () => {
    state.archived = false;
    renderWithProviders(<TeamPage />);
    await userEvent.click(screen.getByRole("button", { name: "Admin Tools" }));
    expect(screen.getByTestId("button-archive-team")).toBeVisible();
    expect(screen.queryByTestId("button-delete-archived-team")).not.toBeInTheDocument();
  });

  it.each(["coach", "member", "visitor", "masquerade"])("does not expose removal to %s", (authority) => {
    if (authority === "masquerade") state.masquerading = true;
    else state.role = "coach";
    if (authority === "member") state.orgRole = "member";
    if (authority === "coach") state.position = "coach";
    renderWithProviders(<TeamPage />);
    expect(screen.queryByRole("button", { name: "Admin Tools" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-delete-archived-team")).not.toBeInTheDocument();
  });

  it("does not extend standalone-team removal", async () => {
    state.solo = true;
    renderWithProviders(<TeamPage />);
    await userEvent.click(screen.getByRole("button", { name: "Admin Tools" }));
    expect(screen.queryByTestId("button-delete-archived-team")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-unarchive-team")).not.toBeInTheDocument();
  });

  it.each([false, true])("handles confirmed deletion success/failure without hiding failures (%s)", async (fails) => {
    if (fails) state.fetch.mockRejectedValue(new Error("Your permission changed. Reload and try again."));
    const user = userEvent.setup();
    renderWithProviders(<TeamPage />);
    await user.click(screen.getByRole("button", { name: "Admin Tools" }));
    await user.click(screen.getByTestId("button-delete-archived-team"));
    await user.type(screen.getByTestId("input-confirm-delete-team-name"), "Gold U12");
    await user.click(screen.getByTestId("checkbox-confirm-permanent-deletion"));
    await user.click(screen.getByTestId("button-confirm-delete-archived-team"));
    if (fails) {
      await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Team was not deleted", description: "Your permission changed. Reload and try again.",
      })));
      expect(state.navigate).not.toHaveBeenCalled();
      expect(screen.getByTestId("dialog-delete-archived-team")).toBeVisible();
    } else {
      await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/organizations/org-1"));
    }
  });
});
