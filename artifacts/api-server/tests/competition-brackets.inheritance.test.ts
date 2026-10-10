import { describe, expect, it } from "vitest";
import { resolveTeamCompetitionBracket } from "../src/lib/competition-brackets";

const brackets = [{ id: "gold", label: "2016 U10 Boys Gold" }, { id: "silver", label: "Silver" }];
const participant = { id: "slot", bracketId: "gold", division: "2016 U10 Boys Gold", bracket: "Bracket A" };
const game = { homeParticipantId: "slot", awayParticipantId: "opponent", division: "2016 U10 Boys Gold", bracket: "Bracket A" };
describe("claimed team bracket inheritance", () => {
  it("uses the organizer's linked overall bracket, not subgroup A", () => {
    expect(resolveTeamCompetitionBracket([participant], brackets, game)).toEqual(brackets[0]);
  });
  it("follows renames without creating a replacement from old schedule text", () => {
    expect(resolveTeamCompetitionBracket([participant], [{ id: "gold", label: "Renamed Gold" }], game)?.label).toBe("Renamed Gold");
    expect(resolveTeamCompetitionBracket([participant], [], game)).toBeNull();
  });
  it("matches existing full group labels for older unlinked slots", () => {
    expect(resolveTeamCompetitionBracket([{ ...participant, bracketId: null }], brackets, game)?.id).toBe("gold");
  });
  it("does not assume a bracket when slots differ, but resolves a specific game's slot", () => {
    const second = { ...participant, id: "second", bracketId: "silver", division: "Silver" };
    expect(resolveTeamCompetitionBracket([participant, second], brackets)).toBeNull();
    expect(resolveTeamCompetitionBracket([participant, second], brackets, game)?.id).toBe("gold");
    expect(resolveTeamCompetitionBracket([second], brackets, game)).toBeNull();
  });
});
