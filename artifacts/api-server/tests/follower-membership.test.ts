import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db, guardianLinks, organizationAdmins, organizationFollowers,
  organizations, rosterEntries, teamFollowers, teams,
} from "@workspace/db";
import { app, findUser, loginAs, request } from "./helpers";

let orgId: string;
let teamId: string;

beforeEach(async () => {
  const [org] = await db.insert(organizations).values({
    name: "Membership test club", type: "club",
  }).returning();
  const [team] = await db.insert(teams).values({
    name: "Membership test team", organizationId: org.id,
  }).returning();
  orgId = org.id;
  teamId = team.id;
});

async function profileOrg(userId: string) {
  const response = await request(app).get(`/api/v1/users/${userId}/organizations`);
  expect(response.status).toBe(200);
  return response.body.data.filter((org: { id: string }) => org.id === orgId);
}

async function addPlayerAndParent() {
  const child = await findUser((user) => user.email === "samira@kinectem.demo");
  const parent = await findUser((user) => user.email === "lisa@kinectem.demo");
  await db.insert(rosterEntries).values({
    teamId, userId: child.id, role: "player", position: "player", status: "accepted",
  });
  await db.delete(guardianLinks).where(and(
    eq(guardianLinks.childId, child.id), eq(guardianLinks.guardianId, parent.id),
  ));
  await db.insert(guardianLinks).values({
    childId: child.id, guardianId: parent.id, status: "active",
  });
  return { child, parent };
}

describe("following is separate from membership", () => {
  it("does not classify an ordinary org or team follower as a member", async () => {
    const { agent, user } = await loginAs("jordan@kinectem.demo");
    await db.insert(organizationFollowers).values({ organizationId: orgId, userId: user.id });
    await db.insert(teamFollowers).values({ teamId, userId: user.id });
    expect(await profileOrg(user.id)).toEqual([
      expect.objectContaining({ isFollowing: true, isMember: false, role: null }),
    ]);
    const detail = await agent.get(`/api/v1/organizations/${orgId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ isFollowing: true, isMember: false, role: null });
    const teamList = await agent.get(`/api/v1/users/${user.id}/teams`);
    expect(teamList.status).toBe(200);
    expect(teamList.body.data.some((team: { teamId: string }) => team.teamId === teamId)).toBe(false);
  });

  it("recognizes players and active parents as members without any follow edges", async () => {
    const { child, parent } = await addPlayerAndParent();
    for (const userId of [child.id, parent.id]) {
      expect(await profileOrg(userId)).toEqual([
        expect.objectContaining({ isMember: true, role: "member", isFollowing: false }),
      ]);
    }
    const { agent } = await loginAs(parent.id);
    const detail = await agent.get(`/api/v1/organizations/${orgId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ isMember: true, role: "member", isFollowing: false });
    const teamList = await agent.get(`/api/v1/users/${parent.id}/teams`);
    expect(teamList.status).toBe(200);
    expect(teamList.body.data).toContainEqual(expect.objectContaining({
      teamId, position: "parent", status: "active",
    }));
  });

  it("does not treat revoked parents or pending roster invites as active members", async () => {
    const { child, parent } = await addPlayerAndParent();
    await db.update(guardianLinks).set({ status: "revoked" }).where(and(
      eq(guardianLinks.childId, child.id), eq(guardianLinks.guardianId, parent.id),
    ));
    await db.insert(organizationFollowers).values({ organizationId: orgId, userId: parent.id });
    expect(await profileOrg(parent.id)).toEqual([
      expect.objectContaining({ isFollowing: true, isMember: false, role: null }),
    ]);
    const pending = await findUser((user) => user.email === "jordan@kinectem.demo");
    await db.insert(rosterEntries).values({
      teamId, userId: pending.id, role: "player", status: "pending",
    });
    expect(await profileOrg(pending.id)).toEqual([]);
    const teamList = await request(app).get(`/api/v1/users/${parent.id}/teams`);
    expect(teamList.status).toBe(200);
    expect(teamList.body.data.some((team: { teamId: string }) => team.teamId === teamId)).toBe(false);
  });

  it.each(["owner", "admin", "member"] as const)("preserves a directly assigned %s role", async (role) => {
    const user = await findUser((user) => user.email === "coach@kinectem.demo");
    await db.insert(organizationAdmins).values({ organizationId: orgId, userId: user.id, role });
    await db.insert(rosterEntries).values({ teamId, userId: user.id, role: "coach" });
    expect(await profileOrg(user.id)).toEqual([
      expect.objectContaining({ isMember: true, role, isFollowing: false }),
    ]);
  });
});
