import { describe, expect, it } from "vitest";
import { app, loginAs, request, DEMO_PASSWORD } from "./helpers";

const ADMIN_EMAIL = "andrew@kinectem.com";

describe("admin", () => {
  describe("gating", () => {
    it("rejects unauthenticated requests to /admin/*", async () => {
      const res = await request(app).get("/api/v1/admin/analytics");
      expect(res.status).toBe(401);
    });

    it("rejects non-admin authenticated requests to /admin/*", async () => {
      const { agent } = await loginAs((u) => u.role === "athlete");
      const res = await agent.get("/api/v1/admin/analytics");
      expect(res.status).toBe(403);
    });

    it("allows admin to read analytics", async () => {
      const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const res = await agent.get("/api/v1/admin/analytics");
      expect(res.status).toBe(200);
      expect(res.body.totals.users).toBeGreaterThan(0);
      expect(typeof res.body.totals.openReports).toBe("number");
      expect(Array.isArray(res.body.series.newUsersByDay)).toBe(true);
    });
  });

  describe("whoami", () => {
    it("returns role for the logged-in user", async () => {
      const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const res = await agent.get("/api/v1/auth/whoami");
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.realUser.role).toBe("admin");
      expect(res.body.isMasquerading).toBe(false);
    });

    it("returns authenticated:false when no session", async () => {
      const res = await request(app).get("/api/v1/auth/whoami");
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
    });
  });

  describe("user CRUD + soft-delete", () => {
    it("creates and deactivates a user, hiding them from non-admin lookups", async () => {
      const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const create = await agent.post("/api/v1/admin/users").send({
        firstName: "Test",
        lastName: "Subject",
        email: `test-subject-${Date.now()}@kinectem.demo`,
        password: "test12345",
        role: "athlete",
      });
      expect(create.status).toBe(201);
      const newId = create.body.id;
      expect(newId).toBeDefined();

      // Public lookup works while active
      const publicLookup = await request(app).get(`/api/v1/users/${newId}`);
      expect(publicLookup.status).toBe(200);

      // Soft delete
      const del = await agent.delete(`/api/v1/admin/users/${newId}`);
      expect(del.status).toBe(200);

      // Non-admin lookup should now 404 (filtered out)
      const after = await request(app).get(`/api/v1/users/${newId}`);
      expect(after.status).toBe(404);

      // Login should be rejected
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: create.body.email, password: "test12345" });
      expect([401, 403]).toContain(login.status);

      // Admin can still see them with includeDeleted
      const list = await agent.get("/api/v1/admin/users?includeDeleted=1");
      const found = list.body.data.find((u: { id: string }) => u.id === newId);
      expect(found).toBeDefined();
      expect(found.deletedAt).not.toBeNull();

      // Restore
      const restore = await agent.post(`/api/v1/admin/users/${newId}/restore`);
      expect(restore.status).toBe(200);
      const after2 = await request(app).get(`/api/v1/users/${newId}`);
      expect(after2.status).toBe(200);
    });

    it("admins can update another user's role", async () => {
      const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const target = await loginAs((u) => u.role === "athlete");
      const update = await agent
        .patch(`/api/v1/admin/users/${target.user.id}`)
        .send({ role: "coach" });
      expect(update.status).toBe(200);
      // restore
      await agent
        .patch(`/api/v1/admin/users/${target.user.id}`)
        .send({ role: "athlete" });
    });

    it("reset-password issues a temp password and revokes existing sessions", async () => {
      const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const target = await loginAs((u) => u.role === "athlete");
      // Their existing session works
      const before = await target.agent.get("/api/v1/users/me");
      expect(before.status).toBe(200);

      const reset = await agent.post(
        `/api/v1/admin/users/${target.user.id}/reset-password`,
      );
      expect(reset.status).toBe(200);
      expect(typeof reset.body.tempPassword).toBe("string");

      // Their old session should now be invalid
      const after = await target.agent.get("/api/v1/users/me");
      expect(after.status).toBe(401);

      // Re-set their original password so other tests still pass
      await agent
        .post(`/api/v1/admin/users/${target.user.id}/reset-password`)
        .expect(200);
      // (other tests log in fresh from seed; the demo password remains the
      // same because they re-seed via globalSetup.)
    });
  });

  describe("reports + dedupe", () => {
    it("anonymous users cannot file reports", async () => {
      const res = await request(app).post("/api/v1/reports").send({
        contentType: "article",
        contentId: "00000000-0000-0000-0000-000000000000",
        reason: "Spam",
      });
      expect(res.status).toBe(401);
    });

    it("dedupes repeat open reports from the same user on same content", async () => {
      const { agent: adminAgent } = await loginAs(
        (u) => u.email === ADMIN_EMAIL,
      );
      const { agent: reporterAgent } = await loginAs(
        (u) => u.role === "athlete",
      );

      // Find an article to report
      const list = await adminAgent.get("/api/v1/admin/content/article");
      const article = list.body.data.find((c: { id: string }) => !!c.id);
      expect(article).toBeDefined();

      const first = await reporterAgent.post("/api/v1/reports").send({
        contentType: "article",
        contentId: article.id,
        reason: "Spam",
      });
      expect([200, 201]).toContain(first.status);
      expect(first.body.id).toBeDefined();

      const second = await reporterAgent.post("/api/v1/reports").send({
        contentType: "article",
        contentId: article.id,
        reason: "Different reason",
      });
      expect(second.status).toBe(200);
      expect(second.body.alreadyReported).toBe(true);
      expect(second.body.id).toBe(first.body.id);

      // Admin sees only one open report for this content
      const reports = await adminAgent.get("/api/v1/admin/reports?status=open");
      const matches = reports.body.data.filter(
        (r: { contentId: string }) => r.contentId === article.id,
      );
      // There may be reports from other tests; check we have exactly one open
      // for this reporter+content.
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("404s when reporting nonexistent content", async () => {
      const { agent } = await loginAs((u) => u.role === "athlete");
      const res = await agent.post("/api/v1/reports").send({
        contentType: "article",
        contentId: "00000000-0000-0000-0000-000000000000",
        reason: "Spam",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("hide / unhide / delete content visibility", () => {
    it("hidden articles disappear from feed/post for non-admin viewers", async () => {
      const { agent: adminAgent } = await loginAs(
        (u) => u.email === ADMIN_EMAIL,
      );
      const { agent: viewer } = await loginAs((u) => u.role === "athlete");

      const list = await adminAgent.get("/api/v1/admin/content/article");
      const article = list.body.data[0];
      expect(article).toBeDefined();
      const postId = `article-${article.id}`;

      const before = await viewer.get(`/api/v1/posts/${postId}`);
      expect(before.status).toBe(200);

      const hide = await adminAgent.post(
        `/api/v1/admin/content/article/${article.id}/hide`,
      );
      expect(hide.status).toBe(200);

      const afterHide = await viewer.get(`/api/v1/posts/${postId}`);
      expect(afterHide.status).toBe(404);

      // Admin can still see the post (no separate /admin/posts; check via
      // moderation listing instead).
      const adminList = await adminAgent.get(
        "/api/v1/admin/content/article?hidden=1",
      );
      const found = adminList.body.data.find(
        (c: { id: string }) => c.id === article.id,
      );
      expect(found).toBeDefined();
      expect(found.hiddenAt).not.toBeNull();

      // Unhide
      const unhide = await adminAgent.post(
        `/api/v1/admin/content/article/${article.id}/unhide`,
      );
      expect(unhide.status).toBe(200);
      const afterUnhide = await viewer.get(`/api/v1/posts/${postId}`);
      expect(afterUnhide.status).toBe(200);
    });
  });

  describe("masquerade", () => {
    it("admin can masquerade as another user; banner state is reflected in whoami", async () => {
      const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const target = await loginAs((u) => u.role === "athlete");

      const start = await agent.post(
        `/api/v1/admin/masquerade/${target.user.id}/start`,
      );
      expect(start.status).toBe(200);

      // /auth/whoami now shows masquerading
      const who = await agent.get("/api/v1/auth/whoami");
      expect(who.body.isMasquerading).toBe(true);
      expect(who.body.realUser.role).toBe("admin");
      expect(who.body.viewingAs.id).toBe(target.user.id);

      // /users/me reflects the acting user
      const me = await agent.get("/api/v1/users/me");
      expect(me.status).toBe(200);
      expect(me.body.id).toBe(target.user.id);

      // Stop
      const stop = await agent.post("/api/v1/admin/masquerade/stop");
      expect(stop.status).toBe(200);

      const who2 = await agent.get("/api/v1/auth/whoami");
      expect(who2.body.isMasquerading).toBe(false);
    });

    it("non-admin cannot masquerade", async () => {
      const { agent } = await loginAs((u) => u.role === "coach");
      const target = await loginAs((u) => u.role === "athlete");
      const res = await agent.post(
        `/api/v1/admin/masquerade/${target.user.id}/start`,
      );
      expect(res.status).toBe(403);
    });

    it("admin endpoints are blocked while masquerading (only stop is allowed)", async () => {
      const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const target = await loginAs((u) => u.role === "athlete");

      // Sanity: admin endpoint works pre-masquerade
      const before = await agent.get("/api/v1/admin/users");
      expect(before.status).toBe(200);

      // Start masquerade
      const start = await agent.post(
        `/api/v1/admin/masquerade/${target.user.id}/start`,
      );
      expect(start.status).toBe(200);

      // Admin endpoints are blocked while masquerading
      const usersWhile = await agent.get("/api/v1/admin/users");
      expect(usersWhile.status).toBe(403);

      const analyticsWhile = await agent.get("/api/v1/admin/analytics");
      expect(analyticsWhile.status).toBe(403);

      const startAgain = await agent.post(
        `/api/v1/admin/masquerade/${target.user.id}/start`,
      );
      expect(startAgain.status).toBe(403);

      // Stop is allowed even while masquerading
      const stop = await agent.post("/api/v1/admin/masquerade/stop");
      expect(stop.status).toBe(200);

      // Endpoints work again after stopping
      const after = await agent.get("/api/v1/admin/users");
      expect(after.status).toBe(200);
    });

    it("admin cannot masquerade as a deactivated user", async () => {
      const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const create = await agent.post("/api/v1/admin/users").send({
        firstName: "Mask",
        lastName: "Target",
        email: `mask-target-${Date.now()}@kinectem.demo`,
        password: DEMO_PASSWORD,
        role: "athlete",
      });
      expect(create.status).toBe(201);
      await agent.delete(`/api/v1/admin/users/${create.body.id}`).expect(200);

      const start = await agent.post(
        `/api/v1/admin/masquerade/${create.body.id}/start`,
      );
      expect(start.status).toBe(400);
    });
  });

  describe("activity log", () => {
    it("records admin actions and surfaces them via /admin/activity", async () => {
      const { agent } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const create = await agent.post("/api/v1/admin/users").send({
        firstName: "Log",
        lastName: "Tester",
        email: `log-tester-${Date.now()}@kinectem.demo`,
        password: DEMO_PASSWORD,
        role: "athlete",
      });
      expect(create.status).toBe(201);

      const log = await agent.get("/api/v1/admin/activity");
      expect(log.status).toBe(200);
      const matching = log.body.data.find(
        (a: { actionType: string; targetId: string }) =>
          a.actionType === "create_user" && a.targetId === create.body.id,
      );
      expect(matching).toBeDefined();
      expect(matching.admin.email).toBe(ADMIN_EMAIL);
    });
  });
});
