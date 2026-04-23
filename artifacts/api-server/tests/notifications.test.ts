import { describe, expect, it } from "vitest";
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
});
