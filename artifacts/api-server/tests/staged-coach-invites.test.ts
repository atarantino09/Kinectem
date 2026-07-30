import { describe, it, expect } from "vitest";
import { request, app, loginAs } from "./helpers";
import type { Agent } from "supertest";

// Task #808 — staged coach drafts on unclaimed orgs.
// Staging is side-effect free (no invites, no roster rows), survives the
// claim, and the endpoints are gated on canManageOrganization (platform
// admin + post-claim owner pass; strangers don't).
//
// NOTE: the global beforeEach truncates + reseeds the DB, so every test
// builds its own org/teams via this helper (no shared beforeAll state).

const ADMIN_EMAIL = "andrew@kinectem.com";

async function setupUnclaimedOrg(): Promise<{
  adminAgent: Agent;
  orgId: string;
  claimToken: string;
  teamAId: string;
  teamBId: string;
}> {
  const { agent: adminAgent } = await loginAs((u) => u.email === ADMIN_EMAIL);
  const orgRes = await adminAgent
    .post("/api/v1/admin/org-claim-links")
    .send({ name: "Staged Coach Test Org" });
  expect(orgRes.status).toBe(201);
  const orgId = orgRes.body.data.id as string;
  const claimToken = orgRes.body.data.token as string;

  // Platform admin sets the org up end-to-end pre-claim (admin bypass).
  const teamA = await adminAgent
    .post(`/api/v1/organizations/${orgId}/teams`)
    .send({ name: "Staged Varsity" });
  expect(teamA.status).toBe(201);
  const teamB = await adminAgent
    .post(`/api/v1/organizations/${orgId}/teams`)
    .send({ name: "Staged JV" });
  expect(teamB.status).toBe(201);
  return {
    adminAgent,
    orgId,
    claimToken,
    teamAId: teamA.body.id as string,
    teamBId: teamB.body.id as string,
  };
}

