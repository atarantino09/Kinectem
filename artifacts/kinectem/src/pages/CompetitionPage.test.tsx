import { describe, expect, it } from "vitest";
import {
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