import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";

const { customFetchMock, toastMock } = vi.hoisted(() => ({
  customFetchMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: customFetchMock,
  useCreatePost: () => ({ mutateAsync: vi.fn(), isPending: false }),
  getListTeamPostsQueryKey: () => ["team-posts"],
  getListTeamPendingPostsQueryKey: () => ["team-pending-posts"],
  getListFeedQueryKey: () => ["feed"],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { SeasonRecapDialog } from "./SeasonRecapDialog";

describe("SeasonRecapDialog news coverage", () => {
  beforeEach(() => {
    customFetchMock.mockReset();
    toastMock.mockReset();
  });

  it("selects matching news coverage and permits a news-only draft", async () => {
    const user = userEvent.setup();
    customFetchMock
      .mockResolvedValueOnce({
        data: [],
        news: [
          {
            id: "news-1",
            title: "Wolves advance after thrilling semifinal",
            sourceName: "Local Paper",
            gameDate: "2026-08-16T00:00:00.000Z",
            description: "A local coverage summary.",
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "The Wolves closed their run with confidence.",
        recapCount: 0,
        newsCount: 1,
      });

    renderWithProviders(
      <SeasonRecapDialog
        teamId="team-1"
        teamName="Westfield Wolves"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("button-season-recap-find-recaps"));

    expect(await screen.findByText("Related news coverage")).toBeInTheDocument();
    expect(
      screen.getByTestId("row-season-news-news-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No published game recaps in this date range."),
    ).toBeInTheDocument();

    const generate = screen.getByTestId("button-season-recap-generate");
    expect(generate).toBeEnabled();
    await user.click(generate);

    await waitFor(() => expect(customFetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(
      customFetchMock.mock.calls[1][1]?.body as string,
    ) as Record<string, unknown>;
    expect(body.recapIds).toEqual([]);
    expect(body.newsIds).toEqual(["news-1"]);
    expect(screen.getByTestId("textarea-season-recap-body")).toHaveValue(
      "The Wolves closed their run with confidence.",
    );
  });

  it("allows related news coverage to be excluded before generation", async () => {
    const user = userEvent.setup();
    customFetchMock.mockResolvedValueOnce({
      data: [
        {
          id: "recap-1",
          title: "Wolves win opener",
          gameDate: "2026-08-16T00:00:00.000Z",
          opponentName: "Tigers",
          teamScore: 3,
          opponentScore: 2,
        },
      ],
      news: [
        {
          id: "news-1",
          title: "Wolves advance",
          sourceName: "Local Paper",
          gameDate: "2026-08-16T00:00:00.000Z",
          description: "A local coverage summary.",
        },
      ],
    });

    renderWithProviders(
      <SeasonRecapDialog
        teamId="team-1"
        teamName="Westfield Wolves"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("button-season-recap-find-recaps"));
    const newsCheckbox = await screen.findByTestId(
      "checkbox-season-news-news-1",
    );
    await user.click(newsCheckbox);
    await user.click(screen.getByTestId("button-season-recap-generate"));

    await waitFor(() => expect(customFetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(
      customFetchMock.mock.calls[1][1]?.body as string,
    ) as Record<string, unknown>;
    expect(body.recapIds).toEqual(["recap-1"]);
    expect(body.newsIds).toEqual([]);
  });

  it("explains when team news needs a saved game date", async () => {
    const user = userEvent.setup();
    customFetchMock.mockResolvedValueOnce({
      data: [],
      news: [],
      newsAvailability: {
        datedCount: 0,
        undatedCount: 1,
        earliestGameDate: null,
        latestGameDate: null,
      },
    });

    renderWithProviders(
      <SeasonRecapDialog
        teamId="team-1"
        teamName="Westfield Wolves"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("button-season-recap-find-recaps"));
    expect(
      await screen.findByTestId("text-season-news-empty-state"),
    ).toHaveTextContent(
      "1 team news article has no saved game date. Use Edit game date on the news card",
    );
  });

  it("explains when dated team news falls outside the selected period", async () => {
    const user = userEvent.setup();
    customFetchMock.mockResolvedValueOnce({
      data: [],
      news: [],
      newsAvailability: {
        datedCount: 2,
        undatedCount: 0,
        earliestGameDate: "2025-09-05T00:00:00.000Z",
        latestGameDate: "2025-09-20T00:00:00.000Z",
      },
    });

    renderWithProviders(
      <SeasonRecapDialog
        teamId="team-1"
        teamName="Westfield Wolves"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("button-season-recap-find-recaps"));
    expect(
      await screen.findByTestId("text-season-news-empty-state"),
    ).toHaveTextContent(
      "Dated team news is available from Sep 5, 2025 to Sep 20, 2025",
    );
  });
});