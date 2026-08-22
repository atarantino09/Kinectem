import { describe, expect, it } from "vitest";
import { competitionWeekForDate, formatCompetitionWeek } from "./competition-weeks";

describe("competition week date-only helpers", () => {
  it("keeps Monday and Sunday together without viewer-timezone shifts", () => {
    const monday = competitionWeekForDate("2026-08-03");
    const sunday = competitionWeekForDate("2026-08-09");
    expect(monday).toEqual({ key: "2026-08-03", start: "2026-08-03", end: "2026-08-09" });
    expect(sunday).toEqual(monday);
  });

  it("formats both ends of a cross-year week", () => {
    const week = competitionWeekForDate("2026-12-31");
    expect(week).toEqual({ key: "2026-12-28", start: "2026-12-28", end: "2027-01-03" });
    expect(formatCompetitionWeek(week!)).toMatch(/Dec 28, 2026.*Jan 3, 2027/);
  });

  it("returns null for unavailable or invalid dates", () => {
    expect(competitionWeekForDate(undefined)).toBeNull();
    expect(competitionWeekForDate("not-a-date")).toBeNull();
  });
});