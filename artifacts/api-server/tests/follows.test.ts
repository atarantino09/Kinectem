import { describe, expect, it } from "vitest";
import { app, loginAs, request } from "./helpers";

async function pickOrgAndTeam() {
  const orgsRes = await request(app).get("/api/v1/organizations");
  const org = orgsRes.body.data[0];
  const teamsRes = await request(app).get(
    `/api/v1/organizations/${org.id}/teams`,
  );
  return { org, team: teamsRes.body.data[0] };
}

describe("follow lists", () => {
  it("returns followers and following for a user, with counts", async () => {
    const { agent: marcus, user: marcusUser } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const { user: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");

    // Marcus follows Sam.
    const followRes = await marcus.post(`/api/v1/users/${sam.id}/follow`);
    expect([201, 200]).toContain(followRes.status);

    // Sam's followers should include Marcus.
    const followers = await request(app).get(
      `/api/v1/users/${sam.id}/followers`,
    );
    expect(followers.status).toBe(200);
    expect(Array.isArray(followers.body.data)).toBe(true);
    const ids = followers.body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(marcusUser.id);
    expect(followers.body.data[0]).toHaveProperty("displayName");
    expect(followers.body.data[0]).toHaveProperty("followedAt");

    // Marcus's following should include Sam (entityType=user).
    const following = await request(app).get(
      `/api/v1/users/${marcusUser.id}/following`,
    );
    expect(following.status).toBe(200);
    const followingItem = following.body.data.find(
      (r: { id: string }) => r.id === sam.id,
    );
    expect(followingItem).toBeDefined();
    expect(followingItem.entityType).toBe("user");

    // GetUserById exposes the follower / following counts.
    const samProfile = await request(app).get(`/api/v1/users/${sam.id}`);
    expect(samProfile.status).toBe(200);
    expect(typeof samProfile.body.followerCount).toBe("number");
    expect(samProfile.body.followerCount).toBeGreaterThanOrEqual(1);

    const marcusProfile = await request(app).get(
      `/api/v1/users/${marcusUser.id}`,
    );
    expect(typeof marcusProfile.body.followingCount).toBe("number");
    expect(marcusProfile.body.followingCount).toBeGreaterThanOrEqual(1);
  });

  it("returns followers for a team and an organization", async () => {
    const { org, team } = await pickOrgAndTeam();
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");

    await agent.post(`/api/v1/teams/${team.id}/follow`);
    await agent.post(`/api/v1/organizations/${org.id}/follow`);

    const teamFollowers = await request(app).get(
      `/api/v1/teams/${team.id}/followers`,
    );
    expect(teamFollowers.status).toBe(200);
    expect(teamFollowers.body.data.length).toBeGreaterThanOrEqual(1);
    expect(teamFollowers.body.data[0]).toHaveProperty("displayName");

    const orgFollowers = await request(app).get(
      `/api/v1/organizations/${org.id}/followers`,
    );
    expect(orgFollowers.status).toBe(200);
    expect(orgFollowers.body.data.length).toBeGreaterThanOrEqual(1);

    // Org detail exposes followerCount.
    const orgDetail = await request(app).get(`/api/v1/organizations/${org.id}`);
    expect(typeof orgDetail.body.followerCount).toBe("number");
    expect(orgDetail.body.followerCount).toBeGreaterThanOrEqual(1);
  });

  it("returns followers in an organization that someone follows via the user-following endpoint", async () => {
    const { org } = await pickOrgAndTeam();
    const { agent, user } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    await agent.post(`/api/v1/organizations/${org.id}/follow`);

    const following = await request(app).get(
      `/api/v1/users/${user.id}/following`,
    );
    expect(following.status).toBe(200);
    const orgItem = following.body.data.find(
      (r: { id: string; entityType: string }) =>
        r.id === org.id && r.entityType === "organization",
    );
    expect(orgItem).toBeDefined();
  });

  it("paginates the followers list", async () => {
    const { user: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const res = await request(app).get(
      `/api/v1/users/${sam.id}/followers?limit=1`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.pagination).toHaveProperty("nextCursor");
    expect(res.body.pagination).toHaveProperty("hasMore");
  });
});
