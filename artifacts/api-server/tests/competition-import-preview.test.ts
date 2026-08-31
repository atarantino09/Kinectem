// Task #766 — CSV re-import dry-run preview.
// Covers: first-time preview (all new, nothing written), preview vs apply
// parity, week-over-week diff (added/changed/unchanged + per-field
// before→after), renumbering heuristic, missing-from-file info, duplicate
// match-number warning, permission guard, and that status/statusReason
// survive a re-import (imports never touch them).
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, tournamentMatches, tournaments } from "@workspace/db";
import { loginAs, request, app } from "./helpers";
import type { Agent } from "supertest";

let n = 0;
function uniq(prefix: string): string {
  n += 1;
  return `${prefix} T766 ${Date.now()}-${n}`;
}

const createdComps: string[] = [];
afterEach(async () => {
  for (const id of createdComps.splice(0)) {
    await db.delete(tournaments).where(eq(tournaments.id, id));
  }
});

async function createCompetition(agent: Agent) {
  const res = await agent.post("/api/v1/competitions").send({
    name: uniq("Comp"),
    type: "league",
    startDate: "2026-08-01",
    endDate: "2026-10-31",
  });
  expect(res.status).toBe(201);
  createdComps.push(res.body.id);
  return { id: res.body.id as string, slug: res.body.slug as string };
}

const HEADER =
  "match #,date,start time,age,gender,division,bracket,venue,venue state,field,home team,away team";

const WEEK1 = `${HEADER}
1,2026-08-01,09:00,U12,boys,Gold,A,Riverside Park,CA,Field 2,Thunder FC,Lightning SC
2,2026-08-01,10:30,U12,boys,Gold,A,Riverside Park,CA,Field 2,Strikers,Comets`;

