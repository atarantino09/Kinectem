import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { CompetitionAlbumSection } from "./CompetitionAlbumSection";

const state = vi.hoisted(() => ({
  search: "",
  canManage: true,
  isCompetitionAdmin: true,
  canUpload: true,
  sessionId: "signed-in-user",
  albumCalls: vi.fn(),
}));
const competition = {
  id: "competition-1", name: "City Cup", slug: "city-cup", logoUrl: null, brandColor: "#3457d5",
};

vi.mock("wouter", async (importOriginal) => ({
  ...await importOriginal<typeof import("wouter")>(),
  useSearch: () => state.search,
}));
vi.mock("@/lib/competitionAlbum", () => ({
  useAlbumSessionId: () => state.sessionId,
  useAlbumAuthReset: vi.fn(),
  useCompetitionAlbum: (...args: unknown[]) => {
    state.albumCalls(...args);
    return ({
    data: {
      competition, photos: [], teams: [], contributionsOpen: false,
      approvedCount: 0, pendingCount: 1,
      canManage: state.canManage, isCompetitionAdmin: state.isCompetitionAdmin, canUpload: state.canUpload,
    },
    isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
    });
  },
  useDeleteAlbumPhoto: () => ({ mutate: vi.fn(), isPending: false }),
  useSetContributions: () => ({ mutate: vi.fn(), isPending: false }),
  errText: () => "Please try again.",
}));
vi.mock("./AlbumUploadDialog", () => ({ AlbumUploadDialog: () => null }));
vi.mock("./AlbumViewer", () => ({ AlbumViewer: () => null }));
vi.mock("./AlbumReviewPanel", () => ({
  AlbumReviewPanel: ({ status }: { status: string }) => <div data-testid="review-status">{status}</div>,
}));

describe("competition album collapse and admin explanation", () => {
  beforeEach(() => {
    state.search = "";
    state.canManage = true;
    state.isCompetitionAdmin = true;
    state.canUpload = true;
    state.sessionId = "signed-in-user";
    state.albumCalls.mockClear();
    window.history.replaceState(null, "", "/");
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("shows visitors a clear sign-in link without requesting or rendering album content", () => {
    state.sessionId = "anon";
    state.search = "?album=pending";
    window.history.replaceState(null, "", "/#photos");
    renderWithProviders(<CompetitionAlbumSection competition={competition} />);
    expect(screen.getByText("Sign in to see photo albums.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href", `/login?returnTo=${encodeURIComponent("/c/city-cup#photos")}`,
    );
    expect(state.albumCalls).not.toHaveBeenCalled();
    expect(screen.queryByTestId("content-competition-album")).not.toBeInTheDocument();
    expect(screen.queryByTestId("guide-competition-photos-members")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-approved-count")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-add-album-photos")).not.toBeInTheDocument();
  });

  it("removes the signed-in gallery and controls when the user signs out", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<CompetitionAlbumSection competition={competition} />);
    await user.click(screen.getByTestId("button-toggle-competition-album"));
    expect(screen.getByTestId("guide-competition-photos")).toBeVisible();
    state.sessionId = "anon";
    state.albumCalls.mockClear();
    rerender(<CompetitionAlbumSection competition={competition} />);
    expect(screen.getByText("Sign in to see photo albums.")).toBeVisible();
    expect(state.albumCalls).not.toHaveBeenCalled();
    expect(screen.queryByTestId("guide-competition-photos")).not.toBeInTheDocument();
    expect(screen.queryByTestId("content-competition-album")).not.toBeInTheDocument();
  });

  it("starts collapsed and shows the thorough admin guide only after expansion", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompetitionAlbumSection competition={competition} />);
    const toggle = screen.getByTestId("button-toggle-competition-album");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("guide-competition-photos")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("guide-competition-photos")).toBeVisible();
    for (const title of [
      "Add your own competition photos", "Choose whether teams can contribute",
      "Receive a submission alert", "Review and approve in bulk",
      "Share approved photos with the right teams", "Stay in control after publication",
    ]) expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByTestId("guide-competition-photos")).toHaveTextContent("approved immediately");
    expect(screen.getByTestId("guide-competition-photos")).toHaveTextContent("on by default");
    expect(screen.getByTestId("guide-competition-photos")).toHaveTextContent("Every team submission still requires your approval");
    expect(screen.getByTestId("guide-competition-photos")).toHaveTextContent("not one per photo");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("guide-competition-photos")).not.toBeInTheDocument();
  });

  it("expands directly into the pending queue from the review shortcut", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompetitionAlbumSection competition={competition} />);
    await user.click(screen.getByTestId("button-review-pending"));
    expect(screen.getByTestId("button-toggle-competition-album")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("review-status")).toHaveTextContent("pending");
  });

  it("opens automatically for a pending-review notification link", () => {
    state.search = "?album=pending";
    renderWithProviders(<CompetitionAlbumSection competition={competition} />);
    expect(screen.getByTestId("button-toggle-competition-album")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("tab-album-pending")).toHaveAttribute("aria-selected", "true");
  });

  it("opens automatically for a direct photo-section link", () => {
    window.history.replaceState(null, "", "/#photos");
    renderWithProviders(<CompetitionAlbumSection competition={competition} />);
    expect(screen.getByTestId("button-toggle-competition-album")).toHaveAttribute("aria-expanded", "true");
  });

  it("opens a notification link even when the same mounted album was collapsed", async () => {
    const { rerender } = renderWithProviders(<CompetitionAlbumSection competition={competition} />);
    state.search = "?album=pending";
    rerender(<CompetitionAlbumSection competition={competition} />);
    await waitFor(() => expect(screen.getByTestId("tab-album-pending")).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByTestId("button-toggle-competition-album")).toHaveAttribute("aria-expanded", "true");
  });

  it.each([false, true])("does not show the admin guide to non-admins (support review access: %s)", async (canManage) => {
    state.canManage = canManage;
    state.isCompetitionAdmin = false;
    state.canUpload = false;
    const user = userEvent.setup();
    renderWithProviders(<CompetitionAlbumSection competition={competition} />);
    await user.click(screen.getByTestId("button-toggle-competition-album"));
    expect(screen.getByTestId("guide-competition-photos-members")).toHaveTextContent("Download photo");
    expect(screen.getByTestId("guide-competition-photos-members")).toHaveTextContent("competition-admin approval");
    expect(screen.getByTestId("guide-competition-photos-members")).toHaveTextContent("Only signed-in users");
    expect(screen.queryByTestId("guide-competition-photos")).not.toBeInTheDocument();
    expect(screen.queryByTestId("switch-album-contributions")).not.toBeInTheDocument();
  });
});