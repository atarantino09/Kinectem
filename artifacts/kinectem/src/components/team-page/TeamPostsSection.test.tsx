import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";

vi.mock("@workspace/api-client-react", () => ({
  useListTeamPendingPosts: () => ({ data: { data: [] } }),
  useListTeamPendingHighlights: () => ({ data: { data: [] } }),
  useApproveTeamHighlight: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeclineTeamHighlight: () => ({ mutateAsync: vi.fn(), isPending: false }),
  getListTeamPendingHighlightsQueryKey: () => ["pending-highlights"],
  getListTeamPostsQueryKey: () => ["team-posts"],
  customFetch: vi.fn(),
  queryOpts: <T,>(opts: T) => opts,
}));

vi.mock("./SeasonRecapDialog", () => ({
  SeasonRecapDialog: () => null,
}));

import { TeamPostsSection } from "./TeamPostsSection";

describe("TeamPostsSection action hierarchy", () => {
  it("keeps the game recap primary and places the other options in one menu", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <TeamPostsSection
        teamId="team-1"
        isAdmin
        canManage
        isTeamMember
        canPostRecap
        teamName="Westfield Wolves"
        posts={[]}
        hasMorePosts={false}
        isLoadingMorePosts={false}
        onLoadMorePosts={vi.fn()}
      />,
    );

    const actions = screen.getByTestId("team-post-actions");
    expect(within(actions).getByTestId("btn-create-recap")).toBeInTheDocument();
    expect(within(actions).getByTestId("btn-open-post-options")).toHaveTextContent(
      "Post options",
    );
    expect(actions).not.toHaveTextContent("Share");
    expect(actions.className).toContain("flex-col");
    expect(screen.queryByTestId("btn-create-highlight")).not.toBeInTheDocument();

    await user.click(within(actions).getByTestId("btn-open-post-options"));

    expect(screen.getByTestId("btn-create-highlight")).toBeInTheDocument();
    expect(screen.getByTestId("btn-season-recap")).toBeInTheDocument();
    expect(screen.getByTestId("btn-add-news")).toBeInTheDocument();
  });

  it("keeps a member's single highlight action direct", () => {
    renderWithProviders(
      <TeamPostsSection
        teamId="team-1"
        isAdmin={false}
        canManage={false}
        isTeamMember
        canPostRecap={false}
        teamName="Westfield Wolves"
        posts={[]}
        hasMorePosts={false}
        isLoadingMorePosts={false}
        onLoadMorePosts={vi.fn()}
      />,
    );

    const actions = screen.getByTestId("team-post-actions");
    expect(within(actions).getByTestId("btn-create-highlight")).toBeInTheDocument();
    expect(
      within(actions).queryByTestId("btn-open-post-options"),
    ).not.toBeInTheDocument();
  });
});