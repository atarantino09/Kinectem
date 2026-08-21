import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db, rosterInvites } from "@workspace/db";
import { app, loginAs, request } from "./helpers";

async function createOrganizationTeam() {
  const { agent } = await loginAs((user) => user.role === "parent");
  const suffix = Math.random().toString(36).slice(2, 10);
  const orgResponse = await agent.post("/api/v1/organizations").send({
    name: `Outreach Club ${suffix}`,
    city: "Westfield",
    state: "NJ",
    zipCode: "07090",
  });
  expect(orgResponse.status).toBe(201);

  const teamResponse = await agent
    .post(`/api/v1/organizations/${orgResponse.body.id}/teams`)
    .send({ name: `12U Blue ${suffix}`, sport: "Soccer" });
  expect(teamResponse.status).toBe(201);

  return {
    agent,
    orgId: orgResponse.body.id as string,
    teamId: teamResponse.body.id as string,
  };
}

describe("organization roster outreach", () => {
  it("requires an authenticated organization manager", async () => {
    const anonymous = await request(app).get(
      "/api/v1/organizations/not-a-real-org/roster-outreach",
    );
    expect(anonymous.status).toBe(401);

    const { orgId } = await createOrganizationTeam();
    const { agent: nonManager } = await loginAs((user) => user.role === "coach");
    const forbidden = await nonManager.get(
      `/api/v1/organizations/${orgId}/roster-outreach`,
    );
    expect(forbidden.status).toBe(403);
    const forbiddenMessage = await nonManager.post(
      `/api/v1/organizations/${orgId}/roster-outreach/not-a-real-team/message`,
    );
    expect(forbiddenMessage.status).toBe(403);
    const forbiddenStatus = await nonManager
      .patch(`/api/v1/organizations/${orgId}/roster-outreach/not-a-real-team`)
      .send({ sent: true });
    expect(forbiddenStatus.status).toBe(403);
  });

  it("lists active teams, prepares a link only on demand, and shares sent status", async () => {
    const { agent, orgId, teamId } = await createOrganizationTeam();
    const outreachUrl = `/api/v1/organizations/${orgId}/roster-outreach`;

    const initialInviteRows = await db
      .select()
      .from(rosterInvites)
      .where(
        and(
          eq(rosterInvites.teamId, teamId),
          isNull(rosterInvites.invitedEmail),
        ),
      );
    expect(initialInviteRows).toHaveLength(0);

    const listed = await agent.get(outreachUrl);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: teamId,
          sentAt: null,
          sentBy: null,
          sport: "Soccer",
        }),
      ]),
    );

    const [prepared, preparedAgain] = await Promise.all([
      agent.post(`${outreachUrl}/${teamId}/message`),
      agent.post(`${outreachUrl}/${teamId}/message`),
    ]);
    expect(prepared.status).toBe(200);
    expect(prepared.body).toMatchObject({
      teamId,
      joinLink: expect.stringContaining("/app/invites/join-"),
    });
    expect(prepared.body.message).toContain(prepared.body.joinLink);
    expect(preparedAgain.status).toBe(200);
    expect(preparedAgain.body.joinLink).toBe(prepared.body.joinLink);
    expect(prepared.body.joinLink).toMatch(
      /\/app\/invites\/join-[A-Za-z0-9_-]{43}$/,
    );

    const preparedInviteRows = await db
      .select()
      .from(rosterInvites)
      .where(
        and(
          eq(rosterInvites.teamId, teamId),
          isNull(rosterInvites.invitedEmail),
        ),
      );
    expect(preparedInviteRows).toHaveLength(1);

    const markedSent = await agent
      .patch(`${outreachUrl}/${teamId}`)
      .send({ sent: true });
    expect(markedSent.status).toBe(200);
    expect(markedSent.body).toMatchObject({
      teamId,
      sentAt: expect.any(String),
      sentBy: expect.objectContaining({ id: expect.any(String) }),
    });

    const afterSent = await agent.get(outreachUrl);
    expect(afterSent.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: teamId,
          sentAt: expect.any(String),
          sentBy: expect.objectContaining({ displayName: expect.any(String) }),
        }),
      ]),
    );

    const reopened = await agent
      .patch(`${outreachUrl}/${teamId}`)
      .send({ sent: false });
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({ teamId, sentAt: null, sentBy: null });

    const afterReopen = await agent.get(outreachUrl);
    expect(afterReopen.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: teamId, sentAt: null, sentBy: null }),
      ]),
    );
  });
});