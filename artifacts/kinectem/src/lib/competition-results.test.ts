import { describe, expect, it } from "vitest";
import {
  CSV_MAX_BYTES,
  csvFileProblem,
  isoToLocalInput,
  localInputToIso,
  nameCandidates,
  expectedRevisionsFor,
  sortStories,
  unresolvedMappings,
  type PublicStory,
  type ResultGroup,
} from "./competition-results";

const group = (over: Partial<ResultGroup> = {}): ResultGroup => ({
  key: "g1",
  label: "Boys U12",
  gender: "boys",
  age: "U12",
  bracketId: "b1",
  complete: true,
  games: [
    { id: "x1", home: "A", away: "B", homeScore: 1, awayScore: 0, date: "2026-07-11", group: "g1", homeParticipantId: null, awayParticipantId: null },
  ],
  standings: [{ team: "A", position: 1, points: 3, participantId: null }],
  ...over,
});

describe("results mappings", () => {
  it("never treats null mappings as decided", () => {
    expect(unresolvedMappings([group()], new Set())).toHaveLength(4);
  });
  it("is resolved only when every mapping is explicitly chosen", () => {
    const all = new Set(["g:g1", "m:g1:x1:home", "m:g1:x1:away", "s:g1:0"]);
    expect(unresolvedMappings([group()], all)).toEqual([]);
    all.delete("m:g1:x1:away");
    expect(unresolvedMappings([group()], all)).toEqual(["m:g1:x1:away"]);
  });
});

describe("expectedRevisionsFor", () => {
  it("uses saved revision, or 0 for new brackets", () => {
    const groups = [group(), group({ key: "g2", bracketId: "b2" }), group({ key: "g3", bracketId: null })];
    const recaps = [{ bracketId: "b1", revision: 4 }] as never;
    expect(expectedRevisionsFor(groups, ["g1", "g2", "g3"], recaps)).toEqual({ b1: 4, b2: 0 });
  });
});

describe("sortStories", () => {
  it("orders by bracket order", () => {
    const s = [{ bracketOrder: 2, bracketLabel: "B" }, { bracketOrder: 1, bracketLabel: "A" }] as PublicStory[];
    expect(sortStories(s).map((x) => x.bracketLabel)).toEqual(["A", "B"]);
  });
});

describe("date conversion", () => {
  it("round-trips ISO through datetime-local", () => {
    const iso = "2026-07-12T10:30:00.000Z";
    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
    expect(localInputToIso("")).toBeNull();
    expect(isoToLocalInput(null)).toBe("");
    expect(localInputToIso("2026-07-12T10:30")).toMatch(/Z$/);
  });
});
describe("csv + candidates", () => {
  it("enforces .csv and 500KB", () => {
    expect(csvFileProblem({ name: "a.txt", size: 1 })).toMatch(/csv/);
    expect(csvFileProblem({ name: "a.csv", size: CSV_MAX_BYTES + 1 })).toMatch(/500/);
    expect(csvFileProblem({ name: "a.CSV", size: 10 })).toBeNull();
  });
  it("returns all same-name candidates", () => {
    const ps = [{ id: "1", name: "Comets " }, { id: "2", name: "comets" }, { id: "3", name: "Hawks" }] as never;
    expect(nameCandidates("COMETS", ps)).toHaveLength(2);
  });
});
