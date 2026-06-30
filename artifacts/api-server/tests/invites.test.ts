import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, notifications, rosterEntries, rosterInvites, users } from "@workspace/db";
import { app, loginAs, request } from "./helpers";

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

describe("invites", () => {
  it("lists existing seeded invites for a manager", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const res = await agent.get(`/api/v1/teams/${teamId}/invites`);
    expect(res.status).toBe(200);
    expect(
      res.body.data.find(
        (i: { token: string }) => i.token === "demo-invite-token-001",
      ),
    ).toBeDefined();
  });

  it("requires authentication to list team invites", async () => {
    const teamId = await getFootballTeamId();
    const res = await request(app).get(`/api/v1/teams/${teamId}/invites`);
    expect(res.status).toBe(401);
  });

  it("forbids non-managers from listing team invites", async () => {
    // Pending-invite emails are PII; only org admins or coach-level
    // staff should be able to enumerate them.
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const teamId = await getFootballTeamId();
    const res = await agent.get(`/api/v1/teams/${teamId}/invites`);
    expect(res.status).toBe(403);
  });

  it("looks up an invite by token", async () => {
    const res = await request(app).get(
      "/api/v1/invites/demo-invite-token-001",
    );
    expect(res.status).toBe(200);
    expect(res.body.invite.token).toBe("demo-invite-token-001");
    expect(res.body.team.name).toBe("Varsity Football");
    expect(res.body.organization.name).toBe("Westfield Athletic Club");
  });

  it("404s on an unknown invite token", async () => {
    const res = await request(app).get("/api/v1/invites/no-such-token");
    expect(res.status).toBe(404);
  });

  it("lets a coach send an email invite for their own team", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const res = await agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({
        email: "newperson@example.com",
        position: "player",
        name: "New Person",
      });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("newperson@example.com");
    expect(res.body.token).toBeTruthy();
  });

  it("forbids non-managers from creating email invites", async () => {
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const teamId = await getFootballTeamId();
    const res = await agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "x@x.com", position: "player" });
    expect(res.status).toBe(403);
  });

  async function createPlayerInvite(): Promise<string> {
    // Seed only includes a "Cornerback" position invite. Mint a fresh
    // player-position invite via the coach so we can exercise the
    // parent/child onboarding flow.
    const coachLogin = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const created = await coachLogin.agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({
        email: "player-invite@example.com",
        position: "player",
        name: "Player Invite",
      });
    if (created.status !== 201) {
      throw new Error(`Failed to mint player invite: ${created.status}`);
    }
    return created.body.token as string;
  }

  it("flags player invite acceptance as requiring child setup", async () => {
    const token = await createPlayerInvite();
    const { agent } = await loginAs((u) => u.role === "parent");
    const res = await agent.post(`/api/v1/invites/${token}/accept`);
    expect(res.status).toBe(200);
    expect(res.body.requiresChildSetup).toBe(true);
    expect(res.body.teamId).toBeTruthy();
  });

  it("creates the child athlete and roster entry from an invite", async () => {
    const token = await createPlayerInvite();
    const { agent } = await loginAs((u) => u.role === "parent");
    const res = await agent
      .post(`/api/v1/invites/${token}/children`)
      .send({ firstName: "Riley", lastName: "Carter" });
    expect(res.status).toBe(201);
    expect(res.body.child.firstName).toBe("Riley");
    expect(res.body.child.lastName).toBe("Carter");
    expect(res.body.member.status).toBe("active");

    // Child should now appear under the parent's children list.
    const kids = await agent.get("/api/v1/users/me/children");
    expect(kids.status).toBe(200);
    expect(
      kids.body.data.find((c: { firstName: string }) => c.firstName === "Riley"),
    ).toBeDefined();
  });

  it("requires firstName/lastName when adding a child", async () => {
    const token = await createPlayerInvite();
    const { agent } = await loginAs((u) => u.role === "parent");
    const res = await agent
      .post(`/api/v1/invites/${token}/children`)
      .send({ firstName: "Solo" });
    expect(res.status).toBe(400);
  });

  it("lets a manager withdraw a pending invite", async () => {
    const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const created = await coach.agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "withdraw-me@example.com", position: "player" });
    expect(created.status).toBe(201);
    const inviteId = created.body.id as string;

    const res = await coach.agent.delete(
      `/api/v1/teams/${teamId}/invites/${inviteId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("withdrawn");

    // After withdrawal, the invite's status is reflected as "withdrawn"
    // in the listing (so the team page's pending filter drops it).
    const listed = await coach.agent.get(`/api/v1/teams/${teamId}/invites`);
    expect(listed.status).toBe(200);
    const found = listed.body.data.find(
      (i: { id: string }) => i.id === inviteId,
    );
    expect(found).toBeDefined();
    expect(found.status).toBe("withdrawn");
  });

  it("forbids non-managers from revoking invites", async () => {
    const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const created = await coach.agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "guarded@example.com", position: "player" });
    expect(created.status).toBe(201);
    const inviteId = created.body.id as string;

    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const res = await agent.delete(
      `/api/v1/teams/${teamId}/invites/${inviteId}`,
    );
    expect(res.status).toBe(403);
  });

  // Task #646 — re-inviting an email after revoking the first invite must
  // reach the recipient again. For an existing account this means a fresh
  // pending roster entry + in-app notification; revoking must not leave a
  // dangling pending entry that silently blocks the re-invite.
  it("re-invites an existing account after revoking (notification fires again)", async () => {
    const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();

    // Morgan is a seeded athlete who is NOT on Varsity Football. Clear any
    // prior roster entry so the first invite creates a clean pending row.
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

    function pendingEntry() {
      return db
        .select()
        .from(rosterEntries)
        .where(
          and(
            eq(rosterEntries.teamId, teamId),
            eq(rosterEntries.userId, morgan.id),
          ),
        )
        .limit(1);
    }
    function inviteNoteCount(): Promise<number> {
      return db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, morgan.id),
            eq(notifications.kind, "roster_invite"),
          ),
        )
        .then((rows) => rows.length);
    }

    const notesBefore = await inviteNoteCount();

    // First invite → pending entry + notification.
    const first = await coach.agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "morgan@kinectem.demo", position: "player" });
    expect(first.status).toBe(201);
    const [afterFirst] = await pendingEntry();
    expect(afterFirst?.status).toBe("pending");
    expect(await inviteNoteCount()).toBe(notesBefore + 1);

    // Revoke → the dangling pending entry is cleaned up in the same tx.
    const revoke = await coach.agent.delete(
      `/api/v1/teams/${teamId}/invites/${first.body.id}`,
    );
    expect(revoke.status).toBe(200);
    expect(revoke.body.status).toBe("withdrawn");
    const afterRevoke = await pendingEntry();
    expect(afterRevoke.length).toBe(0);

    // Re-invite → a fresh pending entry AND a new notification fire.
    const second = await coach.agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "morgan@kinectem.demo", position: "player" });
    expect(second.status).toBe(201);
    const [afterSecond] = await pendingEntry();
    expect(afterSecond?.status).toBe("pending");
    expect(await inviteNoteCount()).toBe(notesBefore + 2);
  });

  describe("re-invite for an email with no account", () => {
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

    it("re-sends the coach invite email after revoking", async () => {
      const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
      const teamId = await getFootballTeamId();
      const email = `reinvite-${Date.now()}@example.com`;

      // First invite → one coach invite email.
      fetchMock.mockClear();
      const first = await coach.agent
        .post(`/api/v1/teams/${teamId}/invites`)
        .send({ email, position: "player" });
      expect(first.status).toBe(201);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Revoke (no roster entry exists for an account-less email).
      const revoke = await coach.agent.delete(
        `/api/v1/teams/${teamId}/invites/${first.body.id}`,
      );
      expect(revoke.status).toBe(200);
      expect(revoke.body.status).toBe("withdrawn");

      // Re-invite → the email goes out again.
      fetchMock.mockClear();
      const second = await coach.agent
        .post(`/api/v1/teams/${teamId}/invites`)
        .send({ email, position: "player" });
      expect(second.status).toBe(201);
      expect(second.body.token).toBeTruthy();
      expect(second.body.token).not.toBe(first.body.token);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Two distinct invite rows exist: the first revoked, the second pending.
      const rows = await db
        .select()
        .from(rosterInvites)
        .where(eq(rosterInvites.invitedEmail, email));
      expect(rows.length).toBe(2);
      expect(rows.some((r) => r.status === "revoked")).toBe(true);
      expect(rows.some((r) => r.status === "pending")).toBe(true);
    });
  });
});
