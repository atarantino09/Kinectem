import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";
import { TeamHeaderCard } from "./TeamHeaderCard";
import { customFetch } from "@workspace/api-client-react";
import { shrinkImageToDataUrl } from "@/lib/shrinkImage";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  getGetTeamByIdQueryKey: (id: string) => ["team", id],
}));

vi.mock("@/lib/shrinkImage", () => ({
  shrinkImageToDataUrl: vi.fn(),
  DATA_URL_MAX_LENGTH: 20 * 1024 * 1024,
  BANNER_SHRINK_MAX_DIMENSION: 2048,
  BANNER_SHRINK_OUTPUT_QUALITY: 0.92,
  isUnsupportedHeicImage: () => false,
  classifyImageFile: () => "supported",
  UnsupportedImageFormatError: class extends Error {},
}));

const mockCustomFetch = vi.mocked(customFetch);
const mockShrinkImageToDataUrl = vi.mocked(shrinkImageToDataUrl);

const team = {
  id: "team-1",
  name: "Westfield Wolves",
  sport: "Soccer",
  level: "Hudson Valley Youth Soccer League",
  gender: "coed" as const,
  isFollowing: false,
  followerCount: 18,
  organization: {
    id: "org-1",
    name: "Westfield Athletic Club",
    avatarUrl: null,
    brandPrimaryColor: "#2563eb",
    brandSecondaryColor: "#7c3aed",
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
  it("compresses a raw photo over 5 MB before PATCHing the banner", async () => {
    const user = userEvent.setup();
    mockCustomFetch.mockResolvedValue({});
    mockShrinkImageToDataUrl.mockResolvedValue("data:image/jpeg;base64,compressed");
    renderHeader({ isAdmin: true });

    await user.click(screen.getByTestId("btn-inline-add-team-photo"));
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "phone.jpg", {
      type: "image/jpeg",
    });
    await user.upload(screen.getByTestId("input-inline-team-photo"), file);

    expect(mockShrinkImageToDataUrl).toHaveBeenCalledWith(file, {
      maxDimension: 2048,
      quality: 0.92,
    });
    expect(mockCustomFetch).toHaveBeenCalledWith(
      "/api/v1/teams/team-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ bannerUrl: "data:image/jpeg;base64,compressed" }),
      }),
    );
  });

  it("places a public viewer's community actions in the magenta menu", async () => {
    const user = userEvent.setup();
    const onToggleFollow = vi.fn();
    const onOpenFollowers = vi.fn();

    renderHeader({ onToggleFollow, onOpenFollowers });

    const navigation = screen.getByTestId("team-section-navigation");
    const community = screen.getByTestId("team-community-actions");
    const actionMenus = screen.getByTestId("team-header-action-menus");
    const actionGroup = screen.getByTestId("team-header-action-group");

    expect(within(navigation).getByTestId("btn-toggle-posts")).toBeInTheDocument();
    expect(within(navigation).getByTestId("btn-toggle-roster")).toBeInTheDocument();
    expect(within(community).getByTestId("btn-team-community-menu")).toHaveTextContent(
      "Community",
    );
    expect(community.innerHTML).toContain("brand-community-trigger");
    expect(
      actionMenus.compareDocumentPosition(navigation) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(actionGroup).toHaveClass("items-end", "sm:justify-end");
    expect(actionGroup.firstElementChild).toBe(community);
    expect(screen.queryByTestId("btn-follow-team")).not.toBeInTheDocument();
    expect(screen.queryByTestId("team-contextual-tools")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("btn-team-community-menu"));
    await user.click(screen.getByTestId("btn-follow-team"));
    expect(onToggleFollow).toHaveBeenCalledOnce();
    await user.click(screen.getByTestId("btn-team-community-menu"));
    await user.click(screen.getByTestId("btn-view-team-followers"));
    expect(onOpenFollowers).toHaveBeenCalledOnce();
  });

  it("separates manager controls from guides for a manager", async () => {
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
    expect(screen.getByTestId("team-header-action-group")).toHaveClass(
      "sm:justify-end",
    );
    expect(
      screen
        .getByTestId("team-header-action-group")
        .querySelector('[data-testid="team-community-actions"]'),
    ).toBeTruthy();
    expect(screen.getByTestId("team-manage-actions").innerHTML).toContain("blue");
    expect(screen.getByTestId("team-guides-actions").innerHTML).toContain("purple");
    expect(screen.queryByTestId("btn-edit-team")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("btn-team-manage-menu"));

    expect(screen.getByTestId("btn-edit-team")).toHaveTextContent("Edit team");
    expect(screen.getByTestId("btn-claim-competition")).toBeInTheDocument();
    expect(screen.getByTestId("btn-team-broadcast")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("btn-team-guides-menu"));
    expect(screen.getByTestId("btn-team-replay-tour")).toHaveTextContent(
      "Take a page tour",
    );
    expect(screen.getByTestId("link-team-getting-started")).toBeInTheDocument();

    await user.click(screen.getByTestId("btn-team-replay-tour"));
    expect(onReplayTour).toHaveBeenCalledOnce();
  });
});

describe("TeamHeaderCard identity metadata", () => {
  it("places sport, gender, and league in muted chips below the team name", () => {
    renderHeader();

    const identity = screen.getByTestId("team-identity-details");
    const metadata = screen.getByTestId("team-identity-metadata");
    const strip = screen.getByTestId("strip-org-brand");
    const sport = within(metadata).getByText("Soccer");
    const gender = screen.getByTestId("chip-team-gender");
    const league = screen.getByTestId("chip-team-league");
    const teamName = screen.getByRole("heading", { name: team.name });

    expect(identity).toContainElement(teamName);
    expect(identity).toContainElement(metadata);
    expect(
      teamName.compareDocumentPosition(metadata) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(metadata).toHaveClass("flex-wrap", "min-w-0");
    expect(sport).toBeInTheDocument();
    expect(gender).toBeInTheDocument();
    expect(league).toHaveTextContent("Hudson Valley Youth Soccer League");
    expect(
      sport.compareDocumentPosition(gender) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      gender.compareDocumentPosition(league) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(league).toHaveClass(
      "bg-muted",
      "rounded-md",
      "max-w-full",
      "break-words",
    );
    expect(gender).toHaveTextContent("coed");
    expect(strip).toHaveClass("h-2");
    expect(strip).toHaveStyle({
      background:
        "linear-gradient(135deg, #2563eb 0%, #2563eb 40%, #7c3aed 100%)",
    });
    expect(
      screen.getByTestId("team-identity-row").compareDocumentPosition(
        screen.getByTestId("team-header-action-menus"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});