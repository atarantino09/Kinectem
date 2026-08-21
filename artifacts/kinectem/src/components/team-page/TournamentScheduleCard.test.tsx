import { beforeEach, describe, expect, it, vi } from "vitest";
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
});