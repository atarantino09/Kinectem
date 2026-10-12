import { describe, expect, it } from "vitest";
import { bestAwards, hoursUntil, nextThreshold, orderForRow } from "./achievements";

const cat = [
  { key: "a", name: "A", subject: "user" as const, thresholds: [10, 25, 50], criteria: "" },
  { key: "b", name: "B", subject: "user" as const, thresholds: [1], criteria: "" },
];
const aw = (key: string, tier: 1 | 2 | 3, threshold: number) => ({ key, tier, threshold, earnedAt: "", celebrated: true });

describe("achievements helpers", () => {
  it("keeps the highest tier", () => {
    expect(bestAwards([aw("a", 1, 10), aw("a", 2, 25)]).get("a")?.tier).toBe(2);
  });
  it("computes next threshold", () => {
    expect(nextThreshold(cat[0], aw("a", 1, 10))).toBe(25);
    expect(nextThreshold(cat[0], aw("a", 3, 50))).toBeNull();
    expect(nextThreshold(cat[1], aw("b", 1, 1))).toBeNull();
    expect(nextThreshold(cat[0])).toBe(10);
  });
  it("returns only featured earned badges", () => {
    const { items } = orderForRow(cat, [aw("a", 3, 50), aw("b", 1, 1)], ["b"]);
    expect(items.map((i) => i.key)).toEqual(["b"]);
  });
  it("hoursUntil", () => {
    expect(hoursUntil("2024-01-01T12:00:00Z", Date.parse("2024-01-01T00:00:00Z"))).toBe(12);
    expect(hoursUntil(null)).toBeNull();
  });
});
