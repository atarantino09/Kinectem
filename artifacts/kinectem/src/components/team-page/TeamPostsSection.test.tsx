import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";

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
  it("groups sharing choices and keeps the game recap as the main author action", () => {
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
    expect(within(actions).getByTestId("btn-create-highlight")).toBeInTheDocument();
    expect(within(actions).getByTestId("btn-create-recap")).toBeInTheDocument();
    expect(within(actions).getByTestId("btn-season-recap")).toBeInTheDocument();
    expect(within(actions).getByTestId("btn-add-news")).toBeInTheDocument();
    expect(actions).toHaveTextContent("Share");
    expect(actions.className).toContain("flex-wrap");
  });
});