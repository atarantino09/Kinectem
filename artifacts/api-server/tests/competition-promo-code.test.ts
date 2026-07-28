// Task #818 — organizer promo code that auto-fills outreach messages.
// Covers: hub-level round-trip, per-competition override round-trip,
// admin-only writes, and admin-only visibility (public reads never leak the
// code); the hub's code rides along on the competition read for managers so
// the console can compute the fallback.
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, tournaments, competitionOrganizers } from "@workspace/db";
import { loginAs } from "./helpers";
import type { Agent } from "supertest";

let n = 0;
function uniq(prefix: string): string {
  n += 1;
  return `${prefix} T818 ${Date.now()}-${n}`;
}

async function createHub(agent: Agent, name: string) {
  const res = await agent.post("/api/v1/organizers").send({ name });
  expect(res.status).toBe(201);
  createdHubs.push(res.body.id);
  return { id: res.body.id as string, slug: res.body.slug as string };
}

async function createCompetition(agent: Agent, name: string, organizerId?: string) {
  const res = await agent.post("/api/v1/competitions").send({
    name,
    type: "tournament",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    ...(organizerId ? { organizerId } : {}),
  });
  expect(res.status).toBe(201);
  createdComps.push(res.body.id);
  return { id: res.body.id as string, slug: res.body.slug as string };
}

const createdHubs: string[] = [];
const createdComps: string[] = [];

afterEach(async () => {
  for (const id of createdComps.splice(0)) {
    await db.delete(tournaments).where(eq(tournaments.id, id));
  }
  for (const id of createdHubs.splice(0)) {
    await db.delete(competitionOrganizers).where(eq(competitionOrganizers.id, id));
  }
});

describe("organizer promo code (Task #818)", () => {
  it("hub code round-trips via PATCH and is visible to the owner", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const hub = await createHub(agent, uniq("Hub"));

    const patch = await agent
      .patch(`/api/v1/organizers/${hub.id}`)
      .send({ promoCode: "  MYEVENTS25  " });
    expect(patch.status).toBe(200);
    expect(patch.body.promoCode).toBe("MYEVENTS25");

    const read = await agent.get(`/api/v1/organizers/${hub.slug}`);
    expect(read.status).toBe(200);
    expect(read.body.organizer.promoCode).toBe("MYEVENTS25");

    const mine = await agent.get(`/api/v1/my/organizers`);
    const row = mine.body.data.find((o: { id: string }) => o.id === hub.id);
    expect(row.promoCode).toBe("MYEVENTS25");

    // Empty string clears it.
    const clear = await agent
      .patch(`/api/v1/organizers/${hub.id}`)
      .send({ promoCode: "" });
    expect(clear.status).toBe(200);
    expect(clear.body.promoCode).toBeNull();
  });

  it("hub code is hidden from non-managers and unwritable by them", async () => {
    const owner = await loginAs("coach@kinectem.demo");
    const outsider = await loginAs("marcus@kinectem.demo");
    const hub = await createHub(owner.agent, uniq("Hub"));
    await owner.agent
      .patch(`/api/v1/organizers/${hub.id}`)
      .send({ promoCode: "SECRET25" });

    const read = await outsider.agent.get(`/api/v1/organizers/${hub.slug}`);
    expect(read.status).toBe(200);
    expect(read.body.organizer.promoCode).toBeUndefined();

    const patch = await outsider.agent
      .patch(`/api/v1/organizers/${hub.id}`)
      .send({ promoCode: "HIJACK" });
    expect(patch.status).toBe(403);
  });

  it("competition code round-trips and overrides; blank falls back to hub code on the read", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const hub = await createHub(agent, uniq("Hub"));
    await agent.patch(`/api/v1/organizers/${hub.id}`).send({ promoCode: "HUB25" });
    const comp = await createCompetition(agent, uniq("Cup"), hub.id);

    // No own code yet — the manager read exposes null own code + hub code.
    let read = await agent.get(`/api/v1/competitions/${comp.slug}`);
    expect(read.status).toBe(200);
    expect(read.body.competition.promoCode).toBeNull();
    expect(read.body.competition.organizer.promoCode).toBe("HUB25");

    // Set an override.
    const patch = await agent
      .patch(`/api/v1/competitions/${comp.id}`)
      .send({ promoCode: " CUP25 " });
    expect(patch.status).toBe(200);
    expect(patch.body.promoCode).toBe("CUP25");

    read = await agent.get(`/api/v1/competitions/${comp.slug}`);
    expect(read.body.competition.promoCode).toBe("CUP25");

    // Clear it — back to hub fallback.
    const clear = await agent
      .patch(`/api/v1/competitions/${comp.id}`)
      .send({ promoCode: null });
    expect(clear.status).toBe(200);
    expect(clear.body.promoCode).toBeNull();
  });

  it("competition code is hidden from non-managers and unwritable by them", async () => {
    const owner = await loginAs("coach@kinectem.demo");
    const outsider = await loginAs("marcus@kinectem.demo");
    const hub = await createHub(owner.agent, uniq("Hub"));
    await owner.agent.patch(`/api/v1/organizers/${hub.id}`).send({ promoCode: "HUB25" });
    const comp = await createCompetition(owner.agent, uniq("Cup"), hub.id);
    await owner.agent.patch(`/api/v1/competitions/${comp.id}`).send({ promoCode: "CUP25" });

    const read = await outsider.agent.get(`/api/v1/competitions/${comp.slug}`);
    expect(read.status).toBe(200);
    expect(read.body.competition.promoCode).toBeUndefined();
    expect(read.body.competition.organizer.promoCode).toBeUndefined();

    const patch = await outsider.agent
      .patch(`/api/v1/competitions/${comp.id}`)
      .send({ promoCode: "HIJACK" });
    expect(patch.status).toBe(403);
  });
});
