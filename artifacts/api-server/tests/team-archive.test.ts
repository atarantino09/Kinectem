// Task #474 — regression coverage for the team archive flow added in
// Task #472. Pins down owner-only archive/unarchive, the visibility
// filter on every read surface that lists teams, and the 409
// `team_archived` block on every write surface that targets a team.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  adminActivityLog,
  db,
  organizationAdmins,
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
  describe("POST /teams/:teamId/archive permissions", () => {
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

    it("forbids org admins (non-owners) with code: owner_only", async () => {
      const org = await getOrg();
      const teamsList = await getTeams(org.id);
      const target = teamsList[0];
      // coachDavis is an org admin (not owner) of Westfield.
      const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
      const res = await agent.post(`/api/v1/teams/${target.id}/archive`);
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe("owner_only");
    });

    it("forbids plain org members with code: owner_only", async () => {
      const org = await getOrg();
      const teamsList = await getTeams(org.id);
      const target = teamsList[0];
      const { agent, user } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      await addOrgMember(org.id, user.id);
      const res = await agent.post(`/api/v1/teams/${target.id}/archive`);
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe("owner_only");
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
  // owner-only invariant honest end-to-end.
  describe("POST /teams/:teamId/unarchive permissions", () => {
    async function setupArchivedTeam(): Promise<string> {
      const org = await getOrg();
      const teamsList = await getTeams(org.id);
      const target = teamsList[0];
      await archiveTeam(target.id);
      return target.id;
    }

    it("forbids org admins (non-owners) with code: owner_only", async () => {
      const teamId = await setupArchivedTeam();
      const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
      const res = await agent.post(`/api/v1/teams/${teamId}/unarchive`);
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe("owner_only");
    });

    it("forbids plain org members with code: owner_only", async () => {
      const teamId = await setupArchivedTeam();
      const org = await getOrg();
      const { agent, user } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      await addOrgMember(org.id, user.id);
      const res = await agent.post(`/api/v1/teams/${teamId}/unarchive`);
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe("owner_only");
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
