import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { AlbumReviewPanel } from "./AlbumReviewPanel";

const reviewMock = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));
const tagsMock = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

vi.mock("@/lib/competitionAlbum", () => ({
  errText: (error: unknown) => error instanceof Error ? error.message : "Please try again.",
  useReviewPhotos: () => reviewMock,
  useSetPhotoTags: () => tagsMock,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const photos = [
  {
    id: "photo-pending-1",
    batchId: "batch-1",
    url: "/photo-1.jpg",
    fileName: "one.jpg",
    status: "pending" as const,
    uploadedByName: "Jordan",
    createdAt: "2026-01-01T00:00:00.000Z",
    teamIds: [],
    teamNames: [],
    canDelete: false,
  },
  {
    id: "photo-pending-2",
    batchId: "batch-1",
    url: "/photo-2.jpg",
    fileName: "two.jpg",
    status: "pending" as const,
    uploadedByName: "Taylor",
    createdAt: "2026-01-02T00:00:00.000Z",
    teamIds: [],
    teamNames: [],
    canDelete: false,
  },
];

const teams = [
  { id: "team-1", name: "Riverside", canTag: true },
  { id: "team-2", name: "Hilltop", canTag: true },
];

function renderPanel(status: "pending" | "approved" = "pending") {
  return renderWithProviders(
    <AlbumReviewPanel
      competitionId="competition-1"
      status={status}
      photos={photos.map((photo) => ({
        ...photo,
        status,
      }))}
      teams={teams}
      onOpen={vi.fn()}
    />,
  );
}

describe("competition album bulk review controls", () => {
  beforeEach(() => {
    reviewMock.mutateAsync.mockReset();
    reviewMock.isPending = false;
    tagsMock.mutateAsync.mockReset();
    tagsMock.isPending = false;
    reviewMock.mutateAsync.mockResolvedValue({
      changedIds: ["photo-pending-1"],
      conflictIds: ["photo-pending-2"],
    });
    tagsMock.mutateAsync.mockResolvedValue({ updatedCount: 1 });
  });

  it("bulk-approves selected photos with pending expected status and surfaces conflicts", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("checkbox", { name: "Select photo by Jordan" }));
    await user.click(screen.getByRole("checkbox", { name: "Select photo by Taylor" }));
    await user.click(screen.getByTestId("button-bulk-approve"));

    await waitFor(() => {
      expect(reviewMock.mutateAsync).toHaveBeenCalledWith({
        photoIds: ["photo-pending-1", "photo-pending-2"],
        action: "approve",
        expectedStatus: "pending",
      });
    });
    expect(await screen.findByTestId("text-review-report")).toHaveTextContent(
      "1 updated, 1 skipped — another reviewer already changed them",
    );
  });

  it("bulk-withdraws approved photos using the approved status guard", async () => {
    const user = userEvent.setup();
    renderPanel("approved");

    await user.click(screen.getByRole("checkbox", { name: "Select photo by Jordan" }));
    await user.click(screen.getByTestId("button-bulk-withdraw"));

    expect(reviewMock.mutateAsync).toHaveBeenCalledWith({
      photoIds: ["photo-pending-1"],
      action: "reject",
      expectedStatus: "approved",
    });
  });

  it("applies selected team tags to the bulk selection", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("checkbox", { name: "Select photo by Jordan" }));
    await user.click(screen.getByTestId("button-bulk-tag"));
    await user.click(screen.getByRole("checkbox", { name: "Riverside" }));
    await user.click(screen.getByTestId("button-apply-tags"));

    await waitFor(() => {
      expect(tagsMock.mutateAsync).toHaveBeenCalledWith({
        photoIds: ["photo-pending-1"],
        teamIds: ["team-1"],
      });
    });
  });
});