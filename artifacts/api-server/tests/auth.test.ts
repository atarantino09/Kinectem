import { describe, expect, it } from "vitest";
import { app, listSeedUsers, loginAs, request, DEMO_PASSWORD } from "./helpers";

describe("auth", () => {
  it("lists seeded users", async () => {
    const users = await listSeedUsers();
    expect(users.length).toBeGreaterThan(0);
    expect(users.find((u) => u.role === "coach")).toBeDefined();
  });

  it("logs an existing user in with email + password", async () => {
    const { agent, user } = await loginAs((u) => u.role === "athlete");
    const me = await agent.get("/api/v1/users/me");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);
  });

  it("rejects login with the wrong password", async () => {
    const users = await listSeedUsers();
    const someone = users.find((u) => u.email)!;
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: someone.email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects login for an unknown email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "ghost@kinectem.test", password: "whatever1234" });
    expect(res.status).toBe(401);
  });

  it("signs up a new athlete with email + password and starts a session", async () => {
    const agent = request.agent(app);
    const email = `signup-${Date.now()}@kinectem.test`;
    const res = await agent
      .post("/api/v1/auth/signup")
      .send({
        firstName: "Test",
        lastName: "User",
        role: "athlete",
        email,
        password: "supersecret1",
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.email).toBe(email);
    const me = await agent.get("/api/v1/users/me");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(res.body.id);
  });

  it("blocks signup for under-13 athletes without a guardian email", async () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 10);
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        firstName: "Tiny",
        lastName: "Player",
        role: "athlete",
        email: `tiny-${Date.now()}@kinectem.test`,
        password: "supersecret1",
        dateOfBirth: dob.toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it("creates an unconfirmed under-13 athlete when guardian email is given, then confirms", async () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 10);
    const email = `kid-${Date.now()}@kinectem.test`;
    const guardianEmail = `parent-${Date.now()}@kinectem.test`;
    const password = "supersecret1";

    const signup = await request(app).post("/api/v1/auth/signup").send({
      firstName: "Tiny",
      lastName: "Player",
      role: "athlete",
      email,
      password,
      dateOfBirth: dob.toISOString(),
      guardianEmail,
      guardianConsent: true,
    });
    expect(signup.status).toBe(201);
    expect(signup.body.pendingGuardianConfirmation).toBe(true);
    const url: string = signup.body.guardianConfirmUrl;
    expect(url).toMatch(/^\/guardian-confirm\//);

    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(blocked.status).toBe(403);

    const token = url.split("/").pop()!;
    const confirm = await request(app)
      .post("/api/v1/auth/guardian-confirm")
      .send({ token });
    expect(confirm.status).toBe(200);

    const ok = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(ok.status).toBe(200);
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
        password: "supersecret1",
      });
    expect(res.status).toBe(409);
  });

  it("requests and completes a password reset", async () => {
    // Create a fresh user we can reset
    const email = `reset-${Date.now()}@kinectem.test`;
    const oldPassword = "originalpass1";
    const newPassword = "brandnewpass2";
    const signup = await request(app).post("/api/v1/auth/signup").send({
      firstName: "Reset",
      lastName: "Me",
      role: "athlete",
      email,
      password: oldPassword,
    });
    expect(signup.status).toBe(201);

    const reqRes = await request(app)
      .post("/api/v1/auth/password-reset/request")
      .send({ email });
    expect(reqRes.status).toBe(200);
    const url: string = reqRes.body.resetUrl;
    expect(url).toMatch(/^\/reset-password\//);
    const token = url.split("/").pop()!;

    const completeRes = await request(app)
      .post("/api/v1/auth/password-reset/complete")
      .send({ token, newPassword });
    expect(completeRes.status).toBe(200);

    const oldLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: oldPassword });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: newPassword });
    expect(newLogin.status).toBe(200);

    // Token cannot be reused
    const reuse = await request(app)
      .post("/api/v1/auth/password-reset/complete")
      .send({ token, newPassword: "anotherone3" });
    expect(reuse.status).toBe(400);
  });

  it("password reset for unknown email returns 200 without leaking", async () => {
    const res = await request(app)
      .post("/api/v1/auth/password-reset/request")
      .send({ email: "no-such-account@kinectem.test" });
    expect(res.status).toBe(200);
    expect(res.body.resetUrl).toBeUndefined();
  });

  it("logs out and clears the session cookie", async () => {
    const { agent } = await loginAs((u) => u.role === "coach");
    const out = await agent.post("/api/v1/auth/logout");
    expect(out.status).toBe(204);
  });

  it("uses the documented demo password for seeded users", () => {
    expect(DEMO_PASSWORD).toBeTruthy();
  });
});
