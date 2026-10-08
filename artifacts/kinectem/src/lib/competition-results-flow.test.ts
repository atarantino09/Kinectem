import { describe, expect, it } from "vitest";
import { missingRecapGroups, publishableRecaps, snapshotSummary, type ManagedRecap, type ResultGroup, type Snapshot } from "./competition-results";

const g = (key: string, bracketId: string | null) => ({ key, bracketId, games: [] }) as unknown as ResultGroup;
const rc = (id: string, bracketId: string, published: boolean, same = true) =>
  ({ id, bracketId, revision: 1, draft: { title: "t", body: "b" }, published: published ? { title: same ? "t" : "old", body: "b" } : null }) as unknown as ManagedRecap;

describe("simple results flow helpers", () => {
  it("skips every bracket with an existing draft or published recap", () => {
    const out = missingRecapGroups([g("a", "b1"), g("b", "b2"), g("c", "b3"), g("d", null)], [rc("1", "b1", false), rc("2", "b2", true)]);
    expect(out.map((x) => x.key)).toEqual(["c"]);
  });
  it("publishes only unpublished or changed drafts", () => {
    expect(publishableRecaps([rc("1", "a", false), rc("2", "b", true), rc("3", "c", true, false)]).map((r) => r.id)).toEqual(["1", "3"]);
  });
  it("summarizes missing scores and blocked sources", () => {
    const game = (h: number | null, a: number | null) => ({ homeScore: h, awayScore: a, homeParticipantId: null, awayParticipantId: "p" });
    const snap = { status: "blocked", groups: [{ games: [game(null, null), game(null, null)] }] } as unknown as Snapshot;
    const s = snapshotSummary(snap);
    expect(s).toMatchObject({ missingScores: 2, allScoresMissing: true, unlinked: 2, blocked: true });
  });
});
