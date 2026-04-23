import { describe, expect, it } from "vitest";
import { app, loginAs, request } from "./helpers";

async function getOrgAndTeam(name = "Varsity Football") {
  const orgs = await request(app).get("/api/v1/organizations");
  const org = orgs.body.data[0];
  const teamsRes = await request(app).get(
    `/api/v1/organizations/${org.id}/teams`,
  );
  const team = teamsRes.body.data.find(
    (t: { name: string }) => t.name === name,
  );
  if (!team) throw new Error(`team ${name} not in seed`);
  return { org, team };
}

describe("posts", () => {
  it("returns the published feed", async () => {
    const res = await request(app).get("/api/v1/feed");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("admin/coach creating a long post publishes immediately", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const res = await agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Coach Recap",
      description: "Test recap",
      body: "Great game.",
    });
    expect(res.status).toBe(201);
    expect(res.body.approvalStatus).toBe("published");
  });

  it("creates a long post as a draft when status=draft", async () => {
    const { agent, user } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const { org } = await getOrgAndTeam();
    const create = await agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Draft recap",
      body: "WIP",
      status: "draft",
    });
    expect(create.status).toBe(201);
    expect(create.body.approvalStatus).toBe("draft");

    const drafts = await agent.get("/api/v1/drafts");
    expect(drafts.status).toBe(200);
    expect(
      drafts.body.data.find(
        (p: { id: string; author?: { id?: string } }) =>
          p.id === create.body.id && p.author?.id === user.id,
      ),
    ).toBeDefined();
  });

  it("blocks non-coach/admin athletes from authoring long posts", async () => {
    const { agent } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const { org } = await getOrgAndTeam();
    const res = await agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Athlete recap",
      body: "Should fail",
    });
    expect(res.status).toBe(403);
  });

  it("non-admin author publish flows through pending_approval and admin can approve", async () => {
    const adminLogin = await loginAs((u) => u.email === "sam@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const { team: jv } = await getOrgAndTeam("JV Football");
    const usersList = await adminLogin.agent.get("/api/v1/users?q=Marcus");
    const marcus = (usersList.body.data ?? usersList.body)[0];
    expect(marcus).toBeDefined();

    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const addRes = await coachLogin.agent
      .post(`/api/v1/teams/${jv.id}/members`)
      .send({ userId: marcus.id, position: "author" });
    expect(addRes.status).toBe(201);

    const marcusLogin = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const accept = await marcusLogin.agent.post(
      `/api/v1/teams/${jv.id}/members/${addRes.body.id}/accept`,
    );
    expect(accept.status).toBe(200);

    const draft = await marcusLogin.agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      teamId: jv.id,
      title: "Marcus author recap",
      body: "From the player's perspective",
      status: "draft",
    });
    expect(draft.status).toBe(201);
    expect(draft.body.approvalStatus).toBe("draft");

    const pub = await marcusLogin.agent.post(
      `/api/v1/posts/${draft.body.id}/publish`,
    );
    expect(pub.status).toBe(200);

    const queue = await adminLogin.agent.get(
      `/api/v1/organizations/${org.id}/post-approvals`,
    );
    expect(queue.status).toBe(200);
    const pending = queue.body.data.find(
      (e: { post: { id: string } }) => e.post.id === draft.body.id,
    );
    expect(pending).toBeDefined();

    const approve = await adminLogin.agent.post(
      `/api/v1/organizations/${org.id}/post-approvals/${draft.body.id}/approve`,
    );
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");
  });

  it("forbids non-admins from viewing or transitioning the approval queue", async () => {
    const { org } = await getOrgAndTeam();
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const view = await agent.get(
      `/api/v1/organizations/${org.id}/post-approvals`,
    );
    expect(view.status).toBe(403);
  });
});
