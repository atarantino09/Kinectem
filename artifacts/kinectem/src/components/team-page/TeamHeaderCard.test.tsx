import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";
import { TeamHeaderCard } from "./TeamHeaderCard";
import {
  TEAM_BANNER_ASPECT,
  TEAM_BANNER_FRAME_CLASS,
  TEAM_BANNER_PREVIEW_CLASS,
} from "@/components/BlurFillImage";
import { EditTeamDialog } from "@/components/EditTeamDialog";
import { CreateTeamDialog } from "@/components/CreateTeamDialog";
import { customFetch } from "@workspace/api-client-react";
import { shrinkImageToDataUrl } from "@/lib/shrinkImage";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  getGetTeamByIdQueryKey: (id: string) => ["team", id],
  getListOrgTeamsQueryKey: (id: string) => ["org-teams", id],
  useCreateTeam: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
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

vi.mock("@/components/LazyImageCropDialog", () => ({
  ImageCropDialog: (props: {
    open: boolean;
    aspect: number;
    onOpenChange: (open: boolean) => void;
    onConfirm: (file: File) => void | Promise<void>;
  }) =>
    props.open ? (
      <div data-testid="mock-team-banner-crop" data-aspect={props.aspect}>
        <button
          type="button"
          data-testid="mock-crop-save"
          onClick={() =>
            props.onConfirm(
              new File(["cropped"], "cropped.jpg", { type: "image/jpeg" }),
            )
          }
        >
          Save crop
        </button>
        <button
          type="button"
          data-testid="mock-crop-cancel"
          onClick={() => props.onOpenChange(false)}
        >
          Cancel crop
        </button>
      </div>
    ) : null,
}));

const mockCustomFetch = vi.mocked(customFetch);
const mockShrinkImageToDataUrl = vi.mocked(shrinkImageToDataUrl);

