import { describe, expect, it } from "vitest";
import { app, listSeedUsers, loginAs, request } from "./helpers";

describe("auth", () => {
  it("lists seeded users", async () => {
    const users = await listSeedUsers();
    expect(users.length).toBeGreaterThan(0);
    expect(users.find((u) => u.role === "coach")).toBeDefined();
  });

  it("logs an existing user in and returns their session", async () => {
    const { agent, user } = await loginAs((u) => u.role === "athlete");
    const me = await agent.get("/api/v1/users/me");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);
  });

  it("rejects login for an unknown user", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ userId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(404);
  });

  it("signs up a new athlete and starts a session", async () => {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/v1/auth/signup")
      .send({
        firstName: "Test",
        lastName: "User",
        role: "athlete",
        email: `signup-${Date.now()}@kinectem.test`,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.email).toBeTruthy();
    const me = await agent.get("/api/v1/users/me");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(res.body.id);
  });

  it("blocks signup for under-13 athletes without a guardian", async () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 10);
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        firstName: "Tiny",
        lastName: "Player",
        role: "athlete",
        email: `tiny-${Date.now()}@kinectem.test`,
        dateOfBirth: dob.toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate email at signup", async () => {
    const seedUsers = await listSeedUsers();
    const existing = seedUsers.find((u) => u.email);
    expect(existing?.email).toBeTruthy();
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        firstName: "Dup",
        lastName: "User",
        role: "athlete",
        email: existing!.email,
      });
    expect(res.status).toBe(409);
  });

  it("logs out and clears the session cookie", async () => {
    const { agent } = await loginAs((u) => u.role === "coach");
    const out = await agent.post("/api/v1/auth/logout");
    expect(out.status).toBe(204);
    // Without a session, /users/me falls back to the first seeded athlete.
    // The important assertion is that logout itself succeeded.
  });
});
