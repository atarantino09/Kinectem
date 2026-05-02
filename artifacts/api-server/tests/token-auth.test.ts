import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, refreshTokens } from "@workspace/db";
import { app, listSeedUsers, loginAs, request, DEMO_PASSWORD } from "./helpers";
import {
  signAccessToken,
  signAccessTokenForTests,
} from "../src/lib/tokens";
import * as passwords from "../src/lib/passwords";

// Wrap passwords.generateToken so individual tests can stub the next
// returned value to force a unique-constraint collision (see the
// atomicity regression test for /auth/refresh). Default behavior is
// preserved for every other test by delegating to the real impl.
vi.mock("../src/lib/passwords", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/passwords")>(
      "../src/lib/passwords",
    );
  return { ...actual, generateToken: vi.fn(actual.generateToken) };
});

// Task #355 — Bearer-token auth for non-browser clients (mobile app
// today, third-party developer apps later). These tests verify that the
// new `/auth/token`, `/auth/refresh`, `/auth/logout` flow works end-to-end
// AND that the existing cookie-session path is unchanged.

async function issueTokens(email: string, password: string) {
  const res = await request(app).post("/api/v1/auth/token").send({
    email,
    password,
    deviceLabel: "vitest-iPhone",
  });
  return res;
}

describe("token auth (task #355)", () => {
  describe("POST /auth/token", () => {
    it("issues an access token + refresh token pair for valid credentials", async () => {
      const seed = await listSeedUsers();
      const user = seed.find((u) => u.role === "athlete" && u.email)!;
      const res = await issueTokens(user.email!, DEMO_PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body.tokenType).toBe("Bearer");
      expect(typeof res.body.accessToken).toBe("string");
      expect(typeof res.body.refreshToken).toBe("string");
      expect(typeof res.body.expiresIn).toBe("number");
      expect(res.body.expiresIn).toBeGreaterThan(0);
      expect(res.body.expiresIn).toBeLessThanOrEqual(15 * 60);
      expect(typeof res.body.accessTokenExpiresAt).toBe("string");
      expect(typeof res.body.refreshTokenExpiresAt).toBe("string");
      expect(res.body.user.id).toBe(user.id);
    });

    it("rejects an unknown email with 401", async () => {
      const res = await issueTokens("ghost@kinectem.test", DEMO_PASSWORD);
      expect(res.status).toBe(401);
    });

    it("rejects a wrong password with 401", async () => {
      const seed = await listSeedUsers();
      const user = seed.find((u) => u.email)!;
      const res = await issueTokens(user.email!, "definitely-wrong-1234");
      expect(res.status).toBe(401);
    });

    it("blocks an under-13 athlete waiting on guardian confirmation", async () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 9);
      const email = `kid-token-${Date.now()}@kinectem.test`;
      const guardianEmail = `parent-token-${Date.now()}@kinectem.test`;
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
      const blocked = await issueTokens(email, password);
      expect(blocked.status).toBe(403);
      expect(blocked.body.pendingGuardianConfirmation).toBe(true);
    });

    it("does not set a session cookie (bearer flow is cookie-free)", async () => {
      const seed = await listSeedUsers();
      const user = seed.find((u) => u.role === "coach" && u.email)!;
      const res = await issueTokens(user.email!, DEMO_PASSWORD);
      expect(res.status).toBe(200);
      const setCookie = res.headers["set-cookie"];
      // Cookie may be entirely absent, or present only as a clear-cookie;
      // either way it must not contain a fresh kinectem_session value.
      const cookieStr = Array.isArray(setCookie)
        ? setCookie.join(";")
        : (setCookie ?? "");
      expect(cookieStr).not.toMatch(/kinectem_session=[^;]+\w/);
    });
  });

  describe("calling protected endpoints with Authorization: Bearer", () => {
    it("returns the same /users/me payload as the cookie flow for the same user", async () => {
      const { agent, user } = await loginAs((u) => u.role === "athlete");
      const cookieMe = await agent.get("/api/v1/users/me");
      expect(cookieMe.status).toBe(200);

      const issued = await issueTokens(user.email!, DEMO_PASSWORD);
      expect(issued.status).toBe(200);
      const bearerMe = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${issued.body.accessToken}`);
      expect(bearerMe.status).toBe(200);
      expect(bearerMe.body.id).toBe(cookieMe.body.id);
      expect(bearerMe.body.email).toBe(cookieMe.body.email);
      expect(bearerMe.body.role).toBe(cookieMe.body.role);
      expect(bearerMe.body.firstName).toBe(cookieMe.body.firstName);
    });

    it("rejects an unauthenticated bare request with 401", async () => {
      const res = await request(app).get("/api/v1/users/me");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTH_REQUIRED");
    });

    it("rejects a malformed Authorization header with 401", async () => {
      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", "totally-not-a-bearer-token");
      expect(res.status).toBe(401);
    });

    it("rejects a Bearer with a tampered signature with 401", async () => {
      const seed = await listSeedUsers();
      const user = seed.find((u) => u.role === "athlete")!;
      const issued = await issueTokens(user.email!, DEMO_PASSWORD);
      const [body, sig] = (issued.body.accessToken as string).split(".");
      const tampered = `${body}.${sig.slice(0, -2)}AA`;
      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${tampered}`);
      expect(res.status).toBe(401);
    });

    it("rejects an expired access token with 401", async () => {
      const seed = await listSeedUsers();
      const user = seed.find((u) => u.role === "athlete")!;
      const expired = signAccessTokenForTests(
        user.id,
        new Date(Date.now() - 60_000),
      );
      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${expired.token}`);
      expect(res.status).toBe(401);
    });

    it("does not load a soft-deleted user even with a valid signature", async () => {
      // Sign a token for a uuid that doesn't match any seeded user — same
      // shape a stale token would have after the user was removed.
      const phantom = signAccessToken("00000000-0000-0000-0000-000000000000");
      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${phantom.token}`);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /auth/refresh", () => {
    it("rotates: returns a new pair and revokes the presented refresh token", async () => {
      const seed = await listSeedUsers();
      const user = seed.find((u) => u.role === "athlete")!;
      const issued = await issueTokens(user.email!, DEMO_PASSWORD);
      const firstRefresh = issued.body.refreshToken as string;

      const rotated = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: firstRefresh });
      expect(rotated.status).toBe(200);
      expect(rotated.body.accessToken).toBeDefined();
      expect(rotated.body.refreshToken).toBeDefined();
      expect(rotated.body.refreshToken).not.toBe(firstRefresh);

      // The new access token works on a protected endpoint.
      const me = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${rotated.body.accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.id).toBe(user.id);
    });

    it("rejects a reused (already-rotated) refresh token with 401", async () => {
      const seed = await listSeedUsers();
      const user = seed.find((u) => u.role === "athlete")!;
      const issued = await issueTokens(user.email!, DEMO_PASSWORD);
      const firstRefresh = issued.body.refreshToken as string;

      const ok = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: firstRefresh });
      expect(ok.status).toBe(200);

      // Replaying the same refresh token now fails — that's the standard
      // mitigation for stolen-token replay (rotation detection).
      const replay = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: firstRefresh });
      expect(replay.status).toBe(401);
    });

    it("rejects a refresh token that was never issued", async () => {
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: "0".repeat(64) });
      expect(res.status).toBe(401);
    });

    it("rejects an expired refresh token", async () => {
      const seed = await listSeedUsers();
      const user = seed.find((u) => u.role === "athlete")!;
      const issued = await issueTokens(user.email!, DEMO_PASSWORD);
      const refresh = issued.body.refreshToken as string;
      // Force-expire every refresh row for this user; refresh must fail.
      await db
        .update(refreshTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(refreshTokens.userId, user.id));
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: refresh });
      expect(res.status).toBe(401);
    });

    // Atomicity regression guard: if /auth/refresh ever revokes the
    // presented token outside the same transaction as the replacement
    // insert, a transient failure during issuance would log the user
    // out. We force a UNIQUE violation on the insert by pre-seeding a
    // row with a known token_hash and stubbing generateToken() to
    // return the value that hashes to it.
    it("rotation is atomic: a failure during issuance leaves the old token usable", async () => {
      const seed = await listSeedUsers();
      const user = seed.find((u) => u.role === "coach" && u.email)!;
      const issued = await issueTokens(user.email!, DEMO_PASSWORD);
      expect(issued.status).toBe(200);
      const rt1 = issued.body.refreshToken as string;

      const collisionToken = "f".repeat(64);
      const collisionHash = createHash("sha256")
        .update(collisionToken)
        .digest("hex");
      await db.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: collisionHash,
        expiresAt: new Date(Date.now() + 60_000),
      });

      vi.mocked(passwords.generateToken).mockReturnValueOnce(collisionToken);

      const failRes = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: rt1 });
      expect(failRes.status).toBeGreaterThanOrEqual(500);

      // The original refresh token must still be usable — the revoke
      // was rolled back along with the failed insert.
      const okRes = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: rt1 });
      expect(okRes.status).toBe(200);
      expect(typeof okRes.body.refreshToken).toBe("string");
      expect(okRes.body.refreshToken).not.toBe(rt1);
    });
  });

  describe("rate limiting", () => {
    // Per-IP refresh limiter is 30/min; the 31st attempt within the
    // window must be rejected with 429. We use a junk refresh token so
    // each request fails fast in the rotation logic but still increments
    // the limiter bucket.
    it("returns 429 on /auth/refresh after the per-IP burst is exhausted", async () => {
      const junk = "0".repeat(64);
      for (let i = 0; i < 30; i++) {
        const r = await request(app)
          .post("/api/v1/auth/refresh")
          .send({ refreshToken: junk });
        // All 30 attempts fail auth (token doesn't exist), but they must
        // not be throttled yet — that's the whole point of the burst.
        expect(r.status).toBe(401);
      }
      const limited = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: junk });
      expect(limited.status).toBe(429);
      expect(limited.body.error).toMatch(/too many/i);
      expect(limited.headers["retry-after"]).toBeDefined();
    });

    it("returns 429 on /auth/logout after the per-IP burst is exhausted", async () => {
      const junk = "1".repeat(64);
      for (let i = 0; i < 30; i++) {
        const r = await request(app)
          .post("/api/v1/auth/logout")
          .send({ refreshToken: junk });
        // /auth/logout is best-effort and always 204s, so each call
        // ticks the limiter without short-circuiting.
        expect(r.status).toBe(204);
      }
      const limited = await request(app)
        .post("/api/v1/auth/logout")
        .send({ refreshToken: junk });
      expect(limited.status).toBe(429);
      expect(limited.body.error).toMatch(/too many/i);
      expect(limited.headers["retry-after"]).toBeDefined();
    });
  });

  describe("POST /auth/logout for bearer clients", () => {
    it("revokes the refresh token passed in the body", async () => {
      const seed = await listSeedUsers();
      const user = seed.find((u) => u.role === "athlete")!;
      const issued = await issueTokens(user.email!, DEMO_PASSWORD);
      const accessToken = issued.body.accessToken as string;
      const refreshToken = issued.body.refreshToken as string;

      const out = await request(app)
        .post("/api/v1/auth/logout")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ refreshToken });
      expect(out.status).toBe(204);

      // Refresh now fails — the token is revoked, even though it would
      // otherwise still be within its 30-day lifetime.
      const refresh = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken });
      expect(refresh.status).toBe(401);
    });

    it("still returns 204 for the cookie path with no refreshToken in body", async () => {
      const { agent } = await loginAs((u) => u.role === "coach");
      const out = await agent.post("/api/v1/auth/logout");
      expect(out.status).toBe(204);
    });
  });

  describe("public OpenAPI spec endpoint", () => {
    it("serves the spec without requiring auth at /api/openapi.public.json", async () => {
      const res = await request(app).get("/api/openapi.public.json");
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBeDefined();
      expect(res.body.info?.title).toBe("Kinectem API");
      // bearerAuth scheme must be advertised so external codegen sees it.
      expect(res.body.components?.securitySchemes?.bearerAuth).toBeDefined();
      expect(res.body.components?.securitySchemes?.bearerAuth?.scheme).toBe(
        "bearer",
      );
    });

    it("serves the YAML variant unauthenticated too", async () => {
      const res = await request(app).get("/api/openapi.public.yaml");
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/openapi: 3\.0/);
      expect(res.text).toMatch(/bearerAuth:/);
    });
  });
});
