import { describe, it, expect } from "vitest";
import type { ResultGroup } from "@workspace/db";
import { automaticBracket, automaticParticipant, canonicalResultGroups, draftableResults } from "../src/lib/competition-results-preparation";
import { parseResultsTable, parsePastedResults } from "../src/lib/competition-results-intake";
import { renderTournamentDraft } from "../src/lib/tournament-recap-drafting";

const group = () => parseResultsTable("Bracket,Gender,Age,Home Team,Away Team,Home Score,Away Score\nGold,Boys,U12,Rovers,United,,").groups[0];
describe("automatic results preparation", () => {
  it("uses gender and age without assuming a similarly named team", () => {
    const g = { ...group(), bracketId: "b" };
    const participants = [
      { id: "boys", name: "Rovers", gender: "Male", age: "12", bracketId: "b" },
      { id: "girls", name: "Rovers", gender: "Girls", age: "U12", bracketId: "b" },
      { id: "older", name: "Rovers", gender: "Boys", age: "U13", bracketId: "b" },
    ];
    expect(automaticParticipant("Rovers", g, participants)).toBe("boys");
    expect(automaticParticipant("United", g, participants)).toBeNull();
    expect(automaticParticipant("Rovers", g, [...participants, { ...participants[0], id: "other" }])).toBeNull();
    expect(automaticParticipant("Rovers", { ...g, gender: "", age: "", bracketId: null }, participants)).toBeNull();
  });
  it("leaves a unique same-name participant in another bracket unlinked", () => {
    const g = { ...group(), bracketId: "gold" };
    const other = { id: "rovers-silver", name: "Rovers", gender: "Boys", age: "U12", bracketId: "silver" };
    expect(automaticParticipant("Rovers", g, [other])).toBeNull();
    const unassigned = { ...other, id: "unassigned", bracketId: null };
    expect(automaticParticipant("Rovers", g, [unassigned])).toBe("unassigned");
    expect(automaticParticipant("Rovers", g, [other, unassigned])).toBeNull();
    expect(automaticParticipant("Rovers", { ...g, gender: "", age: "" }, [unassigned])).toBeNull();
  });
  it("does not treat a generic occupied bracket label as a different age or gender", () => {
    const g = group();
    const brackets = [
      { id: "girls", label: "Gold", gender: "Girls", ageGroup: "U12" },
      { id: "boys", label: "Gold · Boys · U12", gender: null, ageGroup: null },
    ];
    expect(automaticBracket(g, brackets)?.id).toBe("boys");
    expect(automaticBracket(g, [brackets[0]])).toBeNull();
    expect(automaticBracket({ ...g, gender: "", age: "" }, [brackets[0]])).toBeNull();
  });
  it("reuses sparse existing bracket metadata only when real participating teams establish context", () => {
    const b = { id: "original", label: "Gold", gender: "Boys", ageGroup: null };
    const p = { id: "linked", name: "Rovers", gender: "Boys", age: "U12", bracketId: b.id };
    expect(automaticBracket(group(), [b], [p])?.id).toBe(b.id);
    expect(automaticBracket(group(), [b], [p, { ...p, id: "older", age: "U13" }])).toBeNull();
    expect(automaticBracket(group(), [b], [{ ...p, gender: "Girls" }])).toBeNull();
  });
  it("merges repeated tables, makes game ids unique, and leaves unknown scores unknown", () => {
    const first = group();
    const second = { ...group(), key: "another", label: "GOLD" };
    const [merged] = canonicalResultGroups([first, second]);
    expect(merged.games).toHaveLength(1);
    expect(merged.games[0].homeScore).toBeNull();
    expect(merged.complete).toBe(false);
    const body = renderTournamentDraft(merged, { gameIds: [merged.games[0].id], standingTeams: [], style: "results_roundup" });
    expect(body).toContain("complete score was not available");
    expect(body).not.toContain("0–0");
    expect(body).not.toContain("defeated");
  });
  it("bounds large brackets automatically and gives preference to known scores", () => {
    const g: ResultGroup = { ...group(), games: Array.from({ length: 300 }, (_, i) => ({
      ...group().games[0], id: String(i), homeScore: i >= 200 ? 2 : null, awayScore: i >= 200 ? 1 : null,
    })) };
    const bounded = draftableResults(g);
    expect(bounded.games.length).toBeLessThanOrEqual(120);
    expect(bounded.games[0].homeScore).toBe(2);
    expect(bounded.complete).toBe(false);
    expect(g.games).toHaveLength(300);
  });
  it("accepts copied results pages containing headings and multiple tabular brackets", () => {
    const parsed = parsePastedResults("Results Cup\nBoys U12 Gold\nHome Team\tAway Team\tScore\nRovers\tUnited\t2-1\n\nGirls U12 Gold\nHome Team\tAway Team\tScore\nRovers\tUnited\t");
    expect(parsed.groups).toHaveLength(2);
    expect(parsed.groups[0].label).toBe("Boys U12 Gold");
    expect(parsed.groups[1].games[0].homeScore).toBeNull();
    expect(parsed.status).toBe("partial");
  });
});
