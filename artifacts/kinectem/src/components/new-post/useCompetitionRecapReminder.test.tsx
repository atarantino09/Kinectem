import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeRecapCompetitions, useCompetitionRecapReminder } from "./useCompetitionRecapReminder";

const competitions = [
  { id: "league", slug: "league", name: "Season league", startDate: "2026-09-01", endDate: "2026-11-30" },
  { id: "cup", slug: "cup", name: "Midseason cup", startDate: "2026-10-09", endDate: "2026-10-11" },
  { id: "past", slug: "past", name: "Old cup", startDate: "2026-08-01", endDate: "2026-08-02" },
  { id: "unknown", slug: "unknown", name: "Undated cup" },
];
const props = {
  teamId: "team-1", date: "2026-10-09", competitions,
  loading: false, eligible: true, competitionId: "",
};

describe("regular recap competition reminder", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 9, 9, 12));
  });
  afterEach(() => vi.useRealTimers());
  it.each([
    ["two days before", new Date(2026, 9, 7, 12), false],
    ["midnight the day before", new Date(2026, 9, 8, 0, 0), false],
    ["the last millisecond before opening", new Date(2026, 9, 8, 0, 0, 59, 999), false],
    ["12:01 AM the day before", new Date(2026, 9, 8, 0, 1), true],
    ["later the day before", new Date(2026, 9, 8, 12), true],
  ])("uses the shared competition-button boundary %s", (_label, now, available) => {
    const clock = (now as Date).getTime();
    expect(activeRecapCompetitions([competitions[1]], "2026-10-08", clock).length > 0).toBe(available);
  });
  it("does not prompt for a future game before that competition's opening time", () => {
    expect(activeRecapCompetitions([competitions[1]], "2026-10-09", new Date(2026, 9, 7).getTime())).toEqual([]);
  });
  it("opens at 12:01 AM on an already-open editor without a reload", () => {
    vi.setSystemTime(new Date(2026, 9, 8, 0, 0, 59, 999));
    const { result } = renderHook(useCompetitionRecapReminder, {
      initialProps: { ...props, date: "2026-10-08", competitions: [competitions[1]] },
    });
    expect(result.current.open).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.open).toBe(true);
  });
  it("includes both overlapping events once the tournament opens the prior day", () => {
    expect(activeRecapCompetitions(competitions, "2026-10-08", new Date(2026, 9, 8, 0, 1).getTime())
      .map((competition) => competition.id)).toEqual(["league", "cup"]);
  });
  it("includes overlapping leagues and tournaments with inclusive dates, not past or undated events", () => {
    expect(activeRecapCompetitions(competitions, "2026-10-09").map((c) => c.id)).toEqual(["league", "cup"]);
    expect(activeRecapCompetitions(competitions, "2026-10-11").map((c) => c.id)).toEqual(["league", "cup"]);
    expect(activeRecapCompetitions(competitions, "2026-10-12").map((c) => c.id)).toEqual(["league"]);
    expect(activeRecapCompetitions(competitions, "invalid")).toEqual([]);
  });
  it("opens once per team/date, and checks again for a different team or game date", () => {
    const { result, rerender } = renderHook(useCompetitionRecapReminder, { initialProps: props });
    expect(result.current.open).toBe(true);
    act(() => result.current.acknowledge());
    rerender({ ...props, competitions: [...competitions] });
    expect(result.current.open).toBe(false);
    rerender({ ...props, teamId: "team-2" });
    expect(result.current.open).toBe(true);
    rerender({ ...props, date: "2026-10-10" });
    expect(result.current.open).toBe(true);
  });
  it("does not interrupt an explicit link, edits/highlights, loading or teams with no active competition", () => {
    const { result, rerender } = renderHook(useCompetitionRecapReminder, { initialProps: props });
    for (const change of [
      { eligible: false }, { loading: true }, { competitionId: "cup" },
      { teamId: "" }, { competitions: [] }, { date: "2026-12-01" },
    ]) {
      rerender({ ...props, ...change });
      expect(result.current.open).toBe(false);
    }
  });
});
