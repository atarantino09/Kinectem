import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, rosterEntries, rosterInvites, users } from "@workspace/db";
import { app, loginAs, request } from "./helpers";

// Task #668 — Task #667 made team rosters sort alphabetically by display
// name (case-insensitive, nameless last) instead of leaking the raw
// insertion order. These tests pin that ordering on the two server
// endpoints so a future query/refactor can't silently restore the old
// random order without a red test.

async function freshTeam(name: string) {
  const { agent, user } = await loginAs((u) => u.email === "sam@kinectem.demo");
  const orgsRes = await request(app).get("/api/v1/organizations");
  const org = orgsRes.body.data[0];
  const create = await agent
    .post(`/api/v1/organizations/${org.id}/teams`)
    .send({ name, sport: "Soccer" });
  expect(create.status).toBe(201);
  return { agent, user, teamId: create.body.id as string };
}

describe("roster ordering", () => {
  it("orders GET /teams/:teamId/members case-insensitively, nameless last", async () => {
    const { agent, teamId } = await freshTeam("Roster Order Members Team");

    // Insert members directly with names whose alphabetical order differs
    // from both their insertion order AND a naive case-sensitive sort
    // (which would group all uppercase ahead of lowercase). The unique tag
    // lets us isolate just these rows from the team creator's auto roster
    // entry. `name` is NOT NULL, so a "nameless" member is one with an
    // empty / whitespace-only name — those must sort to the very end, not
    // to the front (where a plain `nulls last` order would leave them).
    const tag = randomUUID().slice(0, 8);
    const named = ["delta", "Bravo", "alpha", "Charlie", "echo"];
    // Insert the two nameless members in the middle of the batch so the
    // assertion fails if ordering ever falls back to insertion order.
    const insertion: Array<{ key: string; name: string; nameless: boolean }> = [
      { key: "delta", name: `delta ${tag}`, nameless: false },
      { key: "blank", name: "", nameless: true },
      { key: "Bravo", name: `Bravo ${tag}`, nameless: false },
      { key: "alpha", name: `alpha ${tag}`, nameless: false },
      { key: "spaces", name: "   ", nameless: true },
      { key: "Charlie", name: `Charlie ${tag}`, nameless: false },
      { key: "echo", name: `echo ${tag}`, nameless: false },
    ];
    const createdUserIds: string[] = [];
    for (const m of insertion) {
      const [u] = await db
        .insert(users)
        .values({
          email: `roster-order-${tag}-${m.key}@example.com`,
          name: m.name,
          role: "athlete",
        })
        .returning();
      createdUserIds.push(u.id);
      await db.insert(rosterEntries).values({
        teamId,
        userId: u.id,
        role: "player",
        status: "accepted",
      });
    }

    const res = await agent.get(`/api/v1/teams/${teamId}/members`);
    expect(res.status).toBe(200);
    const idSet = new Set(createdUserIds);
    const ours = (res.body.data as Array<{ userId: string; displayName: string }>)
      .filter((m) => idSet.has(m.userId))
      .map((m) => m.displayName);
    expect(ours.length).toBe(insertion.length);

    const expectedNamed = named
      .map((d) => `${d} ${tag}`)
      .sort((a, b) =>
        a.toLowerCase() < b.toLowerCase()
          ? -1
          : a.toLowerCase() > b.toLowerCase()
            ? 1
            : 0,
      );
    // Named members first (case-insensitive), then the two nameless ones.
    expect(ours.slice(0, expectedNamed.length)).toEqual(expectedNamed);
    const tail = ours.slice(expectedNamed.length);
    expect(tail.length).toBe(2);
    for (const name of tail) {
      expect(name.trim()).toBe("");
    }
  });

  it("orders GET /teams/:teamId/invites by invitedName with nameless last", async () => {
    const { agent, user, teamId } = await freshTeam("Roster Order Invites Team");

    // Insert pending invites directly with scrambled invitedName values,
    // including a couple with no name at all — those must sort to the end
    // (nulls last), never interleaved by insertion order.
    const tag = randomUUID().slice(0, 8);
    const seeds: Array<{ invitedName: string | null; key: string }> = [
      { invitedName: `Zephyr ${tag}`, key: "z" },
      { invitedName: null, key: "n1" },
      { invitedName: `apex ${tag}`, key: "a" },
      { invitedName: `Mango ${tag}`, key: "m" },
      { invitedName: null, key: "n2" },
    ];
    const tokens: string[] = [];
    for (const s of seeds) {
      const token = `roster-order-invite-${tag}-${s.key}`;
      tokens.push(token);
      await db.insert(rosterInvites).values({
        token,
        teamId,
        invitedEmail: `roster-order-invite-${tag}-${s.key}@example.com`,
        invitedName: s.invitedName,
        role: "player",
        status: "pending",
        invitedById: user.id,
      });
    }

    const res = await agent.get(`/api/v1/teams/${teamId}/invites`);
    expect(res.status).toBe(200);
    const tokenSet = new Set(tokens);
    const ours = (
      res.body.data as Array<{ token: string; invitedName: string | null }>
    )
      .filter((i) => tokenSet.has(i.token))
      .map((i) => i.invitedName);
    expect(ours.length).toBe(seeds.length);

    const named = seeds
      .map((s) => s.invitedName)
      .filter((n): n is string => n !== null)
      .sort((a, b) =>
        a.toLowerCase() < b.toLowerCase()
          ? -1
          : a.toLowerCase() > b.toLowerCase()
            ? 1
            : 0,
      );
    // Named invites first (case-insensitive), then the two nameless ones.
    expect(ours.slice(0, named.length)).toEqual(named);
    expect(ours.slice(named.length)).toEqual([null, null]);
  });
});
