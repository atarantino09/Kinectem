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
    expect(screen.getByTestId("setup-step-claim-complete")).toHaveTextContent(
      "delete incorrect teams already listed",
    );
    expect(screen.getByTestId("setup-step-claim-complete")).toHaveTextContent(
      "edit team names",
    );
    expect(screen.getByTestId("setup-step-claim-complete")).toHaveTextContent(
      "create additional teams",
    );
    expect(screen.getByTestId("setup-step-claim-complete")).toHaveTextContent(
      "archive it instead of deleting it",
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

    expect(screen.getByText("Invite every team")).toBeInTheDocument();
    expect(
      screen.getByText(/As club admin, paste each team's ready-made message/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open roster invitations" }),
    ).not.toBeInTheDocument();
    const recapMessage = screen.getByTestId("setup-message-game-recaps");
    expect(recapMessage).toHaveTextContent(
      "Then, bring your season to life",
    );
    expect(recapMessage).toHaveTextContent(
      "coaches visit their team page",
    );
    expect(recapMessage).toHaveTextContent("add a few notes");
    expect(recapMessage).not.toHaveTextContent("highlights");
    expect(recapMessage).toHaveTextContent("AI Assist");
    expect(recapMessage.tagName).toBe("DIV");
  });
});