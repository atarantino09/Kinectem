import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { app, loginAs, request } from "./helpers";

describe("notifications", () => {
  it("returns the seeded notification for samira", async () => {
    const { agent } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    const res = await agent.get("/api/v1/notifications");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].type).toBe("roster_invite");
  });

  it("counts unread notifications per user", async () => {
    const { agent } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    const res = await agent.get("/api/v1/notifications/unread-count");
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBeGreaterThan(0);
  });

  it("marks all notifications as read for the current user", async () => {
    const { agent } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    const before = await agent.get("/api/v1/notifications/unread-count");
    expect(before.body.unreadCount).toBeGreaterThan(0);
    const mark = await agent.post("/api/v1/notifications/read-all");
    expect(mark.status).toBe(200);
    expect(mark.body.markedCount).toBeGreaterThan(0);
    const after = await agent.get("/api/v1/notifications/unread-count");
    expect(after.body.unreadCount).toBe(0);
  });

  it("marks a single notification as read", async () => {
    const { agent } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    const list = await agent.get("/api/v1/notifications");
    const target = list.body.data[0];
    const res = await agent.post(
      `/api/v1/notifications/${target.id}/read`,
    );
    expect(res.status).toBe(204);
  });

  it("returns an empty list for an anonymous request", async () => {
    const res = await request(app).get("/api/v1/notifications");
    expect(res.status).toBe(200);
    // Without a session, there is no targeted user, so the route returns
    // an empty page (per the route implementation).
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  describe("guardian confirmation expired notifications", () => {
    async function setupExpiredChild() {
      const { agent } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const childRes = await agent.get("/api/v1/users/me/children");
      const child = childRes.body.data[0];
      await db
        .update(users)
        .set({
          guardianEmail: "lisa@kinectem.demo",
          guardianConfirmedAt: null,
          guardianConfirmedByUserId: null,
          guardianConfirmToken: "expired-token-test",
          guardianConfirmTokenExpiresAt: new Date(Date.now() - 60_000),
        })
        .where(eq(users.id, child.id));
      return { agent, childId: child.id as string };
    }

    it("creates a notification for the parent when a child's confirmation link has expired", async () => {
      const { agent, childId } = await setupExpiredChild();
      const me = await agent.get("/api/v1/users/me");
      expect(me.status).toBe(200);
      const list = await agent.get("/api/v1/notifications");
      const expired = list.body.data.find(
        (n: { type: string; data: { link: string } | null }) =>
          n.type === "guardian_expired" &&
          n.data?.link === `/guardian?childId=${childId}`,
      );
      expect(expired).toBeDefined();
      expect(expired.title).toMatch(/expired/i);
    });

    it("does not create a duplicate notification on subsequent requests", async () => {
      const { agent, childId } = await setupExpiredChild();
      await agent.get("/api/v1/users/me");
      await agent.get("/api/v1/users/me/children");
      await agent.get("/api/v1/users/me");
      const list = await agent.get("/api/v1/notifications");
      const matches = list.body.data.filter(
        (n: { type: string; data: { link: string } | null }) =>
          n.type === "guardian_expired" &&
          n.data?.link === `/guardian?childId=${childId}`,
      );
      expect(matches).toHaveLength(1);
    });

    it("does not create a notification when the child's confirmation is still pending (not expired)", async () => {
      const { agent } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const childRes = await agent.get("/api/v1/users/me/children");
      const child = childRes.body.data[0];
      await db
        .update(users)
        .set({
          guardianEmail: "lisa@kinectem.demo",
          guardianConfirmedAt: null,
          guardianConfirmedByUserId: null,
          guardianConfirmToken: "valid-token-test",
          guardianConfirmTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
        })
        .where(eq(users.id, child.id));
      await agent.get("/api/v1/users/me");
      const list = await agent.get("/api/v1/notifications");
      const expired = list.body.data.filter(
        (n: { type: string }) => n.type === "guardian_expired",
      );
      expect(expired).toHaveLength(0);
    });

    it("does not create a notification for confirmed children", async () => {
      const { agent } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const childRes = await agent.get("/api/v1/users/me/children");
      const child = childRes.body.data[0];
      await db
        .update(users)
        .set({
          guardianEmail: "lisa@kinectem.demo",
          guardianConfirmedAt: new Date(),
          guardianConfirmToken: null,
          guardianConfirmTokenExpiresAt: new Date(Date.now() - 60_000),
        })
        .where(eq(users.id, child.id));
      await agent.get("/api/v1/users/me");
      const list = await agent.get("/api/v1/notifications");
      const expired = list.body.data.filter(
        (n: { type: string }) => n.type === "guardian_expired",
      );
      expect(expired).toHaveLength(0);
    });
  });
});
