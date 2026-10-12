import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { db, users, teams, rosterEntries, rosterInvites, guardianLinks } from "@workspace/db";
import { loginAs } from "./helpers";

async function setup() {
  const { agent, user: parent } = await loginAs("lisa@kinectem.demo");
  const [child] = await db.select().from(users).where(eq(users.email, "samira@kinectem.demo"));
  const [team] = await db.select().from(teams).limit(1);
  await db.delete(rosterEntries).where(and(eq(rosterEntries.teamId, team.id), eq(rosterEntries.userId, child.id)));
  const [entry] = await db.insert(rosterEntries).values({
    teamId: team.id, userId: child.id, role: "player", position: "player", status: "accepted",
  }).returning();
  return { agent, parent, child, team, entry, url: `/api/v1/teams/${team.id}/members/${entry.id}` };
}

async function otherGuardian(childId: string, status: "active" | "revoked") {
  const [primary] = await db.select().from(users).where(eq(users.email, "lisa@kinectem.demo"));
  const suffix = randomUUID();
  const [guardian] = await db.insert(users).values({
    name: "Other Parent", email: `other-${suffix}@example.test`,
    role: "parent", dateOfBirth: new Date("1980-01-01T00:00:00Z"),
    passwordHash: primary.passwordHash,
  }).returning();
  await db.insert(guardianLinks).values({
    childId, guardianId: guardian.id, status, isPrimary: false, relationshipType: "parent",
  });
  return loginAs(guardian.id);
}

describe("parents removing their own children from a team", () => {
  it("removes only that roster spot and preserves the child, family, and other teams", async () => {
    const { agent, parent, child, team, entry, url } = await setup();
    const [otherTeam] = await db.select().from(teams).where(ne(teams.id, team.id)).limit(1);
    await db.insert(rosterEntries).values({
      teamId: otherTeam.id, userId: child.id, role: "player", position: "player", status: "accepted",
    }).onConflictDoNothing();
    expect((await agent.delete(url)).status).toBe(204);
    expect(await db.select().from(rosterEntries).where(eq(rosterEntries.id, entry.id))).toHaveLength(0);
    expect(await db.select().from(users).where(eq(users.id, child.id))).toHaveLength(1);
    expect(await db.select().from(rosterEntries).where(and(
      eq(rosterEntries.teamId, otherTeam.id), eq(rosterEntries.userId, child.id),
    ))).toHaveLength(1);
    expect(await db.select().from(guardianLinks).where(and(
      eq(guardianLinks.childId, child.id), eq(guardianLinks.guardianId, parent.id),
      eq(guardianLinks.status, "active"),
    ))).toHaveLength(1);
  });

  it("also permits a non-primary active guardian", async () => {
    const { child, url } = await setup();
    const { agent } = await otherGuardian(child.id, "active");
    expect((await agent.delete(url)).status).toBe(204);
  });

  it("clears a paired pending personal invite without revoking a shared join link", async () => {
    const { agent, parent, child, team, entry, url } = await setup();
    await db.update(rosterEntries).set({ status: "pending" }).where(eq(rosterEntries.id, entry.id));
    const [personal] = await db.insert(rosterInvites).values({
      teamId: team.id, role: "player", position: "player", invitedEmail: child.email,
      token: randomUUID(), invitedById: parent.id, status: "pending",
    }).returning();
    const [shared] = await db.insert(rosterInvites).values({
      teamId: team.id, role: "player", position: "player", invitedEmail: null,
      token: randomUUID(), invitedById: parent.id, status: "pending",
    }).returning();
    expect((await agent.delete(url)).status).toBe(204);
    const [personalAfter] = await db.select().from(rosterInvites).where(eq(rosterInvites.id, personal.id));
    const [sharedAfter] = await db.select().from(rosterInvites).where(eq(rosterInvites.id, shared.id));
    expect(personalAfter.status).toBe("revoked");
    expect(sharedAfter.status).toBe("pending");
  });

  it("rejects a revoked guardian and an unrelated player", async () => {
    const { child, url, entry } = await setup();
    const { agent: revoked } = await otherGuardian(child.id, "revoked");
    const { agent: stranger } = await loginAs("daniela@kinectem.demo");
    expect((await revoked.delete(url)).status).toBe(403);
    expect((await stranger.delete(url)).status).toBe(403);
    expect(await db.select().from(rosterEntries).where(eq(rosterEntries.id, entry.id))).toHaveLength(1);
  });

  it("does not give parents permission to change player roles or jerseys", async () => {
    const { agent, url } = await setup();
    expect((await agent.patch(url).send({ position: "admin", jerseyNumber: 10 })).status).toBe(403);
  });

  it("does not allow a parent to remove a staff roster spot", async () => {
    const { agent, entry, url } = await setup();
    await db.update(rosterEntries).set({ role: "coach", position: "coach" })
      .where(eq(rosterEntries.id, entry.id));
    expect((await agent.delete(url)).status).toBe(403);
  });
});
