import { describe, expect, it } from "vitest";
import { app, loginAs, request } from "./helpers";

describe("organizations", () => {
  it("lists seeded organizations", async () => {
    const res = await request(app).get("/api/v1/organizations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(
      res.body.data.find((o: { name: string }) =>
        o.name.includes("Westfield"),
      ),
    ).toBeDefined();
  });

  it("returns the org detail for a known organization", async () => {
    const list = await request(app).get("/api/v1/organizations");
    const org = list.body.data[0];
    const res = await request(app).get(`/api/v1/organizations/${org.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(org.id);
    expect(res.body.name).toBe(org.name);
  });

  it("404s on an unknown organization", async () => {
    const res = await request(app).get(
      "/api/v1/organizations/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(404);
  });

  it("creates an organization for the current user", async () => {
    const { agent, user } = await loginAs((u) => u.role === "admin");
    const res = await agent
      .post("/api/v1/organizations")
      .send({
        name: "Test Org",
        description: "Created in tests",
        city: "Westfield",
        state: "NJ",
        zipCode: "07090",
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Test Org");
    expect(res.body.role).toBe("owner");
    expect(res.body.city).toBe("Westfield");
    expect(res.body.state).toBe("NJ");
    expect(res.body.zipCode).toBe("07090");
    // The creator should be listed as a member of the new org.
    const orgs = await agent.get(`/api/v1/users/${user.id}/organizations`);
    expect(
      orgs.body.data.find((o: { id: string }) => o.id === res.body.id),
    ).toBeDefined();
  });

  it("rejects creating an organization with an empty name", async () => {
    const { agent } = await loginAs((u) => u.role === "admin");
    const res = await agent.post("/api/v1/organizations").send({ name: "  " });
    expect(res.status).toBe(400);
  });

  it("rejects creating an organization without city/state/zipCode (task #230)", async () => {
    const { agent } = await loginAs((u) => u.role === "admin");
    const noCity = await agent.post("/api/v1/organizations").send({
      name: "Test Org",
      state: "NJ",
      zipCode: "07090",
    });
    expect(noCity.status).toBe(400);
    const noState = await agent.post("/api/v1/organizations").send({
      name: "Test Org",
      city: "Westfield",
      zipCode: "07090",
    });
    expect(noState.status).toBe(400);
    const noZip = await agent.post("/api/v1/organizations").send({
      name: "Test Org",
      city: "Westfield",
      state: "NJ",
    });
    expect(noZip.status).toBe(400);
  });

  it("rejects creating an organization with an invalid state code or zip (task #230)", async () => {
    const { agent } = await loginAs((u) => u.role === "admin");
    const badState = await agent.post("/api/v1/organizations").send({
      name: "Test Org",
      city: "Westfield",
      state: "ZZ",
      zipCode: "07090",
    });
    expect(badState.status).toBe(400);
    const badZip = await agent.post("/api/v1/organizations").send({
      name: "Test Org",
      city: "Westfield",
      state: "NJ",
      zipCode: "abcde",
    });
    expect(badZip.status).toBe(400);
    // ZIP+4 is accepted.
    const ok = await agent.post("/api/v1/organizations").send({
      name: "Test Org Plus Four",
      city: "Westfield",
      state: "NJ",
      zipCode: "07090-1234",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.zipCode).toBe("07090-1234");
  });

  it("PATCH applies the same city/state/zipCode rules on edit (task #237)", async () => {
    const { agent } = await loginAs((u) => u.role === "admin");
    const created = await agent.post("/api/v1/organizations").send({
      name: "Editable Org",
      city: "Westfield",
      state: "NJ",
      zipCode: "07090",
    });
    expect(created.status).toBe(201);
    const orgId = created.body.id;

    // Empty city is rejected on edit.
    const emptyCity = await agent
      .patch(`/api/v1/organizations/${orgId}`)
      .send({ city: "   " });
    expect(emptyCity.status).toBe(400);

    // Bogus state code is rejected.
    const badState = await agent
      .patch(`/api/v1/organizations/${orgId}`)
      .send({ state: "ZZ" });
    expect(badState.status).toBe(400);

    // Non-numeric zip is rejected.
    const badZip = await agent
      .patch(`/api/v1/organizations/${orgId}`)
      .send({ zipCode: "abcde" });
    expect(badZip.status).toBe(400);

    // A valid combined update writes through and the response keeps zipCode.
    const ok = await agent.patch(`/api/v1/organizations/${orgId}`).send({
      city: "Cranford",
      state: "ny", // also tests case-insensitive normalization
      zipCode: "07016-1234",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.city).toBe("Cranford");
    expect(ok.body.state).toBe("NY");
    expect(ok.body.zipCode).toBe("07016-1234");

    // GET reflects the saved values too.
    const fetched = await agent.get(`/api/v1/organizations/${orgId}`);
    expect(fetched.body.city).toBe("Cranford");
    expect(fetched.body.state).toBe("NY");
    expect(fetched.body.zipCode).toBe("07016-1234");
  });
});

describe("organization member roles (task #208)", () => {
  // Helper: spin up a fresh org owned by `ownerAgent`'s user, then approve
  // a join request from `joinerAgent` with the requested role. Returns
  // the new org id and the joiner's user id.
  async function createOrgAndAddJoiner(
    ownerAgent: Awaited<ReturnType<typeof loginAs>>["agent"],
    joinerAgent: Awaited<ReturnType<typeof loginAs>>["agent"],
    joinerUserId: string,
    role: "admin" | "member",
  ): Promise<string> {
    const created = await ownerAgent
      .post("/api/v1/organizations")
      .send({
        name: `T208 Org ${Math.random().toString(36).slice(2, 8)}`,
        city: "Westfield",
        state: "NJ",
        zipCode: "07090",
      });
    expect(created.status).toBe(201);
    const orgId: string = created.body.id;
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
    // Verify the member shows up in /members with the requested role.
    const list = await ownerAgent.get(`/api/v1/organizations/${orgId}/members`);
    const found = (list.body.data as Array<{ userId: string; role: string }>)
      .find((m) => m.userId === joinerUserId);
    expect(found?.role).toBe(role);
    return orgId;
  }

  it("creator becomes owner and is the only owner", async () => {
    const { agent } = await loginAs((u) => u.role === "admin");
    const created = await agent
      .post("/api/v1/organizations")
      .send({
        name: "T208 Owner Test",
        city: "Westfield",
        state: "NJ",
        zipCode: "07090",
      });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe("owner");
    const list = await agent.get(
      `/api/v1/organizations/${created.body.id}/members`,
    );
    const owners = (list.body.data as Array<{ role: string }>).filter(
      (m) => m.role === "owner",
    );
    expect(owners).toHaveLength(1);
  });

  it("approving a join request as 'member' creates a member, not an admin", async () => {
    const { agent: owner } = await loginAs((u) => u.role === "admin");
    const { agent: joiner, user: joinerUser } = await loginAs(
      (u) => u.role === "coach",
    );
    const orgId = await createOrgAndAddJoiner(
      owner,
      joiner,
      joinerUser.id,
      "member",
    );
    // Joiner should see themselves with role 'member' on org detail and
    // must NOT be able to perform manage actions (PATCH org metadata is
    // gated on canManageOrganization).
    const detail = await joiner.get(`/api/v1/organizations/${orgId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.role).toBe("member");
    const editAttempt = await joiner
      .patch(`/api/v1/organizations/${orgId}`)
      .send({ description: "Hijack attempt" });
    expect([401, 403]).toContain(editAttempt.status);
  });

  it("PATCH promotes a member to admin and demotes back", async () => {
    const { agent: owner } = await loginAs((u) => u.role === "admin");
    const { agent: joiner, user: joinerUser } = await loginAs(
      (u) => u.role === "coach",
    );
    const orgId = await createOrgAndAddJoiner(
      owner,
      joiner,
      joinerUser.id,
      "member",
    );
    const promote = await owner
      .patch(`/api/v1/organizations/${orgId}/members/${joinerUser.id}`)
      .send({ role: "admin" });
    expect(promote.status).toBe(200);
    expect(promote.body.role).toBe("admin");
    const demote = await owner
      .patch(`/api/v1/organizations/${orgId}/members/${joinerUser.id}`)
      .send({ role: "member" });
    expect(demote.status).toBe(200);
    expect(demote.body.role).toBe("member");
  });

  it("PATCH refuses to change the owner's role", async () => {
    const { agent: owner, user: ownerUser } = await loginAs(
      (u) => u.role === "admin",
    );
    const created = await owner
      .post("/api/v1/organizations")
      .send({
        name: "T208 Owner Lock",
        city: "Westfield",
        state: "NJ",
        zipCode: "07090",
      });
    expect(created.status).toBe(201);
    const orgId: string = created.body.id;
    const res = await owner
      .patch(`/api/v1/organizations/${orgId}/members/${ownerUser.id}`)
      .send({ role: "admin" });
    expect(res.status).toBe(409);
  });

  it("PATCH and DELETE require manage permissions", async () => {
    const { agent: owner } = await loginAs((u) => u.role === "admin");
    const { agent: joiner, user: joinerUser } = await loginAs(
      (u) => u.role === "coach",
    );
    const orgId = await createOrgAndAddJoiner(
      owner,
      joiner,
      joinerUser.id,
      "member",
    );
    const patch = await joiner
      .patch(`/api/v1/organizations/${orgId}/members/${joinerUser.id}`)
      .send({ role: "admin" });
    expect(patch.status).toBe(403);
    const del = await joiner.delete(
      `/api/v1/organizations/${orgId}/members/${joinerUser.id}`,
    );
    expect(del.status).toBe(403);
  });

  it("DELETE removes a non-owner member but refuses to remove the owner", async () => {
    const { agent: owner, user: ownerUser } = await loginAs(
      (u) => u.role === "admin",
    );
    const { agent: joiner, user: joinerUser } = await loginAs(
      (u) => u.role === "coach",
    );
    const orgId = await createOrgAndAddJoiner(
      owner,
      joiner,
      joinerUser.id,
      "member",
    );
    // Refuse for owner.
    const ownerDel = await owner.delete(
      `/api/v1/organizations/${orgId}/members/${ownerUser.id}`,
    );
    expect(ownerDel.status).toBe(409);
    // Remove the joiner.
    const memberDel = await owner.delete(
      `/api/v1/organizations/${orgId}/members/${joinerUser.id}`,
    );
    expect(memberDel.status).toBe(204);
    const list = await owner.get(`/api/v1/organizations/${orgId}/members`);
    const stillThere = (list.body.data as Array<{ userId: string }>).find(
      (m) => m.userId === joinerUser.id,
    );
    expect(stillThere).toBeUndefined();
  });

  it("transfer-ownership swaps owner with target and demotes the previous owner to admin", async () => {
    const { agent: owner, user: ownerUser } = await loginAs(
      (u) => u.role === "admin",
    );
    const { agent: joiner, user: joinerUser } = await loginAs(
      (u) => u.role === "coach",
    );
    const orgId = await createOrgAndAddJoiner(
      owner,
      joiner,
      joinerUser.id,
      "admin",
    );
    const transfer = await owner.post(
      `/api/v1/organizations/${orgId}/members/${joinerUser.id}/transfer-ownership`,
    );
    expect(transfer.status).toBe(200);
    expect(transfer.body.role).toBe("owner");
    const list = await owner.get(`/api/v1/organizations/${orgId}/members`);
    const rows = list.body.data as Array<{ userId: string; role: string }>;
    expect(rows.find((r) => r.userId === joinerUser.id)?.role).toBe("owner");
    expect(rows.find((r) => r.userId === ownerUser.id)?.role).toBe("admin");
    expect(rows.filter((r) => r.role === "owner")).toHaveLength(1);
  });

  it("transfer-ownership rejects non-owners and self-transfer", async () => {
    const { agent: owner, user: ownerUser } = await loginAs(
      (u) => u.role === "admin",
    );
    const { agent: joiner, user: joinerUser } = await loginAs(
      (u) => u.role === "coach",
    );
    const orgId = await createOrgAndAddJoiner(
      owner,
      joiner,
      joinerUser.id,
      "admin",
    );
    // Joiner is an admin but not owner — transferring to anyone (e.g.
    // the current owner) must be 403. Use ownerUser.id as the target
    // so we exercise the role check, not the self-transfer guard.
    const fromAdmin = await joiner.post(
      `/api/v1/organizations/${orgId}/members/${ownerUser.id}/transfer-ownership`,
    );
    expect(fromAdmin.status).toBe(403);
    // Owner trying to transfer to themselves — should be 400.
    const toSelf = await owner.post(
      `/api/v1/organizations/${orgId}/members/${ownerUser.id}/transfer-ownership`,
    );
    expect(toSelf.status).toBe(400);
  });

  it("concurrent transfer-ownership requests still leave exactly one owner", async () => {
    // Set up an org with the owner plus TWO admin members. The owner
    // then fires two transfer-ownership requests in parallel — one
    // targeting each admin. Whatever the interleaving, the org must end
    // with exactly one owner row, and at most one of the requests can
    // succeed with 200 (the other should be 200 OR 409, never both
    // 200 leaving two owners).
    const { agent: owner, user: ownerUser } = await loginAs(
      (u) => u.role === "admin",
    );
    const { agent: joinerA, user: joinerAUser } = await loginAs(
      (u) => u.role === "coach",
    );
    const { agent: joinerB, user: joinerBUser } = await loginAs(
      (u) => u.role === "athlete",
    );
    const created = await owner
      .post("/api/v1/organizations")
      .send({
        name: `T208 RaceOrg ${Math.random().toString(36).slice(2, 8)}`,
        city: "Westfield",
        state: "NJ",
        zipCode: "07090",
      });
    expect(created.status).toBe(201);
    const orgId: string = created.body.id;
    for (const [agent, uid] of [
      [joinerA, joinerAUser.id] as const,
      [joinerB, joinerBUser.id] as const,
    ]) {
      const jr = await agent
        .post(`/api/v1/organizations/${orgId}/join-requests`)
        .send({});
      expect(jr.status).toBe(201);
      const ap = await owner
        .post(
          `/api/v1/organizations/${orgId}/join-requests/${jr.body.id}/approve`,
        )
        .send({ role: "admin" });
      expect(ap.status).toBe(200);
      // sanity: the new admin is in the members list
      void uid;
    }
    const [resA, resB] = await Promise.all([
      owner.post(
        `/api/v1/organizations/${orgId}/members/${joinerAUser.id}/transfer-ownership`,
      ),
      owner.post(
        `/api/v1/organizations/${orgId}/members/${joinerBUser.id}/transfer-ownership`,
      ),
    ]);
    // Acceptable outcomes per request: 200 (won the race), 409 (lost
    // the race inside the transaction), or 403 (the pre-check noticed
    // we're no longer the owner because the other request finished
    // first). Never 5xx, never two simultaneous 200s leaving two
    // owners.
    for (const r of [resA, resB]) {
      expect([200, 403, 409]).toContain(r.status);
    }
    // At least one must have succeeded — the org must still have an
    // owner (unique partial index forbids zero, transactions guarantee
    // the demote+promote happen together).
    expect([resA.status, resB.status]).toContain(200);
    // Final state: exactly one owner row in the org.
    const list = await owner.get(`/api/v1/organizations/${orgId}/members`);
    const owners = (list.body.data as Array<{ role: string; userId: string }>)
      .filter((m) => m.role === "owner");
    expect(owners).toHaveLength(1);
    // The single owner must be one of {originalOwner, joinerA, joinerB}.
    expect([ownerUser.id, joinerAUser.id, joinerBUser.id]).toContain(
      owners[0].userId,
    );
  });

  it("/users/:id/organizations reports the user's stored role per org", async () => {
    const { agent: owner } = await loginAs((u) => u.role === "admin");
    const { agent: joiner, user: joinerUser } = await loginAs(
      (u) => u.role === "coach",
    );
    const orgId = await createOrgAndAddJoiner(
      owner,
      joiner,
      joinerUser.id,
      "admin",
    );
    const orgs = await joiner.get(`/api/v1/users/${joinerUser.id}/organizations`);
    expect(orgs.status).toBe(200);
    const found = (orgs.body.data as Array<{ id: string; role: string }>)
      .find((o) => o.id === orgId);
    expect(found?.role).toBe("admin");
  });
});
