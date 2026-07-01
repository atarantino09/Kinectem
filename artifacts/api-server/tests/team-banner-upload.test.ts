import { describe, expect, it } from "vitest";
import { app, loginAs, request } from "./helpers";

// Task #691 — team banners/org logos are sent inline as base64 data: URLs.
// The global express.json limit is 1 MB, so realistic banners used to be
// rejected with a raw 413 before the dedicated higher-limit parser on the
// image-bearing PATCH routes. These tests lock in that a realistic banner
// round-trips and that an over-cap value returns a friendly 413.

function dataUrlOfBytes(bytes: number): string {
  const prefix = "data:image/jpeg;base64,";
  return prefix + "A".repeat(Math.max(0, bytes - prefix.length));
}

async function getOwnedTeamId() {
  const { agent } = await loginAs((u) => u.email === "sam@kinectem.demo");
  const orgsRes = await request(app).get("/api/v1/organizations");
  const org = orgsRes.body.data[0];
  const created = await agent
    .post(`/api/v1/organizations/${org.id}/teams`)
    .send({ name: "Banner Test Team", sport: "Soccer", level: "Varsity" });
  expect(created.status).toBe(201);
  return { agent, teamId: created.body.id as string };
}

describe("team banner upload body limit (Task #691)", () => {
  it("accepts a ~1.5 MB banner data URL (over the 1 MB global limit)", async () => {
    const { agent, teamId } = await getOwnedTeamId();
    const bannerUrl = dataUrlOfBytes(Math.floor(1.5 * 1024 * 1024));
    const res = await agent
      .patch(`/api/v1/teams/${teamId}`)
      .send({ bannerUrl });
    expect(res.status).toBe(200);
    expect(res.body.bannerUrl).toBe(bannerUrl);
  });

  it("rejects an over-cap banner data URL with a friendly 413", async () => {
    const { agent, teamId } = await getOwnedTeamId();
    const bannerUrl = dataUrlOfBytes(20 * 1024 * 1024 + 1024);
    const res = await agent
      .patch(`/api/v1/teams/${teamId}`)
      .send({ bannerUrl });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
  });
});
