import { describe, expect, it } from "vitest";
import { featuredRecapBrackets } from "./featuredRecapBrackets";

describe("featured recap bracket hierarchy", () => {
  it("combines Bracket A and B under the full overall group, even without assigned bracket IDs", () => {
    const { options, byRecap } = featuredRecapBrackets([
      { id: "b", bracketId: "b", groupDivision: "2016 U10 Boys Gold", groupBracket: "Bracket B" },
      { id: "a", bracketId: "a", groupDivision: "2016 U10 Boys Gold", groupBracket: "Bracket A" },
      { id: "unassigned", groupDivision: " 2016 U10 BOYS GOLD " },
      { id: "white", groupDivision: "2016 U10 Boys White" },
    ], [{ id: "a", label: "Bracket A" }, { id: "b", label: "Bracket B" }]);
    expect(options.map((option) => option.label)).toEqual(["2016 U10 Boys Gold", "2016 U10 Boys White"]);
    expect(byRecap.get("a")?.key).toBe(byRecap.get("b")?.key);
    expect(byRecap.get("unassigned")?.key).toBe(byRecap.get("a")?.key);
    expect(byRecap.get("b")?.subgroup).toBe("Bracket B");
  });
  it("uses saved overall names when there is no linked game, without inventing an overall group from Bracket A", () => {
    const { options, byRecap } = featuredRecapBrackets([
      { id: "known", bracketId: "gold" },
      { id: "named", groupBracket: "2016 U10 Boys White" },
      { id: "pool", groupBracket: "Bracket A" },
      { id: "deleted", bracketId: "deleted" },
    ], [{ id: "gold", label: "2016 U10 Boys Gold" }]);
    expect(options.map((option) => option.label)).toEqual(["2016 U10 Boys Gold", "2016 U10 Boys White"]);
    expect(byRecap.get("pool")?.key).toBe("__other__");
    expect(byRecap.get("deleted")?.label).toBeNull();
  });
  it("lists saved and schedule-only overall brackets with zero counts and merges name variants", () => {
    const { options } = featuredRecapBrackets([
      { id: "one", bracketId: "gold" }, { id: "two", groupDivision: "2016 U10 BOYS GOLD" },
    ], [
      { id: "gold", label: "2016 U10 Boys Gold" },
      { id: "white", label: "2016 U10 Boys White" },
    ], ["2016 U10 Boys Gold", "2016 U10 Boys Blue", " "]);
    expect(options.map(({ label, count }) => [label, count])).toEqual([
      ["2016 U10 Boys Gold", 2], ["2016 U10 Boys White", 0], ["2016 U10 Boys Blue", 0],
    ]);
  });
});
