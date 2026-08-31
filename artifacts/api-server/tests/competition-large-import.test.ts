// Task #938 — league-sized competition schedule imports.
import { afterEach, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { db, tournamentMatches, tournaments } from "@workspace/db";
import { loginAs } from "./helpers";
import type { Agent } from "supertest";

const HEADER =
  "match #,date,start time,age,gender,division,bracket,venue,venue state,field,home team,away team";

let n = 0;
const createdComps: string[] = [];

async function createCompetition(agent: Agent) {
  n += 1;
  const res = await agent.post("/api/v1/competitions").send({
    name: `Large Import T938 ${Date.now()}-${n}`,
    type: "league",
    startDate: "2026-08-01",
    endDate: "2027-06-30",
  });
  expect(res.status).toBe(201);
  createdComps.push(res.body.id);
  return res.body.id as string;
}

function leagueCsv(
  rows: number,
  overrides: Map<number, { startTime?: string; field?: string }> = new Map(),
) {
  const lines = [HEADER];
  for (let i = 1; i <= rows; i += 1) {
    const override = overrides.get(i);
    lines.push(
      [
        i,
        "2026-09-12",
        override?.startTime ?? "09:00",
        "U12",
        "boys",
        "Gold",
        "A",
        `League Sports Complex Number ${i}`,
        "NY",
        override?.field ?? `Field ${(i % 20) + 1}`,
        `Home Club ${(i % 100) + 1}`,
        `Away Club ${((i + 1) % 100) + 1}`,
      ].join(","),
    );
  }
  return lines.join("\n");
}

async function storedMatchCount(competitionId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(tournamentMatches)
    .where(eq(tournamentMatches.tournamentId, competitionId));
  return Number(row?.value ?? 0);
}

afterEach(async () => {
  for (const id of createdComps.splice(0)) {
    await db.delete(tournaments).where(eq(tournaments.id, id));
  }
});

describe("league-sized competition imports (Task #938)", () => {
  it(
    "previews the 25,000-row boundary through the larger request parser without writing",
    async () => {
      const { agent } = await loginAs("coach@kinectem.demo");
      const competitionId = await createCompetition(agent);
      const csv = leagueCsv(25_000);
      expect(Buffer.byteLength(JSON.stringify({ csv, dryRun: true }))).toBeGreaterThan(
        1024 * 1024,
      );

      const res = await agent
        .post(`/api/v1/competitions/${competitionId}/import`)
        .send({ csv, dryRun: true });

      expect(res.status).toBe(200);
      expect(res.body.addedCount).toBe(25_000);
      expect(res.body.added).toHaveLength(200);
      expect(res.body.changedCount).toBe(0);
      expect(res.body.unchangedCount).toBe(0);
      expect(await storedMatchCount(competitionId)).toBe(0);
    },
    30_000,
  );

  it(
    "rejects row 25,001 before writing anything",
    async () => {
      const { agent } = await loginAs("coach@kinectem.demo");
      const competitionId = await createCompetition(agent);
      const res = await agent
        .post(`/api/v1/competitions/${competitionId}/import`)
        .send({ csv: leagueCsv(25_001), dryRun: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Too many rows (25001); max 25000");
      expect(await storedMatchCount(competitionId)).toBe(0);
    },
    30_000,
  );

  it(
    "batch imports and safely re-imports a schedule above the old limit",
    async () => {
      const { agent } = await loginAs("coach@kinectem.demo");
      const competitionId = await createCompetition(agent);
      const original = leagueCsv(1_200);

      const first = await agent
        .post(`/api/v1/competitions/${competitionId}/import`)
        .send({ csv: original });
      expect(first.status).toBe(200);
      expect(first.body.matchesUpserted).toBe(1_200);
      expect(await storedMatchCount(competitionId)).toBe(1_200);

      const corrected = leagueCsv(
        1_200,
        new Map([[1, { startTime: "13:30", field: "Championship Field" }]]),
      );
      const preview = await agent
        .post(`/api/v1/competitions/${competitionId}/import`)
        .send({ csv: corrected, dryRun: true });
      expect(preview.status).toBe(200);
      expect(preview.body.changedCount).toBe(1);
      expect(preview.body.unchangedCount).toBe(1_199);

      const reapplied = await agent
        .post(`/api/v1/competitions/${competitionId}/import`)
        .send({ csv: corrected });
      expect(reapplied.status).toBe(200);
      expect(await storedMatchCount(competitionId)).toBe(1_200);

      const [game] = await db
        .select({
          startTime: tournamentMatches.startTime,
          field: tournamentMatches.field,
        })
        .from(tournamentMatches)
        .where(
          and(
            eq(tournamentMatches.tournamentId, competitionId),
            eq(tournamentMatches.matchNumber, "1"),
          ),
        )
        .limit(1);
      expect(game).toEqual({
        startTime: "13:30",
        field: "Championship Field",
      });
    },
    30_000,
  );
});