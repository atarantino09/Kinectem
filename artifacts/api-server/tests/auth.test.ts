import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { createHash } from "node:crypto";
import { app, listSeedUsers, loginAs, request, DEMO_PASSWORD } from "./helpers";
const sentEmails: Array<{ to: string; subject: string; text: string }> = [];

vi.mock("../src/lib/email", () => ({
  isEmailConfigured: () => true,
  sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => {
    sentEmails.push(m);
  }),
  sendPasswordResetEmail: vi.fn(async (to: string, token: string) => {
    sentEmails.push({
      to,
      subject: "Reset your Kinectem password",
      text: `/reset-password/${token}`,
    });
  }),
  sendGuardianConfirmationEmail: vi.fn(
    async (to: string, _name: string, token: string) => {
      sentEmails.push({
        to,
        subject: "Guardian confirmation",
        text: `/guardian-confirm/${token}`,
      });
    },
  ),
}));

function lastEmailTo(to: string) {
  for (let i = sentEmails.length - 1; i >= 0; i--) {
    if (sentEmails[i].to === to) return sentEmails[i];
  }
  return undefined;
}

beforeEach(() => {
  sentEmails.length = 0;
});

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

  it("returns the caller's role on /users/me so role-gated UI can render", async () => {
    const { agent: athleteAgent } = await loginAs((u) => u.role === "athlete");
    const athleteMe = await athleteAgent.get("/api/v1/users/me");
    expect(athleteMe.status).toBe(200);
    expect(athleteMe.body.role).toBe("athlete");

    // The /family (Guardian) page gates on me.role === "parent", so this
    // assertion must hard-fail (not silently skip) if the seed loses its
    // parent user. Otherwise the GuardianPage gate could regress unnoticed.
    const seedUsers = await listSeedUsers();
    const seedParent = seedUsers.find((u) => u.role === "parent");
    expect(
      seedParent,
      "expected a seeded user with role=parent to exist for the GuardianPage gate test",
    ).toBeDefined();

    const { agent: parentAgent } = await loginAs((u) => u.role === "parent");
    const parentMe = await parentAgent.get("/api/v1/users/me");
    expect(parentMe.status).toBe(200);
    expect(parentMe.body.role).toBe("parent");
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
    expect(signup.body.guardianConfirmUrl).toBeUndefined();

    const guardianEmailMsg = lastEmailTo(guardianEmail);
    expect(guardianEmailMsg).toBeDefined();
    const url = guardianEmailMsg!.text.match(/\/guardian-confirm\/[A-Za-z0-9_-]+/)![0];

    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(blocked.status).toBe(403);
    expect(blocked.body.guardianConfirmUrl).toBeUndefined();

    const token = url.split("/").pop()!;

    // Task #32 — DB stores only the SHA-256 hash, never the raw token.
    const [row] = await db
      .select({ hash: users.guardianConfirmTokenHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const expectedHash = createHash("sha256").update(token).digest("hex");
    expect(row.hash).toBe(expectedHash);
    expect(row.hash).not.toBe(token);

    // Wrong guardian email is rejected so kids can't confirm themselves.
    const wrongEmail = await request(app)
      .post("/api/v1/auth/guardian-confirm")
      .send({ token, guardianEmail: `kid-${Date.now()}@kinectem.test` });
    expect(wrongEmail.status).toBe(403);

    // Identity check requires the guardian email to match.
    const confirm = await request(app)
      .post("/api/v1/auth/guardian-confirm")
      .send({ token, guardianEmail });
    expect(confirm.status).toBe(200);

    const ok = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(ok.status).toBe(200);
  });

  it("lets a pending under-13 athlete request a fresh guardian confirmation link", async () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 11);
    const email = `kid-resend-${Date.now()}@kinectem.test`;
    const guardianEmail = `parent-resend-${Date.now()}@kinectem.test`;
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
    expect(signup.body.guardianConfirmUrl).toBeUndefined();

    const guardianEmailMsg = lastEmailTo(guardianEmail);
    expect(guardianEmailMsg).toBeDefined();
    const originalUrl = guardianEmailMsg!.text.match(/\/guardian-confirm\/[A-Za-z0-9_-]+/)![0];
    const originalToken = originalUrl.split("/").pop()!;

    // Login surfaces a structured pending-guardian payload.
    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(blocked.status).toBe(403);
    expect(blocked.body.pendingGuardianConfirmation).toBe(true);

    const resend = await request(app)
      .post("/api/v1/auth/guardian-resend")
      .send({ email, password });
    expect(resend.status).toBe(200);
    expect(resend.body.guardianConfirmUrl).toBeUndefined();

    const resendEmailMsg = lastEmailTo(guardianEmail);
    expect(resendEmailMsg).toBeDefined();
    const newUrl = resendEmailMsg!.text.match(/\/guardian-confirm\/[A-Za-z0-9_-]+/)![0];
    expect(newUrl).toMatch(/^\/guardian-confirm\//);
    const newToken = newUrl.split("/").pop()!;
    expect(newToken).not.toBe(originalToken);

    // Old link should now be invalid.
    const oldFails = await request(app)
      .post("/api/v1/auth/guardian-confirm")
      .send({ token: originalToken, guardianEmail });
    expect(oldFails.status).toBe(400);

    // New link works.
    const ok = await request(app)
      .post("/api/v1/auth/guardian-confirm")
      .send({ token: newToken, guardianEmail });
    expect(ok.status).toBe(200);
  });

  it("surfaces an expired guardian confirmation link on login and at confirm time", async () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 9);
    const email = `kid-expired-${Date.now()}@kinectem.test`;
    const guardianEmail = `parent-expired-${Date.now()}@kinectem.test`;
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
    expect(signup.body.guardianConfirmUrl).toBeUndefined();

    const guardianEmailMsg = lastEmailTo(guardianEmail);
    expect(guardianEmailMsg).toBeDefined();
    const url = guardianEmailMsg!.text.match(/\/guardian-confirm\/[A-Za-z0-9_-]+/)![0];
    const token = url.split("/").pop()!;

    // Manually expire the token in the database.
    await db
      .update(users)
      .set({ guardianConfirmTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(users.email, email));

    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(blocked.status).toBe(403);
    expect(blocked.body.pendingGuardianConfirmation).toBe(true);
    expect(blocked.body.guardianConfirmExpired).toBe(true);
    expect(blocked.body.guardianConfirmUrl).toBeNull();

    const confirmExpired = await request(app)
      .post("/api/v1/auth/guardian-confirm")
      .send({ token, guardianEmail });
    expect(confirmExpired.status).toBe(400);
    expect(confirmExpired.body.expired).toBe(true);
  });

  it("rejects under-13 signup when guardian email matches the athlete email", async () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 8);
    const email = `kid-self-${Date.now()}@kinectem.test`;
    const res = await request(app).post("/api/v1/auth/signup").send({
      firstName: "Sneaky",
      lastName: "Kid",
      role: "athlete",
      email,
      password: "supersecret1",
      dateOfBirth: dob.toISOString(),
      guardianEmail: email,
      guardianConsent: true,
    });
    expect(res.status).toBe(400);
  });

  it("guardian-resend-by-email mints a fresh link for an unconfirmed minor and rotates the hash", async () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 9);
    const email = `kid-recovery-${Date.now()}@kinectem.test`;
    const guardianEmail = `parent-recovery-${Date.now()}@kinectem.test`;
    const password = "supersecret1";

    const agent = request.agent(app);
    await agent
      .post("/api/v1/auth/age-check")
      .send({ dateOfBirth: dob.toISOString().slice(0, 10) });
    const signup = await agent.post("/api/v1/auth/signup").send({
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

    // Note: signup uses the COPPA "email plus" notice email (not the
    // legacy guardian-confirm email), so the only `/guardian-confirm/`
    // link this test cares about is the one produced by the recovery
    // endpoint we're exercising.
    const [before] = await db
      .select({ hash: users.guardianConfirmTokenHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    expect(before.hash).toBeTruthy();

    const recover = await request(app)
      .post("/api/v1/auth/guardian-resend-by-email")
      .send({ guardianEmail });
    expect(recover.status).toBe(200);
    expect(recover.body.ok).toBe(true);
    expect(recover.body.message).toMatch(/fresh link/i);

    const afterMsg = lastEmailTo(guardianEmail);
    expect(afterMsg).toBeDefined();
    const newToken = afterMsg!.text.match(/\/guardian-confirm\/([A-Za-z0-9_-]+)/)![1];

    const [after] = await db
      .select({ hash: users.guardianConfirmTokenHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    expect(after.hash).not.toBe(before.hash);
    const expected = createHash("sha256").update(newToken).digest("hex");
    expect(after.hash).toBe(expected);

    // The new link works.
    const ok = await request(app)
      .post("/api/v1/auth/guardian-confirm")
      .send({ token: newToken, guardianEmail });
    expect(ok.status).toBe(200);
  });

  it("guardian-resend-by-email returns the same generic 200 for an unknown email and sends nothing", async () => {
    const guardianEmail = `ghost-parent-${Date.now()}@kinectem.test`;
    const before = sentEmails.length;
    const res = await request(app)
      .post("/api/v1/auth/guardian-resend-by-email")
      .send({ guardianEmail });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toMatch(/fresh link/i);
    expect(lastEmailTo(guardianEmail)).toBeUndefined();
    expect(sentEmails.length).toBe(before);
  });

  it("guardian-resend-by-email is a no-op (but generic 200) once the account is already confirmed", async () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 10);
    const email = `kid-already-${Date.now()}@kinectem.test`;
    const guardianEmail = `parent-already-${Date.now()}@kinectem.test`;
    const password = "supersecret1";

    const agent = request.agent(app);
    await agent
      .post("/api/v1/auth/age-check")
      .send({ dateOfBirth: dob.toISOString().slice(0, 10) });
    const signup = await agent.post("/api/v1/auth/signup").send({
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

    // Mark the account as already-confirmed directly in the DB
    // (bypassing the legacy /auth/guardian-confirm flow, which under
    // the new COPPA email-plus signup no longer receives a token via
    // email).
    await db
      .update(users)
      .set({
        guardianConfirmedAt: new Date(),
        guardianConfirmTokenHash: null,
        guardianConfirmTokenExpiresAt: null,
      })
      .where(eq(users.email, email));

    const before = sentEmails.length;
    const res = await request(app)
      .post("/api/v1/auth/guardian-resend-by-email")
      .send({ guardianEmail });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(sentEmails.length).toBe(before);
  });

  it("rejects guardian-resend without correct athlete credentials", async () => {
    const res = await request(app)
      .post("/api/v1/auth/guardian-resend")
      .send({ email: "nobody@kinectem.test", password: "wrongpass1" });
    expect(res.status).toBe(401);
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
    expect(reqRes.body.resetUrl).toBeUndefined();

    const resetEmailMsg = lastEmailTo(email);
    expect(resetEmailMsg).toBeDefined();
    const url = resetEmailMsg!.text.match(/\/reset-password\/[A-Za-z0-9_-]+/)![0];
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

  it("rate-limits repeated failed login attempts for the same email", async () => {
    const users = await listSeedUsers();
    const someone = users.find((u) => u.email)!;
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: someone.email, password: "wrong-password" });
      expect(r.status).toBe(401);
    }
    const limited = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: someone.email, password: "wrong-password" });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/too many/i);
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("does not count successful logins against the limit", async () => {
    const { user } = await loginAs((u) => u.role === "athlete");
    // Repeated successful logins should not trigger the limiter.
    for (let i = 0; i < 7; i++) {
      const r = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: user.email, password: DEMO_PASSWORD });
      expect(r.status).toBe(200);
    }
  });

  it("rate-limits password reset requests for the same email", async () => {
    const email = `reset-throttle-${Date.now()}@kinectem.test`;
    await request(app).post("/api/v1/auth/signup").send({
      firstName: "Throttle",
      lastName: "Me",
      role: "athlete",
      email,
      password: "originalpass1",
    });
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post("/api/v1/auth/password-reset/request")
        .send({ email });
      expect(r.status).toBe(200);
    }
    const limited = await request(app)
      .post("/api/v1/auth/password-reset/request")
      .send({ email });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/too many/i);
  });
});