describe("staged coach drafts", () => {
  it("platform admin can stage coach emails with no invite side effects", async () => {
    const { adminAgent, orgId, teamAId, teamBId } = await setupUnclaimedOrg();

    const put = await adminAgent
      .put(`/api/v1/organizations/${orgId}/staged-coaches`)
      .send({
        entries: [
          {
            teamId: teamAId,
            emails: ["coach-a@example.com", "Coach-A2@Example.com"],
          },
          { teamId: teamBId, emails: ["coach-b@example.com"] },
        ],
      });
    expect(put.status).toBe(200);
    expect(put.body.count).toBe(3);

    const get = await adminAgent.get(
      `/api/v1/organizations/${orgId}/staged-coaches`,
    );
    expect(get.status).toBe(200);
    const rows = get.body.data as Array<{ teamId: string; email: string }>;
    expect(rows).toHaveLength(3);
    // emails normalized to lowercase
    expect(rows.map((r) => r.email)).toContain("coach-a2@example.com");

    // No real invites exist for either team.
    for (const teamId of [teamAId, teamBId]) {
      const invites = await adminAgent.get(`/api/v1/teams/${teamId}/invites`);
      expect(invites.status).toBe(200);
      const list = Array.isArray(invites.body.data)
        ? invites.body.data
        : invites.body;
      expect(list).toHaveLength(0);
    }

    // Replace-all PUT removes rows no longer sent.
    const put2 = await adminAgent
      .put(`/api/v1/organizations/${orgId}/staged-coaches`)
      .send({
        entries: [{ teamId: teamAId, emails: ["coach-a@example.com"] }],
      });
    expect(put2.status).toBe(200);
    expect(put2.body.count).toBe(1);
    const after = await adminAgent.get(
      `/api/v1/organizations/${orgId}/staged-coaches`,
    );
    expect(after.body.data).toHaveLength(1);
  });

  it("rejects a team from another org and invalid emails", async () => {
    const { adminAgent, orgId, teamAId } = await setupUnclaimedOrg();

    const otherOrg = await adminAgent
      .post("/api/v1/admin/org-claim-links")
      .send({ name: "Other Org" });
    const otherTeam = await adminAgent
      .post(`/api/v1/organizations/${otherOrg.body.data.id}/teams`)
      .send({ name: "Other Team" });

    const badTeam = await adminAgent
      .put(`/api/v1/organizations/${orgId}/staged-coaches`)
      .send({
        entries: [
          { teamId: otherTeam.body.id, emails: ["x@example.com"] },
        ],
      });
    expect(badTeam.status).toBe(400);

    const badEmail = await adminAgent
      .put(`/api/v1/organizations/${orgId}/staged-coaches`)
      .send({ entries: [{ teamId: teamAId, emails: ["not-an-email"] }] });
    expect(badEmail.status).toBe(400);
  });

  it("a non-manager cannot read or write drafts; unauthenticated gets 401", async () => {
    const { orgId } = await setupUnclaimedOrg();

    const { agent: outsider } = await loginAs(
      (u) => u.role === "athlete" && !!u.email,
    );
    const get = await outsider.get(
      `/api/v1/organizations/${orgId}/staged-coaches`,
    );
    expect(get.status).toBe(403);
    const put = await outsider
      .put(`/api/v1/organizations/${orgId}/staged-coaches`)
      .send({ entries: [] });
    expect(put.status).toBe(403);
    const del = await outsider.delete(
      `/api/v1/organizations/${orgId}/staged-coaches`,
    );
    expect(del.status).toBe(403);
    // Task #836 — per-entry delete is gated the same way.
    const delOne = await outsider.delete(
      `/api/v1/organizations/${orgId}/staged-coaches/00000000-0000-0000-0000-000000000000`,
    );
    expect(delOne.status).toBe(403);

    const anon = await request(app).get(
      `/api/v1/organizations/${orgId}/staged-coaches`,
    );
    expect(anon.status).toBe(401);
  });

  // Task #836 — staged coaches persist until invited or removed one by one.
  it("per-entry delete removes only that row and 404s on unknown/foreign ids", async () => {
    const { adminAgent, orgId, teamAId, teamBId } = await setupUnclaimedOrg();

    const put = await adminAgent
      .put(`/api/v1/organizations/${orgId}/staged-coaches`)
      .send({
        entries: [
          { teamId: teamAId, emails: ["one@example.com", "two@example.com"] },
          { teamId: teamBId, emails: ["three@example.com"] },
        ],
      });
    expect(put.status).toBe(200);

    const get = await adminAgent.get(
      `/api/v1/organizations/${orgId}/staged-coaches`,
    );
    const rows = get.body.data as Array<{
      id: string;
      teamId: string;
      email: string;
    }>;
    expect(rows).toHaveLength(3);
    // GET now returns row ids so the client can remove entries one by one.
    expect(rows.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(
      true,
    );

    const target = rows.find((r) => r.email === "two@example.com")!;
    const del = await adminAgent.delete(
      `/api/v1/organizations/${orgId}/staged-coaches/${target.id}`,
    );
    expect(del.status).toBe(200);

    const after = await adminAgent.get(
      `/api/v1/organizations/${orgId}/staged-coaches`,
    );
    const remaining = after.body.data as Array<{ id: string; email: string }>;
    expect(remaining).toHaveLength(2);
    expect(remaining.map((r) => r.email).sort()).toEqual([
      "one@example.com",
      "three@example.com",
    ]);

    // Deleting the same id again 404s (already gone).
    const again = await adminAgent.delete(
      `/api/v1/organizations/${orgId}/staged-coaches/${target.id}`,
    );
    expect(again.status).toBe(404);

    // An id belonging to a different org 404s rather than deleting.
    const otherOrg = await adminAgent
      .post("/api/v1/admin/org-claim-links")
      .send({ name: "Other Org For Delete" });
    const foreign = await adminAgent.delete(
      `/api/v1/organizations/${otherOrg.body.data.id}/staged-coaches/${remaining[0].id}`,
    );
    expect(foreign.status).toBe(404);
    const still = await adminAgent.get(
      `/api/v1/organizations/${orgId}/staged-coaches`,
    );
    expect(still.body.data).toHaveLength(2);
  });

  it("confirm clears only invited entries; failures stay staged", async () => {
    const { adminAgent, orgId, claimToken, teamAId, teamBId } =
      await setupUnclaimedOrg();

    await adminAgent.put(`/api/v1/organizations/${orgId}/staged-coaches`).send({
      entries: [
        { teamId: teamAId, emails: ["sent@example.com"] },
        { teamId: teamBId, emails: ["kept@example.com"] },
      ],
    });

    const { agent: claimant } = await loginAs(
      (u) => u.role === "coach" && !!u.email,
    );
    const claim = await claimant.post(
      `/api/v1/org-claim-links/${claimToken}/claim`,
    );
    expect(claim.status).toBe(201);

    const rows = (
      await claimant.get(`/api/v1/organizations/${orgId}/staged-coaches`)
    ).body.data as Array<{ id: string; email: string }>;
    expect(rows).toHaveLength(2);

    // Mirror the client's confirm path: invite one, delete only that entry.
    const invite = await claimant
      .post(`/api/v1/teams/${teamAId}/invites`)
      .send({ email: "sent@example.com", position: "coach" });
    expect([200, 201]).toContain(invite.status);
    const sentRow = rows.find((r) => r.email === "sent@example.com")!;
    const del = await claimant.delete(
      `/api/v1/organizations/${orgId}/staged-coaches/${sentRow.id}`,
    );
    expect(del.status).toBe(200);

    // The "failed" (never invited) entry survives for a later retry.
    const after = await claimant.get(
      `/api/v1/organizations/${orgId}/staged-coaches`,
    );
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].email).toBe("kept@example.com");
  });

  it("claim preserves setup + drafts; owner confirms via normal invites then clears", async () => {
    const { adminAgent, orgId, claimToken, teamAId, teamBId } =
      await setupUnclaimedOrg();

    const put = await adminAgent
      .put(`/api/v1/organizations/${orgId}/staged-coaches`)
      .send({
        entries: [
          { teamId: teamAId, emails: ["coach-a@example.com"] },
          { teamId: teamBId, emails: ["coach-b@example.com"] },
        ],
      });
    expect(put.status).toBe(200);

    const { agent: claimant } = await loginAs(
      (u) => u.role === "coach" && !!u.email,
    );
    const claim = await claimant.post(
      `/api/v1/org-claim-links/${claimToken}/claim`,
    );
    expect(claim.status).toBe(201);

    // Teams survive the claim.
    const teams = await claimant.get(`/api/v1/organizations/${orgId}/teams`);
    expect(teams.status).toBe(200);
    expect(teams.body.data.length).toBeGreaterThanOrEqual(2);

    // Drafts survive and the new owner can read them.
    const get = await claimant.get(
      `/api/v1/organizations/${orgId}/staged-coaches`,
    );
    expect(get.status).toBe(200);
    expect(get.body.data).toHaveLength(2);

    // Confirm fan-out: owner sends a real coach invite through the normal
    // team-invite endpoint, then clears the consumed drafts.
    const invite = await claimant
      .post(`/api/v1/teams/${teamAId}/invites`)
      .send({ email: "coach-a@example.com", position: "coach" });
    expect([200, 201]).toContain(invite.status);

    const del = await claimant.delete(
      `/api/v1/organizations/${orgId}/staged-coaches`,
    );
    expect(del.status).toBe(200);
    const after = await claimant.get(
      `/api/v1/organizations/${orgId}/staged-coaches`,
    );
    expect(after.body.data).toHaveLength(0);
  });
});
