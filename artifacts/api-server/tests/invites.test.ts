import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  notifications,
  organizationFollowers,
  rosterEntries,
  rosterInvites,
  teamFollowers,
  users,
} from "@workspace/db";
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
  //
  // Task #645/#648 — this path only applies to invites that place the matched
  // account on the roster as pending, i.e. *coach/staff* invites. Player
  // invites to an existing account no longer create a roster entry (the
  // matched account is usually the parent), so this test uses a coach invite
  // to exercise the revoke-cleanup-then-reinvite mechanism #646 added.
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
      .send({ email: "morgan@kinectem.demo", position: "coach" });
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
      .send({ email: "morgan@kinectem.demo", position: "coach" });
    expect(second.status).toBe(201);
    const [afterSecond] = await pendingEntry();
    expect(afterSecond?.status).toBe("pending");
    expect(await inviteNoteCount()).toBe(notesBefore + 2);
  });

  // Task #658 — revoking an invite must only ever remove the *pending* paired
  // roster_entry. An already-accepted membership for the same email must be
  // left fully intact, so withdrawing a stray duplicate invite can never evict
  // an active player/coach from the roster.
  it("revoking an invite never deletes an accepted membership", async () => {
    const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();

    const [morgan] = await db
      .select()
      .from(users)
      .where(eq(users.email, "morgan@kinectem.demo"))
      .limit(1);
    expect(morgan).toBeTruthy();

    // Start clean, then plant an ACCEPTED membership for Morgan directly.
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, morgan.id),
        ),
      );
    const [accepted] = await db
      .insert(rosterEntries)
      .values({
        teamId,
        userId: morgan.id,
        role: "coach",
        status: "accepted",
        invitedById: coach.user.id,
      })
      .returning();
    expect(accepted.status).toBe("accepted");

    // Minting a fresh invite for the same email persists the invite row but
    // short-circuits placement (an accepted entry already exists), so the
    // accepted membership is the only roster row.
    const created = await coach.agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "morgan@kinectem.demo", position: "coach" });
    expect(created.status).toBe(201);

    // Revoke the invite — the accepted membership must survive untouched.
    const revoke = await coach.agent.delete(
      `/api/v1/teams/${teamId}/invites/${created.body.id}`,
    );
    expect(revoke.status).toBe(200);
    expect(revoke.body.status).toBe("withdrawn");

    const rows = await db
      .select()
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, morgan.id),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(accepted.id);
    expect(rows[0].status).toBe("accepted");
  });

  // Task #658 — a re-invite of a previously-revoked address must re-fire the
  // full placement fan-out, not silently no-op. The #646 test above covers the
  // pending entry + notification; this asserts the team/org auto-follow is
  // re-established too, even when the prior follow rows were cleared.
  it("re-invite re-fires the team/org auto-follow after revoking", async () => {
    const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();

    const [morgan] = await db
      .select()
      .from(users)
      .where(eq(users.email, "morgan@kinectem.demo"))
      .limit(1);
    expect(morgan).toBeTruthy();

    function teamFollowCount(): Promise<number> {
      return db
        .select()
        .from(teamFollowers)
        .where(
          and(
            eq(teamFollowers.teamId, teamId),
            eq(teamFollowers.userId, morgan.id),
          ),
        )
        .then((rows) => rows.length);
    }
    function orgFollowCount(): Promise<number> {
      return db
        .select()
        .from(organizationFollowers)
        .where(eq(organizationFollowers.userId, morgan.id))
        .then((rows) => rows.length);
    }

    // Clean slate: no roster entry, no team/org follow rows for Morgan.
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, morgan.id),
        ),
      );
    await db
      .delete(teamFollowers)
      .where(
        and(
          eq(teamFollowers.teamId, teamId),
          eq(teamFollowers.userId, morgan.id),
        ),
      );
    await db
      .delete(organizationFollowers)
      .where(eq(organizationFollowers.userId, morgan.id));

    // First coach invite → pending entry + team/org auto-follow.
    const first = await coach.agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "morgan@kinectem.demo", position: "coach" });
    expect(first.status).toBe(201);
    expect(await teamFollowCount()).toBe(1);
    expect(await orgFollowCount()).toBeGreaterThan(0);

    // Revoke clears the pending entry (follow rows are intentionally kept).
    const revoke = await coach.agent.delete(
      `/api/v1/teams/${teamId}/invites/${first.body.id}`,
    );
    expect(revoke.status).toBe(200);

    // Wipe the follow rows so we can prove the re-invite re-creates them
    // rather than relying on the leftovers from the first invite.
    await db
      .delete(teamFollowers)
      .where(
        and(
          eq(teamFollowers.teamId, teamId),
          eq(teamFollowers.userId, morgan.id),
        ),
      );
    await db
      .delete(organizationFollowers)
      .where(eq(organizationFollowers.userId, morgan.id));
    expect(await teamFollowCount()).toBe(0);
    expect(await orgFollowCount()).toBe(0);

    // Re-invite → placement runs again AND the auto-follow re-fires.
    const second = await coach.agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "morgan@kinectem.demo", position: "coach" });
    expect(second.status).toBe(201);

    const [entry] = await db
      .select()
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, morgan.id),
        ),
      )
      .limit(1);
    expect(entry?.status).toBe("pending");
    expect(await teamFollowCount()).toBe(1);
    expect(await orgFollowCount()).toBeGreaterThan(0);
  });

  // Task #648 — guard the Task #645 behavior: a *player* invite to an email
  // that already has a Kinectem account (usually the parent/guardian) must
  // NOT roster that account as the player. No roster entry, no team/org
  // follow — only a `roster_invite` notification deep-linking to the
  // /invites/<token> chooser, fanned out to the recipient AND their parent.
  it("player invite to an existing account creates no roster entry or follow, only a /invites notification", async () => {
    const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();

    // Samira is a seeded minor athlete linked to parent Lisa. She plays
    // basketball, not on Varsity Football — a clean target for a player
    // invite. Clear any stray football roster entry so we start from zero.
    const [samira] = await db
      .select()
      .from(users)
      .where(eq(users.email, "samira@kinectem.demo"))
      .limit(1);
    expect(samira).toBeTruthy();
    expect(samira.parentId).toBeTruthy();
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samira.id),
        ),
      );

    function rosterCount(userId: string): Promise<number> {
      return db
        .select()
        .from(rosterEntries)
        .where(
          and(
            eq(rosterEntries.teamId, teamId),
            eq(rosterEntries.userId, userId),
          ),
        )
        .then((rows) => rows.length);
    }
    function teamFollowCount(userId: string): Promise<number> {
      return db
        .select()
        .from(teamFollowers)
        .where(
          and(
            eq(teamFollowers.teamId, teamId),
            eq(teamFollowers.userId, userId),
          ),
        )
        .then((rows) => rows.length);
    }
    function orgFollowCount(userId: string): Promise<number> {
      return db
        .select()
        .from(organizationFollowers)
        .where(eq(organizationFollowers.userId, userId))
        .then((rows) => rows.length);
    }
    function inviteNotes(userId: string) {
      return db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.kind, "roster_invite"),
          ),
        );
    }

    const samiraRosterBefore = await rosterCount(samira.id);
    const samiraTeamFollowBefore = await teamFollowCount(samira.id);
    const samiraOrgFollowBefore = await orgFollowCount(samira.id);
    const parentTeamFollowBefore = await teamFollowCount(samira.parentId!);
    const parentOrgFollowBefore = await orgFollowCount(samira.parentId!);
    const samiraNotesBefore = (await inviteNotes(samira.id)).length;
    const parentNotesBefore = (await inviteNotes(samira.parentId!)).length;

    const res = await coach.agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "samira@kinectem.demo", position: "player" });
    expect(res.status).toBe(201);
    const token = res.body.token as string;
    expect(token).toBeTruthy();

    // No roster entry is created for the matched (parent) account — it must
    // never surface as a pending player.
    expect(await rosterCount(samira.id)).toBe(samiraRosterBefore);
    // No team/org follow side-effects for the account or its guardian.
    expect(await teamFollowCount(samira.id)).toBe(samiraTeamFollowBefore);
    expect(await orgFollowCount(samira.id)).toBe(samiraOrgFollowBefore);
    expect(await teamFollowCount(samira.parentId!)).toBe(parentTeamFollowBefore);
    expect(await orgFollowCount(samira.parentId!)).toBe(parentOrgFollowBefore);

    // A roster_invite notification deep-linking to the chooser fires for the
    // recipient and (because parentId is set) for their guardian.
    const samiraNotes = await inviteNotes(samira.id);
    expect(samiraNotes.length).toBe(samiraNotesBefore + 1);
    expect(samiraNotes.some((n) => n.link === `/invites/${token}`)).toBe(true);

    const parentNotes = await inviteNotes(samira.parentId!);
    expect(parentNotes.length).toBe(parentNotesBefore + 1);
    expect(parentNotes.some((n) => n.link === `/invites/${token}`)).toBe(true);
  });

  // Task #648 companion — the coach/staff existing-account path is unchanged:
  // it DOES place the matched account on the roster as pending and runs the
  // team/org auto-follow, with a notification deep-linking to the roster row
  // (NOT the /invites chooser).
  it("coach invite to an existing account still creates a pending entry and follows", async () => {
    const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();

    // Morgan is a seeded athlete not on Varsity Football. Clear any prior
    // football roster/follow rows so the invite starts from a clean slate.
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
    await db
      .delete(teamFollowers)
      .where(
        and(
          eq(teamFollowers.teamId, teamId),
          eq(teamFollowers.userId, morgan.id),
        ),
      );

    const res = await coach.agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "morgan@kinectem.demo", position: "coach" });
    expect(res.status).toBe(201);

    // The matched account is rostered as pending coach.
    const [entry] = await db
      .select()
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, morgan.id),
        ),
      )
      .limit(1);
    expect(entry?.status).toBe("pending");
    expect(entry?.role).toBe("coach");

    // Auto-follow side-effects fire: team follow + org follow.
    const teamFollow = await db
      .select()
      .from(teamFollowers)
      .where(
        and(
          eq(teamFollowers.teamId, teamId),
          eq(teamFollowers.userId, morgan.id),
        ),
      );
    expect(teamFollow.length).toBe(1);
    const orgFollow = await db
      .select()
      .from(organizationFollowers)
      .where(eq(organizationFollowers.userId, morgan.id));
    expect(orgFollow.length).toBeGreaterThan(0);

    // The notification deep-links to the roster row, not the /invites chooser.
    const notes = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, morgan.id),
          eq(notifications.kind, "roster_invite"),
        ),
      );
    expect(
      notes.some((n) => (n.link ?? "").includes(`/teams/${teamId}?roster=1`)),
    ).toBe(true);
    expect(notes.every((n) => !(n.link ?? "").startsWith("/invites/"))).toBe(
      true,
    );
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
