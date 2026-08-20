import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";
import { TeamHeaderCard } from "./TeamHeaderCard";

const team = {
  id: "team-1",
  name: "Westfield Wolves",
  sport: "Soccer",
  level: "Varsity",
  gender: "coed" as const,
  isFollowing: false,
  followerCount: 18,
  organization: {
    id: "org-1",
    name: "Westfield Athletic Club",
    avatarUrl: null,
  },
};

function renderHeader(
  overrides: Partial<React.ComponentProps<typeof TeamHeaderCard>> = {},
) {
  return renderWithProviders(
    <TeamHeaderCard
      team={team}
      isAdmin={false}
      expanded="posts"
      playerCount={14}
      staffCount={3}
      followPending={false}
      onSetExpanded={vi.fn()}
      onToggleFollow={vi.fn()}
      onEdit={vi.fn()}
      onOpenFollowers={vi.fn()}
      {...overrides}
    />,
  );
}

describe("TeamHeaderCard action hierarchy", () => {
  it("keeps a public viewer's navigation and community actions separate", () => {
    renderHeader();

    const navigation = screen.getByTestId("team-section-navigation");
    const community = screen.getByTestId("team-community-actions");

    expect(within(navigation).getByTestId("btn-toggle-posts")).toBeInTheDocument();
    expect(within(navigation).getByTestId("btn-toggle-roster")).toBeInTheDocument();
    expect(within(community).getByTestId("btn-follow-team")).toBeInTheDocument();
    expect(
      within(community).getByTestId("btn-view-team-followers"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("team-contextual-tools")).not.toBeInTheDocument();
    // The mobile-first action row stacks before switching to a horizontal row.
    expect(community.parentElement?.className).toContain("flex-col");
  });

  it("places manager-only controls and the page tour in Team tools", async () => {
    const user = userEvent.setup();
    const onReplayTour = vi.fn();
    const onEdit = vi.fn();

    renderHeader({
      isAdmin: true,
      canViewSchedule: true,
      onEdit,
      onClaimCompetition: vi.fn(),
      onMessageTeam: vi.fn(),
      onReplayTour,
    });

    expect(screen.getByTestId("btn-toggle-admin")).toBeInTheDocument();
    expect(screen.getByTestId("team-contextual-tools")).toBeInTheDocument();
    expect(screen.queryByTestId("btn-edit-team")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("btn-team-manage-menu"));

    expect(screen.getByTestId("btn-edit-team")).toHaveTextContent("Edit team");
    expect(screen.getByTestId("btn-claim-competition")).toBeInTheDocument();
    expect(screen.getByTestId("btn-team-broadcast")).toBeInTheDocument();
    expect(screen.getByTestId("btn-team-replay-tour")).toHaveTextContent(
      "Take a page tour",
    );

    await user.click(screen.getByTestId("btn-team-replay-tour"));
    expect(onReplayTour).toHaveBeenCalledOnce();
  });
});