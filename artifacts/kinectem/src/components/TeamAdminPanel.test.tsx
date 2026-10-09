import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import { TeamAdminPanel } from "./TeamAdminPanel";
import { customFetch } from "@workspace/api-client-react";

const archive = vi.hoisted(() => vi.fn());
const unarchive = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn().mockResolvedValue(undefined),
  useListRosterInvites: () => ({ data: { data: [] } }),
  useGetOrCreateTeamJoinLink: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveTeam: () => ({ mutate: archive, isPending: false }),
  useUnarchiveTeam: () => ({ mutate: unarchive, isPending: false }),
  getListRosterInvitesQueryKey: (id: string) => ["invites", id],
  getGetTeamByIdQueryKey: (id: string) => ["team", id],
  getListOrgTeamsQueryKey: (id: string) => ["teams", id],
  getListArchivedOrgTeamsQueryKey: (id: string) => ["archived", id],
}));

const props = { teamId: "team-1", teamName: "Gold U12", organizationId: "org-1", memberCount: 5, canPermanentlyDelete: true };
beforeEach(() => vi.clearAllMocks());
describe("archive then delete team page", () => {
  it.each([0, 5])("explains both steps before archiving a team with %s members", async (memberCount) => {
    const user = userEvent.setup();
    renderWithProviders(<TeamAdminPanel {...props} memberCount={memberCount} isArchived={false} />);
    expect(screen.queryByTestId("button-delete-archived-team")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("button-archive-team"));
    expect(archive).not.toHaveBeenCalled();
    expect(screen.getByTestId("dialog-archive-team")).toHaveTextContent("This cannot be undone");
    expect(screen.getByTestId("dialog-archive-team")).toHaveTextContent("Archiving never automatically deletes the team");
    await user.click(screen.getByTestId("button-confirm-archive-team"));
    expect(archive).toHaveBeenCalledWith({ teamId: "team-1" });
  });

  it("requires the exact name and acknowledgment before deleting an archived team", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamAdminPanel {...props} isArchived />);
    await user.click(screen.getByTestId("button-delete-archived-team"));
    const confirm = screen.getByTestId("button-confirm-delete-archived-team");
    expect(confirm).toBeDisabled();
    await user.type(screen.getByTestId("input-confirm-delete-team-name"), "Wrong name");
    await user.click(screen.getByTestId("checkbox-confirm-permanent-deletion"));
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByTestId("input-confirm-delete-team-name"));
    await user.type(screen.getByTestId("input-confirm-delete-team-name"), props.teamName);
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(customFetch).toHaveBeenCalledWith("/api/v1/teams/team-1", expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ confirmTeamName: props.teamName, acknowledgePermanentDeletion: true }),
    })));
  });

  it("resets confirmation after canceling and reopening", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamAdminPanel {...props} isArchived />);
    await user.click(screen.getByTestId("button-delete-archived-team"));
    await user.type(screen.getByTestId("input-confirm-delete-team-name"), props.teamName);
    await user.click(screen.getByTestId("checkbox-confirm-permanent-deletion"));
    await user.click(screen.getByTestId("button-cancel-delete-archived-team"));
    await user.click(screen.getByTestId("button-delete-archived-team"));
    expect(screen.getByTestId("input-confirm-delete-team-name")).toHaveValue("");
    expect(screen.getByTestId("checkbox-confirm-permanent-deletion")).not.toBeChecked();
    expect(screen.getByTestId("button-confirm-delete-archived-team")).toBeDisabled();
  });

  it.each([false, true])("does not offer archive or deletion to a platform-only admin (archived=%s)", (isArchived) => {
    renderWithProviders(<TeamAdminPanel {...props} canPermanentlyDelete={false} isArchived={isArchived} />);
    expect(screen.queryByTestId("button-archive-team")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-unarchive-team")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-delete-archived-team")).not.toBeInTheDocument();
    expect(screen.getByText(/Only this organization’s admins/)).toBeVisible();
  });
});
