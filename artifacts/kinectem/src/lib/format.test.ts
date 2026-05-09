import { describe, it, expect } from "vitest";
import { friendlyAgeLabel } from "./format";

const dob = (s: string) => new Date(`${s}T00:00:00Z`);
const now = (s: string) => new Date(`${s}T12:00:00Z`);

describe("friendlyAgeLabel", () => {
  it("returns 'Turns N today' on the birthday", () => {
    expect(friendlyAgeLabel(dob("2012-05-09"), now("2026-05-09"))).toBe(
      "Turns 14 today",
    );
  });

  it("returns 'Turns N tomorrow' the day before", () => {
    expect(friendlyAgeLabel(dob("2012-05-10"), now("2026-05-09"))).toBe(
      "Turns 14 tomorrow",
    );
  });

  it("returns 'Turns N in M days' within a week", () => {
    expect(friendlyAgeLabel(dob("2012-05-12"), now("2026-05-09"))).toBe(
      "Turns 14 in 3 days",
    );
  });

  it("returns 'Age N' otherwise (birthday already passed)", () => {
    expect(friendlyAgeLabel(dob("2012-01-15"), now("2026-05-09"))).toBe(
      "Age 14",
    );
  });

  it("returns 'Age N' otherwise (birthday far in future)", () => {
    expect(friendlyAgeLabel(dob("2012-11-20"), now("2026-05-09"))).toBe(
      "Age 13",
    );
  });

  it("treats leap-day birthdays as March 1 in non-leap years", () => {
    expect(friendlyAgeLabel(dob("2012-02-29"), now("2026-03-01"))).toBe(
      "Turns 14 today",
    );
  });
});
