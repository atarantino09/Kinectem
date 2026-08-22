import { describe, expect, it } from "vitest";
import { competitionWeekForDate } from "../src/lib/competition-weeks";

describe("competitionWeekForDate", () => {
  it("keeps Monday and Sunday in the same Monday-through-Sunday week", () => {
    expect(competitionWeekForDate("2026-08-03")).toEqual({
      key: "2026-08-03",
      start: "2026-08-03",
      end: "2026-08-09",
    });
    expect(competitionWeekForDate("2026-08-09")).toEqual({
      key: "2026-08-03",
      start: "2026-08-03",
      end: "2026-08-09",
    });
  });

  it("crosses month and year boundaries without a timezone conversion", () => {
    expect(competitionWeekForDate("2026-12-31")).toEqual({
      key: "2026-12-28",
      start: "2026-12-28",
      end: "2027-01-03",
    });
  });

  it("keeps missing and invalid values undated", () => {
    expect(competitionWeekForDate(null)).toBeNull();
    expect(competitionWeekForDate("2026-02-30")).toBeNull();
    expect(competitionWeekForDate("2026-8-3")).toBeNull();
  });
});