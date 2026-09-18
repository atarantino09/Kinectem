import { describe, expect, it } from "vitest";
import { scheduleEmailWhenText } from "../src/lib/schedule-notifications";

describe("schedule email event times", () => {
  it("matches the Eastern wall-clock time shown in the schedule UI", () => {
    expect(
      scheduleEmailWhenText({
        startAt: new Date("2026-09-18T21:00:00.000Z"),
        allDay: false,
      }),
    ).toBe("Friday, September 18, 2026 at 5:00 PM EDT");
  });

  it("keeps all-day event dates stable", () => {
    expect(
      scheduleEmailWhenText({
        startAt: new Date("2026-09-18T00:00:00.000Z"),
        allDay: true,
      }),
    ).toBe("Friday, September 18, 2026 (all day)");
  });
});