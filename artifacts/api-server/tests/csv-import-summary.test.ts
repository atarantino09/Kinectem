// Task #768 — organizer-facing CSV import clarity. The import response now
// carries a display-only `columns` summary (matched / missingOptional /
// ignoredHeaders, sourced from the same header resolution the parser uses)
// plus `rowWarnings` with 1-based file row numbers. Parser BEHAVIOR is
// unchanged — these tests pin the payload and re-assert the forgiving rules:
// only 4 required columns, aliases accepted, extra columns ignored.
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, tournaments } from "@workspace/db";
import { loginAs } from "./helpers";
import type { Agent } from "supertest";

let n = 0;
function uniq(prefix: string): string {
  n += 1;
  return `${prefix} T768 ${Date.now()}-${n}`;
}

const createdComps: string[] = [];

afterEach(async () => {
  for (const id of createdComps.splice(0)) {
    await db.delete(tournaments).where(eq(tournaments.id, id));
  }
});

async function createCompetition(agent: Agent): Promise<string> {
  const res = await agent.post("/api/v1/competitions").send({
    name: uniq("League"),
    type: "league",
    startDate: "2026-09-01",
    endDate: "2026-11-30",
  });
  expect(res.status).toBe(201);
  createdComps.push(res.body.id);
  return res.body.id as string;
}

describe("CSV import column summary + row warnings (Task #768)", () => {
  it("reports matched aliases, absent optional columns, and ignored extras", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const compId = await createCompetition(agent);

    // Minimal file: aliased headers, one unknown extra column, no optional
    // columns beyond start time.
    const csv = [
      "Game #,Game Date,Kickoff,Home,Visitor,Referee Notes",
      "1,2026-09-05,09:00,Thunder FC,Lightning SC,bring flags",
      "2,2026-09-05,10:30,Strikers,Comets,",
    ].join("\n");

    const res = await agent
      .post(`/api/v1/competitions/${compId}/import`)
      .send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.matchesUpserted).toBe(2);

    const cols = res.body.columns;
    const byColumn = new Map(
      cols.matched.map((m: { column: string; header: string; required: boolean }) => [
        m.column,
        m,
      ]),
    );
    // Aliases resolved, original header text echoed back.
    expect(byColumn.get("match #")).toMatchObject({
      header: "Game #",
      required: true,
    });
    expect(byColumn.get("date")).toMatchObject({ header: "Game Date" });
    expect(byColumn.get("start time")).toMatchObject({
      header: "Kickoff",
      required: false,
    });
    expect(byColumn.get("home team")).toMatchObject({ header: "Home" });
    expect(byColumn.get("away team")).toMatchObject({ header: "Visitor" });

    // Optional columns not present in the file are listed, required never are.
    expect(cols.missingOptional).toEqual(
      expect.arrayContaining(["age", "gender", "division", "bracket", "venue"]),
    );
    expect(cols.missingOptional).not.toContain("date");

    // Unknown extra column is ignored (import still succeeded) and reported.
    expect(cols.ignoredHeaders).toEqual(["Referee Notes"]);

    expect(res.body.rowWarnings).toEqual([]);
  });

  it("warns per row (1-based, header = row 1) without changing import behavior", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const compId = await createCompetition(agent);

    const csv = [
      "match #,date,home team,away team",
      "1,2026-09-05,Thunder FC,Lightning SC", // row 2: fine
      ",2026-09-05,Strikers,Comets", // row 3: no match # → skipped
      "3,not-a-date,Rovers,United", // row 4: bad date → imported, no date
      "4,2026-09-12,,Comets", // row 5: missing home team
    ].join("\n");

    const res = await agent
      .post(`/api/v1/competitions/${compId}/import`)
      .send({ csv });
    expect(res.status).toBe(200);
    // Skipped row is NOT imported; partial rows still are (unchanged behavior).
    expect(res.body.matchesUpserted).toBe(3);

    const rows = res.body.rowWarnings.map((w: { row: number }) => w.row);
    expect(rows).toEqual([3, 4, 5]);
    expect(res.body.rowWarnings[0].reason).toMatch(/no value in the match #/i);
    expect(res.body.rowWarnings[1].reason).toMatch(/couldn't read "not-a-date"/i);
    expect(res.body.rowWarnings[2].reason).toMatch(/home team/i);
  });

  it("lists recognized and unmatched headers in the missing-required error", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const compId = await createCompetition(agent);

    const csv = [
      "match #,date,Home Side,Away Side", // team columns mis-named
      "1,2026-09-05,Thunder FC,Lightning SC",
    ].join("\n");

    const res = await agent
      .post(`/api/v1/competitions/${compId}/import`)
      .send({ csv });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/home team, away team/);
    expect(res.body.error).toMatch(/did recognize.*match #/i);
    expect(res.body.error).toMatch(/"Home Side"/);
    expect(res.body.error).toMatch(/"Away Side"/);
  });
});
