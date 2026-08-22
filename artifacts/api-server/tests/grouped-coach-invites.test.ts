import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  coachInviteGroups,
  db,
  rosterEntries,
  rosterInvites,
  teams,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";

describe("grouped multi-team coach invitations", () => {
  let originalKey: string | undefined;
  let originalFrom: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalKey = process.env.SENDGRID_API_KEY;
    originalFrom = process.env.EMAIL_FROM;
    process.env.SENDGRID_API_KEY = "test-key";
    process.env.EMAIL_FROM = "noreply@kinectem.test";
    fetchMock = vi.fn(async () => new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalFrom;
    vi.unstubAllGlobals();
  });

  async function twoTeamsInOneOrganization(): Promise<{
    orgId: string;
    teams: Array<{ id: string; name: string }>;
  }> {
    const orgs = await request(app).get("/api/v1/organizations");
    const orgId = orgs.body.data[0].id as string;
    const listed = await request(app).get(
      `/api/v1/organizations/${orgId}/teams`,
    );
    const selected = listed.body.data.slice(0, 2) as Array<{
      id: string;
      name: string;
    }>;
    if (selected.length !== 2) throw new Error("Seed needs two teams");
    return { orgId, teams: selected };
  }

  it("sends one email, previews all teams, and accepts every valid child exactly once", async () => {
    const { agent: manager } = await loginAs((user) => user.role === "admin");
    const { orgId, teams: invitedTeams } = await twoTeamsInOneOrganization();
    const email = `grouped-coach-${Date.now()}@kinectem.test`;

    const created = await manager
      .post(`/api/v1/organizations/${orgId}/coach-invites`)
      .send({
        assignments: invitedTeams.map((team) => ({
          teamId: team.id,
          email: ` ${email.toUpperCase()} `,
        })),
      });
    expect(created.status).toBe(201);
    expect(created.body.data).toHaveLength(1);
    expect(created.body.data[0].teamNames).toEqual(
      invitedTeams.map((team) => team.name),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, emailRequest] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(emailRequest.body));
    expect(sent.personalizations[0].custom_args.kinectem_invite_kind).toBe(
      "roster_group",
    );
    const text = sent.content.find(
      (content: { type: string; value: string }) =>
        content.type === "text/plain",
    ).value as string;
    for (const team of invitedTeams) expect(text).toContain(team.name);

    const acceptUrl = created.body.data[0].acceptUrl as string;
    const token = acceptUrl.split("/").pop() as string;
    const preview = await request(app).get(`/api/v1/invites/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.multiTeam).toBe(true);
    expect(preview.body.organization.id).toBe(orgId);
    expect(preview.body.invite.role).toBe("coach");
    expect(preview.body.teams.map((team: { name: string }) => team.name)).toEqual(
      invitedTeams.map((team) => team.name),
    );

    const recipient = request.agent(app);
    const signup = await recipient.post("/api/v1/auth/signup").send({
      firstName: "Grouped",
      lastName: "Coach",
      role: "coach",
      email,
      password: "supersecret1",
    });
    expect(signup.status, JSON.stringify(signup.body)).toBe(201);

    expect((await recipient.post(`/api/v1/invites/${token}/accept`)).status).toBe(201);
    expect((await recipient.post(`/api/v1/invites/${token}/accept`)).status).toBe(200);

    const ids = invitedTeams.map((team) => team.id);
    const entries = await db
      .select()
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.userId, signup.body.id as string),
          inArray(rosterEntries.teamId, ids),
        ),
      );
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.role === "coach" && entry.status === "accepted")).toBe(
      true,
    );
    const [group] = await db
      .select()
      .from(coachInviteGroups)
      .where(eq(coachInviteGroups.invitedEmail, email))
      .limit(1);
    expect(group.status).toBe("accepted");
    const children = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.coachInviteGroupId, group.id));
    expect(children).toHaveLength(2);
    expect(children.every((child) => child.status === "accepted")).toBe(true);
  });

  it("does not grant a child invitation withdrawn before acceptance", async () => {
    const { agent: manager } = await loginAs((user) => user.role === "admin");
    const { orgId, teams: invitedTeams } = await twoTeamsInOneOrganization();
    const email = `revoked-grouped-coach-${Date.now()}@kinectem.test`;
    const created = await manager
      .post(`/api/v1/organizations/${orgId}/coach-invites`)
      .send({
        assignments: invitedTeams.map((team) => ({ teamId: team.id, email })),
      });
    const token = (created.body.data[0].acceptUrl as string).split("/").pop();
    const [group] = await db
      .select()
      .from(coachInviteGroups)
      .where(eq(coachInviteGroups.invitedEmail, email))
      .limit(1);
    const [withdrawn] = await db
      .select()
      .from(rosterInvites)
      .where(
        and(
          eq(rosterInvites.coachInviteGroupId, group.id),
          eq(rosterInvites.teamId, invitedTeams[0].id),
        ),
      )
      .limit(1);
    const revoke = await manager.delete(
      `/api/v1/teams/${invitedTeams[0].id}/invites/${withdrawn.id}`,
    );
    expect(revoke.status).toBe(200);

    const recipient = request.agent(app);
    const signup = await recipient.post("/api/v1/auth/signup").send({
      firstName: "Revoked",
      lastName: "Coach",
      role: "coach",
      email,
      password: "supersecret1",
    });
    expect(signup.status, JSON.stringify(signup.body)).toBe(201);
    expect((await recipient.post(`/api/v1/invites/${token}/accept`)).status).toBe(201);
    const entries = await db
      .select()
      .from(rosterEntries)
      .where(eq(rosterEntries.userId, signup.body.id as string));
    expect(entries.map((entry) => entry.teamId)).toContain(invitedTeams[1].id);
    expect(entries.map((entry) => entry.teamId)).not.toContain(invitedTeams[0].id);
  });

  it("rejects a grouped token when a different account is signed in", async () => {
    const { agent: manager } = await loginAs((user) => user.role === "admin");
    const { orgId, teams: invitedTeams } = await twoTeamsInOneOrganization();
    const email = `email-bound-grouped-coach-${Date.now()}@kinectem.test`;
    const created = await manager
      .post(`/api/v1/organizations/${orgId}/coach-invites`)
      .send({
        assignments: invitedTeams.map((team) => ({ teamId: team.id, email })),
      });
    const token = (created.body.data[0].acceptUrl as string).split("/").pop();
    const { agent: wrongAccount } = await loginAs(
      (user) => user.email === "marcus@kinectem.demo",
    );

    const accepted = await wrongAccount.post(`/api/v1/invites/${token}/accept`);
    expect(accepted.status).toBe(403);
    expect(accepted.body.error).toContain("different email");
  });

  it("keeps a valid pending invite and copy-link fallback when grouped email delivery fails", async () => {
    const { agent: manager } = await loginAs((user) => user.role === "admin");
    const { orgId, teams: invitedTeams } = await twoTeamsInOneOrganization();
    const email = `delivery-failure-grouped-coach-${Date.now()}@kinectem.test`;
    fetchMock.mockImplementationOnce(async () => new Response("", { status: 500 }));

    const created = await manager
      .post(`/api/v1/organizations/${orgId}/coach-invites`)
      .send({
        assignments: invitedTeams.map((team) => ({ teamId: team.id, email })),
      });
    expect(created.status).toBe(201);
    expect(created.body.data[0].emailSent).toBe(false);
    expect(created.body.data[0].acceptUrl).toContain("/invites/");
    const [group] = await db
      .select()
      .from(coachInviteGroups)
      .where(eq(coachInviteGroups.invitedEmail, email))
      .limit(1);
    expect(group.deliveryStatus).toBe("unknown");
    expect(group.deliveryReason).toBe("Unable to send invite email");
    const children = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.coachInviteGroupId, group.id));
    expect(children).toHaveLength(2);
    expect(children.every((child) => child.deliveryStatus === "unknown")).toBe(
      true,
    );
  });
});