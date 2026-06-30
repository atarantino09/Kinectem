import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, notifications, rosterEntries, rosterInvites, users } from "@workspace/db";
import { app, loginAs, request } from "./helpers";

// Task #655 — re-send an invite that didn't arrive.
//
// `POST /teams/:teamId/invites/:inviteId/resend` re-triggers delivery for an
// existing pending invite WITHOUT minting a new token or creating duplicate
// roster rows, and reports the same `emailSent` outcome as the original send:
//   - unknown address  → re-sends the coach email (emailSent true/false)
//   - known address    → re-fires the in-app notification (emailSent null)
// We stub the SendGrid env + global `fetch` (mirrors coach-invite-email.test)
// so the genuine helper renders and "sends".
async function getFootballTeamId(): Promise<string> {
  const orgs = await request(app).get("/api/v1/organizations");
  const org = orgs.body.data[0];
  const teams = await request(app).get(
    `/api/v1/organizations/${org.id}/teams`,
  );
  const t = teams.body.data.find(
    (x: { name: string }) => x.name === "Varsity Football",
  );
  if (!t) throw new Error("Varsity Football missing from seed");
  return t.id;
}

describe("coach invite resend (task #655)", () => {
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

  it("re-emails an unknown address, reusing the same token (emailSent true)", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const email = `resend-${Date.now()}@example.com`;

    const created = await agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email, position: "player" });
    expect(created.status).toBe(201);
    const inviteId = created.body.id as string;
    const token = created.body.token as string;

    fetchMock.mockClear();
    const res = await agent.post(
      `/api/v1/teams/${teamId}/invites/${inviteId}/resend`,
    );
    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(true);
    // No new token / row — the same invite is reused.
    expect(res.body.id).toBe(inviteId);
    expect(res.body.token).toBe(token);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Exactly one invite row still exists for this address.
    const rows = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.invitedEmail, email));
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe(token);
  });

  it("re-fires the in-app notification (no email) for a known address", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();

    const [morgan] = await db
      .select()
      .from(users)
      .where(eq(users.email, "morgan@kinectem.demo"))
      .limit(1);
    expect(morgan).toBeTruthy();
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, morgan.id),
        ),
      );

    const created = await agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "morgan@kinectem.demo", position: "coach" });
    expect(created.status).toBe(201);
    const inviteId = created.body.id as string;

    const before = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, morgan.id),
          eq(notifications.kind, "roster_invite"),
        ),
      );

    fetchMock.mockClear();
    const res = await agent.post(
      `/api/v1/teams/${teamId}/invites/${inviteId}/resend`,
    );
    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBeNull();
    // Known address → no email.
    expect(fetchMock).not.toHaveBeenCalled();

    // A fresh in-app notification was written.
    const after = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, morgan.id),
          eq(notifications.kind, "roster_invite"),
        ),
      );
    expect(after.length).toBe(before.length + 1);

    // No duplicate roster rows were created by the resend.
    const entries = await db
      .select()
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, morgan.id),
        ),
      );
    expect(entries).toHaveLength(1);
  });

  it("reports emailSent false when re-delivery fails (invite stays pending)", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const email = `resend-fail-${Date.now()}@example.com`;

    const created = await agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email, position: "player" });
    expect(created.status).toBe(201);
    const inviteId = created.body.id as string;

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const res = await agent.post(
      `/api/v1/teams/${teamId}/invites/${inviteId}/resend`,
    );
    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(false);

    const [invite] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.id, inviteId))
      .limit(1);
    expect(invite.status).toBe("pending");
  });

  it("409s when the invite is no longer pending", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const email = `resend-withdrawn-${Date.now()}@example.com`;

    const created = await agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email, position: "player" });
    expect(created.status).toBe(201);
    const inviteId = created.body.id as string;

    // Withdraw it, then a resend has nothing to re-deliver.
    const del = await agent.delete(
      `/api/v1/teams/${teamId}/invites/${inviteId}`,
    );
    expect(del.status).toBe(200);

    const res = await agent.post(
      `/api/v1/teams/${teamId}/invites/${inviteId}/resend`,
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("invite_not_pending");
  });

  it("403s for a non-manager", async () => {
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const teamId = await getFootballTeamId();
    const email = `resend-403-${Date.now()}@example.com`;
    const created = await coach
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email, position: "player" });
    expect(created.status).toBe(201);
    const inviteId = created.body.id as string;

    const { agent: athlete } = await loginAs(
      (u) => u.email === "morgan@kinectem.demo",
    );
    const res = await athlete.post(
      `/api/v1/teams/${teamId}/invites/${inviteId}/resend`,
    );
    expect(res.status).toBe(403);
  });
});
