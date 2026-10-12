import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TeamRosterRail } from "./TeamRosterRail";
import { TeamRosterTabs } from "./TeamRosterTabs";
import { RemoveChildFromTeamDialog } from "./RemoveChildFromTeamDialog";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(), children: [{ status: "active", child: { id: "child-1" } }],
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsLg: () => true }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...(await original<object>()),
  useListUserChildren: () => ({ data: { data: mocks.children } }),
  useRemoveTeamMember: () => ({ mutateAsync: mocks.remove, isPending: false }),
  useUpdateTeamMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAcceptTeamInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeclineTeamInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useWithdrawRosterInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const mine = { id: "entry-1", userId: "child-1", displayName: "My Child", position: "player", status: "active" };
const other = { ...mine, id: "entry-2", userId: "child-2", displayName: "Other Child" };
function mount(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return invalidate;
}
beforeEach(() => { mocks.remove.mockReset(); });

describe("parent roster controls", () => {
  it("shows a separate pencil beside only the parent's child in the side roster", async () => {
    const edit = vi.fn();
    mount(<TeamRosterRail players={[mine, other]} staff={[]} myChildIds={new Set(["child-1"])} onEditChild={edit} />);
    expect(screen.queryByTestId("btn-rail-edit-entry-2")).not.toBeInTheDocument();
    const pencil = screen.getByTestId("btn-rail-edit-entry-1");
    expect(pencil.closest("a")).toBeNull();
    await userEvent.click(pencil);
    expect(edit).toHaveBeenCalledWith(mine);
  });
  it("opens a removal-only confirmation from the full roster without staff-edit controls", async () => {
    mount(<TeamRosterTabs teamId="team-1" isAdmin={false} meId="parent-1"
      players={[mine, other]} staff={[]} invites={[]} onOpenInvite={vi.fn()} />);
    expect(screen.queryByTestId("btn-edit-entry-2")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("btn-edit-entry-1"));
    expect(screen.getByTestId("dialog-remove-child-from-team")).toBeVisible();
    expect(screen.queryByTestId("input-edit-jersey")).not.toBeInTheDocument();
    expect(screen.getByText(/Their account, other teams, and family connections stay unchanged/)).toBeVisible();
  });
  it("cancel leaves the roster unchanged", async () => {
    const close = vi.fn();
    mount(<RemoveChildFromTeamDialog teamId="team-1" member={mine} viewerId="parent-1" onClose={close} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("removes the selected spot and refreshes both roster and team detail", async () => {
    mocks.remove.mockResolvedValue(undefined);
    const close = vi.fn();
    const invalidate = mount(<RemoveChildFromTeamDialog teamId="team-1" member={mine} viewerId="parent-1" onClose={close} />);
    await userEvent.click(screen.getByTestId("btn-remove-child-from-team"));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(mocks.remove).toHaveBeenCalledWith({ teamId: "team-1", memberId: "entry-1" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/v1/teams/team-1/members"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/v1/teams/team-1"] });
  });
  it("keeps the confirmation open with an error when removal fails", async () => {
    mocks.remove.mockRejectedValue(new Error("Forbidden"));
    const close = vi.fn();
    mount(<RemoveChildFromTeamDialog teamId="team-1" member={mine} onClose={close} />);
    await userEvent.click(screen.getByTestId("btn-remove-child-from-team"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again");
    expect(close).not.toHaveBeenCalled();
  });
});
