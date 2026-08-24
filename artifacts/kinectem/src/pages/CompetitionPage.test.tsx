import { describe, expect, it } from "vitest";
import { featuredRecapPreviewText } from "../lib/featuredRecapPreview";
import {
  competitionTeamSections,
  isPublicFeaturedCompetitionRecap,
  isShortTournament,
  recapGroups,
  weekGroups,
} from "./CompetitionPage";

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "article-recap-1",
    articleStatus: "published",
    competitionFeatured: true,
    competition: { id: "competition-1" },
    ...overrides,
  } as never;
}

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