describe("CSV import dry-run preview (Task #766)", () => {
  it("first-time preview shows everything as new and writes nothing", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const comp = await createCompetition(agent);

    const res = await agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: WEEK1, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.preview).toBe(true);
    expect(res.body.added).toHaveLength(2);
    expect(res.body.changed).toHaveLength(0);
    expect(res.body.unchangedCount).toBe(0);
    expect(res.body.renumberWarnings).toHaveLength(0);
    expect(res.body.missingFromFile).toHaveLength(0);

    // Nothing was written.
    const pub = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    expect(pub.body.matches).toHaveLength(0);
    expect(pub.body.participants).toHaveLength(0);
  });

  it("apply after preview matches the preview (parity)", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const comp = await createCompetition(agent);

    const prev = await agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: WEEK1, dryRun: true });
    const applied = await agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: WEEK1 });
    expect(applied.status).toBe(200);
    expect(applied.body.matchesUpserted).toBe(
      prev.body.added.length + prev.body.changed.length + prev.body.unchangedCount,
    );

    const pub = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    expect(pub.body.matches).toHaveLength(2);
  });

  it("refreshes a participant's display age and group after a schedule re-import", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const comp = await createCompetition(agent);
    await agent.post(`/api/v1/competitions/${comp.id}/import`).send({ csv: WEEK1 });

    const corrected = `${HEADER}
1,2026-08-01,09:00,U14,boys,Silver,B,Riverside Park,CA,Field 2,Thunder FC,Lightning SC
2,2026-08-01,10:30,U14,boys,Silver,B,Riverside Park,CA,Field 2,Strikers,Comets`;
    const applied = await agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: corrected });
    expect(applied.status).toBe(200);

    const pub = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    expect(pub.status).toBe(200);
    expect(
      pub.body.participants.find((participant: { name: string }) => participant.name === "Thunder FC"),
    ).toMatchObject({
      age: "U14",
      gender: "boys",
      division: "Silver",
      bracket: "B",
    });
  });

  it("week-over-week preview: added, changed with before→after, unchanged, missing", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const comp = await createCompetition(agent);
    await agent.post(`/api/v1/competitions/${comp.id}/import`).send({ csv: WEEK1 });

    // Game 1 unchanged, game 2 moves time+field, game 3 is new; the file is
    // partial in spirit but includes all numbers so missingFromFile is empty.
    const week2 = `${HEADER}
1,2026-08-01,09:00,U12,boys,Gold,A,Riverside Park,CA,Field 2,Thunder FC,Lightning SC
2,2026-08-01,12:00,U12,boys,Gold,A,Riverside Park,CA,Field 5,Strikers,Comets
3,2026-08-08,09:00,U12,boys,Gold,A,Riverside Park,CA,Field 2,Thunder FC,Comets`;

    const res = await agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: week2, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.added.map((a: { matchNumber: string }) => a.matchNumber)).toEqual(["3"]);
    expect(res.body.unchangedCount).toBe(1);
    expect(res.body.changed).toHaveLength(1);
    const changed = res.body.changed[0];
    expect(changed.matchNumber).toBe("2");
    const fields = Object.fromEntries(
      changed.changes.map((c: { field: string; before: string; after: string }) => [
        c.field,
        c,
      ]),
    );
    expect(fields["start time"]).toMatchObject({ before: "10:30", after: "12:00" });
    expect(fields["field"]).toMatchObject({ before: "Field 2", after: "Field 5" });
    expect(changed.changes).toHaveLength(2);

    // A partial file omitting game 1 reports it as untouched, not deleted.
    const partial = `${HEADER}
2,2026-08-01,12:00,U12,boys,Gold,A,Riverside Park,CA,Field 5,Strikers,Comets`;
    const res2 = await agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: partial, dryRun: true });
    expect(
      res2.body.missingFromFile.map((m: { matchNumber: string }) => m.matchNumber).sort(),
    ).toEqual(["1"]);
  });

  it("flags a likely renumbered export", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const comp = await createCompetition(agent);
    await agent.post(`/api/v1/competitions/${comp.id}/import`).send({ csv: WEEK1 });

    // Same games, same dates/teams — but the tool regenerated numbers.
    const renumbered = `${HEADER}
101,2026-08-01,09:00,U12,boys,Gold,A,Riverside Park,CA,Field 2,Thunder FC,Lightning SC
102,2026-08-01,10:30,U12,boys,Gold,A,Riverside Park,CA,Field 2,Strikers,Comets`;

    const res = await agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: renumbered, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.added).toHaveLength(2);
    expect(res.body.renumberWarnings).toHaveLength(2);
    const w = res.body.renumberWarnings.find(
      (x: { fileMatchNumber: string }) => x.fileMatchNumber === "101",
    );
    expect(w).toMatchObject({ existingMatchNumber: "1", homeName: "Thunder FC" });
  });

  it("warns when a match number appears twice in the file", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const comp = await createCompetition(agent);
    const dupes = `${HEADER}
1,2026-08-01,09:00,,,Gold,A,,,,Thunder FC,Lightning SC
1,2026-08-01,10:30,,,Gold,A,,,,Strikers,Comets`;
    const res = await agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: dupes, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.added).toHaveLength(1);
    expect(
      res.body.rowWarnings.some((w: { reason: string }) =>
        w.reason.includes("more than once"),
      ),
    ).toBe(true);
  });

  it("re-import preserves postponed status + reason (imports never touch them)", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const comp = await createCompetition(agent);
    await agent.post(`/api/v1/competitions/${comp.id}/import`).send({ csv: WEEK1 });

    const pub1 = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    const match = pub1.body.matches.find(
      (m: { matchNumber: string }) => m.matchNumber === "1",
    );
    await agent
      .post(`/api/v1/competitions/${comp.id}/matches/${match.id}/status`)
      .send({ status: "postponed", reason: "Rainout" });

    // Preview doesn't count status as a change…
    const prev = await agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: WEEK1, dryRun: true });
    expect(prev.body.unchangedCount).toBe(2);
    expect(prev.body.changed).toHaveLength(0);

    // …and applying keeps the mark.
    await agent.post(`/api/v1/competitions/${comp.id}/import`).send({ csv: WEEK1 });
    const pub2 = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    const after = pub2.body.matches.find(
      (m: { matchNumber: string }) => m.matchNumber === "1",
    );
    expect(after.status).toBe("postponed");
    expect(after.statusReason).toBe("Rainout");
  });

  it("rejects Excel epoch artifacts as schedule dates and start times", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const comp = await createCompetition(agent);
    const epochValues = `${HEADER}
1,1899-12-31,1899-12-31,U12,boys,Gold,A,Riverside Park,CA,Field 2,Thunder FC,Lightning SC
2,0,0,U12,boys,Gold,A,Riverside Park,CA,Field 3,Strikers,Comets`;

    const res = await agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: epochValues });
    expect(res.status).toBe(200);

    const pub = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.matches).toHaveLength(2);
    for (const match of pub.body.matches) {
      expect(match.matchDate).toBeNull();
      expect(match.startTime).toBeNull();
    }
  });

  it("does not expose an already-stored 1899 value as a kickoff time", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const comp = await createCompetition(agent);
    await agent.post(`/api/v1/competitions/${comp.id}/import`).send({ csv: WEEK1 });
    await db
      .update(tournamentMatches)
      .set({ startTime: "1899-12-31" })
      .where(
        and(
          eq(tournamentMatches.tournamentId, comp.id),
          eq(tournamentMatches.matchNumber, "1"),
        ),
      );

    const pub = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    expect(pub.status).toBe(200);
    const game = pub.body.matches.find(
      (match: { matchNumber: string }) => match.matchNumber === "1",
    );
    expect(game.startTime).toBeNull();
  });

  it("blocks non-operators from previewing", async () => {
    const { agent: owner } = await loginAs("coach@kinectem.demo");
    const { agent: outsider } = await loginAs("marcus@kinectem.demo");
    const comp = await createCompetition(owner);
    const res = await outsider
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: WEEK1, dryRun: true });
    expect(res.status).toBe(403);
  });
});
