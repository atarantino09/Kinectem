import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customFetch } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { featuredRecapPreviewText } from "../lib/featuredRecapPreview";
import {
  competitionTeamSections,
  defaultOpenScheduleWeekKeys,
  isPublicFeaturedCompetitionRecap,
  isShortTournament,
  recapGroups,
  rollingScheduleSpotlight,
  scheduleDateKeyForViewer,
  scheduleWeekStateKey,
  type ScheduleSpotlightMatch,
  weekGroups,
} from "./CompetitionPage";
import CompetitionPage from "./CompetitionPage";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  useGetLoggedInUser: () => ({ data: null }),
}));

vi.mock("@/components/ClaimTokenBanner", () => ({
  CompetitionClaimBanner: () => null,
  useClaimTokenParams: () => ({ token: null }),
  useCompetitionClaimResolve: () => ({ data: null }),
}));

vi.mock("@/components/CompetitionHowItWorks", () => ({
  CompetitionHowItWorks: () => null,
}));

vi.mock("@/components/share-image/ShareRecapImageDialog", () => ({
  ShareRecapImageDialog: () => null,
}));

const mockedFetch = vi.mocked(customFetch);

function makeMatch(
  id: string,
  matchDate: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    matchNumber: id,
    matchDate,
    startTime: "10:00 AM",
    age: "U12",
    gender: "Girls",
    division: "Gold",
    bracket: "A",
    venue: "Riverside Complex",
    venueState: "CA",
    field: "Field 2",
    homeName: `${id} Home`,
    awayName: `${id} Away`,
    homeParticipantId: null,
    awayParticipantId: null,
    status: "scheduled",
    statusReason: null,
    ...overrides,
  } as ScheduleSpotlightMatch;
}

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "article-recap-1",
    articleStatus: "published",
    competitionFeatured: true,
    competition: { id: "competition-1" },
    ...overrides,
  } as never;
}

describe("rolling schedule model", () => {
  it("prioritizes today and upcoming games while excluding invalid dates", () => {
    const matches = [
      makeMatch("past", "2026-08-29"),
      makeMatch("future", "2026-09-02"),
      makeMatch("today-late", "2026-08-31", { startTime: "7:00 PM" }),
      makeMatch("today-early", "2026-08-31", { startTime: "9:00 AM" }),
      makeMatch("invalid", "2026-02-30"),
      makeMatch("undated", null),
    ];

    expect(
      rollingScheduleSpotlight(matches, "2026-08-31").map(
        (match) => match.id,
      ),
    ).toEqual(["today-early", "today-late", "future"]);
  });

  it("falls back to recent games, then undated games when no valid dates exist", () => {
    expect(
      rollingScheduleSpotlight(
        [
          makeMatch("older", "2026-08-20"),
          makeMatch("recent", "2026-08-30"),
          makeMatch("undated", null),
        ],
        "2026-08-31",
      ).map((match) => match.id),
    ).toEqual(["recent", "older"]);

    expect(
      rollingScheduleSpotlight(
        [makeMatch("invalid", "not-a-date"), makeMatch("undated", null)],
        "2026-08-31",
      ).map((match) => match.id),
    ).toEqual(["invalid", "undated"]);
  });

  it("opens the current week, or the next available week, with group-safe keys", () => {
    const groups: [string, ReturnType<typeof makeMatch>[]][] = [
      [
        "Gold · A",
        [
          makeMatch("old", "2026-08-10"),
          makeMatch("current", "2026-08-31"),
        ],
      ],
      ["Silver · B", [makeMatch("next", "2026-09-07")]],
    ];

    expect(
      defaultOpenScheduleWeekKeys(groups, "2026-08-31"),
    ).toEqual([scheduleWeekStateKey("Gold · A", "2026-08-31")]);
    expect(
      defaultOpenScheduleWeekKeys(groups, "2026-09-07"),
    ).toEqual([scheduleWeekStateKey("Silver · B", "2026-09-07")]);
  });

  it("uses the viewer calendar date without a UTC date shift", () => {
    expect(scheduleDateKeyForViewer(new Date(2026, 7, 31, 23, 59))).toBe(
      "2026-08-31",
    );
    expect(scheduleDateKeyForViewer(new Date(2026, 8, 1, 0, 1))).toBe(
      "2026-09-01",
    );
  });

  it("sorts supported legacy time formats chronologically", () => {
    const matches = [
      makeMatch("ten", "2026-08-31", { startTime: "10:00 AM" }),
      makeMatch("nine", "2026-08-31", { startTime: "9 AM" }),
      makeMatch("seconds-late", "2026-08-31", { startTime: "09:00:45" }),
      makeMatch("seconds-early", "2026-08-31", { startTime: "9:00:15 AM" }),
      makeMatch("evening", "2026-08-31", { startTime: "7.30 P.M." }),
      makeMatch("unknown", "2026-08-31", { startTime: "After warmups" }),
    ];

    expect(
      rollingScheduleSpotlight(matches, "2026-08-31").map((match) => match.id),
    ).toEqual([
      "nine",
      "seconds-early",
      "seconds-late",
      "ten",
      "evening",
      "unknown",
    ]);
  });

  it("keeps malformed dates reachable in the Undated week", () => {
    const groups = weekGroups([
      makeMatch("valid", "2026-08-31"),
      makeMatch("invalid", "2026-02-30"),
      makeMatch("missing", null),
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "2026-08-31",
      "__undated__",
    ]);
    expect(groups[1].items.map((match) => match.id)).toEqual([
      "invalid",
      "missing",
    ]);
  });
});

