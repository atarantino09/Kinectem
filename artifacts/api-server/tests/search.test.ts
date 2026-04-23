import { describe, expect, it } from "vitest";
import { app, request } from "./helpers";

describe("search", () => {
  it("returns empty result groups for an empty query", async () => {
    const res = await request(app).get("/api/v1/search");
    expect(res.status).toBe(200);
    expect(res.body.users.data).toEqual([]);
    expect(res.body.organizations.data).toEqual([]);
    expect(res.body.teams.data).toEqual([]);
  });

  it("matches users, orgs, and teams by name", async () => {
    const res = await request(app).get("/api/v1/search?q=Westfield");
    expect(res.status).toBe(200);
    expect(
      res.body.organizations.data.find(
        (o: { name: string }) => o.name === "Westfield Athletic Club",
      ),
    ).toBeDefined();
  });

  it("finds users by partial name match", async () => {
    const res = await request(app).get("/api/v1/search?q=Marcus");
    expect(res.status).toBe(200);
    expect(
      res.body.users.data.find((u: { displayName: string }) =>
        u.displayName.includes("Marcus"),
      ),
    ).toBeDefined();
  });

  it("finds teams by partial name match", async () => {
    const res = await request(app).get("/api/v1/search?q=Varsity");
    expect(res.status).toBe(200);
    expect(
      res.body.teams.data.find((t: { name: string }) =>
        t.name.includes("Varsity"),
      ),
    ).toBeDefined();
  });
});
