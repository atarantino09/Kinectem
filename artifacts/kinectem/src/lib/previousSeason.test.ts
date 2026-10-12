import { describe, expect, it } from "vitest";
import { previousSeasonPatch, previousSeasonProblemFor } from "./previousSeason";

const on = { enabled: true, season: " 2023-24 ", playedDate: "2024-03-02", attested: false };
describe("previousSeason metadata", () => {
  it("omits when untouched", () => expect(previousSeasonPatch(false, on)).toEqual({}));
  it("clears with null when touched and disabled", () =>
    expect(previousSeasonPatch(true, { ...on, enabled: false })).toEqual({ previousSeason: null }));
  it("draft allows unattested, trimmed", () =>
    expect(previousSeasonPatch(true, on)).toEqual({ previousSeason: { season: "2023-24", gamePlayedDate: "2024-03-02", attested: false } }));
  it("publish validation", () => {
    expect(previousSeasonProblemFor(on, "2025-01-01")).toMatch(/Confirm/);
    expect(previousSeasonProblemFor({ ...on, attested: true }, "2025-01-01")).toBeNull();
    expect(previousSeasonProblemFor({ ...on, attested: true, playedDate: "2025-01-01" }, "2025-01-01")).toMatch(/past/);
    expect(previousSeasonProblemFor({ ...on, enabled: false }, "2025-01-01")).toBeNull();
  });
});