describe("rolling schedule interactions", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/c/rolling-cup");
    mockedFetch.mockReset();
    mockedFetch.mockResolvedValue({
      competition: {
        id: "competition-1",
        slug: "rolling-cup",
        name: "Rolling Cup",
        type: "tournament",
        startDate: "2099-01-01",
        endDate: "2099-01-20",
        location: "Riverside",
        description: null,
        isActive: false,
        isEnded: false,
        autoApproveClaims: true,
        logoUrl: null,
        brandColor: "#2457a7",
        secondaryColor: null,
        tertiaryColor: null,
        bannerUrl: null,
        websiteUrl: null,
        claimedCount: 0,
        participantCount: 0,
        isFollowing: false,
      },
      participants: [],
      matches: [
        makeMatch("first", "2099-01-05"),
        makeMatch("second", "2099-01-12", {
          status: "postponed",
          statusReason: "Weather",
        }),
        makeMatch("invalid", "2099-02-30"),
      ],
      featuredRecaps: [],
      brackets: [],
    } as never);
  });

  it("supports manual navigation and explicit pause without hiding the spotlight", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompetitionPage />);

    expect(await screen.findByTestId("schedule-spotlight")).toBeInTheDocument();
    expect(screen.getByTestId("spotlight-match-first")).toBeInTheDocument();
    expect(screen.queryByTestId("row-match-first")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("btn-spotlight-next"));
    expect(screen.getByTestId("spotlight-match-second")).toBeInTheDocument();
    expect(screen.getByTestId("spotlight-status-second")).toHaveTextContent(
      "Postponed",
    );
    expect(screen.getByTestId("btn-spotlight-pause")).toHaveAccessibleName(
      "Resume spotlight rotation",
    );
  });

  it("toggles week sections independently and keeps malformed dates under Undated", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompetitionPage />);

    await screen.findByTestId("schedule-spotlight");
    await user.click(screen.getByTestId("btn-toggle-schedule"));

    await waitFor(() =>
      expect(screen.getByTestId("row-match-first")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("row-match-second")).not.toBeInTheDocument();

    const secondKey = scheduleWeekStateKey("Gold · A", "2099-01-12");
    await user.click(
      screen.getByTestId(
        `btn-toggle-match-week-${encodeURIComponent(secondKey)}`,
      ),
    );
    expect(screen.getByTestId("row-match-second")).toBeInTheDocument();

    const firstKey = scheduleWeekStateKey("Gold · A", "2099-01-05");
    await user.click(
      screen.getByTestId(
        `btn-toggle-match-week-${encodeURIComponent(firstKey)}`,
      ),
    );
    expect(screen.queryByTestId("row-match-first")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-match-second")).toBeInTheDocument();

    const undatedKey = scheduleWeekStateKey("Gold · A", "__undated__");
    await user.click(
      screen.getByTestId(
        `btn-toggle-match-week-${encodeURIComponent(undatedKey)}`,
      ),
    );
    expect(screen.getByTestId("row-match-invalid")).toHaveTextContent(
      "Date not listed",
    );
  });
});

describe("featured recap week sections", () => {
  it("groups unbracketed recap-like items by week and keeps undated items visible", () => {
    const groups = weekGroups([
      { id: "monday", matchDate: "2026-08-03" },
      { id: "sunday", matchDate: "2026-08-09" },
      { id: "next-week", matchDate: "2026-08-10" },
      { id: "undated", matchDate: null },
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "2026-08-03",
      "2026-08-10",
      "__undated__",
    ]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["monday", "sunday"]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["next-week"]);
    expect(groups[2].items.map((item) => item.id)).toEqual(["undated"]);
  });

  it("uses one actual-date group for a short tournament, even across week boundaries", () => {
    const competition = {
      type: "tournament" as const,
      startDate: "2026-08-09",
      endDate: "2026-08-11",
    };
    const groups = recapGroups(
      [
        { id: "sunday", matchDate: "2026-08-09" },
        { id: "monday", matchDate: "2026-08-10" },
        { id: "undated", matchDate: null },
      ],
      competition,
    );

    expect(isShortTournament(competition)).toBe(true);
    expect(groups.map((group) => group.key)).toEqual([
      "__competition_dates__",
      "__undated__",
    ]);
    expect(groups[0].items.map((item) => item.id)).toEqual([
      "sunday",
      "monday",
    ]);
  });

  it("keeps Monday–Sunday groups for leagues and longer tournaments", () => {
    expect(
      isShortTournament({
        type: "league",
        startDate: "2026-08-09",
        endDate: "2026-08-11",
      }),
    ).toBe(false);
    expect(
      isShortTournament({
        type: "tournament",
        startDate: "2026-08-01",
        endDate: "2026-08-15",
      }),
    ).toBe(false);
  });
});

