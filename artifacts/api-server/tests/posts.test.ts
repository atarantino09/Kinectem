import { describe, expect, it } from "vitest";
import { db, rosterEntries, users } from "@workspace/db";
import { eq } from "drizzle-orm";
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

    // Task #167 — sharing should bell-notify the recap's author with a
    // "X shared your recap '<title>'" notification linking back to the
    // post. Self-shares and duplicate toggles do not generate one.
    const coachNotifs = await coachLogin.agent.get("/api/v1/notifications");
    expect(coachNotifs.status).toBe(200);
    const shareNotif = coachNotifs.body.data.find(
      (n: { type: string; data?: { link?: string } | null }) =>
        n.type === "share" && n.data?.link === `/posts/${articlePostId}`,
    );
    expect(shareNotif).toBeDefined();
    expect(shareNotif.title).toContain("shared your recap");
    expect(shareNotif.title).toContain("Shareable recap");
    expect(shareNotif.isRead).toBe(false);

    // Idempotent: a second POST returns 204 without creating a dupe
    // and without inserting a second notification.
    const shareAgain = await sharerAgent.post(
      `/api/v1/posts/${articlePostId}/share`,
    );
    expect(shareAgain.status).toBe(204);
    const coachNotifsAfterDupe = await coachLogin.agent.get(
      "/api/v1/notifications",
    );
    const dupeShareNotifs = coachNotifsAfterDupe.body.data.filter(
      (n: { type: string; data?: { link?: string } | null }) =>
        n.type === "share" && n.data?.link === `/posts/${articlePostId}`,
    );
    expect(dupeShareNotifs).toHaveLength(1);

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

    // Task #167 — DELETE retracts a still-unread share notification.
    const coachNotifsAfterUnshare = await coachLogin.agent.get(
      "/api/v1/notifications",
    );
    expect(
      coachNotifsAfterUnshare.body.data.find(
        (n: { type: string; data?: { link?: string } | null }) =>
          n.type === "share" && n.data?.link === `/posts/${articlePostId}`,
      ),
    ).toBeUndefined();
  });

  it("share notification stays put once the recap author has read it", async () => {
    // Task #167 — A read notification is part of the author's history;
    // unsharing should not silently rewrite it.
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const create = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Read-then-unshare recap",
      body: "Body",
      gameDate: new Date().toISOString(),
    });
    expect(create.status).toBe(201);
    const articlePostId: string = create.body.id;

    const sharerEmail = `readshare+${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: sharerEmail,
      password: "test-password-123",
      firstName: "Read",
      lastName: "Sharer",
      role: "athlete",
    });
    const sharerAgent = request.agent(app);
    await sharerAgent
      .post("/api/v1/auth/login")
      .send({ email: sharerEmail, password: "test-password-123" });

    const share = await sharerAgent.post(
      `/api/v1/posts/${articlePostId}/share`,
    );
    expect(share.status).toBe(204);

    const inbox = await coachLogin.agent.get("/api/v1/notifications");
    const notif = inbox.body.data.find(
      (n: { type: string; data?: { link?: string } | null }) =>
        n.type === "share" && n.data?.link === `/posts/${articlePostId}`,
    );
    expect(notif).toBeDefined();

    const markRead = await coachLogin.agent.post(
      `/api/v1/notifications/${notif.id}/read`,
    );
    expect(markRead.status).toBe(204);

    const unshare = await sharerAgent.delete(
      `/api/v1/posts/${articlePostId}/share`,
    );
    expect(unshare.status).toBe(204);

    const inboxAfter = await coachLogin.agent.get("/api/v1/notifications");
    const stillThere = inboxAfter.body.data.find(
      (n: { id: string }) => n.id === notif.id,
    );
    expect(stillThere).toBeDefined();
    expect(stillThere.isRead).toBe(true);
  });

  it("share notification is suppressed when the recap author opted out", async () => {
    // Task #167 — Recipients who turn share notifications off via
    // PATCH /notifications/share-preference should not receive the
    // bell row, while the share itself still goes through.
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const create = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Opted-out recap",
      body: "Body",
      gameDate: new Date().toISOString(),
    });
    expect(create.status).toBe(201);
    const articlePostId: string = create.body.id;

    // Author opts out of share notifications.
    const optOut = await coachLogin.agent
      .patch("/api/v1/notifications/share-preference")
      .send({ shareOptOut: true });
    expect(optOut.status).toBe(200);
    expect(optOut.body.shareOptOut).toBe(true);

    const sharerEmail = `optout+${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: sharerEmail,
      password: "test-password-123",
      firstName: "Opt",
      lastName: "Out",
      role: "athlete",
    });
    const sharerAgent = request.agent(app);
    await sharerAgent
      .post("/api/v1/auth/login")
      .send({ email: sharerEmail, password: "test-password-123" });

    const share = await sharerAgent.post(
      `/api/v1/posts/${articlePostId}/share`,
    );
    expect(share.status).toBe(204);

    // The share row itself was created (shareCount went up) — only the
    // notification was suppressed.
    const detail = await sharerAgent.get(`/api/v1/posts/${articlePostId}`);
    expect(detail.body.shareCount).toBe(1);

    const inbox = await coachLogin.agent.get("/api/v1/notifications");
    expect(
      inbox.body.data.find(
        (n: { type: string; data?: { link?: string } | null }) =>
          n.type === "share" && n.data?.link === `/posts/${articlePostId}`,
      ),
    ).toBeUndefined();

    // Opting back in resumes delivery on the next fresh share. Unshare
    // first so the next POST triggers a real insert.
    const unshare = await sharerAgent.delete(
      `/api/v1/posts/${articlePostId}/share`,
    );
    expect(unshare.status).toBe(204);

    const optBackIn = await coachLogin.agent
      .patch("/api/v1/notifications/share-preference")
      .send({ shareOptOut: false });
    expect(optBackIn.body.shareOptOut).toBe(false);

    const reShare = await sharerAgent.post(
      `/api/v1/posts/${articlePostId}/share`,
    );
    expect(reShare.status).toBe(204);

    const inboxAfter = await coachLogin.agent.get("/api/v1/notifications");
    expect(
      inboxAfter.body.data.find(
        (n: { type: string; data?: { link?: string } | null }) =>
          n.type === "share" && n.data?.link === `/posts/${articlePostId}`,
      ),
    ).toBeDefined();
  });

  it("share-preference GET/PATCH/PUT round-trip persists across requests", async () => {
    const { agent } = await loginAs((u) => u.email === "lisa@kinectem.demo");
    // Reset to a known state.
    await agent
      .patch("/api/v1/notifications/share-preference")
      .send({ shareOptOut: false });
    const before = await agent.get("/api/v1/notifications/share-preference");
    expect(before.status).toBe(200);
    expect(before.body.shareOptOut).toBe(false);

    const set = await agent
      .patch("/api/v1/notifications/share-preference")
      .send({ shareOptOut: true });
    expect(set.body.shareOptOut).toBe(true);
    const after = await agent.get("/api/v1/notifications/share-preference");
    expect(after.body.shareOptOut).toBe(true);

    // PUT alias works too.
    const putRes = await agent
      .put("/api/v1/notifications/share-preference")
      .send({ shareOptOut: false });
    expect(putRes.status).toBe(200);
    expect(putRes.body.shareOptOut).toBe(false);

    // Unauthenticated request is rejected.
    const unauth = await request(app).get(
      "/api/v1/notifications/share-preference",
    );
    expect(unauth.status).toBe(401);
  });

  it("self-share by the recap author does not create a notification", async () => {
    // Task #167 — sharing your own recap should not bell yourself.
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const create = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Self-share recap",
      body: "Body",
      gameDate: new Date().toISOString(),
    });
    expect(create.status).toBe(201);
    const articlePostId: string = create.body.id;

    const share = await coachLogin.agent.post(
      `/api/v1/posts/${articlePostId}/share`,
    );
    expect(share.status).toBe(204);

    const inbox = await coachLogin.agent.get("/api/v1/notifications");
    expect(
      inbox.body.data.find(
        (n: { type: string; data?: { link?: string } | null }) =>
          n.type === "share" && n.data?.link === `/posts/${articlePostId}`,
      ),
    ).toBeUndefined();
  });

  it("rejects sharing an org_post (only article + highlight are shareable per task #190)", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();

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

  it("highlight share toggles increment shareCount, surface the highlight on the sharer's profile, and notify the uploader", async () => {
    // Task #190 — Highlights are now polymorphically shareable. The
    // re-share fires a "shared your highlight" notification, the
    // highlight surfaces on the sharer's profile with sharedBy
    // attribution, and an unshare cleanly retracts both.
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { team } = await getOrgAndTeam();

    const create = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Shareable highlight",
      description: "Used by the highlight share-toggle test",
      assets: [{ fileType: "video/mp4", url: "https://example.com/clip.mp4" }],
    });
    expect(create.status).toBe(201);
    const highlightPostId: string = create.body.id;
    expect(highlightPostId.startsWith("highlight-")).toBe(true);
    expect(create.body.shareCount).toBe(0);
    expect(create.body.hasShared).toBe(false);

    const sharerEmail = `hlsharer+${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: sharerEmail,
      password: "test-password-123",
      firstName: "Highlight",
      lastName: "Sharer",
      role: "athlete",
    });
    const sharerAgent = request.agent(app);
    await sharerAgent
      .post("/api/v1/auth/login")
      .send({ email: sharerEmail, password: "test-password-123" });
    const meRes = await sharerAgent.get("/api/v1/users/me");
    const sharerUserId: string = meRes.body.id;

    const share = await sharerAgent.post(`/api/v1/posts/${highlightPostId}/share`);
    expect(share.status).toBe(204);

    const inbox = await coachLogin.agent.get("/api/v1/notifications");
    const notif = inbox.body.data.find(
      (n: { type: string; data?: { link?: string } | null }) =>
        n.type === "share" && n.data?.link === `/posts/${highlightPostId}`,
    );
    expect(notif).toBeDefined();
    expect(notif.title).toContain("shared your highlight");
    expect(notif.title).toContain("Shareable highlight");

    const detail = await sharerAgent.get(`/api/v1/posts/${highlightPostId}`);
    expect(detail.body.shareCount).toBe(1);
    expect(detail.body.hasShared).toBe(true);

    const profile = await sharerAgent.get(`/api/v1/users/${sharerUserId}/posts`);
    const sharedCard = profile.body.data.find(
      (p: { id: string }) => p.id === highlightPostId,
    );
    expect(sharedCard).toBeDefined();
    expect(sharedCard.sharedBy?.id).toBe(sharerUserId);

    const unshare = await sharerAgent.delete(
      `/api/v1/posts/${highlightPostId}/share`,
    );
    expect(unshare.status).toBe(204);
    const after = await sharerAgent.get(`/api/v1/posts/${highlightPostId}`);
    expect(after.body.shareCount).toBe(0);
    expect(after.body.hasShared).toBe(false);

    const inboxAfter = await coachLogin.agent.get("/api/v1/notifications");
    expect(
      inboxAfter.body.data.find(
        (n: { type: string; data?: { link?: string } | null }) =>
          n.type === "share" && n.data?.link === `/posts/${highlightPostId}`,
      ),
    ).toBeUndefined();
  });

  it("team-follower fan can share a highlight (any post viewer is a valid sharer)", async () => {
    // Task #190 — Sharing is no longer gated by org/team membership.
    // A new athlete who only follows the team (not on the roster) can
    // still re-share a highlight from that team.
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { team } = await getOrgAndTeam();

    const create = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Fan-shareable highlight",
      description: "Anyone who can see it can share it",
      assets: [{ fileType: "video/mp4", url: "https://example.com/fan.mp4" }],
    });
    expect(create.status).toBe(201);
    const highlightPostId: string = create.body.id;

    const fanEmail = `fanshare+${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: fanEmail,
      password: "test-password-123",
      firstName: "Fan",
      lastName: "Sharer",
      role: "athlete",
    });
    const fanAgent = request.agent(app);
    await fanAgent
      .post("/api/v1/auth/login")
      .send({ email: fanEmail, password: "test-password-123" });

    // Fan never joins the org/team — they're effectively a public
    // viewer. The share must still go through.
    const share = await fanAgent.post(`/api/v1/posts/${highlightPostId}/share`);
    expect(share.status).toBe(204);

    const detail = await fanAgent.get(`/api/v1/posts/${highlightPostId}`);
    expect(detail.body.shareCount).toBe(1);
    expect(detail.body.hasShared).toBe(true);
  });

  it("highlight share is idempotent (a second POST is a no-op, count stays at 1)", async () => {
    // Task #190 — The (post_kind, post_ref_id, sharer_user_id)
    // unique index makes a duplicate share a no-op rather than a 409.
    // Toggling Share twice from the UI should not double-count.
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { team } = await getOrgAndTeam();
    const create = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Idempotent highlight",
      description: "Re-sharing must not double-count",
      assets: [{ fileType: "video/mp4", url: "https://example.com/idem.mp4" }],
    });
    expect(create.status).toBe(201);
    const highlightPostId: string = create.body.id;

    const sharerEmail = `idem+${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: sharerEmail,
      password: "test-password-123",
      firstName: "Idem",
      lastName: "Potent",
      role: "athlete",
    });
    const sharerAgent = request.agent(app);
    await sharerAgent
      .post("/api/v1/auth/login")
      .send({ email: sharerEmail, password: "test-password-123" });

    const first = await sharerAgent.post(`/api/v1/posts/${highlightPostId}/share`);
    expect(first.status).toBe(204);
    const second = await sharerAgent.post(`/api/v1/posts/${highlightPostId}/share`);
    expect(second.status).toBe(204);

    const detail = await sharerAgent.get(`/api/v1/posts/${highlightPostId}`);
    expect(detail.body.shareCount).toBe(1);
    expect(detail.body.hasShared).toBe(true);
  });

  it("self-share by the highlight uploader does not create a notification", async () => {
    // Task #190 — Mirror of the existing self-share test for recaps:
    // the uploader should not get a "you shared your own highlight"
    // bell row.
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { team } = await getOrgAndTeam();
    const create = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Self-shared highlight",
      description: "Uploader shares their own clip",
      assets: [{ fileType: "video/mp4", url: "https://example.com/self.mp4" }],
    });
    expect(create.status).toBe(201);
    const highlightPostId: string = create.body.id;

    const share = await coachLogin.agent.post(
      `/api/v1/posts/${highlightPostId}/share`,
    );
    expect(share.status).toBe(204);

    const inbox = await coachLogin.agent.get("/api/v1/notifications");
    const selfNotif = inbox.body.data.find(
      (n: { type: string; data?: { link?: string } | null }) =>
        n.type === "share" && n.data?.link === `/posts/${highlightPostId}`,
    );
    expect(selfNotif).toBeUndefined();
  });

  it("team page surfaces real share state for both recap and highlight cards (no stale 0/false)", async () => {
    // Task #190 — `/teams/:teamId/posts` has to load shareCount /
    // hasShared for both kinds so the team-page Share button matches
    // the post-detail view. Without the wiring this regresses to the
    // schema default of 0 / false for every card.
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { team, org } = await getOrgAndTeam();

    const recap = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      teamId: team.id,
      title: "Team-page recap",
      body: "Game recap body",
      gameDate: "2026-04-20",
    });
    expect(recap.status).toBe(201);
    const recapId: string = recap.body.id;

    const highlight = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Team-page highlight",
      description: "Surfaces with share state on team page",
      assets: [{ fileType: "video/mp4", url: "https://example.com/team.mp4" }],
    });
    expect(highlight.status).toBe(201);
    const highlightId: string = highlight.body.id;

    const fanEmail = `teamfan+${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: fanEmail,
      password: "test-password-123",
      firstName: "Team",
      lastName: "Fan",
      role: "athlete",
    });
    const fanAgent = request.agent(app);
    await fanAgent
      .post("/api/v1/auth/login")
      .send({ email: fanEmail, password: "test-password-123" });

    expect((await fanAgent.post(`/api/v1/posts/${recapId}/share`)).status).toBe(204);
    expect(
      (await fanAgent.post(`/api/v1/posts/${highlightId}/share`)).status,
    ).toBe(204);

    const teamPage = await fanAgent.get(`/api/v1/teams/${team.id}/posts`);
    expect(teamPage.status).toBe(200);
    const recapCard = teamPage.body.data.find((p: { id: string }) => p.id === recapId);
    const hlCard = teamPage.body.data.find((p: { id: string }) => p.id === highlightId);
    expect(recapCard).toBeDefined();
    expect(hlCard).toBeDefined();
    expect(recapCard.shareCount).toBe(1);
    expect(recapCard.hasShared).toBe(true);
    expect(hlCard.shareCount).toBe(1);
    expect(hlCard.hasShared).toBe(true);

    // Logged-out viewer sees the count but never hasShared=true.
    const anon = await request(app).get(`/api/v1/teams/${team.id}/posts`);
    const anonHl = anon.body.data.find((p: { id: string }) => p.id === highlightId);
    expect(anonHl.shareCount).toBe(1);
    expect(anonHl.hasShared).toBe(false);
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

  // ----------------------------------------------------------------
  // Task #270 — DELETE /posts/:postId author-only soft delete.
  // ----------------------------------------------------------------

  it("DELETE /posts/:postId removes the author's recap from feeds and detail", async () => {
    const { agent: coachAgent, user: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const { org } = await getOrgAndTeam();

    const create = await coachAgent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Recap to delete",
      body: "Body",
      gameDate: new Date().toISOString(),
    });
    expect(create.status).toBe(201);
    const articleId: string = create.body.id;

    // Author sees `canDelete: true` on their own published recap.
    const detail = await coachAgent.get(`/api/v1/posts/${articleId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.canDelete).toBe(true);
    expect(detail.body.author.id).toBe(coach.id);

    // Delete returns 204; second call is idempotent (also 204).
    const del = await coachAgent.delete(`/api/v1/posts/${articleId}`);
    expect(del.status).toBe(204);
    const delAgain = await coachAgent.delete(`/api/v1/posts/${articleId}`);
    expect(delAgain.status).toBe(204);

    // Detail is now 404 (soft-deleted via hiddenAt — the GET handler
    // looks up via the same query that excludes hidden articles).
    const after = await coachAgent.get(`/api/v1/posts/${articleId}`);
    expect(after.status).toBe(404);

    // Feed no longer surfaces it.
    const feed = await coachAgent.get("/api/v1/feed");
    expect(feed.status).toBe(200);
    const stillThere = (feed.body.data ?? []).find(
      (p: { id: string }) => p.id === articleId,
    );
    expect(stillThere).toBeUndefined();
  });

  it("DELETE /posts/:postId hides the recap from the team page (task #283)", async () => {
    // Task #283 — `/teams/:teamId/posts` previously forgot to filter
    // out soft-deleted articles, so a deleted recap would still appear
    // on the team page even though the home/profile feeds dropped it.
    const { agent: coachAgent } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const { team, org } = await getOrgAndTeam();

    const create = await coachAgent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      teamId: team.id,
      title: "Team-page recap to delete",
      body: "Body",
      gameDate: new Date().toISOString(),
    });
    expect(create.status).toBe(201);
    const articleId: string = create.body.id;

    // Pre-condition: the recap shows up on the team page.
    const before = await coachAgent.get(`/api/v1/teams/${team.id}/posts`);
    expect(before.status).toBe(200);
    expect(
      (before.body.data ?? []).some((p: { id: string }) => p.id === articleId),
    ).toBe(true);

    const del = await coachAgent.delete(`/api/v1/posts/${articleId}`);
    expect(del.status).toBe(204);

    // Author no longer sees the soft-deleted recap on the team page.
    const afterAuthor = await coachAgent.get(
      `/api/v1/teams/${team.id}/posts`,
    );
    expect(afterAuthor.status).toBe(200);
    expect(
      (afterAuthor.body.data ?? []).some(
        (p: { id: string }) => p.id === articleId,
      ),
    ).toBe(false);

    // And neither does an anonymous viewer — there's no "ghost" copy.
    const afterAnon = await request(app).get(
      `/api/v1/teams/${team.id}/posts`,
    );
    expect(afterAnon.status).toBe(200);
    expect(
      (afterAnon.body.data ?? []).some(
        (p: { id: string }) => p.id === articleId,
      ),
    ).toBe(false);
  });

  it("DELETE /posts/:postId returns 403 when the caller is not the original author", async () => {
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const create = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Other-author guard",
      body: "Body",
    });
    expect(create.status).toBe(201);
    const articleId: string = create.body.id;

    // A different user (org admin) cannot delete the coach's recap
    // even though they can edit/hide it through the admin flow.
    const adminLogin = await loginAs((u) => u.email === "sam@kinectem.demo");
    const del = await adminLogin.agent.delete(`/api/v1/posts/${articleId}`);
    expect(del.status).toBe(403);

    // Recap is still reachable.
    const detail = await coachLogin.agent.get(`/api/v1/posts/${articleId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.canDelete).toBe(true);
    // Admin sees it but cannot delete it.
    const adminDetail = await adminLogin.agent.get(
      `/api/v1/posts/${articleId}`,
    );
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.canDelete).toBe(false);
  });

  it("DELETE /posts/:postId returns 404 for a missing highlight (post #296)", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const fakeShortId = "highlight-00000000-0000-0000-0000-000000000000";
    const res = await agent.delete(`/api/v1/posts/${fakeShortId}`);
    expect(res.status).toBe(404);
  });

  it("DELETE /posts/:postId hides a highlight from the team-page list (post #296)", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { team } = await getOrgAndTeam();
    const before = await agent.get(`/api/v1/teams/${team.id}/posts`);
    const hl = before.body.data.find((p: { id: string }) => p.id.startsWith("highlight-"));
    expect(hl).toBeTruthy();
    const del = await agent.delete(`/api/v1/posts/${hl.id}`);
    expect(del.status).toBe(204);
    const after = await agent.get(`/api/v1/teams/${team.id}/posts`);
    expect(after.body.data.find((p: { id: string }) => p.id === hl.id)).toBeUndefined();
  });

  it("GET /posts/:postId surfaces the canEdit/canDelete matrix for org_post (post #296)", async () => {
    const { agent: coachAgent } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const { org } = await getOrgAndTeam();
    const create = await coachAgent.post(`/api/v1/organizations/${org.id}/posts`).send({
      title: "Matrix subject",
      body: "Body",
    });
    expect(create.status).toBe(201);
    const orgPostId: string = create.body.id;

    // Author: can edit AND delete.
    const asAuthor = await coachAgent.get(`/api/v1/posts/${orgPostId}`);
    expect(asAuthor.status).toBe(200);
    expect(asAuthor.body.canEdit).toBe(true);
    expect(asAuthor.body.canDelete).toBe(true);

    // Org admin: can edit, cannot delete.
    const { agent: adminAgent } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const asAdmin = await adminAgent.get(`/api/v1/posts/${orgPostId}`);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.canEdit).toBe(true);
    expect(asAdmin.body.canDelete).toBe(false);

    // Non-admin viewer: cannot edit, cannot delete.
    const { agent: viewerAgent } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const asViewer = await viewerAgent.get(`/api/v1/posts/${orgPostId}`);
    expect(asViewer.status).toBe(200);
    expect(asViewer.body.canEdit).toBe(false);
    expect(asViewer.body.canDelete).toBe(false);
  });

  it("DELETE /posts/:postId on an already-hidden highlight stays idempotent (post #296)", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { team } = await getOrgAndTeam();
    const list = await agent.get(`/api/v1/teams/${team.id}/posts`);
    const hl = list.body.data.find((p: { id: string }) =>
      p.id.startsWith("highlight-"),
    );
    expect(hl).toBeTruthy();

    const first = await agent.delete(`/api/v1/posts/${hl.id}`);
    expect(first.status).toBe(204);
    const second = await agent.delete(`/api/v1/posts/${hl.id}`);
    expect(second.status).toBe(204);
  });

  it("PATCH /posts/:postId rejects a non-uploader editing a highlight (post #296)", async () => {
    const { agent: coachAgent } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const { team } = await getOrgAndTeam();
    const list = await coachAgent.get(`/api/v1/teams/${team.id}/posts`);
    const hl = list.body.data.find((p: { id: string }) =>
      p.id.startsWith("highlight-"),
    );
    expect(hl).toBeTruthy();

    const { agent: parentAgent } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const res = await parentAgent
      .patch(`/api/v1/posts/${hl.id}`)
      .send({ title: "Tampered" });
    expect(res.status).toBe(403);
  });

  it("PATCH /posts/:postId lets the org admin edit an org_post but not delete it (post #296)", async () => {
    const { agent: coachAgent } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const { org } = await getOrgAndTeam();
    const create = await coachAgent.post(`/api/v1/organizations/${org.id}/posts`).send({
      title: "Original",
      body: "Body",
    });
    expect(create.status).toBe(201);
    const orgPostId: string = create.body.id;

    const { agent: adminAgent } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const patch = await adminAgent
      .patch(`/api/v1/posts/${orgPostId}`)
      .send({ title: "Edited by admin" });
    expect(patch.status).toBe(200);
    expect(patch.body.title).toBe("Edited by admin");
    expect(patch.body.canEdit).toBe(true);
    expect(patch.body.canDelete).toBe(false);

    const del = await adminAgent.delete(`/api/v1/posts/${orgPostId}`);
    expect(del.status).toBe(403);

    const get = await coachAgent.get(`/api/v1/posts/${orgPostId}`);
    expect(get.body.canDelete).toBe(true);
  });

  it("DELETE /posts/:postId hides an org_post from the org-page list (post #296)", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const create = await agent.post(`/api/v1/organizations/${org.id}/posts`).send({
      title: "To be deleted",
      body: "Soft-delete should hide me from the org page.",
    });
    expect(create.status).toBe(201);
    const orgPostId: string = create.body.id;
    const before = await agent.get(`/api/v1/organizations/${org.id}/posts`);
    expect(before.body.data.find((p: { id: string }) => p.id === orgPostId)).toBeTruthy();
    const del = await agent.delete(`/api/v1/posts/${orgPostId}`);
    expect(del.status).toBe(204);
    const after = await agent.get(`/api/v1/organizations/${org.id}/posts`);
    expect(after.body.data.find((p: { id: string }) => p.id === orgPostId)).toBeUndefined();
  });

  it("DELETE /posts/:postId requires authentication", async () => {
    const fakeId = "article-00000000-0000-0000-0000-000000000000";
    const res = await request(app).delete(`/api/v1/posts/${fakeId}`);
    expect(res.status).toBe(401);
  });

  // ----------------------------------------------------------------
  // Task #274 — PUT /posts/:postId/reactions canonical "add reaction".
  // ----------------------------------------------------------------

  it("PUT /posts/:postId/reactions adds a like, is idempotent, and bell-notifies the post owner exactly once (task #274)", async () => {
    // Task #274 — The OpenAPI contract makes `PUT` the canonical
    // "add reaction" verb and the generated React client uses it. The
    // server previously only registered `POST`, so the heart button
    // 404'd silently. Verify the new `PUT` handler:
    //   * inserts the like and increments the count
    //   * is idempotent on a re-like (no dupe row, no dupe notification)
    //   * sends the post owner a single "liked your post" bell row
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const create = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Reaction PUT recap",
      description: "Used by the PUT-reaction test",
      body: "Body",
    });
    expect(create.status).toBe(201);
    const postId: string = create.body.id;

    const likerEmail = `liker+${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: likerEmail,
      password: "test-password-123",
      firstName: "Like",
      lastName: "Tester",
      role: "athlete",
    });
    const likerAgent = request.agent(app);
    await likerAgent
      .post("/api/v1/auth/login")
      .send({ email: likerEmail, password: "test-password-123" });

    const like = await likerAgent
      .put(`/api/v1/posts/${postId}/reactions`)
      .send({ reactionType: "like" });
    expect(like.status).toBe(204);

    const detail = await likerAgent.get(`/api/v1/posts/${postId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.reactionCount).toBe(1);
    expect(detail.body.hasReacted).toBe(true);

    // Idempotent: re-PUT does not double-count and does not create a
    // second notification row.
    const again = await likerAgent
      .put(`/api/v1/posts/${postId}/reactions`)
      .send({ reactionType: "like" });
    expect(again.status).toBe(204);
    const detail2 = await likerAgent.get(`/api/v1/posts/${postId}`);
    expect(detail2.body.reactionCount).toBe(1);

    const ownerInbox = await coachLogin.agent.get("/api/v1/notifications");
    expect(ownerInbox.status).toBe(200);
    const likeNotifs = ownerInbox.body.data.filter(
      (n: { type: string; data?: { link?: string } | null }) =>
        n.type === "like" && n.data?.link === `/posts/${postId}`,
    );
    expect(likeNotifs).toHaveLength(1);
    expect(likeNotifs[0].title).toContain("liked your post");

    // DELETE removes the like and decrements the count.
    const unlike = await likerAgent.delete(`/api/v1/posts/${postId}/reactions`);
    expect(unlike.status).toBe(204);
    const detail3 = await likerAgent.get(`/api/v1/posts/${postId}`);
    expect(detail3.body.reactionCount).toBe(0);
    expect(detail3.body.hasReacted).toBe(false);
  });

  it("PUT /posts/:postId/reactions does not bell-notify the post owner when they like their own post (task #274)", async () => {
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const create = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "Self-like recap",
      body: "Body",
    });
    expect(create.status).toBe(201);
    const postId: string = create.body.id;

    const like = await coachLogin.agent
      .put(`/api/v1/posts/${postId}/reactions`)
      .send({ reactionType: "like" });
    expect(like.status).toBe(204);

    const inbox = await coachLogin.agent.get("/api/v1/notifications");
    const selfNotif = inbox.body.data.find(
      (n: { type: string; data?: { link?: string } | null }) =>
        n.type === "like" && n.data?.link === `/posts/${postId}`,
    );
    expect(selfNotif).toBeUndefined();
  });

  it("deprecated POST /posts/:postId/reactions alias still works for older clients (task #274)", async () => {
    // Backwards compatibility check — the OpenAPI spec keeps `POST` as
    // a deprecated alias and the server must keep honoring it for any
    // older clients that haven't regenerated against the `PUT` verb.
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const create = await coachLogin.agent.post("/api/v1/posts").send({
      postType: "long",
      organizationId: org.id,
      title: "POST-alias recap",
      body: "Body",
    });
    expect(create.status).toBe(201);
    const postId: string = create.body.id;

    const likerEmail = `postaliaslike+${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: likerEmail,
      password: "test-password-123",
      firstName: "Alias",
      lastName: "Liker",
      role: "athlete",
    });
    const likerAgent = request.agent(app);
    await likerAgent
      .post("/api/v1/auth/login")
      .send({ email: likerEmail, password: "test-password-123" });

    const like = await likerAgent
      .post(`/api/v1/posts/${postId}/reactions`)
      .send({ reactionType: "like" });
    expect(like.status).toBe(204);

    const detail = await likerAgent.get(`/api/v1/posts/${postId}`);
    expect(detail.body.reactionCount).toBe(1);
    expect(detail.body.hasReacted).toBe(true);
  });

  // ----------------------------------------------------------------
  // Task #291 — Team-scoped highlight permissions.
  //
  // The team-page "Post Highlight" CTA is gated to (a) accepted
  // roster members of the team and (b) org admins/owners. The
  // server enforces the same check on `POST /api/v1/posts` for
  // `postType=short` so a non-member can't bypass the UI gate.
  // Highlights skip every tag fan-out — they are NEVER auto-tagged
  // to the roster, regardless of who posts them.
  // ----------------------------------------------------------------

  it("accepted roster player can post a team-scoped highlight (and it shows up in the team posts list)", async () => {
    const playerLogin = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const { team } = await getOrgAndTeam();

    const create = await playerLogin.agent.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Player highlight",
      description: "Posted from the team page by a roster player.",
      videoUrl: "https://example.com/player-clip.mp4",
    });
    expect(create.status).toBe(201);
    expect(create.body.id.startsWith("highlight-")).toBe(true);
    expect(create.body.author?.id).toBe(playerLogin.user.id);
    expect(create.body.context?.type).toBe("team");
    expect(create.body.context?.id).toBe(team.id);

    const teamPosts = await playerLogin.agent.get(
      `/api/v1/teams/${team.id}/posts`,
    );
    expect(teamPosts.status).toBe(200);
    expect(
      teamPosts.body.data.find((p: { id: string }) => p.id === create.body.id),
    ).toBeDefined();
  });

  it("org admin can post a team-scoped highlight", async () => {
    const adminLogin = await loginAs((u) => u.email === "sam@kinectem.demo");
    const { team } = await getOrgAndTeam();

    const create = await adminLogin.agent.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Admin highlight",
      description: "Posted by an org admin who isn't on the roster.",
      videoUrl: "https://example.com/admin-clip.mp4",
    });
    expect(create.status).toBe(201);
    expect(create.body.id.startsWith("highlight-")).toBe(true);
  });

  it("non-member, non-admin gets 403 trying to post a team-scoped highlight", async () => {
    const { team } = await getOrgAndTeam();

    // Brand-new account: never joins the org, never on the roster.
    const outsiderEmail = `outsider+${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      email: outsiderEmail,
      password: "test-password-123",
      firstName: "Out",
      lastName: "Sider",
      role: "athlete",
    });
    const outsider = request.agent(app);
    await outsider
      .post("/api/v1/auth/login")
      .send({ email: outsiderEmail, password: "test-password-123" });

    const create = await outsider.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Should be blocked",
      description: "Outsiders cannot post to a team they don't belong to.",
      videoUrl: "https://example.com/blocked.mp4",
    });
    expect(create.status).toBe(403);
    expect(create.body.error).toMatch(/team members/i);
  });

  it("a declined roster entry does NOT count as membership (403 like an outsider)", async () => {
    const { team } = await getOrgAndTeam();

    // daniela is a basketball player in the seed — not on Varsity Football
    // by default. Create a *declined* roster entry for her on Varsity
    // Football. The server gate uses status === "accepted", so she must
    // still be rejected with the same 403 as a complete outsider.
    const danielaRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "daniela@kinectem.demo"));
    const danielaId = danielaRow[0]?.id;
    if (!danielaId) throw new Error("daniela seed user missing");

    await db.insert(rosterEntries).values({
      teamId: team.id,
      userId: danielaId,
      role: "player",
      position: "player",
      status: "declined",
    });

    const danielaLogin = await loginAs(
      (u) => u.email === "daniela@kinectem.demo",
    );
    const create = await danielaLogin.agent.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Declined cannot post",
      description: "Declined roster entries must not unlock the team CTA.",
      videoUrl: "https://example.com/declined.mp4",
    });
    expect(create.status).toBe(403);
    expect(create.body.error).toMatch(/team members/i);
  });

  // ----------------------------------------------------------------
  // Task #306 — Notify org admins/owners on a member-posted highlight.
  //
  // When a non-admin roster member posts a team-scoped highlight,
  // every owner / admin of the team's organization gets a bell
  // notification linking to the new highlight. Suppressed when the
  // poster is themselves an org admin (no point in notifying their
  // own moderation queue) and self-notifications are excluded.
  // ----------------------------------------------------------------

  it("non-admin roster player posting a highlight notifies every org admin/owner", async () => {
    const playerLogin = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const { team } = await getOrgAndTeam();

    const create = await playerLogin.agent.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Roster highlight needs review",
      description: "Posted by Marcus, a non-admin player.",
      videoUrl: "https://example.com/marcus-clip.mp4",
    });
    expect(create.status).toBe(201);
    const newHighlightId: string = create.body.id;

    // Sam is the org owner of Westfield (which owns Varsity Football).
    const ownerLogin = await loginAs((u) => u.email === "sam@kinectem.demo");
    const ownerInbox = await ownerLogin.agent.get("/api/v1/notifications");
    const ownerNotif = ownerInbox.body.data.find(
      (n: { type: string; data?: { link?: string } | null }) =>
        n.type === "team_highlight_created" &&
        n.data?.link === `/posts/${newHighlightId}`,
    );
    expect(ownerNotif).toBeDefined();
    expect(ownerNotif.title).toContain("Roster highlight needs review");
    expect(ownerNotif.title).toContain(team.name);
    expect(ownerNotif.isRead).toBe(false);

    // Coach Davis is registered as an org "admin" on Westfield, so he
    // should receive the same fan-out (the org-admin role is what
    // matters here, not his roster coach role).
    const adminLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const adminInbox = await adminLogin.agent.get("/api/v1/notifications");
    const adminNotif = adminInbox.body.data.find(
      (n: { type: string; data?: { link?: string } | null }) =>
        n.type === "team_highlight_created" &&
        n.data?.link === `/posts/${newHighlightId}`,
    );
    expect(adminNotif).toBeDefined();
  });

  it("does NOT notify admins when the poster is themselves an org admin/owner", async () => {
    const adminLogin = await loginAs((u) => u.email === "sam@kinectem.demo");
    const { team } = await getOrgAndTeam();

    const create = await adminLogin.agent.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Owner-posted highlight",
      description: "An owner posting their own highlight should not fan out.",
      videoUrl: "https://example.com/owner-clip.mp4",
    });
    expect(create.status).toBe(201);
    const newHighlightId: string = create.body.id;

    // Self-check: the owner-poster never receives a notification for
    // their own highlight.
    const selfInbox = await adminLogin.agent.get("/api/v1/notifications");
    const selfNotif = selfInbox.body.data.find(
      (n: { type: string; data?: { link?: string } | null }) =>
        n.type === "team_highlight_created" &&
        n.data?.link === `/posts/${newHighlightId}`,
    );
    expect(selfNotif).toBeUndefined();

    // Co-admin Coach Davis is also an admin on Westfield. The whole
    // fan-out is suppressed for admin-posted highlights, so he must
    // not see one either.
    const adminPeerLogin = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const peerInbox = await adminPeerLogin.agent.get("/api/v1/notifications");
    const peerNotif = peerInbox.body.data.find(
      (n: { type: string; data?: { link?: string } | null }) =>
        n.type === "team_highlight_created" &&
        n.data?.link === `/posts/${newHighlightId}`,
    );
    expect(peerNotif).toBeUndefined();
  });

  it("creating a team-scoped highlight does NOT fan out tags to the roster", async () => {
    const playerLogin = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const { team } = await getOrgAndTeam();

    const create = await playerLogin.agent.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Untagged highlight",
      description: "Highlights must remain untagged.",
      videoUrl: "https://example.com/untagged.mp4",
    });
    expect(create.status).toBe(201);

    const tags = await playerLogin.agent.get(
      `/api/v1/posts/${create.body.id}/tags`,
    );
    expect(tags.status).toBe(200);
    expect(tags.body.tags).toEqual([]);
  });

  // ----------------------------------------------------------------
  // Task #319 — Manual tagging of roster players from the highlight
  // composer must actually persist. The earlier eligibility gate
  // filtered roster rows by `position = "player"`, but `position`
  // stores the football position (e.g. "WR", "QB") and is null for
  // coaches. The "is this a player?" decision lives on `role`. The
  // bug silently dropped every valid tag, so the composer's
  // "tagged players" UI showed nothing on every newly-published
  // highlight. This test pins the contract: tagging real player-role
  // roster members succeeds, and coach-role roster members are still
  // rejected from the player-tag set.
  // ----------------------------------------------------------------
  it("highlight composer tags persist for player-role roster members and skip coaches", async () => {
    const authorLogin = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const { team } = await getOrgAndTeam();

    // Marcus authors a highlight he can tag himself on (he's the
    // post author and a player on the same team).
    const create = await authorLogin.agent.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Tagged highlight",
      description: "Composer manual-tag flow.",
      videoUrl: "https://example.com/tagged.mp4",
    });
    expect(create.status).toBe(201);
    const postId: string = create.body.id;

    // Look up the seed users we want to tag: jordan & tyler are
    // accepted players on Varsity Football, coachDavis is the head
    // coach (role="coach", position="Head Coach").
    const targets = await db
      .select({ id: users.id, email: users.email })
      .from(users);
    const byEmail = new Map(targets.map((t) => [t.email, t.id]));
    const jordanId = byEmail.get("jordan@kinectem.demo");
    const tylerId = byEmail.get("tyler@kinectem.demo");
    const coachId = byEmail.get("coach@kinectem.demo");
    if (!jordanId || !tylerId || !coachId) throw new Error("seed users missing");

    const tagRes = await authorLogin.agent
      .post(`/api/v1/posts/${postId}/tags`)
      .send({
        tags: [
          { taggedEntityType: "user", taggedEntityId: jordanId },
          { taggedEntityType: "user", taggedEntityId: tylerId },
          { taggedEntityType: "user", taggedEntityId: coachId },
        ],
      });
    expect(tagRes.status).toBe(201);
    const persistedIds: string[] = (tagRes.body.tags ?? []).map(
      (t: { taggedEntityId: string }) => t.taggedEntityId,
    );
    expect(persistedIds).toEqual(
      expect.arrayContaining([jordanId, tylerId]),
    );
    expect(persistedIds).not.toContain(coachId);

    // Reading back the tag list should show the same player tags so
    // the highlight detail/card UI can render them.
    const list = await authorLogin.agent.get(`/api/v1/posts/${postId}/tags`);
    expect(list.status).toBe(200);
    const listedIds: string[] = (list.body.tags ?? []).map(
      (t: { taggedEntityId: string }) => t.taggedEntityId,
    );
    expect(listedIds).toEqual(expect.arrayContaining([jordanId, tylerId]));
    expect(listedIds).not.toContain(coachId);
  });
});
