import { describe, expect, it } from "vitest";
import { db, adminActivityLog, userActivityLog } from "@workspace/db";
import { eq } from "drizzle-orm";
import { app, loginAs, request, DEMO_PASSWORD } from "./helpers";

describe("platform activity", () => {
  it("records bearer-token sign-ins without retaining credentials or tokens", async () => {
    const response = await request(app).post("/api/v1/auth/token").send({
      email: "coach@kinectem.demo", password: DEMO_PASSWORD,
    });
    expect(response.status).toBe(200);
    await expect.poll(async () => {
      const rows = await db.select().from(userActivityLog);
      return rows.some((r) => r.actionType === "sign_in" && r.route === "/auth/token" && r.actorType === "user");
    }).toBe(true);
    const rows = await db.select().from(userActivityLog);
    expect(JSON.stringify(rows)).not.toContain(DEMO_PASSWORD);
    expect(JSON.stringify(rows)).not.toContain(response.body.accessToken);
  });
  it("records sign-ins and successful user changes, but not reads or failed changes", async () => {
    const { agent, user } = await loginAs("coach@kinectem.demo");
    await expect.poll(async () => (await db.select().from(userActivityLog)
      .where(eq(userActivityLog.actorId, user.id))).some((a) => a.actionType === "sign_in")).toBe(true);
    const update = await agent.patch(`/api/v1/users/${user.id}`).send({ bio: "Activity test" });
    expect(update.status).toBe(200);
    await expect.poll(async () => (await db.select().from(userActivityLog)
      .where(eq(userActivityLog.actorId, user.id))).some((a) => a.actionType === "update_users")).toBe(true);
    const before = await db.select().from(userActivityLog).where(eq(userActivityLog.actorId, user.id));
    await agent.get(`/api/v1/users/${user.id}`);
    await agent.patch("/api/v1/users/not-a-uuid").send({ bio: "Should fail" });
    const after = await db.select().from(userActivityLog).where(eq(userActivityLog.actorId, user.id));
    expect(after).toHaveLength(before.length);
    expect(after.every((a) => a.actorType === "user")).toBe(true);
    expect(JSON.stringify(after)).not.toContain("Activity test");
    expect(JSON.stringify(after)).not.toContain("password");
  });

  it("combines history and activity with role, person, action, sort and pagination filters", async () => {
    const { agent, user: admin } = await loginAs((u) => u.role === "admin");
    const { user: coach } = await loginAs("coach@kinectem.demo");
    await db.insert(adminActivityLog).values([
      { adminUserId: admin.id, actionType: "update_user", createdAt: new Date("2020-01-01") },
      { adminUserId: coach.id, actionType: "archive_team", createdAt: new Date("2020-01-02") },
    ]);
    await db.insert(userActivityLog).values({
      actorId: coach.id, actorType: "user", actionType: "create_posts",
      resource: "posts", route: "/posts", createdAt: new Date("2020-01-03"),
    });
    const users = await agent.get("/api/v1/admin/activity?actorType=user&order=oldest&limit=1");
    expect(users.status).toBe(200);
    expect(users.body.data[0].actionType).toBe("archive_team");
    expect(users.body.pagination.hasMore).toBe(true);
    const next = await agent.get("/api/v1/admin/activity?actorType=user&order=oldest&limit=1&offset=1");
    expect(next.body.data[0].actionType).toBe("create_posts");
    const admins = await agent.get("/api/v1/admin/activity?actorType=admin");
    expect(admins.body.data.every((a: any) => a.actorType === "admin")).toBe(true);
    expect(admins.body.data.some((a: any) => a.actionType === "update_user")).toBe(true);
    const person = await agent.get(`/api/v1/admin/activity?adminUserId=${coach.id}&actionType=create_posts`);
    expect(person.body.pagination.totalCount).toBe(1);
    expect(person.body.data[0].admin.id).toBe(coach.id);
    const people = await agent.get("/api/v1/admin/activity/admins");
    expect(people.body.data.some((p: any) => p.id === coach.id)).toBe(true);
    const actions = await agent.get("/api/v1/admin/activity/actions");
    expect(actions.body.data).toContain("archive_team");
    expect(actions.body.data).toContain("create_posts");
    const invalid = await agent.get("/api/v1/admin/activity?actorType=invalid");
    expect(invalid.status).toBe(400);
  });

  it("keeps the log and its filter lists private to platform admins", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    for (const path of ["activity", "activity/admins", "activity/actions"]) {
      expect((await request(app).get(`/api/v1/admin/${path}`)).status).toBe(401);
      expect((await agent.get(`/api/v1/admin/${path}`)).status).toBe(403);
    }
  });

  it("attributes masquerading activity to the real admin", async () => {
    const { agent, user: admin } = await loginAs((u) => u.role === "admin");
    const { user: coach } = await loginAs("coach@kinectem.demo");
    expect((await agent.post(`/api/v1/admin/masquerade/${coach.id}/start`)).status).toBe(200);
    expect((await agent.patch(`/api/v1/users/${coach.id}`).send({ bio: "Masquerade test" })).status).toBe(200);
    await expect.poll(async () => {
      const rows = await db.select().from(userActivityLog).where(eq(userActivityLog.actorId, admin.id));
      return rows.some((r) => r.actionType === "update_users" && r.actorType === "admin" && r.effectiveUserId === coach.id);
    }).toBe(true);
  });
});
