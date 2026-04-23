import { describe, expect, it } from "vitest";
import { app, loginAs, request } from "./helpers";

async function getFootballTeamId(): Promise<string> {
  const orgs = await request(app).get("/api/v1/organizations");
  const org = orgs.body.data[0];
  const teams = await request(app).get(
    `/api/v1/organizations/${org.id}/teams`,
  );
  const t = teams.body.data.find(
    (x: { name: string }) => x.name === "Varsity Football",
  );
  if (!t) throw new Error("Varsity Football missing from seed");
  return t.id;
}

describe("invites", () => {
  it("lists existing seeded invites", async () => {
    const teamId = await getFootballTeamId();
    const res = await request(app).get(`/api/v1/teams/${teamId}/invites`);
    expect(res.status).toBe(200);
    expect(
      res.body.data.find(
        (i: { token: string }) => i.token === "demo-invite-token-001",
      ),
    ).toBeDefined();
  });

  it("looks up an invite by token", async () => {
    const res = await request(app).get(
      "/api/v1/invites/demo-invite-token-001",
    );
    expect(res.status).toBe(200);
    expect(res.body.invite.token).toBe("demo-invite-token-001");
    expect(res.body.team.name).toBe("Varsity Football");
    expect(res.body.organization.name).toBe("Westfield Athletic Club");
  });

  it("404s on an unknown invite token", async () => {
    const res = await request(app).get("/api/v1/invites/no-such-token");
    expect(res.status).toBe(404);
  });

  it("lets a coach send an email invite for their own team", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const res = await agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({
        email: "newperson@example.com",
        position: "player",
        name: "New Person",
      });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("newperson@example.com");
    expect(res.body.token).toBeTruthy();
  });

  it("forbids non-managers from creating email invites", async () => {
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const teamId = await getFootballTeamId();
    const res = await agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "x@x.com", position: "player" });
    expect(res.status).toBe(403);
  });

  async function createPlayerInvite(): Promise<string> {
    // Seed only includes a "Cornerback" position invite. Mint a fresh
    // player-position invite via the coach so we can exercise the
    // parent/child onboarding flow.
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const created = await coachLogin.agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({
        email: "player-invite@example.com",
        position: "player",
        name: "Player Invite",
      });
    if (created.status !== 201) {
      throw new Error(`Failed to mint player invite: ${created.status}`);
    }
    return created.body.token as string;
  }

  it("flags player invite acceptance as requiring child setup", async () => {
    const token = await createPlayerInvite();
    const { agent } = await loginAs((u) => u.role === "parent");
    const res = await agent.post(`/api/v1/invites/${token}/accept`);
    expect(res.status).toBe(200);
    expect(res.body.requiresChildSetup).toBe(true);
    expect(res.body.teamId).toBeTruthy();
  });

  it("creates the child athlete and roster entry from an invite", async () => {
    const token = await createPlayerInvite();
    const { agent } = await loginAs((u) => u.role === "parent");
    const res = await agent
      .post(`/api/v1/invites/${token}/children`)
      .send({ firstName: "Riley", lastName: "Carter" });
    expect(res.status).toBe(201);
    expect(res.body.child.firstName).toBe("Riley");
    expect(res.body.child.lastName).toBe("Carter");
    expect(res.body.member.status).toBe("active");

    // Child should now appear under the parent's children list.
    const kids = await agent.get("/api/v1/users/me/children");
    expect(kids.status).toBe(200);
    expect(
      kids.body.data.find((c: { firstName: string }) => c.firstName === "Riley"),
    ).toBeDefined();
  });

  it("requires firstName/lastName when adding a child", async () => {
    const token = await createPlayerInvite();
    const { agent } = await loginAs((u) => u.role === "parent");
    const res = await agent
      .post(`/api/v1/invites/${token}/children`)
      .send({ firstName: "Solo" });
    expect(res.status).toBe(400);
  });
});
