// Task #765 — inline single-game management in the organizer console.
// Covers: operator create/edit/status/delete of one match, 409 on a taken
// match number (create + renumber-collision on edit only), participant-slot
// upsert mirroring the CSV import, statusReason lifecycle (set on
// postpone/cancel, cleared on restore), permission guards (401/403/404),
// and the public read surfacing status + statusReason.
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, tournaments } from "@workspace/db";
import { loginAs, request, app } from "./helpers";
import type { Agent } from "supertest";

let n = 0;
function uniq(prefix: string): string {
  n += 1;
  return `${prefix} T765 ${Date.now()}-${n}`;
}

async function createCompetition(
  agent: Agent,
): Promise<{ id: string; slug: string }> {
  const res = await agent.post("/api/v1/competitions").send({
    name: uniq("Comp"),
    type: "tournament",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
  });
  expect(res.status).toBe(201);
  createdComps.push(res.body.id);
  return { id: res.body.id, slug: res.body.slug };
}

const createdComps: string[] = [];

afterEach(async () => {
  for (const id of createdComps.splice(0)) {
    await db.delete(tournaments).where(eq(tournaments.id, id));
  }
});

async function setup() {
  const owner = await loginAs("coach@kinectem.demo");
  const outsider = await loginAs("marcus@kinectem.demo");
  return { owner, outsider };
}

const baseGame = {
  matchNumber: "1",
  matchDate: "2026-08-01",
  startTime: "09:00",
  division: "Gold",
  bracket: "A",
  homeName: "Thunder FC",
  awayName: "Lightning SC",
  venue: "Riverside Park",
  venueState: "CA",
  field: "Field 2",
};

