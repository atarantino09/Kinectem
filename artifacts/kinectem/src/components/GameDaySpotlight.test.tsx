import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedPost } from "@workspace/api-client-react";
import { GameDaySpotlight } from "./GameDaySpotlight";

const mocks = vi.hoisted(() => ({
  team: vi.fn(),
  org: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  queryOpts: (options: unknown) => options,
  useGetTeamById: mocks.team,
  useGetOrganizationById: mocks.org,
}));

const post = (assets: FeedPost["assets"] = []): FeedPost => ({
  id: "post-1",
  postType: "long",
  title: "Friday recap",
  description: "A great game",
  bodyTruncated: false,
  isEdited: false,
  createdAt: "2026-09-25T12:00:00Z",
  author: { id: "author-1", displayName: "Coach", avatarUrl: null },
  context: { type: "team", id: "team-1", name: "Falcons", orgId: "org-1" },
  assets,
  reactionCount: 0,
  hasReacted: false,
  commentCount: 0,
});

describe("GameDaySpotlight image priority", () => {
  beforeEach(() => {
    mocks.team.mockReset().mockReturnValue({
      data: { name: "Falcons", bannerUrl: "/team-photo.jpg", organization: { id: "org-1" } },
      isError: false,
    });
    mocks.org.mockReset().mockReturnValue({ data: { name: "Falcons Club", logoUrl: "/org-logo.png" } });
  });

  it("uses the recap attachment before team or org imagery", () => {
    render(<GameDaySpotlight post={post([{ id: "asset-1", fileType: "image/jpeg", url: "/recap.jpg", displayOrder: 0 }])} />);
    expect(screen.getByRole("presentation")).toHaveAttribute("src", "/recap.jpg");
    expect(mocks.team).toHaveBeenCalledWith("", expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }));
  });

  it("uses the team banner when there is no recap photo", () => {
    render(<GameDaySpotlight post={post()} />);
    expect(screen.getByAltText("Falcons photo")).toHaveAttribute("src", "/team-photo.jpg");
    expect(screen.getByAltText("Falcons photo").closest(".game-day-fallback-image")).toBeInTheDocument();
  });

  it("uses the org logo when the team has no banner", () => {
    mocks.team.mockReturnValue({ data: { name: "Falcons", bannerUrl: null, organization: { id: "org-1" } }, isError: false });
    render(<GameDaySpotlight post={post()} />);
    expect(screen.getByAltText("Falcons Club logo")).toHaveAttribute("src", "/org-logo.png");
    expect(screen.getByAltText("Falcons Club logo").closest(".game-day-lead-image-logo")).toBeInTheDocument();
  });

  it("falls back to the org logo when the team photo cannot load", () => {
    render(<GameDaySpotlight post={post()} />);
    fireEvent.error(screen.getByAltText("Falcons photo"));
    expect(screen.getByAltText("Falcons Club logo")).toHaveAttribute("src", "/org-logo.png");
  });
});