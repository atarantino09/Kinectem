import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customFetch } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { featuredRecapPreviewText } from "../lib/featuredRecapPreview";
import {
  allScheduleWeekKeys,
  competitionTeamSections,
  defaultOpenScheduleWeekKeys,
  isPublicFeaturedCompetitionRecap,
  isShortTournament,
  mapUrlForLocation,
  matchCalendarText,
  recapGroups,
  scheduleDateKeyForViewer,
  scheduleWeekStateKey,
  type Match,
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

function competitionResponse(overrides: Record<string, unknown> = {}) {
  return {
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
      secondaryColor: "#7c3aed",
      tertiaryColor: null,
      bannerUrl: null,
      websiteUrl: null,
      claimedCount: 0,
      participantCount: 0,
      isFollowing: false,
      ...overrides,
    },
    participants: [],
    matches: [],
    featuredRecaps: [],
    brackets: [],
  };
}

function makeMatch(
  id: string,
  matchDate: string | null,
  overrides: Record<string, unknown> = {},
): Match {
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
  } as Match;
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

describe("schedule grouping model", () => {
  it("can expand every matching week for filtered results, including past and undated games", () => {
    const groups: [string, Match[]][] = [
      ["Gold · A", [makeMatch("past", "2020-01-06"), makeMatch("undated", null)]],
      ["Silver · B", [makeMatch("future", "2099-01-12")]],
    ];

    expect(allScheduleWeekKeys(groups)).toEqual([
      scheduleWeekStateKey("Gold · A", "2020-01-06"),
      scheduleWeekStateKey("Gold · A", "__undated__"),
      scheduleWeekStateKey("Silver · B", "2099-01-12"),
    ]);
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

describe("competition partnership directory", () => {
  it("shows organization branding on the actual featured recap card alongside the event strip", async () => {
    mockedFetch.mockResolvedValue({
      ...competitionResponse(),
      featuredRecaps: [{
        id: "club-recap", title: "A hard-fought victory in the final match of a very busy competition", body: "A hard-fought win.", summary: null,
        coverImageUrl: null, gameDate: "2026-05-04", opponentName: "Rivals",
        teamScore: 3, opponentScore: 1, teamId: "club-team", teamName: "Club U12",
        publishedAt: "2026-05-05T12:00:00Z",
        organization: { id: "club", name: "Authoring Club", logoUrl: "/author-club.png",
          brandPrimaryColor: "#123456", brandSecondaryColor: "#abcdef" },
      }],
    });
    renderWithProviders(<CompetitionPage />);
    const card = await screen.findByTestId("card-featured-recap-club-recap");
    expect(screen.getByRole("heading", { name: "Featured Game Recaps" })).toBeVisible();
    expect(screen.queryByTestId("section-tournament-recaps")).not.toBeInTheDocument();
    expect(mockedFetch.mock.calls.some(([url]) => String(url).includes("/tournament-recaps"))).toBe(false);
    expect(within(card).getByRole("img", { name: "Authoring Club logo" })).toHaveAttribute("src", "/author-club.png");
    expect(within(card).getByText("Authoring Club")).toBeVisible();
    expect(within(card).getByTestId("strip-competition-brand")).toHaveTextContent("Rolling Cup");
    expect(within(card).getByTestId("featured-recap-organization").getAttribute("style")).toContain("#abcdef");
    expect(within(card).getByTestId("featured-recap-team-name")).toHaveTextContent("Club U12");
    expect(within(card).queryByRole("button", { name: /share.*image/i })).not.toBeInTheDocument();
    expect(card.closest("a")).toHaveAttribute("href", "/posts/club-recap");
    expect(within(card).queryByText("Rivals")).not.toBeInTheDocument();
    const title = within(card).getByText("A hard-fought victory in the final match of a very busy competition");
    expect(title).toHaveClass("truncate");
    expect(title).not.toHaveClass("line-clamp-2");
    expect(title).toHaveAttribute("title", title.textContent);
    expect(within(card).getByTestId("preview-featured-recap-club-recap")).toHaveClass("h-36");
    expect(within(card).getByText("A hard-fought win.")).toHaveClass("line-clamp-4");
  });
  it.each([true, false])("keeps the removed results entry hidden (canManage=%s)", async (canManage) => {
    mockedFetch.mockResolvedValue(competitionResponse({ canManage }));
    renderWithProviders(<CompetitionPage />);
    await screen.findByRole("heading", { name: "Rolling Cup" });
    expect(screen.queryByTestId("section-post-competition-results")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-tournament-recaps")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tournament Recaps" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("rail-featured-recaps")).not.toBeInTheDocument();
    expect(mockedFetch.mock.calls.some(([url]) => String(url).includes("/tournament-recaps"))).toBe(false);
  });

  beforeEach(() => {
    window.history.pushState({}, "", "/c/rolling-cup");
    mockedFetch.mockReset();
  });

  it("shows linked partnership branding and a searchable, deduplicated club list", async () => {
    const partners = [
      {
        slug: "north-stars",
        officialName: "North Stars League",
        associationLabel: "League",
        logoUrl: null,
        primaryColor: "#155EEF",
        secondaryColor: "#06B6D4",
      },
      {
        slug: "regional-soccer",
        officialName: "Regional Soccer",
        associationLabel: "Association",
        logoUrl: null,
        primaryColor: "#7C3AED",
        secondaryColor: "#DB2777",
      },
    ];
    const club = {
      id: "org-1",
      name: "Riverside United",
      location: "Riverside",
      city: "Riverside",
      state: "CA",
      logoUrl: null,
      canRequestClaim: true,
      owner: null,
      teams: [{ id: "team-1", name: "Riverside U12" }],
    };
    mockedFetch.mockImplementation(async (path) => {
      if (String(path).includes("/partner-pages/")) {
        return { data: { organizations: [club] } } as never;
      }
      return competitionResponse({ partnerPages: partners }) as never;
    });

    renderWithProviders(<CompetitionPage />);

    expect(
      await screen.findByTestId("competition-partner-directory"),
    ).toHaveTextContent("Find your club");
    expect(screen.getByRole("button", { name: "Show clubs" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.queryByRole("textbox", { name: "Search partnership clubs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("link-competition-partner-north-stars").closest("a"),
    ).toHaveAttribute("href", "/partners/north-stars");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show clubs" }));
    expect(screen.getByRole("button", { name: "Hide clubs" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      await screen.findAllByTestId("competition-partner-club-org-1"),
    ).toHaveLength(1);
    expect(screen.getByText("Ownership access available")).toBeInTheDocument();
    expect(
      screen.getByTestId("competition-partner-access-org-1"),
    ).toHaveStyle({ color: "#ffffff" });

    await user.type(
      screen.getByRole("textbox", { name: "Search partnership clubs" }),
      "Elsewhere",
    );
    expect(screen.getByText("No clubs match that search.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide clubs" }));
    expect(
      screen.queryByTestId("competition-partner-club-org-1"),
    ).not.toBeInTheDocument();
  });

  it("does not reserve directory space for an unlinked competition", async () => {
    mockedFetch.mockResolvedValue(
      competitionResponse({ partnerPages: [] }) as never,
    );

    renderWithProviders(<CompetitionPage />);

    await screen.findByTestId("hero-competition");
    expect(
      screen.queryByTestId("competition-partner-directory"),
    ).not.toBeInTheDocument();
  });

  it("distinguishes a directory outage from a successful empty search", async () => {
    mockedFetch.mockImplementation(async (path) => {
      if (String(path).includes("/partner-pages/")) {
        throw new Error("Directory unavailable");
      }
      return competitionResponse({
        partnerPages: [
          {
            slug: "north-stars",
            officialName: "North Stars League",
            associationLabel: "League",
            logoUrl: null,
            primaryColor: "#FDE047",
            secondaryColor: "#F8FAFC",
          },
        ],
      }) as never;
    });

    renderWithProviders(<CompetitionPage />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Show clubs" }));
    expect(
      await screen.findByRole("alert", undefined, { timeout: 5000 }),
    ).toHaveTextContent("couldn't load the club directory");
    expect(
      screen.queryByText("No clubs match that search."),
    ).not.toBeInTheDocument();
  });

  it("uses readable access-button text for a light partnership color", async () => {
    mockedFetch.mockImplementation(async (path) => {
      if (String(path).includes("/partner-pages/")) {
        return {
          data: {
            organizations: [
              {
                id: "org-light",
                name: "Sunrise Soccer",
                location: null,
                city: "Albany",
                state: "NY",
                logoUrl: null,
                canRequestClaim: true,
                owner: null,
                teams: [],
              },
            ],
          },
        } as never;
      }
      return competitionResponse({
        partnerPages: [
          {
            slug: "sunrise",
            officialName: "Sunrise League",
            associationLabel: "League",
            logoUrl: null,
            primaryColor: "#FDE047",
            secondaryColor: "#F8FAFC",
          },
        ],
      }) as never;
    });

    renderWithProviders(<CompetitionPage />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Show clubs" }));
    expect(
      await screen.findByTestId("competition-partner-access-org-light"),
    ).toHaveStyle({ color: "#111827" });
  });
});

describe("event-day schedule helpers", () => {
  it("builds encoded directions only for safe non-empty locations", () => {
    expect(mapUrlForLocation("Riverside Complex, CA")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Riverside%20Complex%2C%20CA",
    );
    expect(mapUrlForLocation("  ")).toBeNull();
    expect(mapUrlForLocation("Unsafe\nLocation")).toBeNull();
  });

  it("builds a downloadable calendar event for a dated game", () => {
    const text = matchCalendarText(
      makeMatch("calendar", "2026-08-31", {
        homeName: "Falcons",
        awayName: "Storm",
        startTime: "7:30 PM",
      }),
      "Summer Cup",
    );
    expect(text).toContain("SUMMARY:Falcons vs Storm · Summer Cup");
    expect(text).toContain("DTSTART:20260831T193000");
    expect(text).toContain("LOCATION:Riverside Complex\\, CA\\, Field 2");
  });

  it("rolls late games into the next calendar day and blocks line injection", () => {
    const text = matchCalendarText(
      makeMatch("late", "2026-08-31", {
        startTime: "11:00 PM",
        homeName: "Falcons\r\nX-INJECTED:yes",
      }),
      "Summer Cup",
    );
    expect(text).toContain("DTEND:20260901T010000");
    expect(text).not.toContain("\r\nX-INJECTED:yes");
    expect(text).toContain("Falcons\\nX-INJECTED:yes");
  });
});

describe("schedule filtering interactions", () => {
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
        makeMatch("first", "2099-01-05", {
          homeName: "Falcons",
          awayName: "Comets",
        }),
        makeMatch("second", "2099-01-12", {
          homeName: "Storm",
          awayName: "Lightning",
          gender: "Boys",
          age: "U10",
          division: "Silver",
          bracket: "B",
          venue: "North Athletic Park",
          field: "Pitch 9",
          status: "postponed",
          statusReason: "Weather",
        }),
        makeMatch("invalid", "2099-02-30", {
          homeName: "United",
          awayName: "City",
        }),
      ],
      featuredRecaps: [],
      brackets: [],
    } as never);
  });

  it("searches both matchup teams and details, updates counts, and clears cleanly", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompetitionPage />);

    await screen.findByTestId("card-schedule");
    expect(screen.queryByTestId("schedule-spotlight")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-spotlight-next")).not.toBeInTheDocument();
    expect(screen.queryByText("View full schedule")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("btn-toggle-schedule"));
    expect(screen.getByTestId("badge-schedule-count")).toHaveTextContent("3");
    expect(screen.getByTestId("schedule-result-count")).toHaveTextContent(
      "3 games shown",
    );

    await user.type(screen.getByTestId("input-search-schedule"), "Lightning");
    expect(screen.getByTestId("badge-schedule-count")).toHaveTextContent("1 of 3");
    expect(screen.getByTestId("schedule-result-count")).toHaveTextContent(
      "1 game shown",
    );
    expect(await screen.findByTestId("row-match-second")).toHaveTextContent(
      "Storm",
    );
    expect(screen.queryByTestId("row-match-first")).not.toBeInTheDocument();

    await user.clear(screen.getByTestId("input-search-schedule"));
    await user.type(screen.getByTestId("input-search-schedule"), "Pitch 9");
    expect(screen.getByTestId("row-match-second")).toBeInTheDocument();

    await user.click(screen.getByTestId("btn-clear-schedule-filters"));
    expect(screen.getByTestId("badge-schedule-count")).toHaveTextContent("3");
    expect(screen.getByTestId("schedule-result-count")).toHaveTextContent(
      "3 games shown",
    );
  });

  it("combines Gender, Age, and Group filters and offers a clear no-results action", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompetitionPage />);

    await screen.findByTestId("card-schedule");
    await user.click(screen.getByTestId("btn-toggle-schedule"));

    await user.selectOptions(screen.getByTestId("select-schedule-gender"), "boys");
    await user.selectOptions(screen.getByTestId("select-schedule-age"), "u10");
    await user.selectOptions(
      screen.getByTestId("select-schedule-group"),
      "silver · b",
    );
    expect(screen.getByTestId("badge-schedule-count")).toHaveTextContent("1 of 3");
    expect(await screen.findByTestId("row-match-second")).toBeInTheDocument();

    await user.type(screen.getByTestId("input-search-schedule"), "no such game");
    expect(screen.getByTestId("empty-schedule-filters")).toHaveTextContent(
      "No games match those filters",
    );
    expect(screen.getByTestId("schedule-result-count")).toHaveTextContent(
      "No games match these filters.",
    );

    await user.click(screen.getByTestId("btn-empty-clear-schedule-filters"));
    expect(screen.queryByTestId("empty-schedule-filters")).not.toBeInTheDocument();
    expect(screen.getByTestId("badge-schedule-count")).toHaveTextContent("3");
  });

  it("keeps grouped week rows and malformed dates reachable", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompetitionPage />);

    await screen.findByTestId("card-schedule");
    await user.click(screen.getByTestId("btn-toggle-schedule"));

    await waitFor(() =>
      expect(screen.getByTestId("row-match-first")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("row-match-second")).not.toBeInTheDocument();

    const secondKey = scheduleWeekStateKey("Silver · B", "2099-01-12");
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

  it("distinguishes a competition with no scheduled games", async () => {
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
        secondaryColor: "#7c3aed",
        tertiaryColor: null,
        bannerUrl: null,
        websiteUrl: null,
        claimedCount: 0,
        participantCount: 0,
        isFollowing: false,
      },
      participants: [],
      matches: [],
      featuredRecaps: [],
      brackets: [],
    } as never);

    const user = userEvent.setup();
    renderWithProviders(<CompetitionPage />);
    await screen.findByTestId("card-schedule");
    await user.click(screen.getByTestId("btn-toggle-schedule"));

    expect(screen.getByTestId("empty-schedule")).toHaveTextContent(
      "No games scheduled yet",
    );
    expect(screen.queryByTestId("empty-schedule-filters")).not.toBeInTheDocument();
    expect(screen.getByTestId("schedule-filters")).toBeInTheDocument();
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
  function makeParticipant(
    id: string,
    name: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id,
      name,
      division: "",
      bracket: "",
      age: null,
      gender: null,
      claimed: false,
      teamId: null,
      bracketId: null,
      ...overrides,
    } as Parameters<typeof competitionTeamSections>[0][number];
  }

  it("separates repeated group names by age and gender, with natural team sorting", () => {
    const sections = competitionTeamSections([
      makeParticipant("u12-girls-z", "Zebras 20", { division: "Gold", bracket: "A", age: "U12", gender: "girls" }),
      makeParticipant("u10-boys-20", "Storm 20",  { division: "Gold", bracket: "A", age: "U10", gender: "Boys" }),
      makeParticipant("u8-boys",     "Comets",    { division: "Gold", bracket: "A", age: "U8",  gender: "boys" }),
      makeParticipant("u10-boys-12", "Storm 12",  { division: "Gold", bracket: "A", age: "U10", gender: "Boys" }),
      makeParticipant("u12-boys",    "Falcons",   { division: "Silver", bracket: "B", age: "U12", gender: "Boys" }),
      makeParticipant("missing",     "Unlisted",  { division: "Gold", bracket: "A" }),
    ]);

    expect(sections.map((section) => section.title)).toEqual([
      "Boys · U8 · Gold · A",
      "Boys · U10 · Gold · A",
      "Boys · U12 · Silver · B",
      "Girls · U12 · Gold · A",
      "Gender not listed · Age not listed · Gold · A",
    ]);
    expect(sections[1].teams.map((team) => team.name)).toEqual([
      "Storm 12",
      "Storm 20",
    ]);
  });

  it("sorts bracket-linked and unlinked sections together by gender → age, using the bracket label as title", () => {
    const brackets = [
      { id: "b1", label: "U9 Girls", gender: "Girls", ageGroup: "U9" },
      { id: "b2", label: "U11 Boys", gender: "Boys", ageGroup: "U11" },
    ];
    const sections = competitionTeamSections(
      [
        // Unlinked Boys U8 — sorts before Boys U11 and Girls U9.
        makeParticipant("unlinked-z", "Zebras", { age: "U8", gender: "Boys", division: "Gold" }),
        // Linked to b2 (Boys U11).
        makeParticipant("b2-team-a", "Avalanche", { bracketId: "b2" }),
        makeParticipant("b2-team-b", "Blizzard",  { bracketId: "b2" }),
        // Linked to b1 (Girls U9).
        makeParticipant("b1-team",   "Storm",     { bracketId: "b1" }),
      ],
      brackets,
    );

    expect(sections.map((s) => s.title)).toEqual([
      "Boys · U8 · Gold",   // unlinked Boys U8 — youngest boys first
      "U11 Boys",           // b2 — Boys U11
      "U9 Girls",           // b1 — Girls U9 (girls sort after boys)
    ]);
    expect(sections[2].teams.map((t) => t.id)).toEqual(["b1-team"]);
    // b2 teams sorted alphabetically.
    expect(sections[1].teams.map((t) => t.name)).toEqual(["Avalanche", "Blizzard"]);
  });

  it("keeps linked schedule groups separate when one bracket label spans ages and genders", () => {
    const brackets = [
      { id: "shared", label: "Gold", gender: null, ageGroup: null },
    ];
    const sections = competitionTeamSections(
      [
        makeParticipant("girls-u12", "Falcons", {
          bracketId: "shared",
          age: "U12",
          gender: "Girls",
          division: "Gold",
        }),
        makeParticipant("boys-u10", "Storm", {
          bracketId: "shared",
          age: "U10",
          gender: "Boys",
          division: "Gold",
        }),
      ],
      brackets,
    );

    expect(sections).toHaveLength(2);
    expect(sections.map((section) => section.title)).toEqual(["Gold", "Gold"]);
    expect(sections.map((section) => section.teams.map((team) => team.id))).toEqual([
      ["boys-u10"],
      ["girls-u12"],
    ]);
  });

  it("falls back to string-based grouping when a bracketId is not in the brackets array", () => {
    const brackets = [{ id: "b1", label: "Gold Pool", gender: null, ageGroup: null }];
    const sections = competitionTeamSections(
      [
        makeParticipant("stale", "Old Team", { bracketId: "deleted-bracket", age: "U10", gender: "Boys", division: "Div A" }),
        makeParticipant("linked", "New Team", { bracketId: "b1" }),
      ],
      brackets,
    );

    expect(sections.map((s) => s.title)).toEqual([
      "Boys · U10 · Div A", // stale bracketId → falls back to string grouping (Boys sorts before no-gender)
      "Gold Pool",          // bracketId resolved → bracket label (no gender → sorts last)
    ]);
  });

  it("keeps same-age different-gender unnamed groups in separate sections", () => {
    // This is the key regression guard: a schedule with no division/bracket
    // column produces groups like "U12 · Boys" and "U12 · Girls" — they must
    // NOT merge even if one or both are unnamed (empty division/bracket strings).
    const sections = competitionTeamSections(
      [
        makeParticipant("u12-boys-a", "Alpha", { age: "U12", gender: "Boys" }),
        makeParticipant("u12-boys-b", "Beta",  { age: "U12", gender: "Boys" }),
        makeParticipant("u12-girls",  "Gamma", { age: "U12", gender: "Girls" }),
      ],
      [],
    );

    expect(sections.map((s) => s.title)).toEqual(["Boys · U12", "Girls · U12"]);
    expect(sections[0].teams.map((t) => t.id)).toEqual(["u12-boys-a", "u12-boys-b"]);
    expect(sections[1].teams.map((t) => t.id)).toEqual(["u12-girls"]);
  });

  it("is backward-compatible when called without a brackets argument", () => {
    const sections = competitionTeamSections([
      makeParticipant("t1", "Alpha", { age: "U10", gender: "Boys", division: "Gold" }),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Boys · U10 · Gold");
  });
});

describe("competition claimed-team visibility", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/c/claimed-team-cup");
    mockedFetch.mockReset();
    mockedFetch.mockResolvedValue({
      competition: {
        id: "competition-claimed",
        slug: "claimed-team-cup",
        name: "Claimed Team Cup",
        type: "tournament",
        startDate: "2099-01-01",
        endDate: "2099-01-02",
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
        claimedCount: 1,
        participantCount: 2,
        isFollowing: false,
        canManage: false,
      },
      participants: [
        {
          id: "claimed-slot",
          name: "Already United",
          division: "Gold",
          bracket: "A",
          bracketId: null,
          age: "U10",
          gender: "Boys",
          claimed: true,
          pending: false,
          teamId: "team-claimed",
        },
        {
          id: "open-slot",
          name: "Open City",
          division: "Gold",
          bracket: "A",
          bracketId: null,
          age: "U10",
          gender: "Boys",
          claimed: false,
          pending: false,
          teamId: null,
        },
      ],
      matches: [],
      featuredRecaps: [],
      brackets: [],
    } as never);
  });

  it("keeps claimed teams listed but removes their claim action", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompetitionPage />);

    await user.click(await screen.findByTestId("btn-toggle-participants"));

    expect(screen.getByTestId("row-participant-claimed-slot")).toHaveTextContent(
      "Already United",
    );
    expect(screen.getByTestId("badge-claimed-claimed-slot")).toHaveTextContent(
      "Claimed",
    );
    expect(screen.queryByTestId("btn-claim-claimed-slot")).not.toBeInTheDocument();

    expect(screen.getByTestId("row-participant-open-slot")).toHaveTextContent(
      "Open City",
    );
    expect(screen.getByTestId("btn-claim-open-slot")).toBeInTheDocument();
    expect(screen.getByTestId("badge-team-count")).toHaveTextContent("2");
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