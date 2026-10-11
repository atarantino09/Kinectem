import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";

const { customFetchMock, toastMock, publishMock } = vi.hoisted(() => ({
  customFetchMock: vi.fn(),
  toastMock: vi.fn(),
  publishMock: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: customFetchMock,
  useCreatePost: () => ({ mutateAsync: publishMock, isPending: false }),
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
    publishMock.mockReset();
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
        newsContext: [{ id: "news-1", title: "Wolves advance", status: "analyzed" }],
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
    expect(
      screen.getByTestId("text-season-recap-news-context-status"),
    ).toHaveTextContent("1 article analyzed");
  });

  it("prevents more than five news articles being sent for full-text analysis", async () => {
    const user = userEvent.setup();
    customFetchMock.mockResolvedValueOnce({
      data: [],
      news: Array.from({ length: 6 }, (_, index) => ({
        id: `news-${index + 1}`,
        title: `Wolves coverage ${index + 1}`,
        sourceName: "Local Paper",
        gameDate: "2026-08-16T00:00:00.000Z",
        description: null,
      })),
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
    await user.click(screen.getByTestId("button-season-recap-generate"));

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Choose 5 or fewer news stories" }),
    );
    expect(customFetchMock).toHaveBeenCalledTimes(1);
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

describe("Combined Recap competition matches", () => {
  const competitions = [
    { id: "cup", name: "Weekend Cup", startDate: "2026-10-03", endDate: "2026-10-04" },
    { id: "league", name: "Season League", startDate: "2026-08-01", endDate: "2026-12-31" },
  ];
  const match = (id: string, extra = {}) => ({
    id, title: `Game ${id}`, gameDate: "2026-10-03", opponentName: id,
    teamScore: 3, opponentScore: 1, recapId: `recap-${id}`, eligible: true,
    blockedReason: null, requiresConfirmation: false, ...extra,
  });
  beforeEach(() => {
    customFetchMock.mockReset();
    toastMock.mockReset();
    publishMock.mockReset().mockResolvedValue({ id: "article-new" });
  });
  async function openPicker(matches: ReturnType<typeof match>[]) {
    const user = userEvent.setup();
    customFetchMock
      .mockResolvedValueOnce({ data: competitions })
      .mockResolvedValueOnce({ matches });
    renderWithProviders(<SeasonRecapDialog teamId="team-1" teamName="Wolves" open onOpenChange={vi.fn()} />);
    await user.click(screen.getByTestId("button-season-recap-competition-mode"));
    await user.selectOptions(await screen.findByTestId("select-season-recap-competition"), "cup");
    await screen.findByTestId("button-select-all-competition-matches");
    return user;
  }
  it("selects the competition's available games in one click, supports deselection, and publishes the generated competition identity", async () => {
    const user = await openPicker([
      match("A"), match("B", { gameDate: "2026-10-04" }),
      match("future", { eligible: false, blockedReason: "Future match" }),
    ]);
    expect(screen.getByTestId("checkbox-competition-match-future")).toBeDisabled();
    await user.click(screen.getByTestId("button-select-all-competition-matches"));
    expect(screen.getByText("2 of 2 available matches selected")).toBeInTheDocument();
    await user.click(screen.getByTestId("checkbox-competition-match-B"));
    customFetchMock.mockResolvedValueOnce({ text: "A strong weekend.", competitionId: "cup", recapCount: 1 });
    await user.click(screen.getByTestId("button-season-recap-generate"));
    expect(JSON.parse(customFetchMock.mock.calls[2][1].body)).toMatchObject({
      competitionId: "cup", matchIds: ["A"], recapIds: [], newsIds: [],
    });
    expect(JSON.parse(customFetchMock.mock.calls[2][1].body)).not.toHaveProperty("startDate");
    expect(await screen.findByTestId("textarea-season-recap-body")).toHaveValue("A strong weekend.");
    await user.click(screen.getByTestId("button-season-recap-publish"));
    await waitFor(() => expect(publishMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ competitionId: "cup", competitionGameId: null, recapKind: "combined" }),
    }));
  });
  it("requires played confirmation for schedule-only matches and sends explicit confirmed IDs", async () => {
    const user = await openPicker([match("A", {
      recapId: null, teamScore: null, opponentScore: null, requiresConfirmation: true,
    })]);
    await user.click(screen.getByTestId("button-select-all-competition-matches"));
    expect(screen.getByTestId("button-season-recap-generate")).toBeDisabled();
    expect(screen.getByText(/No individual recap — confirmed facts only/)).toBeInTheDocument();
    await user.click(screen.getByTestId("checkbox-confirm-competition-played"));
    customFetchMock.mockResolvedValueOnce({ text: "The Wolves faced A.", competitionId: "cup" });
    await user.click(screen.getByTestId("button-season-recap-generate"));
    expect(JSON.parse(customFetchMock.mock.calls[2][1].body).confirmedPlayedMatchIds).toEqual(["A"]);
  });
  it("keeps the editor mounted when coaches clear and replace the generated text", async () => {
    const user = await openPicker([match("A")]);
    await user.click(screen.getByTestId("button-select-all-competition-matches"));
    customFetchMock.mockResolvedValueOnce({ text: "Replace this draft.", competitionId: "cup" });
    await user.click(screen.getByTestId("button-season-recap-generate"));
    const body = await screen.findByTestId("textarea-season-recap-body");
    await user.clear(body);
    expect(screen.getByTestId("textarea-season-recap-body")).toHaveValue("");
    expect(screen.getByTestId("button-season-recap-publish")).toBeDisabled();
    await user.type(body, "My rewritten weekend story.");
    expect(screen.getByTestId("textarea-season-recap-body")).toHaveValue("My rewritten weekend story.");
    expect(screen.getByTestId("button-season-recap-publish")).toBeEnabled();
  });
  it("preserves text but prevents posting a stale draft after selecting another overlapping competition", async () => {
    const user = await openPicker([match("A")]);
    await user.click(screen.getByTestId("button-select-all-competition-matches"));
    customFetchMock.mockResolvedValueOnce({ text: "Editable cup draft.", competitionId: "cup" });
    await user.click(screen.getByTestId("button-season-recap-generate"));
    await screen.findByTestId("textarea-season-recap-body");
    customFetchMock.mockResolvedValueOnce({ matches: [match("league-match")] });
    await user.selectOptions(screen.getByTestId("select-season-recap-competition"), "league");
    expect(screen.getByTestId("textarea-season-recap-body")).toHaveValue("Editable cup draft.");
    expect(screen.getByTestId("button-season-recap-publish")).toBeDisabled();
    expect(screen.getByText(/Sources changed/)).toBeInTheDocument();
    await screen.findByTestId("checkbox-competition-match-league-match");
    expect(screen.queryByTestId("checkbox-competition-match-A")).not.toBeInTheDocument();
    expect(screen.getByTestId("checkbox-competition-match-league-match")).not.toBeChecked();
  });
  it("shows the entire selection and blocks generation over the 25-match limit rather than silently trimming", async () => {
    const user = await openPicker(Array.from({ length: 26 }, (_, i) => match(`${i}`)));
    await user.click(screen.getByTestId("button-select-all-competition-matches"));
    expect(screen.getByText("26 of 26 available matches selected")).toBeInTheDocument();
    expect(screen.getByText(/None have been discarded/)).toBeInTheDocument();
    expect(screen.getByTestId("button-season-recap-generate")).toBeDisabled();
  });
  it("ignores an outdated match response after changing the competition", async () => {
    const user = userEvent.setup();
    let resolveOld!: (value: unknown) => void;
    customFetchMock.mockResolvedValueOnce({ data: competitions })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ matches: [match("new-league")] });
    renderWithProviders(<SeasonRecapDialog teamId="team-1" teamName="Wolves" open onOpenChange={vi.fn()} />);
    await user.click(screen.getByTestId("button-season-recap-competition-mode"));
    await user.selectOptions(screen.getByTestId("select-season-recap-competition"), "cup");
    await user.selectOptions(screen.getByTestId("select-season-recap-competition"), "league");
    await screen.findByTestId("checkbox-competition-match-new-league");
    resolveOld({ matches: [match("outdated-cup")] });
    await waitFor(() => expect(screen.queryByTestId("checkbox-competition-match-outdated-cup")).not.toBeInTheDocument());
  });
});