import { describe, expect, it } from "vitest";
import { isPublicFeaturedCompetitionRecap, weekGroups } from "./CompetitionPage";

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