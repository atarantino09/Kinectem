import { describe, expect, it } from "vitest";
import { app, loginAs, request } from "./helpers";

describe("organizations", () => {
  it("lists seeded organizations", async () => {
    const res = await request(app).get("/api/v1/organizations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(
      res.body.data.find((o: { name: string }) =>
        o.name.includes("Westfield"),
      ),
    ).toBeDefined();
  });

  it("returns the org detail for a known organization", async () => {
    const list = await request(app).get("/api/v1/organizations");
    const org = list.body.data[0];
    const res = await request(app).get(`/api/v1/organizations/${org.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(org.id);
    expect(res.body.name).toBe(org.name);
  });

  it("404s on an unknown organization", async () => {
    const res = await request(app).get(
      "/api/v1/organizations/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(404);
  });

  it("creates an organization for the current user", async () => {
    const { agent, user } = await loginAs((u) => u.role === "admin");
    const res = await agent
      .post("/api/v1/organizations")
      .send({ name: "Test Org", description: "Created in tests" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Test Org");
    expect(res.body.role).toBe("owner");
    // The creator should be listed as a member of the new org.
    const orgs = await agent.get(`/api/v1/users/${user.id}/organizations`);
    expect(
      orgs.body.data.find((o: { id: string }) => o.id === res.body.id),
    ).toBeDefined();
  });

  it("rejects creating an organization with an empty name", async () => {
    const { agent } = await loginAs((u) => u.role === "admin");
    const res = await agent.post("/api/v1/organizations").send({ name: "  " });
    expect(res.status).toBe(400);
  });
});
