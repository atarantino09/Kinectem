// Task #767 — notify claimed teams & competition followers when games change.
// Covers: material inline edit → claimed-team staff notified (actor
// excluded), cosmetic edit stays silent, status transitions notify staff +
// followers (same-status write silent, restore notifies), CSV re-import
// sends ONE digest per recipient (not per game) and skips brand-new games,
// and followers are NOT notified by non-status import changes.
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, rosterEntries, teams, tournaments } from "@workspace/db";
import { loginAs } from "./helpers";
import type { Agent } from "supertest";

let n = 0;
function uniq(prefix: string): string {
  n += 1;
  return `${prefix} T767 ${Date.now()}-${n}`;
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
    type: "tournament",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    // Claims must land directly on teamId (not pendingTeamId) so the
    // claimer counts as claimed-team staff for notifications.
    autoApproveClaims: true,
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

async function claimSlot(agent: Agent, comp: { id: string; slug: string }, name: string) {
  const pub = await agent.get(`/api/v1/competitions/${comp.slug}`);
  const slot = pub.body.participants.find((p: { name: string }) => p.name === name);
  expect(slot).toBeTruthy();
  const res = await agent
    .post(`/api/v1/competitions/${comp.slug}/claim`)
    .send({ participantId: slot.id, teamName: uniq(name) });
  expect(res.status).toBe(201);
}

const GAME_KINDS = [
  "competition_game_changed",
  "competition_game_status",
  "competition_games_digest",
];

// Scope to THIS competition's link — demo users persist across tests, so
// notifications from earlier tests in this file would otherwise pollute
// the counts.
// The public serializer maps kind→type, message→title, link→data.link;
// normalize back to kind/message/link for readable assertions.
async function gameNotifs(agent: Agent, slug: string) {
  const res = await agent.get("/api/v1/notifications");
  expect(res.status).toBe(200);
  const rows = res.body.data as {
    type: string;
    title: string;
    data: { link?: string } | null;
  }[];
  return rows
    .map((nn) => ({
      kind: nn.type,
      message: nn.title,
      link: nn.data?.link ?? null,
    }))
    .filter(
      (nn) =>
        GAME_KINDS.includes(nn.kind) && nn.link === `/competitions/c/${slug}`,
    );
}

async function setup() {
  const operator = await loginAs("coach@kinectem.demo");
  const claimer = await loginAs("marcus@kinectem.demo");
  const follower = await loginAs("daniela@kinectem.demo");
  const comp = await createCompetition(operator.agent);
  await operator.agent
    .post(`/api/v1/competitions/${comp.id}/import`)
    .send({ csv: WEEK1 });
  await claimSlot(claimer.agent, comp, "Thunder FC");
  const f = await follower.agent.post(
    `/api/v1/competitions/${comp.slug}/follow`,
  );
  expect(f.status).toBeLessThan(300);
  return { operator, claimer, follower, comp };
}

async function matchIdByNumber(agent: Agent, slug: string, num: string) {
  const pub = await agent.get(`/api/v1/competitions/${slug}`);
  const m = pub.body.matches.find(
    (mm: { matchNumber: string }) => mm.matchNumber === num,
  );
  expect(m).toBeTruthy();
  return m.id as string;
}

const game1Fields = {
  matchNumber: "1",
  matchDate: "2026-08-01",
  startTime: "09:00",
  age: "U12",
  gender: "boys",
  division: "Gold",
  bracket: "A",
  venue: "Riverside Park",
  venueState: "CA",
  field: "Field 2",
  homeName: "Thunder FC",
  awayName: "Lightning SC",
};

describe("game change notifications (Task #767)", () => {
  it("material inline edit notifies claimed-team staff, not the actor or followers", async () => {
    const { operator, claimer, follower, comp } = await setup();
    const before = await gameNotifs(claimer.agent, comp.slug);
    const id = await matchIdByNumber(operator.agent, comp.slug, "1");

    const res = await operator.agent
      .patch(`/api/v1/competitions/${comp.id}/matches/${id}`)
      .send({ ...game1Fields, startTime: "11:30", venue: "Lakeside Complex" });
    expect(res.status).toBe(200);

    const after = await gameNotifs(claimer.agent, comp.slug);
    expect(after.length).toBe(before.length + 1);
    const notif = after[0];
    expect(notif.kind).toBe("competition_game_changed");
    expect(notif.message).toContain("Thunder FC");
    expect(notif.message).toContain("start time 09:00 → 11:30");
    expect(notif.message).toContain("venue Riverside Park → Lakeside Complex");
    expect(notif.link).toBe(`/competitions/c/${comp.slug}`);

    // Actor and followers get nothing for a plain edit.
    expect(await gameNotifs(operator.agent, comp.slug)).toHaveLength(0);
    expect(await gameNotifs(follower.agent, comp.slug)).toHaveLength(0);
  });

  it("cosmetic edit (labels only) stays silent", async () => {
    const { operator, claimer, comp } = await setup();
    const id = await matchIdByNumber(operator.agent, comp.slug, "1");
    const res = await operator.agent
      .patch(`/api/v1/competitions/${comp.id}/matches/${id}`)
      .send({ ...game1Fields, age: "U-12", gender: "Boys" });
    expect(res.status).toBe(200);
    expect(await gameNotifs(claimer.agent, comp.slug)).toHaveLength(0);
  });

  it("status transitions notify staff and followers; same-status write is silent", async () => {
    const { operator, claimer, follower, comp } = await setup();
    const id = await matchIdByNumber(operator.agent, comp.slug, "1");

    const post = await operator.agent
      .post(`/api/v1/competitions/${comp.id}/matches/${id}/status`)
      .send({ status: "postponed", reason: "Rain" });
    expect(post.status).toBe(200);

    for (const agent of [claimer.agent, follower.agent]) {
      const notifs = await gameNotifs(agent, comp.slug);
      expect(notifs).toHaveLength(1);
      expect(notifs[0].kind).toBe("competition_game_status");
      expect(notifs[0].message).toContain("was postponed");
      expect(notifs[0].message).toContain("Rain");
    }

    // Re-sending the same status writes nothing new.
    await operator.agent
      .post(`/api/v1/competitions/${comp.id}/matches/${id}/status`)
      .send({ status: "postponed", reason: "Rain" });
    expect(await gameNotifs(follower.agent, comp.slug)).toHaveLength(1);

    // Restoring notifies again.
    await operator.agent
      .post(`/api/v1/competitions/${comp.id}/matches/${id}/status`)
      .send({ status: "scheduled" });
    const restored = await gameNotifs(follower.agent, comp.slug);
    expect(restored).toHaveLength(2);
    expect(restored[0].message).toContain("back on the schedule");
  });

  it("CSV re-import sends one digest per recipient; new games and followers stay silent", async () => {
    const { operator, claimer, follower, comp } = await setup();
    // Claim the second Thunder-side slot too so the claimer staffs BOTH
    // changed games — still exactly one digest.
    await claimSlot(claimer.agent, comp, "Strikers");

    // Game 1 moves date, game 2 moves venue, game 3 is brand new.
    const week2 = `${HEADER}
1,2026-08-02,09:00,U12,boys,Gold,A,Riverside Park,CA,Field 2,Thunder FC,Lightning SC
2,2026-08-01,10:30,U12,boys,Gold,A,Lakeside Complex,CA,Field 2,Strikers,Comets
3,2026-08-03,09:00,U12,boys,Gold,A,Riverside Park,CA,Field 2,Thunder FC,Comets`;
    const res = await operator.agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: week2 });
    expect(res.status).toBe(200);

    const notifs = await gameNotifs(claimer.agent, comp.slug);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].kind).toBe("competition_games_digest");
    expect(notifs[0].message).toContain("2 of your games");
    expect(notifs[0].link).toBe(`/competitions/c/${comp.slug}`);

    // Followers only hear about STATUS changes; imports never touch status.
    expect(await gameNotifs(follower.agent, comp.slug)).toHaveLength(0);
    // The actor never notifies themselves.
    expect(await gameNotifs(operator.agent, comp.slug)).toHaveLength(0);

    // Re-importing the identical file changes nothing → no new digest.
    await operator.agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: week2 });
    expect(await gameNotifs(claimer.agent, comp.slug)).toHaveLength(1);
  });

  it("CSV re-import status change notifies staff AND followers (one digest each)", async () => {
    const { operator, claimer, follower, comp } = await setup();

    // Same file plus an optional status column: game 1 canceled, game 2
    // untouched (blank cell).
    const week2 = `${HEADER},status
1,2026-08-01,09:00,U12,boys,Gold,A,Riverside Park,CA,Field 2,Thunder FC,Lightning SC,Cancelled
2,2026-08-01,10:30,U12,boys,Gold,A,Riverside Park,CA,Field 2,Strikers,Comets,`;
    const res = await operator.agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: week2 });
    expect(res.status).toBe(200);

    // Status actually persisted (Cancelled alias → canceled).
    const pub = await operator.agent.get(`/api/v1/competitions/${comp.slug}`);
    const g1 = pub.body.matches.find(
      (m: { matchNumber: string }) => m.matchNumber === "1",
    );
    expect(g1.status).toBe("canceled");

    // Claimed-team staff get their digest.
    const staffNotifs = await gameNotifs(claimer.agent, comp.slug);
    expect(staffNotifs).toHaveLength(1);
    expect(staffNotifs[0].kind).toBe("competition_games_digest");
    expect(staffNotifs[0].message).toContain("1 of your games");

    // Followers hear about the status change too — exactly one digest.
    const followerNotifs = await gameNotifs(follower.agent, comp.slug);
    expect(followerNotifs).toHaveLength(1);
    expect(followerNotifs[0].kind).toBe("competition_games_digest");
    expect(followerNotifs[0].message).toContain("canceled");

    // Actor stays silent; identical re-import adds nothing.
    expect(await gameNotifs(operator.agent, comp.slug)).toHaveLength(0);
    await operator.agent
      .post(`/api/v1/competitions/${comp.id}/import`)
      .send({ csv: week2 });
    expect(await gameNotifs(follower.agent, comp.slug)).toHaveLength(1);
  });

  it("accepted team managers are notified alongside coaches", async () => {
    const { operator, claimer, comp } = await setup();
    const manager = await loginAs("daniela@kinectem.demo");

    // Find the claimer's solo team for this competition and add the
    // manager as an accepted staff position on its roster.
    const pub = await operator.agent.get(`/api/v1/competitions/${comp.slug}`);
    const slot = pub.body.participants.find(
      (p: { name: string }) => p.name === "Thunder FC",
    );
    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, slot.teamId));
    expect(team).toBeTruthy();
    const [entry] = await db
      .insert(rosterEntries)
      .values({
        teamId: team.id,
        userId: manager.user.id,
        role: "player",
        status: "accepted",
        position: "manager",
      })
      .returning({ id: rosterEntries.id });

    try {
      const id = await matchIdByNumber(operator.agent, comp.slug, "1");
      const res = await operator.agent
        .patch(`/api/v1/competitions/${comp.id}/matches/${id}`)
        .send({ ...game1Fields, startTime: "12:00" });
      expect(res.status).toBe(200);

      expect(await gameNotifs(manager.agent, comp.slug)).toHaveLength(1);
      expect(await gameNotifs(claimer.agent, comp.slug)).toHaveLength(1);
    } finally {
      await db.delete(rosterEntries).where(eq(rosterEntries.id, entry.id));
    }
  });
});
