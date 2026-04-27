import { describe, expect, it } from "vitest";
import { app, loginAs, request } from "./helpers";

async function getOrgAndTeams() {
  const orgsRes = await request(app).get("/api/v1/organizations");
  const org = orgsRes.body.data[0];
  const teamsRes = await request(app).get(
    `/api/v1/organizations/${org.id}/teams`,
  );
  return { org, teams: teamsRes.body.data as Array<{ id: string; name: string }> };
}

describe("teams", () => {
  it("returns teams for an organization with member counts", async () => {
    const { teams } = await getOrgAndTeams();
    expect(teams.length).toBeGreaterThan(0);
    const varsity = teams.find((t) => t.name === "Varsity Football");
    expect(varsity).toBeDefined();
  });

  it("returns the team detail and roster", async () => {
    const { teams } = await getOrgAndTeams();
    const t = teams[0];
    const detail = await request(app).get(`/api/v1/teams/${t.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(t.id);
    const members = await request(app).get(`/api/v1/teams/${t.id}/members`);
    expect(members.status).toBe(200);
    expect(Array.isArray(members.body.data)).toBe(true);
  });

  it("lets an org admin create a new team", async () => {
    const { agent } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const { org } = await getOrgAndTeams();
    const res = await agent
      .post(`/api/v1/organizations/${org.id}/teams`)
      .send({ name: "Test Team", sport: "Soccer", level: "Varsity" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Test Team");
  });

  it("auto-adds the team creator to the roster as an active Admin", async () => {
    // Sam is an org admin who can create teams. We verify that creating
    // the team also lands Sam on the roster as an accepted coach with
    // position "admin", and that Sam can immediately manage the team
    // (e.g. invite another roster member) — proving the existing
    // canManageTeam check picks up the new entry.
    const { agent, user } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const { org } = await getOrgAndTeams();
    const create = await agent
      .post(`/api/v1/organizations/${org.id}/teams`)
      .send({ name: "Creator Admin Team", sport: "Track" });
    expect(create.status).toBe(201);
    const newTeamId = create.body.id as string;

    const members = await agent.get(`/api/v1/teams/${newTeamId}/members`);
    expect(members.status).toBe(200);
    const roster = members.body.data as Array<{
      userId: string;
      position: string;
      status: string;
      role: string;
    }>;
    const mine = roster.find((m) => m.userId === user.id);
    expect(mine).toBeDefined();
    expect(mine!.position).toBe("admin");
    expect(mine!.status).toBe("active");
    expect(mine!.role).toBe("admin");

    // Prove the creator passes the existing "can manage team" check by
    // exercising a coach-only action — adding another roster member.
    const targets = await request(app).get("/api/v1/users?q=Daniela");
    const targetUserId = targets.body.data?.[0]?.id;
    expect(targetUserId).toBeDefined();
    const add = await agent
      .post(`/api/v1/teams/${newTeamId}/members`)
      .send({ userId: targetUserId, position: "player" });
    expect(add.status).toBe(201);
  });

  it("does not notify the creator about their own newly created team", async () => {
    const { agent, user } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const { org } = await getOrgAndTeams();
    const before = await agent.get("/api/v1/notifications");
    const beforeIds = new Set(
      ((before.body?.data ?? []) as Array<{ id: string }>).map((n) => n.id),
    );
    const create = await agent
      .post(`/api/v1/organizations/${org.id}/teams`)
      .send({ name: "No-Notif Team", sport: "Swim" });
    expect(create.status).toBe(201);
    const after = await agent.get("/api/v1/notifications");
    const newOnes = ((after.body?.data ?? []) as Array<{
      id: string;
      kind?: string;
      userId?: string;
    }>).filter((n) => !beforeIds.has(n.id));
    const selfRosterInvites = newOnes.filter(
      (n) => n.kind === "roster_invite" && n.userId === user.id,
    );
    expect(selfRosterInvites).toEqual([]);
  });

  it("treats 'admin' as a coach-level position when added to an existing team", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { teams } = await getOrgAndTeams();
    const target = teams.find((t) => t.name === "JV Football");
    expect(target).toBeDefined();
    const usersList = await request(app).get("/api/v1/users?q=Marcus");
    const userId = usersList.body.data?.[0]?.id ?? usersList.body[0]?.id;
    expect(userId).toBeDefined();
    const res = await agent
      .post(`/api/v1/teams/${target!.id}/members`)
      .send({ userId, position: "admin" });
    expect(res.status).toBe(201);
    expect(res.body.position).toBe("admin");
    expect(res.body.role).toBe("admin");
  });

  it("forbids non-admins from editing a team", async () => {
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const { teams } = await getOrgAndTeams();
    const res = await agent
      .patch(`/api/v1/teams/${teams[0].id}`)
      .send({ name: "Hacked Name" });
    expect(res.status).toBe(403);
  });

  it("lets a coach add a known user to the roster as pending", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { teams } = await getOrgAndTeams();
    const targetTeam = teams.find((t) => t.name === "JV Football");
    expect(targetTeam).toBeDefined();
    // Find a user not currently on JV.
    const usersList = await request(app).get(
      "/api/v1/users?q=Daniela",
    );
    const target = usersList.body.data?.[0] ?? usersList.body[0];
    const userId = target.id;
    const res = await agent
      .post(`/api/v1/teams/${targetTeam!.id}/members`)
      .send({ userId, position: "PG" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
  });

  it("forbids non-managers from adding roster members", async () => {
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const { teams } = await getOrgAndTeams();
    const res = await agent
      .post(`/api/v1/teams/${teams[0].id}/members`)
      .send({ userId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(403);
  });

  it("lets the invited player accept their own roster entry", async () => {
    // Samira (child) has a pending entry on Varsity Boys Basketball.
    const { agent, user } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    const { teams } = await getOrgAndTeams();
    const basketball = teams.find((t) =>
      t.name.includes("Basketball"),
    );
    expect(basketball).toBeDefined();
    const members = await request(app).get(
      `/api/v1/teams/${basketball!.id}/members`,
    );
    const myEntry = members.body.data.find(
      (m: { userId?: string; user?: { id?: string }; id?: string }) =>
        m.userId === user.id || m.user?.id === user.id,
    );
    expect(myEntry).toBeDefined();
    const res = await agent.post(
      `/api/v1/teams/${basketball!.id}/members/${myEntry.id}/accept`,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });
});
