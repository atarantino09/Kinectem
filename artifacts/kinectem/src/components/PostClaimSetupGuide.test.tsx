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
        hasTeams
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
      ["Open roster invitations", "roster"],
    ] as const;

    for (const [label, action] of actions) {
      await user.click(screen.getByRole("button", { name: label }));
      expect(onAction).toHaveBeenLastCalledWith(action);
    }
  });

  it("explains why roster invitations are unavailable without teams", () => {
    renderWithProviders(
      <PostClaimSetupGuide
        organizationName="Westfield Athletic Club"
        hasTeams={false}
        onAction={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Open roster invitations" }),
    ).toBeDisabled();
    expect(screen.getByText("Add a team before opening roster invitations."))
      .toBeInTheDocument();
  });
});