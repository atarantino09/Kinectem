import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test";
import { PostClaimSetupGuide } from "./PostClaimSetupGuide";

describe("PostClaimSetupGuide", () => {
  it("makes every unfinished setup step an obvious direct action", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <PostClaimSetupGuide
        organizationName="Westfield Athletic Club"
        onAction={onAction}
      />,
    );

    expect(screen.getByTestId("setup-step-claim-complete")).toHaveTextContent(
      "Complete",
    );

    const actions = [
      ["Open pre-invite message", "preInvite"],
      ["Open bulk coach invites", "coaches"],
      ["Open Roster Outreach", "outreach"],
    ] as const;

    for (const [label, action] of actions) {
      await user.click(screen.getByRole("button", { name: label }));
      expect(onAction).toHaveBeenLastCalledWith(action);
    }
  });

  it("combines Roster Outreach and family invitations into the final step", () => {
    renderWithProviders(
      <PostClaimSetupGuide
        organizationName="Westfield Athletic Club"
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Invite parents & players")).toBeInTheDocument();
    expect(screen.getByText(/Open Roster Outreach to use/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open roster invitations" }),
    ).not.toBeInTheDocument();
  });
});