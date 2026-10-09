// Regression coverage for the team archive flow. Pins down organization
// owner/admin and effective platform-admin archive/unarchive, the visibility
// filter on every read surface that lists teams, and the 409
// `team_archived` block on every write surface that targets a team.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  adminActivityLog,
  db,
  organizationAdmins,
  teams,
  users,
  rosterEntries,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";

// The DB schema's `actionType` enum union does not (yet) include
// "archive_team" / "unarchive_team" — the route handler inserts the
// string directly and the typecheck mismatch is tracked under the
// pre-existing "Fix backend type errors" task. We narrow with a
// runtime string compare instead of a typed `eq()` so this test file
// stays compatible until the union is widened.
type ActionType = (typeof adminActivityLog.$inferSelect)["actionType"];
const ARCHIVE_ACTION = "archive_team" as ActionType;
const UNARCHIVE_ACTION = "unarchive_team" as ActionType;

async function getOrg() {
  const orgsRes = await request(app).get("/api/v1/organizations");
  return orgsRes.body.data[0] as { id: string; name: string };
}

async function getTeams(orgId: string) {
  const res = await request(app).get(`/api/v1/organizations/${orgId}/teams`);
  return res.body.data as Array<{ id: string; name: string }>;
}

// Add a "plain member" of the org to test the member rejection path.
// Seed only ships an owner (sam) and an admin (coachDavis); inserting
// directly avoids dragging unrelated routes into the setup.
async function addOrgMember(orgId: string, userId: string) {
  await db
    .insert(organizationAdmins)
    .values({ organizationId: orgId, userId, role: "member" });
}

async function archiveTeam(teamId: string) {
  const { agent } = await loginAs((u) => u.email === "sam@kinectem.demo");
  const res = await agent.post(`/api/v1/teams/${teamId}/archive`);
  expect(res.status).toBe(200);
}

