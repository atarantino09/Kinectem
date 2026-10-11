import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...(await original<object>()),
  useListMembers: () => ({ data: { data: [] }, isLoading: false }),
  useListOrganizationInvites: () => ({ data: { data: [] } }),
  useSearchUsers: () => ({ data: [], isLoading: false }),
  useUpdateMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveMember: () => ({ mutate: vi.fn(), isPending: false }),
  useTransferOrganizationOwnership: () => ({ mutate: vi.fn(), isPending: false }),
  useAddMember: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateOrganizationInvite: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawOrganizationInvite: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ManageMembersDialog } from "./ManageMembersDialog";

function renderDialog(myRole: "owner" | "admin") {
  return render(
    <ManageMembersDialog
      open
      onOpenChange={vi.fn()}
      orgId="org-test"
      orgName="Test Club"
      myUserId="user-test"
      myRole={myRole}
    />,
  );
}

describe("organization ownership handoff instructions", () => {
  it("explains invite, acceptance, and explicit transfer in order for the owner", () => {
    renderDialog("owner");
    const guide = screen.getByRole("region", { name: "Ownership transfer steps" });
    const steps = within(guide).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent("Invite the new owner as an admin.");
    expect(steps[0]).toHaveTextContent("Add admin");
    expect(steps[0]).toHaveTextContent("Invite by email");
    expect(steps[1]).toHaveTextContent("Wait for them to accept.");
    expect(steps[1]).toHaveTextContent("Accepting makes them an admin—not the owner.");
    expect(steps[2]).toHaveTextContent("next to their name and confirm");
    expect(guide).toHaveTextContent("Already listed as a member or admin? Skip to step 3.");
    expect(guide).toHaveTextContent("Ownership changes only after you confirm the transfer.");
    expect(guide).toHaveTextContent("remain an admin afterward");
    expect(screen.getByTestId("btn-open-add-admin")).toBeVisible();
  });

  it("does not suggest that ordinary admins can transfer ownership", () => {
    renderDialog("admin");
    expect(screen.queryByTestId("ownership-transfer-guide")).not.toBeInTheDocument();
    expect(screen.getByText(/Only the owner can transfer ownership/)).toBeVisible();
  });
});
