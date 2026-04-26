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
  it("requires authentication for the feed", async () => {
    const res = await request(app).get("/api/v1/feed");
    expect(res.status).toBe(401);
  });

  it("filters the feed by what the user follows (and unfollows)", async () => {
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();

    const post = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Follow filter recap",
      description: "Used by the follow-filter test",
      body: "Body",
    });
    expect(post.status).toBe(201);
    const postId: string = post.body.id;

    const email = `feedtester+${Date.now()}@kinectem.test`;
    const signup = await request(app).post("/api/v1/auth/signup").send({
      email,
      password: "test-password-123",
      firstName: "Feed",
      lastName: "Tester",
      role: "coach",
    });
    expect(signup.status).toBe(201);
    const newAgent = request.agent(app);
    const login = await newAgent
      .post("/api/v1/auth/login")
      .send({ email, password: "test-password-123" });
    expect(login.status).toBe(200);

    const empty = await newAgent.get("/api/v1/feed");
    expect(empty.status).toBe(200);
    expect(
      empty.body.data.find((p: { id: string }) => p.id === postId),
    ).toBeUndefined();

    const follow = await newAgent.post(
      `/api/v1/organizations/${org.id}/follow`,
    );
    expect([200, 201, 204]).toContain(follow.status);

    const followed = await newAgent.get("/api/v1/feed");
    expect(followed.status).toBe(200);
    expect(
      followed.body.data.find((p: { id: string }) => p.id === postId),
    ).toBeDefined();

    const unfollow = await newAgent.delete(
      `/api/v1/organizations/${org.id}/follow`,
    );
    expect([200, 204]).toContain(unfollow.status);

    const after = await newAgent.get("/api/v1/feed");
    expect(after.status).toBe(200);
    expect(
      after.body.data.find((p: { id: string }) => p.id === postId),
    ).toBeUndefined();
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

  // ----------------------------------------------------------------
  // Task #162 — Share button / re-share endpoints
  // ----------------------------------------------------------------

  it("share toggles increment shareCount and surface the recap on the sharer's profile", async () => {
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();

    // Coach authors a recap (gameDate flag makes it a true recap so
    // the future "is this shareable" client check is satisfied; the
    // server-side check only requires the article kind).
    const create = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Shareable recap",
      description: "Used by the share-toggle test",
      body: "Body",
      gameDate: new Date().toISOString(),
    });
    expect(create.status).toBe(201);
    const articlePostId: string = create.body.id;
    expect(articlePostId.startsWith("article-")).toBe(true);
    expect(create.body.shareCount).toBe(0);
    expect(create.body.hasShared).toBe(false);

    // A second user shares the recap.
    const sharerEmail = `sharetester+${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: sharerEmail,
      password: "test-password-123",
      firstName: "Share",
      lastName: "Tester",
      role: "athlete",
    });
    const sharerAgent = request.agent(app);
    await sharerAgent
      .post("/api/v1/auth/login")
      .send({ email: sharerEmail, password: "test-password-123" });
    const meRes = await sharerAgent.get("/api/v1/users/me");
    const sharerUserId: string = meRes.body.id;

    const share = await sharerAgent.post(
      `/api/v1/posts/${articlePostId}/share`,
    );
    expect(share.status).toBe(204);

    // Idempotent: a second POST returns 204 without creating a dupe.
    const shareAgain = await sharerAgent.post(
      `/api/v1/posts/${articlePostId}/share`,
    );
    expect(shareAgain.status).toBe(204);

    const detail = await sharerAgent.get(`/api/v1/posts/${articlePostId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.shareCount).toBe(1);
    expect(detail.body.hasShared).toBe(true);

    // Third party sees count=1 but hasShared=false.
    const otherView = await coachLogin.agent.get(
      `/api/v1/posts/${articlePostId}`,
    );
    expect(otherView.body.shareCount).toBe(1);
    expect(otherView.body.hasShared).toBe(false);

    // Sharer's profile Posts tab includes the recap with sharedBy
    // attribution (linking back to the sharer).
    const profile = await sharerAgent.get(
      `/api/v1/users/${sharerUserId}/posts`,
    );
    expect(profile.status).toBe(200);
    const sharedCard = profile.body.data.find(
      (p: { id: string }) => p.id === articlePostId,
    );
    expect(sharedCard).toBeDefined();
    expect(sharedCard.sharedBy?.id).toBe(sharerUserId);
    expect(sharedCard.sharedAt).toBeTypeOf("string");

    // Unshare: count drops, hasShared flips, the card disappears
    // from the sharer's Posts tab.
    const unshare = await sharerAgent.delete(
      `/api/v1/posts/${articlePostId}/share`,
    );
    expect(unshare.status).toBe(204);
    const after = await sharerAgent.get(`/api/v1/posts/${articlePostId}`);
    expect(after.body.shareCount).toBe(0);
    expect(after.body.hasShared).toBe(false);
    const profileAfter = await sharerAgent.get(
      `/api/v1/users/${sharerUserId}/posts`,
    );
    expect(
      profileAfter.body.data.find(
        (p: { id: string }) => p.id === articlePostId,
      ),
    ).toBeUndefined();
  });

  it("rejects sharing a non-article post (highlight or org_post)", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();

    // org-post is the easiest non-article kind to author here.
    const create = await agent.post(`/api/v1/organizations/${org.id}/posts`).send({
      title: "Reminder",
      body: "Practice moved to 5pm",
    });
    expect(create.status).toBe(201);
    const orgPostId: string = create.body.id;
    expect(orgPostId.startsWith("orgpost-")).toBe(true);

    const share = await agent.post(`/api/v1/posts/${orgPostId}/share`);
    expect(share.status).toBe(400);
    const unshare = await agent.delete(`/api/v1/posts/${orgPostId}/share`);
    expect(unshare.status).toBe(400);
  });

  it("returns 404 when sharing an article that isn't a game recap (no gameDate)", async () => {
    // The Share feature is scoped to game recaps. The articles
    // schema allows a free-form long-form post without a gameDate;
    // those are not recaps and must not be shareable.
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const create = await agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Generic update — not a recap",
      body: "No gameDate, so this is not a recap.",
    });
    expect(create.status).toBe(201);
    const nonRecapId: string = create.body.id;
    expect(nonRecapId.startsWith("article-")).toBe(true);

    const share = await agent.post(`/api/v1/posts/${nonRecapId}/share`);
    expect(share.status).toBe(404);
  });

  it("returns 404 when sharing a post the viewer cannot see", async () => {
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const draft = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Draft for share-404",
      body: "Not yet published",
      status: "draft",
    });
    expect(draft.status).toBe(201);
    const draftPostId: string = draft.body.id;

    const otherEmail = `share404+${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: otherEmail,
      password: "test-password-123",
      firstName: "Other",
      lastName: "Viewer",
      role: "athlete",
    });
    const otherAgent = request.agent(app);
    await otherAgent
      .post("/api/v1/auth/login")
      .send({ email: otherEmail, password: "test-password-123" });

    const share = await otherAgent.post(`/api/v1/posts/${draftPostId}/share`);
    expect(share.status).toBe(404);
  });

  it("rejects share/unshare when not authenticated", async () => {
    // Synthetic id is fine — the auth check fires before the parse.
    const fakeId = "article-00000000-0000-0000-0000-000000000000";
    const sharePost = await request(app).post(`/api/v1/posts/${fakeId}/share`);
    expect(sharePost.status).toBe(401);
    const unshare = await request(app).delete(`/api/v1/posts/${fakeId}/share`);
    expect(unshare.status).toBe(401);
  });
});
