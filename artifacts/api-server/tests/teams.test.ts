import { describe, expect, it } from "vitest";
import { app, loginAs, request } from "./helpers";

async function getOrgAndTeams() {
  const orgsRes = await request(app).get("/api/v1/organizations");
  const org = orgsRes.body.data[0];
  const teamsRes = await request(app).get(
    `/api/v1/organizations/${org.id}/teams`,
  );
  return { org, teams: teamsRes.body.data as Array<{ id: string; name: string }> };
}

describe("teams", () => {
  it("returns teams for an organization with member counts", async () => {
    const { teams } = await getOrgAndTeams();
    expect(teams.length).toBeGreaterThan(0);
    const varsity = teams.find((t) => t.name === "Varsity Football");
    expect(varsity).toBeDefined();
  });

  it("returns the team detail and roster", async () => {
    const { teams } = await getOrgAndTeams();
    const t = teams[0];
    const detail = await request(app).get(`/api/v1/teams/${t.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(t.id);
    const members = await request(app).get(`/api/v1/teams/${t.id}/members`);
    expect(members.status).toBe(200);
    expect(Array.isArray(members.body.data)).toBe(true);
  });

  it("lets an org admin create a new team", async () => {
    const { agent } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const { org } = await getOrgAndTeams();
    const res = await agent
      .post(`/api/v1/organizations/${org.id}/teams`)
      .send({ name: "Test Team", sport: "Soccer", level: "Varsity" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Test Team");
  });

  it("persists, returns, and updates the optional team gender field", async () => {
    const { agent } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const { org } = await getOrgAndTeams();

    // Create with gender — value is stored lowercase and round-trips.
    const created = await agent
      .post(`/api/v1/organizations/${org.id}/teams`)
      .send({ name: "U14 Boys Test", sport: "Soccer", gender: "boys" });
    expect(created.status).toBe(201);
    expect(created.body.gender).toBe("boys");

    // Reading the team returns the gender.
    const detail = await request(app).get(`/api/v1/teams/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.gender).toBe("boys");

    // Update via PATCH switches the gender and clearing with null works.
    const patched = await agent
      .patch(`/api/v1/teams/${created.body.id}`)
      .send({ gender: "coed" });
    expect(patched.status).toBe(200);
    expect(patched.body.gender).toBe("coed");

    const cleared = await agent
      .patch(`/api/v1/teams/${created.body.id}`)
      .send({ gender: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.gender).toBeNull();

    // Invalid value is rejected with a 400 on both endpoints.
    const badCreate = await agent
      .post(`/api/v1/organizations/${org.id}/teams`)
      .send({ name: "Bad Gender", gender: "men" });
    expect(badCreate.status).toBe(400);

    const badPatch = await agent
      .patch(`/api/v1/teams/${created.body.id}`)
      .send({ gender: "men" });
    expect(badPatch.status).toBe(400);

    // A team created without gender stays null (optional everywhere).
    const created2 = await agent
      .post(`/api/v1/organizations/${org.id}/teams`)
      .send({ name: "No Gender Team", sport: "Soccer" });
    expect(created2.status).toBe(201);
    expect(created2.body.gender).toBeNull();
  });

  it("auto-adds the team creator to the roster as an active Admin", async () => {
    // Sam is an org admin who can create teams. We verify that creating
    // the team also lands Sam on the roster as an accepted coach with
    // position "admin", and that Sam can immediately manage the team
    // (e.g. invite another roster member) — proving the existing
    // canManageTeam check picks up the new entry.
    const { agent, user } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const { org } = await getOrgAndTeams();
    const create = await agent
      .post(`/api/v1/organizations/${org.id}/teams`)
      .send({ name: "Creator Admin Team", sport: "Track" });
    expect(create.status).toBe(201);
    const newTeamId = create.body.id as string;

    const members = await agent.get(`/api/v1/teams/${newTeamId}/members`);
    expect(members.status).toBe(200);
    const roster = members.body.data as Array<{
      userId: string;
      position: string;
      status: string;
      role: string;
    }>;
    const mine = roster.find((m) => m.userId === user.id);
    expect(mine).toBeDefined();
    expect(mine!.position).toBe("admin");
    expect(mine!.status).toBe("active");
    expect(mine!.role).toBe("admin");

    // Prove the creator passes the existing "can manage team" check by
    // exercising a coach-only action — adding another roster member.
    const targets = await request(app).get("/api/v1/users?q=Daniela");
    const targetUserId = targets.body.data?.[0]?.id;
    expect(targetUserId).toBeDefined();
    const add = await agent
      .post(`/api/v1/teams/${newTeamId}/members`)
      .send({ userId: targetUserId, position: "player" });
    expect(add.status).toBe(201);
  });

  it("does not notify the creator about their own newly created team", async () => {
    const { agent, user } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const { org } = await getOrgAndTeams();
    const before = await agent.get("/api/v1/notifications");
    const beforeIds = new Set(
      ((before.body?.data ?? []) as Array<{ id: string }>).map((n) => n.id),
    );
    const create = await agent
      .post(`/api/v1/organizations/${org.id}/teams`)
      .send({ name: "No-Notif Team", sport: "Swim" });
    expect(create.status).toBe(201);
    const after = await agent.get("/api/v1/notifications");
    const newOnes = ((after.body?.data ?? []) as Array<{
      id: string;
      kind?: string;
      userId?: string;
    }>).filter((n) => !beforeIds.has(n.id));
    const selfRosterInvites = newOnes.filter(
      (n) => n.kind === "roster_invite" && n.userId === user.id,
    );
    expect(selfRosterInvites).toEqual([]);
  });

  it("treats 'admin' as a coach-level position when added to an existing team", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { teams } = await getOrgAndTeams();
    const target = teams.find((t) => t.name === "JV Football");
    expect(target).toBeDefined();
    const usersList = await request(app).get("/api/v1/users?q=Marcus");
    const userId = usersList.body.data?.[0]?.id ?? usersList.body[0]?.id;
    expect(userId).toBeDefined();
    const res = await agent
      .post(`/api/v1/teams/${target!.id}/members`)
      .send({ userId, position: "admin" });
    expect(res.status).toBe(201);
    expect(res.body.position).toBe("admin");
    expect(res.body.role).toBe("admin");
  });

  it("forbids non-admins from editing a team", async () => {
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const { teams } = await getOrgAndTeams();
    const res = await agent
      .patch(`/api/v1/teams/${teams[0].id}`)
      .send({ name: "Hacked Name" });
    expect(res.status).toBe(403);
  });

  it("lets a coach add a known user to the roster as pending", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { teams } = await getOrgAndTeams();
    const targetTeam = teams.find((t) => t.name === "JV Football");
    expect(targetTeam).toBeDefined();
    // Find a user not currently on JV.
    const usersList = await request(app).get(
      "/api/v1/users?q=Daniela",
    );
    const target = usersList.body.data?.[0] ?? usersList.body[0];
    const userId = target.id;
    const res = await agent
      .post(`/api/v1/teams/${targetTeam!.id}/members`)
      .send({ userId, position: "PG" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
  });

  it("forbids non-managers from adding roster members", async () => {
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const { teams } = await getOrgAndTeams();
    const res = await agent
      .post(`/api/v1/teams/${teams[0].id}/members`)
      .send({ userId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(403);
  });

  // Helper: create a fresh team owned by Sam (so the auto-added creator
  // is the only Admin) so each edit/remove test has its own isolated
  // roster and doesn't drift the seeded data shared by other tests.
  async function freshTeam(name: string) {
    const { agent, user } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const { org } = await getOrgAndTeams();
    const create = await agent
      .post(`/api/v1/organizations/${org.id}/teams`)
      .send({ name, sport: "Soccer" });
    expect(create.status).toBe(201);
    return { agent, user, teamId: create.body.id as string };
  }

  it("lets a team manager change a member's position via PATCH /members/:id", async () => {
    const { agent, teamId } = await freshTeam("Edit Position Team");
    // Add a fresh player we can safely promote without disturbing seeded rows.
    const usersList = await request(app).get("/api/v1/users?q=Marcus");
    const userId = usersList.body.data?.[0]?.id;
    expect(userId).toBeDefined();
    const add = await agent
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId, position: "player" });
    expect(add.status).toBe(201);
    const memberId = add.body.id as string;
    const res = await agent
      .patch(`/api/v1/teams/${teamId}/members/${memberId}`)
      .send({ position: "assistant_coach" });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe("assistant_coach");
    // The spec maps the db `role: "coach"` (which assistant_coach,
    // coach and admin positions all imply) to `"admin"` in the API
    // response, which is how the row gets sorted into the Staff tab.
    expect(res.body.role).toBe("admin");
  });

  it("lets a team manager set, change, and clear a player's jerseyNumber", async () => {
    // The Edit Roster Member dialog now sends jerseyNumber alongside
    // position; this guards the contract end-to-end so the column is
    // persisted, surfaced in the response, and clearable via null.
    const { agent, teamId } = await freshTeam("Edit Jersey Team");
    const usersList = await request(app).get("/api/v1/users?q=Daniela");
    const userId = usersList.body.data?.[0]?.id;
    expect(userId).toBeDefined();
    const add = await agent
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId, position: "player" });
    expect(add.status).toBe(201);
    const memberId = add.body.id as string;
    // New rosters start without a jersey number set.
    expect(add.body.jerseyNumber).toBeNull();

    // Set a number — accepts the value, returns it on the row, and the
    // subsequent GET also reflects it so the roster list will refresh.
    const setRes = await agent
      .patch(`/api/v1/teams/${teamId}/members/${memberId}`)
      .send({ position: "player", jerseyNumber: 23 });
    expect(setRes.status).toBe(200);
    expect(setRes.body.jerseyNumber).toBe(23);
    const list = await request(app).get(`/api/v1/teams/${teamId}/members`);
    const stored = (list.body.data as Array<{ id: string; jerseyNumber: number | null }>)
      .find((m) => m.id === memberId);
    expect(stored?.jerseyNumber).toBe(23);

    // Send only jerseyNumber (no position) — the handler must accept this
    // and only update the jersey column.
    const changeRes = await agent
      .patch(`/api/v1/teams/${teamId}/members/${memberId}`)
      .send({ jerseyNumber: 7 });
    expect(changeRes.status).toBe(200);
    expect(changeRes.body.jerseyNumber).toBe(7);
    expect(changeRes.body.position).toBe("player");

    // Explicit null clears the number back out.
    const clearRes = await agent
      .patch(`/api/v1/teams/${teamId}/members/${memberId}`)
      .send({ jerseyNumber: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.jerseyNumber).toBeNull();
  });

  it("rejects out-of-range or non-integer jerseyNumber values", async () => {
    const { agent, teamId } = await freshTeam("Bad Jersey Team");
    const usersList = await request(app).get("/api/v1/users?q=Marcus");
    const userId = usersList.body.data?.[0]?.id;
    expect(userId).toBeDefined();
    const add = await agent
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId, position: "player" });
    expect(add.status).toBe(201);
    const memberId = add.body.id as string;

    for (const bad of [-1, 1000, 1.5, "12", true]) {
      const res = await agent
        .patch(`/api/v1/teams/${teamId}/members/${memberId}`)
        .send({ jerseyNumber: bad });
      expect(res.status).toBe(400);
    }
  });

  it("lets an accepted team coach (no org-admin role) manage members", async () => {
    // Reproduces the bug surfaced by code review: the backend lets
    // accepted team coaches manage their roster, so this path must work
    // end-to-end too — the UI now mirrors this with `canManage`.
    const { agent: samAgent, teamId } = await freshTeam("Coach Manage Team");

    // Promote Marcus (an athlete with no org-admin role) into the
    // team's coaching staff and have him accept the invite himself.
    const usersList = await request(app).get("/api/v1/users?q=Marcus");
    const marcusId = usersList.body.data?.[0]?.id;
    expect(marcusId).toBeDefined();
    const addCoach = await samAgent
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: marcusId, position: "coach" });
    expect(addCoach.status).toBe(201);
    const coachMemberId = addCoach.body.id as string;
    const { agent: marcusAgent } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const accept = await marcusAgent.post(
      `/api/v1/teams/${teamId}/members/${coachMemberId}/accept`,
    );
    expect(accept.status).toBe(200);

    // Add a fresh player Marcus can edit + remove without disturbing
    // the seeded roster.
    const danielaList = await request(app).get("/api/v1/users?q=Daniela");
    const danielaId = danielaList.body.data?.[0]?.id;
    expect(danielaId).toBeDefined();
    const addPlayer = await samAgent
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: danielaId, position: "player" });
    expect(addPlayer.status).toBe(201);
    const playerMemberId = addPlayer.body.id as string;

    const patch = await marcusAgent
      .patch(`/api/v1/teams/${teamId}/members/${playerMemberId}`)
      .send({ position: "assistant_coach" });
    expect(patch.status).toBe(200);
    expect(patch.body.position).toBe("assistant_coach");

    const del = await marcusAgent.delete(
      `/api/v1/teams/${teamId}/members/${playerMemberId}`,
    );
    expect(del.status).toBe(204);
  });

  it("forbids accepted non-coach staff (e.g. team manager) from PATCH/DELETE", async () => {
    // The Staff tab in the UI groups every non-player position
    // together (manager, parent, author, coach, assistant_coach,
    // admin), but the server only treats role==="coach" entries as
    // managers via canManageTeam. This test pins down that distinction
    // so a future refactor can't silently grant manager rights to
    // "manager"/"parent"/"author" positions.
    const { agent: samAgent, teamId } = await freshTeam("Non-coach Staff Team");
    const usersList = await request(app).get("/api/v1/users?q=Marcus");
    const marcusId = usersList.body.data?.[0]?.id;
    expect(marcusId).toBeDefined();
    const addManager = await samAgent
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: marcusId, position: "manager" });
    expect(addManager.status).toBe(201);
    const managerMemberId = addManager.body.id as string;
    const { agent: marcusAgent } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const accept = await marcusAgent.post(
      `/api/v1/teams/${teamId}/members/${managerMemberId}/accept`,
    );
    expect(accept.status).toBe(200);

    // Marcus is now an accepted "manager" — he shows up on Staff but
    // canManageTeam is still false, so PATCH/DELETE on any other member
    // must be 403.
    const danielaList = await request(app).get("/api/v1/users?q=Daniela");
    const danielaId = danielaList.body.data?.[0]?.id;
    expect(danielaId).toBeDefined();
    const addPlayer = await samAgent
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: danielaId, position: "player" });
    expect(addPlayer.status).toBe(201);
    const playerMemberId = addPlayer.body.id as string;

    const patch = await marcusAgent
      .patch(`/api/v1/teams/${teamId}/members/${playerMemberId}`)
      .send({ position: "assistant_coach" });
    expect(patch.status).toBe(403);
    const del = await marcusAgent.delete(
      `/api/v1/teams/${teamId}/members/${playerMemberId}`,
    );
    expect(del.status).toBe(403);
  });

  it("lets a team manager remove a member via DELETE /members/:id", async () => {
    const { agent, teamId } = await freshTeam("Remove Member Team");
    const usersList = await request(app).get("/api/v1/users?q=Daniela");
    const userId = usersList.body.data?.[0]?.id;
    expect(userId).toBeDefined();
    const add = await agent
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId, position: "player" });
    expect(add.status).toBe(201);
    const memberId = add.body.id as string;
    const del = await agent.delete(
      `/api/v1/teams/${teamId}/members/${memberId}`,
    );
    expect(del.status).toBe(204);
    const after = await agent.get(`/api/v1/teams/${teamId}/members`);
    const stillThere = (after.body.data as Array<{ id: string }>).some(
      (m) => m.id === memberId,
    );
    expect(stillThere).toBe(false);
  });

  it("forbids non-managers from editing or removing a member", async () => {
    const { agent: samAgent, teamId } = await freshTeam("Forbidden Edit Team");
    // Add Marcus so we have a known target row, then switch to his
    // session — he has no team-management rights so both PATCH and
    // DELETE must be rejected with 403.
    const usersList = await request(app).get("/api/v1/users?q=Marcus");
    const userId = usersList.body.data?.[0]?.id;
    expect(userId).toBeDefined();
    const add = await samAgent
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId, position: "player" });
    expect(add.status).toBe(201);
    const memberId = add.body.id as string;

    const { agent: marcusAgent } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const patch = await marcusAgent
      .patch(`/api/v1/teams/${teamId}/members/${memberId}`)
      .send({ position: "assistant_coach" });
    expect(patch.status).toBe(403);
    const del = await marcusAgent.delete(
      `/api/v1/teams/${teamId}/members/${memberId}`,
    );
    expect(del.status).toBe(403);
  });

  it("blocks demoting or removing the last accepted Admin on a team", async () => {
    // The team-creation flow auto-adds the creator as the only accepted
    // Admin, which is exactly the "last Admin" scenario we want to test.
    const { agent: samAgent, user: sam, teamId } = await freshTeam(
      "Last Admin Team",
    );
    const members = await samAgent.get(`/api/v1/teams/${teamId}/members`);
    const samEntry = (members.body.data as Array<{
      id: string;
      userId: string;
      position: string;
    }>).find((m) => m.userId === sam.id);
    expect(samEntry).toBeDefined();
    expect(samEntry!.position).toBe("admin");

    // Demoting the last Admin must be refused.
    const demote = await samAgent
      .patch(`/api/v1/teams/${teamId}/members/${samEntry!.id}`)
      .send({ position: "coach" });
    expect(demote.status).toBe(422);
    expect(String(demote.body?.error ?? "")).toMatch(/at least one Admin/i);

    // Removing the last Admin must be refused too.
    const del = await samAgent.delete(
      `/api/v1/teams/${teamId}/members/${samEntry!.id}`,
    );
    expect(del.status).toBe(422);
    expect(String(del.body?.error ?? "")).toMatch(/at least one Admin/i);

    // Once a second accepted Admin is in place, the original Admin can
    // be removed — this proves the rule unblocks itself once the
    // invariant is satisfied. The invited Admin must accept their spot
    // first because pending entries don't count toward the Admin total.
    const others = await request(app).get("/api/v1/users?q=Daniela");
    const otherId = others.body.data?.[0]?.id;
    expect(otherId).toBeDefined();
    const add = await samAgent
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: otherId, position: "admin" });
    expect(add.status).toBe(201);
    const newAdminId = add.body.id as string;
    const { agent: otherAgent } = await loginAs(
      (u) => u.email === "daniela@kinectem.demo",
    );
    const acceptByInvitee = await otherAgent.post(
      `/api/v1/teams/${teamId}/members/${newAdminId}/accept`,
    );
    expect(acceptByInvitee.status).toBe(200);

    const removeOriginal = await samAgent.delete(
      `/api/v1/teams/${teamId}/members/${samEntry!.id}`,
    );
    expect(removeOriginal.status).toBe(204);
  });

  it("lets the invited player accept their own roster entry", async () => {
    // Samira (child) has a pending entry on Varsity Boys Basketball.
    const { agent, user } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    const { teams } = await getOrgAndTeams();
    const basketball = teams.find((t) =>
      t.name.includes("Basketball"),
    );
    expect(basketball).toBeDefined();
    const members = await request(app).get(
      `/api/v1/teams/${basketball!.id}/members`,
    );
    const myEntry = members.body.data.find(
      (m: { userId?: string; user?: { id?: string }; id?: string }) =>
        m.userId === user.id || m.user?.id === user.id,
    );
    expect(myEntry).toBeDefined();
    const res = await agent.post(
      `/api/v1/teams/${basketball!.id}/members/${myEntry.id}/accept`,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });

  // ---------------------------------------------------------------------
  // Task #218: only org owners/admins can create teams
  // ---------------------------------------------------------------------
  describe("POST /organizations/:orgId/teams permissions", () => {
    // Spin up a fresh org owned by Sam, then approve `joiner` into it
    // with the requested role. Returns the new orgId.
    async function freshOrgWithJoiner(
      joinerEmail: string,
      role: "admin" | "member",
    ): Promise<{ orgId: string }> {
      const { agent: ownerAgent } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const created = await ownerAgent
        .post("/api/v1/organizations")
        .send({
          name: `T218 Org ${Math.random().toString(36).slice(2, 8)}`,
          city: "Westfield",
          state: "NJ",
          zipCode: "07090",
        });
      expect(created.status).toBe(201);
      const orgId: string = created.body.id;
      const { agent: joinerAgent } = await loginAs(
        (u) => u.email === joinerEmail,
      );
      const jr = await joinerAgent
        .post(`/api/v1/organizations/${orgId}/join-requests`)
        .send({});
      expect(jr.status).toBe(201);
      const approve = await ownerAgent
        .post(
          `/api/v1/organizations/${orgId}/join-requests/${jr.body.id}/approve`,
        )
        .send({ role });
      expect(approve.status).toBe(200);
      return { orgId };
    }

    it("lets an org admin (not owner) create a team", async () => {
      const { orgId } = await freshOrgWithJoiner(
        "marcus@kinectem.demo",
        "admin",
      );
      const { agent: marcusAgent, user: marcus } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      const res = await marcusAgent
        .post(`/api/v1/organizations/${orgId}/teams`)
        .send({ name: "Admin-Created Team", sport: "Track" });
      expect(res.status).toBe(201);
      // The admin who created the team should be on the roster as Admin.
      const members = await marcusAgent.get(
        `/api/v1/teams/${res.body.id}/members`,
      );
      const mine = (members.body.data as Array<{
        userId: string;
        position: string;
        status: string;
      }>).find((m) => m.userId === marcus.id);
      expect(mine?.position).toBe("admin");
    });

    it("forbids a plain org member from creating a team", async () => {
      const { orgId } = await freshOrgWithJoiner(
        "marcus@kinectem.demo",
        "member",
      );
      const { agent: marcusAgent, user: marcus } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      const before = await request(app).get(
        `/api/v1/organizations/${orgId}/teams`,
      );
      const beforeCount = (before.body.data as unknown[]).length;
      const res = await marcusAgent
        .post(`/api/v1/organizations/${orgId}/teams`)
        .send({ name: "Should Not Exist" });
      expect(res.status).toBe(403);
      expect(res.body?.error).toBe(
        "Only organization admins can create teams",
      );
      // No team was inserted by the failed call.
      const after = await request(app).get(
        `/api/v1/organizations/${orgId}/teams`,
      );
      expect((after.body.data as unknown[]).length).toBe(beforeCount);
      // And no auto-staff roster row was inserted for Marcus on any
      // team in this org — proves the transaction never opened.
      const teamsAfter = after.body.data as Array<{ id: string }>;
      for (const t of teamsAfter) {
        const members = await request(app).get(
          `/api/v1/teams/${t.id}/members`,
        );
        const mine = (members.body.data as Array<{ userId: string }>).find(
          (m) => m.userId === marcus.id,
        );
        expect(mine).toBeUndefined();
      }
    });

    it("forbids a user with no relationship to the org from creating a team", async () => {
      // Marcus has no admin/owner role on the seeded Westfield org.
      const orgsRes = await request(app).get("/api/v1/organizations");
      const westfield = (orgsRes.body.data as Array<{
        id: string;
        name: string;
      }>).find((o) => o.name.includes("Westfield"));
      expect(westfield).toBeDefined();
      const { agent } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      const res = await agent
        .post(`/api/v1/organizations/${westfield!.id}/teams`)
        .send({ name: "Stranger Team" });
      expect(res.status).toBe(403);
    });

    it("requires authentication", async () => {
      const orgsRes = await request(app).get("/api/v1/organizations");
      const orgId = orgsRes.body.data[0].id;
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/teams`)
        .send({ name: "Anon Team" });
      expect(res.status).toBe(401);
    });

    it("404s on an unknown organization (still gated)", async () => {
      const { agent } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const res = await agent
        .post(
          "/api/v1/organizations/00000000-0000-0000-0000-000000000000/teams",
        )
        .send({ name: "Ghost Team" });
      expect(res.status).toBe(404);
    });
  });
});