describe("competition Teams ordering", () => {
  it("separates repeated group names by age and gender, with natural team sorting", () => {
    const sections = competitionTeamSections([
      {
        id: "u12-girls-z",
        name: "Zebras 20",
        division: "Gold",
        bracket: "A",
        age: "U12",
        gender: "girls",
        claimed: false,
        teamId: null,
      },
      {
        id: "u10-boys-20",
        name: "Storm 20",
        division: "Gold",
        bracket: "A",
        age: "U10",
        gender: "Boys",
        claimed: false,
        teamId: null,
      },
      {
        id: "u8-boys",
        name: "Comets",
        division: "Gold",
        bracket: "A",
        age: "U8",
        gender: "boys",
        claimed: false,
        teamId: null,
      },
      {
        id: "u10-boys-12",
        name: "Storm 12",
        division: "Gold",
        bracket: "A",
        age: "U10",
        gender: "Boys",
        claimed: false,
        teamId: null,
      },
      {
        id: "u12-boys",
        name: "Falcons",
        division: "Silver",
        bracket: "B",
        age: "U12",
        gender: "Boys",
        claimed: false,
        teamId: null,
      },
      {
        id: "missing",
        name: "Unlisted",
        division: "Gold",
        bracket: "A",
        age: null,
        gender: null,
        claimed: false,
        teamId: null,
      },
    ]);

    expect(sections.map((section) => section.title)).toEqual([
      "U8 · Boys · Gold · A",
      "U10 · Boys · Gold · A",
      "U12 · Boys · Silver · B",
      "U12 · Girls · Gold · A",
      "Age not listed · Gender not listed · Gold · A",
    ]);
    expect(sections[1].teams.map((team) => team.name)).toEqual([
      "Storm 12",
      "Storm 20",
    ]);
  });
});

describe("featured recap preview text", () => {
  it("prefers a later paragraph from the published recap body", () => {
    expect(
      featuredRecapPreviewText({
        body: [
          "The opening goal set the tone for a complete performance.",
          "",
          "After halftime, the midfield pressed higher and created three clear chances.",
          "",
          "The team stayed composed through the final whistle.",
        ].join("\n"),
        summary: "A complete performance.",
      }),
    ).toBe("After halftime, the midfield pressed higher and created three clear chances.");
  });

  it("uses a later sentence when the recap has no paragraph break", () => {
    expect(
      featuredRecapPreviewText({
        body: "The opening goal set the tone. The midfield pressed higher after halftime. The team stayed composed.",
        summary: "A complete performance.",
      }),
    ).toBe("The midfield pressed higher after halftime. The team stayed composed.");
  });

  it("keeps a short body when there is no later content to preview", () => {
    expect(
      featuredRecapPreviewText({
        body: "Big win",
        summary: "A complete performance.",
      }),
    ).toBe("Big win");
  });

  it("falls back to the summary when the recap body is blank", () => {
    expect(
      featuredRecapPreviewText({
        body: "   ",
        summary: "A late winner decided the match.",
      }),
    ).toBe("A late winner decided the match.");
  });

  it("leaves the visual fallback available when neither text field has content", () => {
    expect(featuredRecapPreviewText({ body: null, summary: "  " })).toBeNull();
  });
});

describe("competition recap export safeguards", () => {
  it("allows only published featured recaps from the current competition", () => {
    expect(
      isPublicFeaturedCompetitionRecap(makePost(), "competition-1"),
    ).toBe(true);
    expect(
      isPublicFeaturedCompetitionRecap(
        makePost({ articleStatus: "pending_approval" }),
        "competition-1",
      ),
    ).toBe(false);
    expect(
      isPublicFeaturedCompetitionRecap(makePost({ hidden: true }), "competition-1"),
    ).toBe(false);
    expect(
      isPublicFeaturedCompetitionRecap(
        makePost({ competition: { id: "other-competition" } }),
        "competition-1",
      ),
    ).toBe(false);
  });
});