beforeEach(() => {
  mockCustomFetch.mockReset();
  mockShrinkImageToDataUrl.mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:team-banner");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

describe("fixed team photo sizing", () => {
  it("uses the same compact 16:5 geometry for the header and edit preview", () => {
    expect(TEAM_BANNER_ASPECT).toBe(16 / 5);
    expect(TEAM_BANNER_FRAME_CLASS).toBe("aspect-[16/5]");
    expect(TEAM_BANNER_PREVIEW_CLASS).toBe("aspect-[16/5]");
  });
});

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
  it("keeps a cropped photo edge-to-edge in the fixed banner frame", () => {
    renderHeader({
      team: {
        ...team,
        bannerUrl: "data:image/jpeg;base64,team-photo",
      },
    });

    expect(screen.getByTestId("team-banner-frame")).toHaveClass("aspect-[16/5]");
    expect(screen.getByTestId("img-team-banner")).toHaveClass("object-cover");
  });

  it("opens the full team photo and closes it from the lightbox", async () => {
    const user = userEvent.setup();
    renderHeader({
      team: {
        ...team,
        bannerUrl: "data:image/jpeg;base64,team-photo",
      },
    });

    await user.click(screen.getByTestId("btn-open-team-banner-lightbox"));
    expect(screen.getByTestId("team-banner-lightbox-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("team-banner-lightbox-image")).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,team-photo",
    );

    await user.click(screen.getByTestId("team-banner-lightbox-close"));
    expect(
      screen.queryByTestId("team-banner-lightbox-dialog"),
    ).not.toBeInTheDocument();
  });

  it("opens the file picker directly from Change photo", async () => {
    const user = userEvent.setup();
    renderHeader({
      isAdmin: true,
      team: {
        ...team,
        bannerUrl: "data:image/jpeg;base64,team-photo",
      },
    });
    const input = screen.getByTestId("input-inline-team-photo");
    const click = vi.spyOn(input, "click");

    await user.click(screen.getByTestId("btn-inline-edit-team-photo"));

    expect(click).toHaveBeenCalledOnce();
  });

  it("waits for inline crop confirmation before compressing and PATCHing", async () => {
    const user = userEvent.setup();
    mockCustomFetch.mockResolvedValue({});
    mockShrinkImageToDataUrl.mockResolvedValue("data:image/jpeg;base64,compressed");
    renderHeader({ isAdmin: true });

    await user.click(screen.getByTestId("btn-inline-add-team-photo"));
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "phone.jpg", {
      type: "image/jpeg",
    });
    await user.upload(screen.getByTestId("input-inline-team-photo"), file);

    expect(screen.getByTestId("mock-team-banner-crop")).toHaveAttribute(
      "data-aspect",
      String(16 / 5),
    );
    expect(mockShrinkImageToDataUrl).not.toHaveBeenCalled();
    expect(mockCustomFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("mock-crop-save"));

    expect(mockShrinkImageToDataUrl).toHaveBeenCalledWith(expect.any(File), {
      maxDimension: 2048,
      quality: 0.92,
    });
    await waitFor(() =>
      expect(mockCustomFetch).toHaveBeenCalledWith(
        "/api/v1/teams/team-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ bannerUrl: "data:image/jpeg;base64,compressed" }),
        }),
      ),
    );
  });

  it("leaves the inline banner unchanged when cropping is canceled", async () => {
    const user = userEvent.setup();
    renderHeader({ isAdmin: true });

    await user.upload(
      screen.getByTestId("input-inline-team-photo"),
      new File(["photo"], "phone.jpg", { type: "image/jpeg" }),
    );
    fireEvent.click(screen.getByTestId("mock-crop-cancel"));

    expect(screen.queryByTestId("mock-team-banner-crop")).not.toBeInTheDocument();
    expect(mockShrinkImageToDataUrl).not.toHaveBeenCalled();
    expect(mockCustomFetch).not.toHaveBeenCalled();
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

describe("EditTeamDialog team photo cropping", () => {
  it("uses the fixed preview and uploads only the confirmed crop", async () => {
    const user = userEvent.setup();
    mockCustomFetch.mockResolvedValue({});
    mockShrinkImageToDataUrl.mockResolvedValue(
      "data:image/jpeg;base64,edit-cropped",
    );
    renderWithProviders(
      <EditTeamDialog
        team={{ ...team, bannerUrl: "data:image/jpeg;base64,current" }}
        canManagePhoto
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("team-photo-preview-frame")).toHaveClass(
      "aspect-[16/5]",
    );
    expect(screen.getByTestId("img-team-photo-preview")).toHaveClass(
      "object-cover",
    );

    await user.upload(
      screen.getByTestId("input-team-photo"),
      new File(["photo"], "replacement.png", { type: "image/png" }),
    );
    expect(mockCustomFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("mock-crop-save"));
    await waitFor(() =>
      expect(mockCustomFetch).toHaveBeenCalledWith(
        "/api/v1/teams/team-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            bannerUrl: "data:image/jpeg;base64,edit-cropped",
          }),
        }),
      ),
    );
  });

  it("does not replace the Edit team photo when cropping is canceled", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <EditTeamDialog
        team={{ ...team, bannerUrl: "data:image/jpeg;base64,current" }}
        canManagePhoto
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.upload(
      screen.getByTestId("input-team-photo"),
      new File(["photo"], "replacement.png", { type: "image/png" }),
    );
    fireEvent.click(screen.getByTestId("mock-crop-cancel"));

    expect(mockShrinkImageToDataUrl).not.toHaveBeenCalled();
    expect(mockCustomFetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("img-team-photo-preview")).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,current",
    );
  });
});

describe("CreateTeamDialog team photo cropping", () => {
  it("stages only a confirmed crop in the shared fixed preview", async () => {
    const user = userEvent.setup();
    mockShrinkImageToDataUrl.mockResolvedValue(
      "data:image/jpeg;base64,create-cropped",
    );
    renderWithProviders(
      <CreateTeamDialog
        orgId="org-1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("create-team-photo-preview-frame")).toHaveClass(
      "aspect-[16/5]",
    );
    await user.upload(
      screen.getByTestId("input-create-team-photo"),
      new File(["photo"], "new-team.png", { type: "image/png" }),
    );

    expect(mockShrinkImageToDataUrl).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("img-create-team-photo-preview"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-crop-save"));

    await waitFor(() =>
      expect(screen.getByTestId("img-create-team-photo-preview")).toHaveAttribute(
        "src",
        "data:image/jpeg;base64,create-cropped",
      ),
    );
    expect(screen.getByTestId("img-create-team-photo-preview")).toHaveClass(
      "object-cover",
    );
  });

  it("leaves the Create team banner empty when cropping is canceled", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CreateTeamDialog
        orgId="org-1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.upload(
      screen.getByTestId("input-create-team-photo"),
      new File(["photo"], "new-team.png", { type: "image/png" }),
    );
    fireEvent.click(screen.getByTestId("mock-crop-cancel"));

    expect(mockShrinkImageToDataUrl).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("img-create-team-photo-preview"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No team photo yet")).toBeInTheDocument();
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