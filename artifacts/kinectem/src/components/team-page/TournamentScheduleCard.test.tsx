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

async function renderCard() {
  renderWithProviders(<TournamentScheduleCard teamId="team-1" />);
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