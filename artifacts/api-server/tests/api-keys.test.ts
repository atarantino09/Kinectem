import { describe, expect, it } from "vitest";
import { app, loginAs, request } from "./helpers";

describe("API keys (task #358)", () => {
  it("requires authentication on all endpoints", async () => {
    const list = await request(app).get("/api/v1/auth/api-keys");
    expect(list.status).toBe(401);

    const create = await request(app)
      .post("/api/v1/auth/api-keys")
      .send({ name: "anon" });
    expect(create.status).toBe(401);

    const revoke = await request(app).delete(
      "/api/v1/auth/api-keys/00000000-0000-0000-0000-000000000000",
    );
    expect(revoke.status).toBe(401);
  });

  it("creates a key, lists it, and accepts it as a bearer credential", async () => {
    const { agent, user } = await loginAs((u) => u.role === "coach");

    // Create
    const created = await agent
      .post("/api/v1/auth/api-keys")
      .send({ name: "Integration test", scopes: ["read"] });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("Integration test");
    expect(created.body.scopes).toEqual(["read"]);
    expect(created.body.revokedAt).toBeNull();
    expect(created.body.lastUsedAt).toBeNull();
    // Plaintext token is returned exactly once and starts with the prefix.
    expect(typeof created.body.token).toBe("string");
    expect(created.body.token.startsWith("kk_")).toBe(true);
    expect(created.body.prefix.startsWith("kk_")).toBe(true);
    expect(created.body.token.length).toBeGreaterThan(20);
    const token: string = created.body.token;

    // List
    const list = await agent.get("/api/v1/auth/api-keys");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(created.body.id);
    // Plaintext token must NOT come back in subsequent reads.
    expect("token" in list.body.data[0]).toBe(false);

    // Bearer middleware accepts the new key against an unrelated user route.
    const meViaKey = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`);
    expect(meViaKey.status).toBe(200);
    expect(meViaKey.body.id).toBe(user.id);
  });

  it("revokes a key and rejects subsequent use", async () => {
    const { agent } = await loginAs((u) => u.role === "coach");
    const created = await agent
      .post("/api/v1/auth/api-keys")
      .send({ name: "to-revoke" });
    expect(created.status).toBe(201);
    const token: string = created.body.token;
    const id: string = created.body.id;

    // The key works first.
    const before = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`);
    expect(before.status).toBe(200);

    // Revoke.
    const del = await agent.delete(`/api/v1/auth/api-keys/${id}`);
    expect(del.status).toBe(204);

    // After revoke, the bearer is treated as anonymous.
    const after = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(401);

    // Listing still shows it, now flagged as revoked.
    const list = await agent.get("/api/v1/auth/api-keys");
    const row = list.body.data.find((k: { id: string }) => k.id === id);
    expect(row).toBeTruthy();
    expect(row.revokedAt).toBeTruthy();

    // Re-revoking is a no-op (still 204).
    const del2 = await agent.delete(`/api/v1/auth/api-keys/${id}`);
    expect(del2.status).toBe(204);
  });

  it("rejects revoking another user's key", async () => {
    const owner = await loginAs((u) => u.role === "coach");
    const other = await loginAs(
      (u) => u.role === "admin" && u.id !== owner.user.id,
    );
    const created = await owner.agent
      .post("/api/v1/auth/api-keys")
      .send({ name: "owned" });
    expect(created.status).toBe(201);

    const stolen = await other.agent.delete(
      `/api/v1/auth/api-keys/${created.body.id}`,
    );
    expect(stolen.status).toBe(404);

    // The owner's key is still usable.
    const ok = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${created.body.token}`);
    expect(ok.status).toBe(200);
  });

  it("validates the create body and 400s on a missing name", async () => {
    const { agent } = await loginAs((u) => u.role === "coach");
    const bad = await agent.post("/api/v1/auth/api-keys").send({});
    expect(bad.status).toBe(400);
  });
});
