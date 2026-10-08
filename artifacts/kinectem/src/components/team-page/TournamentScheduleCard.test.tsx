import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";

const customFetchMock = vi.fn<
  (url: string, options?: RequestInit) => Promise<unknown>
>();
const toastMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) =>
    (customFetchMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args,
    ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { TournamentScheduleCard } from "./TournamentScheduleCard";

const competitions = [
  {
    tournamentId: "competition-1",
    tournamentSlug: "columbus-cup",
    tournamentName: "Columbus Cup",
    startDate: "2026-06-12",
    endDate: "2026-06-14",
    recapFreeUntil: null,
    logoUrl: null,
    brandColor: "#f59e0b",
    secondaryColor: "#7c2d12",
    matches: [
      {
        id: "match-1",
        matchNumber: "1",
        matchDate: "2026-06-12",
        startTime: "10:00",
        division: "U12",
        bracket: "Gold",
        venue: "Columbus Fields",
        venueState: "OH",
        field: "Field 3",
        isHome: true,
        opponentName: "Rovers",
      },
    ],
  },
  {
    tournamentId: "competition-2",
    tournamentSlug: "union-kickoff",
    tournamentName: "Union Kickoff",
    startDate: "2026-05-10",
    endDate: "2026-05-12",
    recapFreeUntil: null,
    logoUrl: null,
    brandColor: "#2563eb",
    secondaryColor: "#172554",
    matches: [],
  },
];

async function renderCard(canPostRecap = false, canManage = false) {
  renderWithProviders(<TournamentScheduleCard teamId="team-1" canPostRecap={canPostRecap} canManage={canManage} />);
  await screen.findByTestId("content-competitions-panel");
}

beforeEach(() => {
  customFetchMock.mockReset();
  customFetchMock.mockResolvedValue({ data: competitions });
  toastMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TournamentScheduleCard", () => {
  it("offers one contextual competition recap per expanded schedule, including empty schedules", async () => {
    const user = userEvent.setup();
    await renderCard(true, true);
    expect(screen.queryByText("Competition Game Recap")).not.toBeInTheDocument();
    for (const competition of competitions) {
      const toggle = screen.getByTestId(`toggle-tournament-${competition.tournamentId}`);
      toggle.focus();
      await user.keyboard("{Enter}");
      const action = screen.getByTestId(`button-competition-recap-${competition.tournamentId}`);
      expect(action.tagName).toBe("A");
      expect(action.closest("button")).toBeNull();
      const url = new URL(action.getAttribute("href")!, "https://example.test");
      expect(url.pathname).toBe("/posts/new");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        type: "long", teamId: "team-1", competitionId: competition.tournamentId, from: "/teams/team-1",
      });
      expect(action).toHaveAccessibleDescription(
        "Playoff or extra game? Add a branded recap to this competition.",
      );
      const recapBox = screen.getByTestId(`competition-recap-box-${competition.tournamentId}`);
      expect(recapBox.previousElementSibling?.tagName).toBe("UL");
      expect(recapBox).toHaveClass("bg-gradient-to-br", "from-purple-50", "to-purple-100/70");
      for (const match of competition.matches) {
        expect(screen.getByTestId(`tournament-match-${match.id}`).compareDocumentPosition(recapBox) &
          Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      }
      action.focus();
      expect(action).toHaveFocus();
    }
    expect(screen.getAllByText("Competition Game Recap")).toHaveLength(2);
    const perGame = screen.getByTestId("btn-write-recap-match-1").closest("a")!;
    const matchUrl = new URL(perGame.getAttribute("href")!, "https://example.test");
    expect(matchUrl.searchParams.get("matchId")).toBe("match-1");
    expect(matchUrl.searchParams.get("opponent")).toBe("Rovers");
    expect(matchUrl.searchParams.get("gameDate")).toBe("2026-06-12");
    expect(screen.getByTestId("btn-hide-game-match-1")).toBeVisible();
    await user.click(screen.getByTestId("toggle-tournament-competition-1"));
    expect(screen.queryByTestId("button-competition-recap-competition-1")).not.toBeInTheDocument();
  });

  it("hides both competition authoring and its helper from non-authors even when they manage games", async () => {
    const user = userEvent.setup();
    await renderCard(false, true);
    for (const competition of competitions) {
      await user.click(screen.getByTestId(`toggle-tournament-${competition.tournamentId}`));
    }
    expect(screen.queryByText("Competition Game Recap")).not.toBeInTheDocument();
    expect(screen.queryByText("Playoff or extra game? Add a branded recap to this competition.")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-write-recap-match-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("btn-hide-game-match-1")).toBeVisible();
  });

  it("offers the empty competition action to recap authors without management controls", async () => {
    const user = userEvent.setup();
    await renderCard(true, false);
    await user.click(screen.getByTestId("toggle-tournament-competition-2"));
    expect(screen.getByTestId("button-competition-recap-competition-2")).toBeVisible();
    expect(screen.getByText("Playoff or extra game? Add a branded recap to this competition.")).toBeVisible();
    expect(screen.queryByTestId("btn-hide-game-match-1")).not.toBeInTheDocument();
  });

  it("retains published recap links and unhide controls beside the competition action", async () => {
    customFetchMock.mockResolvedValue({ data: [{
      ...competitions[0],
      matches: [{ ...competitions[0].matches[0], recapPostId: "article-recap-1", hidden: true }],
    }] });
    const user = userEvent.setup();
    await renderCard(true, true);
    await user.click(screen.getByTestId("toggle-tournament-competition-1"));
    expect(screen.getByTestId("pill-game-recap-match-1").closest("a")).toHaveAttribute("href", "/posts/article-recap-1");
    expect(screen.getByTestId("btn-unhide-game-match-1")).toBeVisible();
    expect(screen.getByTestId("notice-hidden-game-match-1")).toBeVisible();
    expect(screen.getByTestId("button-competition-recap-competition-1")).toBeVisible();
    expect(screen.queryByTestId("btn-write-recap-match-1")).not.toBeInTheDocument();
  });

  it("keeps the full competitions panel open by default and collapses it from the header", async () => {
    const user = userEvent.setup();
    await renderCard();

    const trigger = screen.getByTestId("toggle-competitions-panel");
    expect(trigger).toHaveAttribute("data-state", "open");
    expect(screen.getByTestId("competition-count")).toHaveTextContent(
      "2 competitions",
    );
    expect(screen.getByTestId("banner-tournament-competition-1")).toBeInTheDocument();

    trigger.focus();
    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("data-state", "closed");
    expect(screen.getByTestId("content-competitions-panel")).toHaveAttribute(
      "data-state",
      "closed",
    );
    expect(screen.getByTestId("content-competitions-panel")).not.toBeVisible();
    expect(screen.getByTestId("competition-count")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(await screen.findByTestId("content-competitions-panel")).toBeVisible();
  });

  it("keeps competition navigation separate from the nested schedule toggle", async () => {
    const user = userEvent.setup();
    await renderCard();

    const competitionLink = screen.getByTestId("link-tournament-competition-1");
    expect(competitionLink.tagName).toBe("A");
    expect(competitionLink.closest("button")).toBeNull();
    expect(screen.queryByTestId("tournament-match-match-1")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("toggle-tournament-competition-1"));
    expect(await screen.findByTestId("tournament-match-match-1")).toBeInTheDocument();

    await user.click(screen.getByTestId("toggle-competitions-panel"));
    expect(screen.getByTestId("content-competitions-panel")).not.toBeVisible();
  });

  it("counts down through the end of the latest active competition", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-09-20T12:00:00Z").getTime(),
    );
    customFetchMock.mockResolvedValue({
      data: [
        {
          ...competitions[0],
          startDate: "2026-08-01",
          endDate: "2026-09-30",
          recapFreeUntil: "2026-09-30",
        },
        {
          ...competitions[1],
          startDate: "2026-09-15",
          endDate: "2026-10-05",
          recapFreeUntil: "2026-10-05",
        },
      ],
    });

    await renderCard();

    const notice = screen.getByTestId("free-recap-notice");
    expect(notice).toHaveTextContent("while this competition is active");
    expect(notice).toHaveTextContent("Access ends Oct 5");
    expect(screen.getByTestId("free-recap-countdown")).toHaveTextContent(
      "15d 12h 0m",
    );
    expect(notice).not.toHaveTextContent(/tournament|2 weeks/i);
  });

  it("shows the next competition's start and end dates before access opens", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-09-01T12:00:00Z").getTime(),
    );
    customFetchMock.mockResolvedValue({
      data: [
        {
          ...competitions[0],
          startDate: "2026-10-10",
          endDate: "2026-10-12",
          recapFreeUntil: "2026-10-12",
        },
        {
          ...competitions[1],
          startDate: "2026-11-01",
          endDate: "2027-03-30",
          recapFreeUntil: "2027-03-30",
        },
      ],
    });

    await renderCard();

    expect(screen.getByTestId("free-recap-notice")).toHaveTextContent(
      "starts on Oct 10 and remain available through Oct 12",
    );
  });

  it("shows the most recent competition end after all access has expired", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-09-20T12:00:00Z").getTime(),
    );
    customFetchMock.mockResolvedValue({
      data: [
        {
          ...competitions[0],
          startDate: "2026-09-01",
          endDate: "2026-09-02",
          recapFreeUntil: "2026-09-02",
        },
        {
          ...competitions[1],
          startDate: "2026-09-10",
          endDate: "2026-09-19",
          recapFreeUntil: "2026-09-19",
        },
      ],
    });

    await renderCard();

    const notice = screen.getByTestId("free-recap-notice");
    expect(notice).toHaveTextContent("access ended on Sep 19");
    expect(notice).not.toHaveTextContent(/tournament|2-week/i);
  });

  it("does not show a free-window notice for organization-backed teams", async () => {
    await renderCard();
    expect(screen.queryByTestId("free-recap-notice")).not.toBeInTheDocument();
  });
});