import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { CompetitionAlbumConsolePanel } from "./CompetitionAlbumConsolePanel";

vi.mock("@/lib/competitionAlbum", () => ({
  useCompetitionAlbum: () => ({
    data: { approvedCount: 3, pendingCount: 2, isCompetitionAdmin: true, contributionsOpen: true },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("./AlbumAdminControls", () => ({
  AlbumAdminControls: () => <div>How your competition photo album works</div>,
}));

describe("CompetitionAlbumConsolePanel", () => {
  it("starts collapsed, keeps counts visible, and expands and collapses its tools", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompetitionAlbumConsolePanel competitionId="competition-1" slug="summer-cup" />);
    const toggle = screen.getByRole("button", { name: "Photo album" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("3 approved · 2 pending review")).toBeVisible();
    expect(screen.queryByText("How your competition photo album works")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-review-album")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("How your competition photo album works")).toBeVisible();
    expect(screen.getByTestId("link-review-album")).toHaveAttribute("href", "/competitions/c/summer-cup?album=pending#photos");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("link-review-album")).not.toBeInTheDocument();
    expect(screen.getByText("3 approved · 2 pending review")).toBeVisible();
  });
});
