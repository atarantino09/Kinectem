import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";

const { customFetchMock, toastMock } = vi.hoisted(() => ({
  customFetchMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: customFetchMock,
  getListFeedQueryKey: () => ["feed"],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { NewsGameDateDialog } from "./NewsGameDateDialog";

describe("NewsGameDateDialog", () => {
  beforeEach(() => {
    customFetchMock.mockReset();
    toastMock.mockReset();
  });

  it("saves an explicit game date for an existing news article", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    customFetchMock.mockResolvedValueOnce({});

    renderWithProviders(
      <NewsGameDateDialog
        teamId="team-1"
        newsId="news-1"
        title="Wolves take the opener"
        gameDate={null}
        open
        onOpenChange={onOpenChange}
      />,
    );

    const input = screen.getByTestId("input-news-game-date-news-1");
    expect(input).toHaveClass("text-muted-foreground");
    fireEvent.change(input, { target: { value: "2025-09-05" } });
    expect(input).toHaveClass("text-foreground");
    await user.click(screen.getByTestId("button-save-news-game-date-news-1"));

    await waitFor(() =>
      expect(customFetchMock).toHaveBeenCalledWith(
        "/api/v1/teams/team-1/news/news-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ gameDate: "2025-09-05" }),
        }),
      ),
    );
    expect(toastMock).toHaveBeenCalledWith({ title: "Game date updated" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});