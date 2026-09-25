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

const post = (assets: FeedPost["assets"] = [], overrides: Partial<FeedPost> = {}): FeedPost => ({
  id: "post-1",
  postType: "long",
  title: "Friday recap",
  description: "A great game",
  bodyTruncated: false,
  isEdited: false,
  createdAt: "2026-09-25T12:00:00Z",
  author: { id: "author-1", displayName: "Coach", avatarUrl: null },
  context: { type: "team", id: "team-1", name: "Falcons", orgId: "org-1", orgName: "Falcons Club" },
  assets,
  reactionCount: 0,
  hasReacted: false,
  commentCount: 0,
  ...overrides,
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

  it("names and links the parent organization even when a recap has its own photo", () => {
    render(<GameDaySpotlight post={post([{ id: "asset-1", fileType: "image/jpeg", url: "/recap.jpg", displayOrder: 0 }])} />);
    expect(screen.getByTestId("text-spotlight-organization")).toHaveTextContent("Falcons Club");
    expect(screen.getByRole("link", { name: "Falcons" })).toHaveAttribute("href", "/teams/team-1");
    expect(screen.getByRole("link", { name: "Falcons Club" })).toHaveAttribute("href", "/organizations/org-1");
    expect(screen.getByTestId("text-spotlight-organization").nextElementSibling).toBe(screen.getByTestId("link-spotlight-team"));
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
    expect(screen.getByText("By Coach")).toBeInTheDocument();
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

  it("previews a later paragraph of a recap rather than its repetitive opening summary", () => {
    render(<GameDaySpotlight post={post([], {
      body: "What a way to close out the tournament.\n\nAfter halftime, the midfield pressed higher and created three clear chances.\n\nThe team stayed composed through the final whistle.",
      description: "What a way to close out the tournament.",
    })} />);

    expect(screen.getByTestId("text-spotlight-preview")).toHaveTextContent(
      "After halftime, the midfield pressed higher and created three clear chances.",
    );
    expect(screen.getByTestId("text-spotlight-preview")).not.toHaveTextContent("What a way");
  });

  it("previews a later sentence when a recap has no paragraph breaks", () => {
    render(<GameDaySpotlight post={post([], {
      body: "What a way to close out the tournament. The defense made the difference after halftime.",
      description: "What a way to close out the tournament.",
    })} />);

    expect(screen.getByTestId("text-spotlight-preview")).toHaveTextContent(
      "The defense made the difference after halftime.",
    );
    expect(screen.getByTestId("text-spotlight-preview")).not.toHaveTextContent("What a way");
  });

  it("falls back to the summary for a recap without a body", () => {
    render(<GameDaySpotlight post={post([], {
      body: null,
      description: "A late winner decided the match.",
    })} />);
    expect(screen.getByTestId("text-spotlight-preview")).toHaveTextContent("A late winner decided the match.");
  });

  it("keeps the original preview order for short community posts", () => {
    render(<GameDaySpotlight post={post([], {
      postType: "short",
      body: "A longer account of the moment.",
      description: "A quick highlight.",
    })} />);
    expect(screen.getByTestId("text-spotlight-preview")).toHaveTextContent("A quick highlight.");
  });
});