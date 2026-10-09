import { describe, expect, it } from "vitest";
import { db, organizationAdmins, rosterEntries, rosterInvites } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { app, loginAs, request } from "./helpers";

async function createTeam(name: string) {
  const { agent } = await loginAs("sam@kinectem.demo");
  const orgs = await request(app).get("/api/v1/organizations");
  const orgId = orgs.body.data[0].id as string;
  const response = await agent.post(`/api/v1/organizations/${orgId}/teams`)
    .send({ name, sport: "Soccer" });
  expect(response.status).toBe(201);
  return { teamId: response.body.id as string, orgId };
}

describe("organization manager self-invites", () => {
  it.each(["sam@kinectem.demo", "coach@kinectem.demo"])("auto-approves every position for %s", async (email) => {
    const { agent, user } = await loginAs(email);
    for (const position of ["player", "coach", "assistant_coach", "admin", "manager"]) {
      const { teamId } = await createTeam(`Self ${position}`);
      const added = await agent.post(`/api/v1/teams/${teamId}/invites`)
        .send({ email: ` ${email.toUpperCase()} `, position });
      expect(added.status).toBe(200);
      expect(added.body.outcome).toBe("auto_approved");
      expect(added.body.emailSent).toBeNull();
      const members = await agent.get(`/api/v1/teams/${teamId}/members`);
      expect(members.body.data.find((member: { userId: string }) => member.userId === user.id)?.status).toBe("active");
      const repeated = await agent.post(`/api/v1/teams/${teamId}/invites`).send({ email, position });
      expect(repeated.body.outcome).toBe("already_active");
      const entries = await db.select().from(rosterEntries)
        .where(and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.userId, user.id)));
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe("accepted");
      expect(entries[0].position).toBe(position === "coach" ? null : position);
      expect(await db.select().from(rosterInvites).where(eq(rosterInvites.teamId, teamId))).toHaveLength(0);
    }
  });

  it("promotes a legacy pending player self-invite and keeps the roster and Pending list consistent", async () => {
    const { agent, user } = await loginAs("coach@kinectem.demo");
    const { teamId } = await createTeam("Legacy self-player");
    await db.insert(rosterEntries).values({
      teamId, userId: user.id, role: "player", position: "player",
      status: "pending", invitedById: user.id,
    });
    await db.insert(rosterInvites).values({
      teamId, token: `legacy-${teamId}`, invitedEmail: user.email!.toUpperCase(),
      role: "player", position: "player", invitedById: user.id,
    });
    const [members, invites] = await Promise.all([
      agent.get(`/api/v1/teams/${teamId}/members`),
      agent.get(`/api/v1/teams/${teamId}/invites`),
    ]);
    expect(members.status).toBe(200);
    expect(members.body.data.find((member: { userId: string }) => member.userId === user.id)?.status).toBe("active");
    expect(invites.status).toBe(200);
    expect(invites.body.data.filter((invite: { status: string }) => invite.status === "pending")).toHaveLength(0);
    const entries = await db.select().from(rosterEntries).where(eq(rosterEntries.teamId, teamId));
    expect(entries).toHaveLength(1);
  });

  it("clears a stale self-invite for active staff without replacing their position", async () => {
    const { agent, user } = await loginAs("coach@kinectem.demo");
    const { teamId } = await createTeam("Already active self");
    await db.insert(rosterEntries).values({
      teamId, userId: user.id, role: "coach", position: "admin", status: "accepted",
    });
    await db.insert(rosterInvites).values({
      teamId, token: `active-${teamId}`, invitedEmail: user.email,
      role: "coach", position: "coach", invitedById: user.id,
    });
    const invites = await agent.get(`/api/v1/teams/${teamId}/invites`);
    expect(invites.status).toBe(200);
    expect(invites.body.data.filter((invite: { status: string }) => invite.status === "pending")).toHaveLength(0);
    const [entry] = await db.select().from(rosterEntries).where(eq(rosterEntries.teamId, teamId));
    expect(entry.position).toBe("admin");
    expect(entry.status).toBe("accepted");
  });

  it("creates an accepted membership for a legacy self-invite with no paired roster row", async () => {
    const { agent, user } = await loginAs("coach@kinectem.demo");
    const { teamId } = await createTeam("Legacy unpaired self");
    await db.insert(rosterInvites).values({
      teamId, token: `unpaired-${teamId}`, invitedEmail: user.email,
      role: "coach", position: "assistant_coach", invitedById: user.id,
    });
    const members = await agent.get(`/api/v1/teams/${teamId}/members`);
    expect(members.body.data.find((member: { userId: string }) => member.userId === user.id)?.status).toBe("active");
    const [entry] = await db.select().from(rosterEntries).where(eq(rosterEntries.teamId, teamId));
    expect(entry.position).toBe("assistant_coach");
  });

  it("does not grant automatic approval solely for platform admin authority", async () => {
    const { agent, user } = await loginAs("sam@kinectem.demo");
    const { teamId, orgId } = await createTeam("Platform-only self");
    await db.delete(organizationAdmins).where(and(
      eq(organizationAdmins.organizationId, orgId), eq(organizationAdmins.userId, user.id),
    ));
    const response = await agent.post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: user.email, position: "player" });
    expect(response.status).toBe(201);
    expect(response.body.outcome).toBe("invited");
    const members = await agent.get(`/api/v1/teams/${teamId}/members`);
    expect(members.body.data).toHaveLength(0);
    const invites = await agent.get(`/api/v1/teams/${teamId}/invites`);
    expect(invites.body.data.some((invite: { status: string }) => invite.status === "pending")).toBe(true);
  });

  it("accepts a direct self-add and clears only that admin's own pending invitations", async () => {
    const { agent, user } = await loginAs("coach@kinectem.demo");
    const { user: otherAdmin } = await loginAs("sam@kinectem.demo");
    const { teamId } = await createTeam("Direct self repair");
    await db.insert(rosterEntries).values({
      teamId, userId: user.id, role: "player", status: "pending", invitedById: user.id,
    });
    await db.insert(rosterInvites).values([
      { teamId, token: `own-${teamId}`, invitedEmail: user.email, role: "player", invitedById: user.id },
      { teamId, token: `parent-${teamId}`, invitedEmail: user.email, role: "player", invitedById: otherAdmin.id },
    ]);
    const response = await agent.post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: user.id, position: "player" });
    expect(response.body.status).toBe("active");
    expect(response.body.outcome).toBe("auto_approved");
    const invites = await agent.get(`/api/v1/teams/${teamId}/invites`);
    const pending = invites.body.data.filter((invite: { status: string }) => invite.status === "pending");
    expect(pending).toHaveLength(1);
    const stored = await db.select().from(rosterInvites).where(eq(rosterInvites.token, `parent-${teamId}`));
    expect(stored[0].status).toBe("pending");
  });

  it("does not auto-approve a coach who is not an org admin", async () => {
    const { agent, user } = await loginAs("coach@kinectem.demo");
    const { teamId, orgId } = await createTeam("Coach self chooser");
    await db.delete(organizationAdmins).where(and(
      eq(organizationAdmins.organizationId, orgId), eq(organizationAdmins.userId, user.id),
    ));
    await db.insert(rosterEntries).values({ teamId, userId: user.id, role: "coach", status: "accepted" });
    const response = await agent.post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: user.email, position: "player" });
    expect(response.status).toBe(201);
    expect(response.body.outcome).toBe("invited");
    const invites = await agent.get(`/api/v1/teams/${teamId}/invites`);
    expect(invites.body.data.some((invite: { status: string }) => invite.status === "pending")).toBe(true);
  });
});