describe("team archive flow", () => {
  describe("DELETE /teams/:teamId", () => {
    it("requires archiving first, even for an empty team", async () => {
      const org = await getOrg();
      const [emptyTeam] = await db
        .insert(teams)
        .values({
          organizationId: org.id,
          name: `Empty mistaken team ${Date.now()}`,
        })
        .returning();
      const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");

      const res = await agent.delete(`/api/v1/teams/${emptyTeam.id}`).send({
        confirmTeamName: emptyTeam.name, acknowledgePermanentDeletion: true,
      });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("team_not_archived");
      const remaining = await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.id, emptyTeam.id));
      expect(remaining).toHaveLength(1);
    });

    it.each(["coach@kinectem.demo", "sam@kinectem.demo"])("lets an authorized admin (%s) delete an archived team with members only after explicit confirmation", async (email) => {
      const org = await getOrg();
      const [target] = await getTeams(org.id);
      const { agent, user } = await loginAs(email);
      if (user.role === "admin") await db.delete(organizationAdmins).where(eq(organizationAdmins.userId, user.id));
      expect(await db.select().from(rosterEntries).where(eq(rosterEntries.teamId, target.id))).not.toHaveLength(0);

      const archived = await agent.post(`/api/v1/teams/${target.id}/archive`);
      expect(archived.status).toBe(200);
      for (const body of [
        {},
        { confirmTeamName: "Wrong name", acknowledgePermanentDeletion: true },
        { confirmTeamName: target.name, acknowledgePermanentDeletion: false },
        { confirmTeamName: target.name },
        { acknowledgePermanentDeletion: true },
        { confirmTeamName: target.name, acknowledgePermanentDeletion: "true" },
      ]) {
        const blocked = await agent.delete(`/api/v1/teams/${target.id}`).send(body);
        expect(blocked.status).toBe(400);
        expect(blocked.body.code).toBe("team_delete_not_confirmed");
      }
      const res = await agent.delete(`/api/v1/teams/${target.id}`).send({
        confirmTeamName: target.name, acknowledgePermanentDeletion: true,
      });
      expect(res.status).toBe(204);
      expect(await db.select().from(teams).where(eq(teams.id, target.id))).toHaveLength(0);
      expect((await agent.get(`/api/v1/organizations/${org.id}/teams/archived`)).body.data.map((t: { id: string }) => t.id)).not.toContain(target.id);
      expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(1);
    });

    it("rejects a coach, ordinary member, anonymous caller, and non-admin masquerade target", async () => {
      const org = await getOrg();
      const [target] = await getTeams(org.id);
      await archiveTeam(target.id);
      const coach = await loginAs("coach@kinectem.demo");
      await db.delete(organizationAdmins).where(eq(organizationAdmins.userId, coach.user.id));
      const member = await loginAs("marcus@kinectem.demo");
      await addOrgMember(org.id, member.user.id);
      for (const email of ["coach@kinectem.demo", "marcus@kinectem.demo", "daniela@kinectem.demo"]) {
        const { agent } = await loginAs(email);
        const res = await agent.delete(`/api/v1/teams/${target.id}`).send({
          confirmTeamName: target.name, acknowledgePermanentDeletion: true,
        });
        expect(res.status).toBe(403);
      }
      const body = { confirmTeamName: target.name, acknowledgePermanentDeletion: true };
      expect((await request(app).delete(`/api/v1/teams/${target.id}`).send(body)).status).toBe(401);
      const platform = await loginAs("sam@kinectem.demo");
      expect((await platform.agent.post(`/api/v1/admin/masquerade/${member.user.id}/start`)).status).toBe(200);
      expect((await platform.agent.delete(`/api/v1/teams/${target.id}`).send(body)).status).toBe(403);
      expect(await db.select().from(teams).where(eq(teams.id, target.id))).toHaveLength(1);
    });

    it.each(["platform", "organization", "moved", "renamed", "restored"])("rechecks %s authority/state after preflight under the deletion lock", async (change) => {
      const org = await getOrg();
      const [target] = await getTeams(org.id);
      await archiveTeam(target.id);
      const actor = await loginAs(change === "platform" ? "sam@kinectem.demo" : "coach@kinectem.demo");
      if (change === "platform") await db.delete(organizationAdmins).where(eq(organizationAdmins.userId, actor.user.id));
      const original = db.transaction.bind(db);
      const spy = vi.spyOn(db, "transaction").mockImplementationOnce(async (callback, config) => {
        if (change === "platform") await db.update(users).set({ role: "coach" }).where(eq(users.id, actor.user.id));
        if (change === "organization") await db.delete(organizationAdmins).where(eq(organizationAdmins.userId, actor.user.id));
        if (change === "moved") await db.update(teams).set({ organizationId: null }).where(eq(teams.id, target.id));
        if (change === "renamed") await db.update(teams).set({ name: "Changed current name" }).where(eq(teams.id, target.id));
        if (change === "restored") await db.update(teams).set({ archivedAt: null }).where(eq(teams.id, target.id));
        return original(callback, config);
      });
      try {
        const response = await actor.agent.delete(`/api/v1/teams/${target.id}`).send({
          confirmTeamName: target.name, acknowledgePermanentDeletion: true,
        });
        expect(response.status).toBe(change === "renamed" ? 400 : change === "restored" ? 409 : 403);
        expect(await db.select().from(teams).where(eq(teams.id, target.id))).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });

    it("allows a stored organization owner without platform authority", async () => {
      const org = await getOrg();
      const [target] = await getTeams(org.id);
      const actor = await loginAs("sam@kinectem.demo");
      await db.update(users).set({ role: "coach" }).where(eq(users.id, actor.user.id));
      expect((await actor.agent.post(`/api/v1/teams/${target.id}/archive`)).status).toBe(200);
      expect((await actor.agent.delete(`/api/v1/teams/${target.id}`).send({
        confirmTeamName: target.name, acknowledgePermanentDeletion: true,
      })).status).toBe(204);
    });
  });

  describe("POST /teams/:teamId/archive permissions", () => {
    it("lets a platform-only admin archive, restore and view teams without gaining membership", async () => {
      const org = await getOrg();
      const [target] = await getTeams(org.id);
      const actor = await loginAs("sam@kinectem.demo");
      await db.delete(organizationAdmins).where(eq(organizationAdmins.userId, actor.user.id));
      await db.delete(rosterEntries).where(eq(rosterEntries.userId, actor.user.id));
      const body = { confirmTeamName: target.name, acknowledgePermanentDeletion: true };
      expect((await actor.agent.delete(`/api/v1/teams/${target.id}`).send(body)).status).toBe(409);
      expect((await actor.agent.post(`/api/v1/teams/${target.id}/archive`)).status).toBe(200);
      expect((await actor.agent.get(`/api/v1/teams/${target.id}`)).status).toBe(200);
      expect((await actor.agent.post(`/api/v1/teams/${target.id}/unarchive`)).status).toBe(200);
      expect(await db.select().from(organizationAdmins).where(eq(organizationAdmins.userId, actor.user.id))).toHaveLength(0);
      expect(await db.select().from(rosterEntries).where(eq(rosterEntries.userId, actor.user.id))).toHaveLength(0);
    });

    it("denies archive and restore to a coach-only masquerade target and keeps standalone teams out of this flow", async () => {
      const org = await getOrg();
      const [target] = await getTeams(org.id);
      const coach = await loginAs("coach@kinectem.demo");
      await db.delete(organizationAdmins).where(eq(organizationAdmins.userId, coach.user.id));
      for (const action of ["archive", "unarchive"]) {
        expect((await coach.agent.post(`/api/v1/teams/${target.id}/${action}`)).status).toBe(404);
      }
      const platform = await loginAs("sam@kinectem.demo");
      const [solo] = await db.insert(teams).values({ name: "Standalone safety" }).returning();
      expect((await platform.agent.post(`/api/v1/teams/${solo.id}/archive`)).status).toBe(404);
      expect((await platform.agent.delete(`/api/v1/teams/${solo.id}`).send({
        confirmTeamName: solo.name, acknowledgePermanentDeletion: true,
      })).status).toBe(403);
      expect((await platform.agent.post(`/api/v1/admin/masquerade/${coach.user.id}/start`)).status).toBe(200);
      for (const action of ["archive", "unarchive"]) {
        expect((await platform.agent.post(`/api/v1/teams/${target.id}/${action}`)).status).toBe(404);
      }
    });
    it("lets the org owner archive and unarchive (idempotent)", async () => {
      const org = await getOrg();
      const teamsList = await getTeams(org.id);
      const target = teamsList[0];
      const { agent } = await loginAs((u) => u.email === "sam@kinectem.demo");

      const arch1 = await agent.post(`/api/v1/teams/${target.id}/archive`);
      expect(arch1.status).toBe(200);
      // Second archive call must be a no-op success (idempotent).
      const arch2 = await agent.post(`/api/v1/teams/${target.id}/archive`);
      expect(arch2.status).toBe(200);

      const archiveRows1 = (
        await db
          .select()
          .from(adminActivityLog)
          .where(eq(adminActivityLog.targetId, target.id))
      ).filter((r) => r.actionType === ARCHIVE_ACTION);
      expect(archiveRows1.length).toBe(1);

      const un1 = await agent.post(`/api/v1/teams/${target.id}/unarchive`);
      expect(un1.status).toBe(200);
      const un2 = await agent.post(`/api/v1/teams/${target.id}/unarchive`);
      expect(un2.status).toBe(200);

      const unarchiveRows1 = (
        await db
          .select()
          .from(adminActivityLog)
          .where(eq(adminActivityLog.targetId, target.id))
      ).filter((r) => r.actionType === UNARCHIVE_ACTION);
      expect(unarchiveRows1.length).toBe(1);
    });

    it("lets organization admins archive teams", async () => {
      const org = await getOrg();
      const teamsList = await getTeams(org.id);
      const target = teamsList[0];
      // coachDavis is an org admin (not owner) of Westfield.
      const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
      const res = await agent.post(`/api/v1/teams/${target.id}/archive`);
      expect(res.status).toBe(200);
    });

    it("forbids plain organization members", async () => {
      const org = await getOrg();
      const teamsList = await getTeams(org.id);
      const target = teamsList[0];
      const { agent, user } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      await addOrgMember(org.id, user.id);
      const res = await agent.post(`/api/v1/teams/${target.id}/archive`);
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe("FORBIDDEN");
    });

    it("returns 404 to non-members of the org (no existence leak)", async () => {
      const org = await getOrg();
      const teamsList = await getTeams(org.id);
      const target = teamsList[0];
      const { agent } = await loginAs(
        (u) => u.email === "daniela@kinectem.demo",
      );
      const res = await agent.post(`/api/v1/teams/${target.id}/archive`);
      expect(res.status).toBe(404);
    });

    it("rejects unauthenticated archive attempts with 401", async () => {
      const org = await getOrg();
      const teamsList = await getTeams(org.id);
      const target = teamsList[0];
      const res = await request(app).post(
        `/api/v1/teams/${target.id}/archive`,
      );
      expect(res.status).toBe(401);
    });
  });

  // Symmetric permission coverage for the unarchive endpoint. The route
  // shares `loadTeamForArchiveAction` with archive, but a future
  // refactor could split them; pinning down both sides keeps the
  // removal-authority invariant honest end-to-end.
  describe("POST /teams/:teamId/unarchive permissions", () => {
    async function setupArchivedTeam(): Promise<string> {
      const org = await getOrg();
      const teamsList = await getTeams(org.id);
      const target = teamsList[0];
      await archiveTeam(target.id);
      return target.id;
    }

    it("lets organization admins unarchive teams", async () => {
      const teamId = await setupArchivedTeam();
      const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
      const res = await agent.post(`/api/v1/teams/${teamId}/unarchive`);
      expect(res.status).toBe(200);
    });

    it("forbids plain organization members", async () => {
      const teamId = await setupArchivedTeam();
      const org = await getOrg();
      const { agent, user } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      await addOrgMember(org.id, user.id);
      const res = await agent.post(`/api/v1/teams/${teamId}/unarchive`);
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe("FORBIDDEN");
    });

    it("returns 404 to non-members of the org (no existence leak)", async () => {
      const teamId = await setupArchivedTeam();
      const { agent } = await loginAs(
        (u) => u.email === "daniela@kinectem.demo",
      );
      const res = await agent.post(`/api/v1/teams/${teamId}/unarchive`);
      expect(res.status).toBe(404);
    });

    it("rejects unauthenticated unarchive attempts with 401", async () => {
      const teamId = await setupArchivedTeam();
      const res = await request(app).post(
        `/api/v1/teams/${teamId}/unarchive`,
      );
      expect(res.status).toBe(401);
    });
  });

  describe("read-side visibility of archived teams", () => {
    let orgId: string;
    let archivedTeamId: string;
    let archivedTeamName: string;

    beforeEach(async () => {
      const org = await getOrg();
      orgId = org.id;
      const teamsList = await getTeams(orgId);
      // Pick "JV Football" — a less central seed team — so other
      // describe blocks can keep using Varsity Football undisturbed.
      const target = teamsList.find((t) => t.name === "JV Football");
      expect(target).toBeDefined();
      archivedTeamId = target!.id;
      archivedTeamName = target!.name;
      await archiveTeam(archivedTeamId);
    });

    it("GET /teams/:teamId returns 404 to non-managers", async () => {
      const anon = await request(app).get(`/api/v1/teams/${archivedTeamId}`);
      expect(anon.status).toBe(404);

      // Tyler is rostered on JV Football but has no org-management role —
      // archived teams must hide from regular roster members too.
      const { agent: tyler } = await loginAs(
        (u) => u.email === "tyler@kinectem.demo",
      );
      const memberView = await tyler.get(`/api/v1/teams/${archivedTeamId}`);
      expect(memberView.status).toBe(404);
    });

    it("GET /teams/:teamId still surfaces the row to org owner/admin", async () => {
      const { agent: sam } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const ownerView = await sam.get(`/api/v1/teams/${archivedTeamId}`);
      expect(ownerView.status).toBe(200);
      expect(ownerView.body.id).toBe(archivedTeamId);

      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const adminView = await coach.get(`/api/v1/teams/${archivedTeamId}`);
      expect(adminView.status).toBe(200);
    });

    it("GET /organizations/:orgId/teams hides archived teams from everyone", async () => {
      // Even the org owner should not see the archived team in the
      // public list — that's the whole point of the dedicated
      // /teams/archived endpoint.
      const anon = await request(app).get(
        `/api/v1/organizations/${orgId}/teams`,
      );
      const anonIds = (anon.body.data as Array<{ id: string }>).map(
        (t) => t.id,
      );
      expect(anonIds).not.toContain(archivedTeamId);

      const { agent: sam } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const ownerList = await sam.get(`/api/v1/organizations/${orgId}/teams`);
      const ownerIds = (ownerList.body.data as Array<{ id: string }>).map(
        (t) => t.id,
      );
      expect(ownerIds).not.toContain(archivedTeamId);
    });

    it("GET /organizations/:orgId/teams/archived returns archived teams to managers only", async () => {
      const { agent: sam } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const ownerArchived = await sam.get(
        `/api/v1/organizations/${orgId}/teams/archived`,
      );
      expect(ownerArchived.status).toBe(200);
      const ownerIds = (ownerArchived.body.data as Array<{ id: string }>).map(
        (t) => t.id,
      );
      expect(ownerIds).toContain(archivedTeamId);

      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const adminArchived = await coach.get(
        `/api/v1/organizations/${orgId}/teams/archived`,
      );
      expect(adminArchived.status).toBe(200);
      expect(
        (adminArchived.body.data as Array<{ id: string }>).map((t) => t.id),
      ).toContain(archivedTeamId);

      // A non-manager (Tyler is just a player) gets 403 from this endpoint.
      const { agent: tyler } = await loginAs(
        (u) => u.email === "tyler@kinectem.demo",
      );
      const playerArchived = await tyler.get(
        `/api/v1/organizations/${orgId}/teams/archived`,
      );
      expect(playerArchived.status).toBe(403);

      const anon = await request(app).get(
        `/api/v1/organizations/${orgId}/teams/archived`,
      );
      expect(anon.status).toBe(401);
    });

    it("excludes archived teams from cross-entity search", async () => {
      const res = await request(app).get(
        `/api/v1/search?q=${encodeURIComponent(archivedTeamName)}`,
      );
      expect(res.status).toBe(200);
      const teamHits = (res.body.teams?.data ?? []) as Array<{
        id: string;
      }>;
      expect(teamHits.find((t) => t.id === archivedTeamId)).toBeUndefined();
    });

    it("excludes archived teams from /follow-suggestions", async () => {
      // Daniela is not on JV Football and is not an org admin, so the
      // suggestion engine would normally consider every team. After
      // archiving, the archived team must drop out of the recommendations.
      const { agent } = await loginAs(
        (u) => u.email === "daniela@kinectem.demo",
      );
      const res = await agent.get(`/api/v1/follow-suggestions`);
      expect(res.status).toBe(200);
      const suggestedTeams = (res.body.teams?.data ??
        res.body.teams ??
        []) as Array<{ id: string }>;
      expect(
        suggestedTeams.find((t) => t.id === archivedTeamId),
      ).toBeUndefined();
    });

    it("excludes archived teams from /users/:userId/teams", async () => {
      // Tyler is rostered on JV Football. Once it's archived, his
      // profile/sidebar should stop reporting that membership.
      const { agent: tyler, user } = await loginAs(
        (u) => u.email === "tyler@kinectem.demo",
      );
      const res = await tyler.get(`/api/v1/users/${user.id}/teams`);
      expect(res.status).toBe(200);
      const teamIds = (res.body.data as Array<{ teamId: string }>).map(
        (m) => m.teamId,
      );
      expect(teamIds).not.toContain(archivedTeamId);
    });
  });

  describe("write surfaces return 409 team_archived", () => {
    let orgId: string;
    let teamId: string;

    beforeEach(async () => {
      const org = await getOrg();
      orgId = org.id;
      const teamsList = await getTeams(orgId);
      const target = teamsList.find((t) => t.name === "Varsity Football");
      expect(target).toBeDefined();
      teamId = target!.id;
      await archiveTeam(teamId);
    });

    function expectArchivedConflict(res: { status: number; body: unknown }) {
      expect(res.status).toBe(409);
      expect((res.body as { code?: string }).code).toBe("team_archived");
    }

    it("blocks POST /teams/:teamId/members", async () => {
      const { agent } = await loginAs((u) => u.email === "sam@kinectem.demo");
      const usersList = await request(app).get("/api/v1/users?q=Daniela");
      const userId = (usersList.body.data as Array<{ id: string }>)[0]?.id;
      expect(userId).toBeDefined();
      const res = await agent
        .post(`/api/v1/teams/${teamId}/members`)
        .send({ userId, position: "player" });
      expectArchivedConflict(res);
    });

    it("blocks POST /teams/:teamId/invites", async () => {
      const { agent } = await loginAs((u) => u.email === "sam@kinectem.demo");
      const res = await agent
        .post(`/api/v1/teams/${teamId}/invites`)
        .send({ email: "newcomer@example.com", position: "player" });
      expectArchivedConflict(res);
    });

    it("blocks POST /teams/:teamId/follow", async () => {
      const { agent } = await loginAs(
        (u) => u.email === "daniela@kinectem.demo",
      );
      const res = await agent.post(`/api/v1/teams/${teamId}/follow`);
      expectArchivedConflict(res);
    });

    it("blocks POST /teams/:teamId/join-link", async () => {
      const { agent } = await loginAs((u) => u.email === "sam@kinectem.demo");
      const res = await agent.post(`/api/v1/teams/${teamId}/join-link`);
      expectArchivedConflict(res);
    });

    it("blocks recap creation via POST /posts (postType=long)", async () => {
      const { agent } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const res = await agent.post(`/api/v1/posts`).send({
        postType: "long",
        organizationId: orgId,
        teamId,
        title: "Cannot Post",
        body: "Should fail",
      });
      expectArchivedConflict(res);
    });

    it("unarchive restores write access", async () => {
      const { agent: sam } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const un = await sam.post(`/api/v1/teams/${teamId}/unarchive`);
      expect(un.status).toBe(200);

      // Following must now succeed (returns 201 per organizations.ts).
      const { agent: daniela } = await loginAs(
        (u) => u.email === "daniela@kinectem.demo",
      );
      const follow = await daniela.post(`/api/v1/teams/${teamId}/follow`);
      expect(follow.status).toBe(201);

      // And the team is visible again on the public org list.
      const list = await request(app).get(
        `/api/v1/organizations/${orgId}/teams`,
      );
      const ids = (list.body.data as Array<{ id: string }>).map((t) => t.id);
      expect(ids).toContain(teamId);
    });
  });

  // Belt-and-suspenders: confirm the audit row format matches what the
  // org admin tools expect when they replay the activity log.
  describe("audit trail", () => {
    it("writes one archive_team row with metadata on the first archive only", async () => {
      const org = await getOrg();
      const teamsList = await getTeams(org.id);
      const target = teamsList[0];
      const { agent } = await loginAs((u) => u.email === "sam@kinectem.demo");

      await agent.post(`/api/v1/teams/${target.id}/archive`);
      await agent.post(`/api/v1/teams/${target.id}/archive`);
      await agent.post(`/api/v1/teams/${target.id}/unarchive`);
      await agent.post(`/api/v1/teams/${target.id}/unarchive`);
      await agent.post(`/api/v1/teams/${target.id}/archive`);

      const rows = await db
        .select()
        .from(adminActivityLog)
        .where(eq(adminActivityLog.targetId, target.id));
      const archiveRows = rows.filter(
        (r) => r.actionType === ARCHIVE_ACTION,
      );
      const unarchiveRows = rows.filter(
        (r) => r.actionType === UNARCHIVE_ACTION,
      );
      // archive → no-op archive → unarchive → no-op unarchive → archive
      expect(archiveRows.length).toBe(2);
      expect(unarchiveRows.length).toBe(1);

      for (const r of archiveRows) {
        const meta = JSON.parse(String(r.metadata ?? "{}"));
        expect(meta.organizationId).toBe(org.id);
        expect(typeof meta.teamName).toBe("string");
      }
    });
  });
});
