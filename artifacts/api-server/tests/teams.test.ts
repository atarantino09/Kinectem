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
