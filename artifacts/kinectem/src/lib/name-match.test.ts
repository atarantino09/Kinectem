import { describe, expect, it } from "vitest";
import {
  namesRoughlyMatch,
  suggestDistinctNameMatches,
} from "./name-match";

describe("namesRoughlyMatch", () => {
  it("ignores case and repeated whitespace", () => {
    expect(namesRoughlyMatch(" Metro   United ", "metro united")).toBe(true);
  });
});

describe("suggestDistinctNameMatches", () => {
  it("suggests distinct exact and containment matches", () => {
    expect(
      suggestDistinctNameMatches(
        [
          { id: "team-a", name: "Metro United 12U" },
          { id: "team-b", name: "River City" },
        ],
        [
          { id: "slot-a", name: "Metro United 12U Girls" },
          { id: "slot-b", name: "River City" },
        ],
      ),
    ).toEqual({ "team-a": "slot-a", "team-b": "slot-b" });
  });

  it("prefers an exact match over additional containment candidates", () => {
    expect(
      suggestDistinctNameMatches(
        [{ id: "team", name: "Lions" }],
        [
          { id: "exact", name: "Lions" },
          { id: "containment", name: "Lions Blue" },
        ],
      ),
    ).toEqual({ team: "exact" });
  });

  it("leaves ambiguous team choices and conflicting slots unselected", () => {
    expect(
      suggestDistinctNameMatches(
        [
          { id: "ambiguous", name: "Falcons" },
          { id: "conflict-a", name: "Tigers" },
          { id: "conflict-b", name: "Tigers" },
        ],
        [
          { id: "falcons-red", name: "Falcons Red" },
          { id: "falcons-blue", name: "Falcons Blue" },
          { id: "tigers", name: "Tigers" },
        ],
      ),
    ).toEqual({});
  });
});