describe("competition single-game management (Task #765)", () => {
  it("lets the operator add a game and shows it publicly", async () => {
    const { owner } = await setup();
    const comp = await createCompetition(owner.agent);

    const res = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send(baseGame);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.matchId).toBeTruthy();

    const pub = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.matches).toHaveLength(1);
    const m = pub.body.matches[0];
    expect(m.matchNumber).toBe("1");
    expect(m.homeName).toBe("Thunder FC");
    expect(m.awayName).toBe("Lightning SC");
    expect(m.status).toBe("scheduled");
    expect(m.statusReason).toBeNull();
    // Participant slots were upserted like the CSV import does.
    const names = pub.body.participants.map((p: { name: string }) => p.name);
    expect(names).toContain("Thunder FC");
    expect(names).toContain("Lightning SC");
  });

  it("reuses an existing participant slot instead of duplicating it", async () => {
    const { owner } = await setup();
    const comp = await createCompetition(owner.agent);

    await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send(baseGame);
    await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send({ ...baseGame, matchNumber: "2", awayName: "Comets" });

    const pub = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    const thunders = pub.body.participants.filter(
      (p: { name: string }) => p.name === "Thunder FC",
    );
    expect(thunders).toHaveLength(1);
  });

  it("409s on a duplicate match number (create) and on renumber collision (edit)", async () => {
    const { owner } = await setup();
    const comp = await createCompetition(owner.agent);

    await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send(baseGame);
    const two = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send({ ...baseGame, matchNumber: "2" });
    expect(two.status).toBe(201);

    const dupe = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send(baseGame);
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe("MATCH_NUMBER_TAKEN");

    // Renumbering game 2 onto game 1's number collides…
    const clash = await owner.agent
      .patch(`/api/v1/competitions/${comp.id}/matches/${two.body.matchId}`)
      .send({ ...baseGame, matchNumber: "1" });
    expect(clash.status).toBe(409);

    // …but saving game 2 with its own number untouched is fine.
    const same = await owner.agent
      .patch(`/api/v1/competitions/${comp.id}/matches/${two.body.matchId}`)
      .send({ ...baseGame, matchNumber: "2", field: "Field 9" });
    expect(same.status).toBe(200);
  });

  it("edits fields and re-resolves participant slots", async () => {
    const { owner } = await setup();
    const comp = await createCompetition(owner.agent);
    const created = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send(baseGame);

    const patch = await owner.agent
      .patch(`/api/v1/competitions/${comp.id}/matches/${created.body.matchId}`)
      .send({
        ...baseGame,
        startTime: "11:30",
        awayName: "Comets",
        venue: null,
      });
    expect(patch.status).toBe(200);

    const pub = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    const m = pub.body.matches[0];
    expect(m.startTime).toBe("11:30");
    expect(m.awayName).toBe("Comets");
    expect(m.venue).toBeNull();
  });

  it("400s on an unreadable date", async () => {
    const { owner } = await setup();
    const comp = await createCompetition(owner.agent);
    const res = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send({ ...baseGame, matchDate: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("postpones/cancels with a reason and clears it on restore", async () => {
    const { owner } = await setup();
    const comp = await createCompetition(owner.agent);
    const created = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send(baseGame);
    const matchId = created.body.matchId as string;

    const postpone = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches/${matchId}/status`)
      .send({ status: "postponed", reason: "Rainout" });
    expect(postpone.status).toBe(200);

    let pub = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    expect(pub.body.matches[0].status).toBe("postponed");
    expect(pub.body.matches[0].statusReason).toBe("Rainout");

    const cancel = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches/${matchId}/status`)
      .send({ status: "canceled" });
    expect(cancel.status).toBe(200);
    pub = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    expect(pub.body.matches[0].status).toBe("canceled");
    expect(pub.body.matches[0].statusReason).toBeNull();

    // Restore clears any reason even if one is (incorrectly) sent.
    const restore = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches/${matchId}/status`)
      .send({ status: "scheduled", reason: "ignored" });
    expect(restore.status).toBe(200);
    pub = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    expect(pub.body.matches[0].status).toBe("scheduled");
    expect(pub.body.matches[0].statusReason).toBeNull();
  });

  it("rejects an unknown status value", async () => {
    const { owner } = await setup();
    const comp = await createCompetition(owner.agent);
    const created = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send(baseGame);
    const res = await owner.agent
      .post(
        `/api/v1/competitions/${comp.id}/matches/${created.body.matchId}/status`,
      )
      .send({ status: "completed" });
    expect(res.status).toBe(400);
  });

  it("deletes a game", async () => {
    const { owner } = await setup();
    const comp = await createCompetition(owner.agent);
    const created = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send(baseGame);

    const del = await owner.agent.delete(
      `/api/v1/competitions/${comp.id}/matches/${created.body.matchId}`,
    );
    expect(del.status).toBe(200);

    const pub = await request(app).get(`/api/v1/competitions/${comp.slug}`);
    expect(pub.body.matches).toHaveLength(0);

    const again = await owner.agent.delete(
      `/api/v1/competitions/${comp.id}/matches/${created.body.matchId}`,
    );
    expect(again.status).toBe(404);
  });

  it("blocks non-operators and anonymous callers", async () => {
    const { owner, outsider } = await setup();
    const comp = await createCompetition(owner.agent);
    const created = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send(baseGame);
    const matchId = created.body.matchId as string;

    const anon = await request(app)
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send({ ...baseGame, matchNumber: "9" });
    expect(anon.status).toBe(401);

    const add = await outsider.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send({ ...baseGame, matchNumber: "9" });
    expect(add.status).toBe(403);
    expect(add.body.code).toBe("COMPETITION_FORBIDDEN");

    const edit = await outsider.agent
      .patch(`/api/v1/competitions/${comp.id}/matches/${matchId}`)
      .send(baseGame);
    expect(edit.status).toBe(403);

    const status = await outsider.agent
      .post(`/api/v1/competitions/${comp.id}/matches/${matchId}/status`)
      .send({ status: "canceled" });
    expect(status.status).toBe(403);

    const del = await outsider.agent.delete(
      `/api/v1/competitions/${comp.id}/matches/${matchId}`,
    );
    expect(del.status).toBe(403);
  });

  it("404s for a match in a different competition", async () => {
    const { owner } = await setup();
    const compA = await createCompetition(owner.agent);
    const compB = await createCompetition(owner.agent);
    const created = await owner.agent
      .post(`/api/v1/competitions/${compA.id}/matches`)
      .send(baseGame);

    const cross = await owner.agent.delete(
      `/api/v1/competitions/${compB.id}/matches/${created.body.matchId}`,
    );
    expect(cross.status).toBe(404);
  });
});
