import { describe, expect, it } from "vitest";
import { normalizeNewsGameDate } from "../src/lib/news-game-date";
import { newsLinkToPost } from "../src/lib/spec-helpers";

describe("news game date validation", () => {
  it("preserves a valid date-only value and rejects impossible calendar dates", () => {
    expect(normalizeNewsGameDate("2026-08-16")).toBe("2026-08-16");
    expect(normalizeNewsGameDate("2024-02-29")).toBe("2024-02-29");
    expect(normalizeNewsGameDate("2026-02-29")).toBe("invalid");
    expect(normalizeNewsGameDate("08/16/2026")).toBe("invalid");
    expect(normalizeNewsGameDate(null)).toBeNull();
    expect(normalizeNewsGameDate(undefined)).toBeNull();
  });
});

describe("news post serialization", () => {
  it("exposes the stored game date separately from the Kinectem posting time", () => {
    const post = newsLinkToPost(
      {
        id: "news-1",
        title: "Wolves take the playoff opener",
        url: "https://localpaper.example/sports/wolves-win",
        sourceName: "Local Paper",
        description: null,
        imageUrl: null,
        gameDate: "2026-08-16",
        createdAt: new Date("2026-08-23T14:00:00.000Z"),
        updatedAt: new Date("2026-08-23T14:00:00.000Z"),
      } as Parameters<typeof newsLinkToPost>[0],
      {
        team: { id: "team-1", name: "Westfield Wolves", logoUrl: null },
        org: null,
        author: null,
      } as Parameters<typeof newsLinkToPost>[1],
    );

    expect(post.createdAt).toBe("2026-08-23T14:00:00.000Z");
    expect(post.gameDate).toBe("2026-08-16T00:00:00.000Z");
  });
});