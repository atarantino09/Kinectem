// Task #745 — multi-admin management for organizer hubs + competitions.
// Covers: hub admins get rights over ALL hub competitions (including
// later-attached ones), per-competition admins stay scoped, add is open to
// any admin, remove is owner-only, the owner is never removable, minors are
// blocked everywhere (COPPA), and the email-invite lifecycle
// (create → link rotate → accept / withdraw).
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  users,
  tournaments,
  competitionOrganizers,
  organizerAdmins,
} from "@workspace/db";
import { loginAs } from "./helpers";
import type { Agent } from "supertest";

let n = 0;
function uniq(prefix: string): string {
  n += 1;
  return `${prefix} T745 ${Date.now()}-${n}`;
}

async function createHub(agent: Agent, name: string): Promise<{ id: string; slug: string }> {
  const res = await agent.post("/api/v1/organizers").send({ name });
  expect(res.status).toBe(201);
  return { id: res.body.id, slug: res.body.slug };
}

async function createCompetition(
  agent: Agent,
  name: string,
  organizerId?: string,
): Promise<{ id: string; slug: string }> {
  const res = await agent.post("/api/v1/competitions").send({
    name,
    type: "tournament",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    ...(organizerId ? { organizerId } : {}),
  });
  expect(res.status).toBe(201);
  return { id: res.body.id, slug: res.body.slug };
}

const createdHubs: string[] = [];
const createdComps: string[] = [];
const minorFlagged: string[] = [];

afterEach(async () => {
  // Restore any seed user we temporarily flagged as a minor.
  for (const id of minorFlagged.splice(0)) {
    await db.update(users).set({ isMinor: false }).where(eq(users.id, id));
  }
  for (const id of createdComps.splice(0)) {
    await db.delete(tournaments).where(eq(tournaments.id, id));
  }
  for (const id of createdHubs.splice(0)) {
    await db.delete(competitionOrganizers).where(eq(competitionOrganizers.id, id));
  }
});

async function setup() {
  // NOTE: sam@kinectem.demo is the PLATFORM admin (users.role === "admin"),
  // which bypasses ownership checks — use regular athletes here so the
  // membership-based permissions are what's actually under test.
  const owner = await loginAs("coach@kinectem.demo");
  const admin = await loginAs("daniela@kinectem.demo");
  const outsider = await loginAs("marcus@kinectem.demo");
  return { owner, admin, outsider };
}

describe("competition & hub admins (Task #745)", () => {
  it("lets platform admins find and fully operate competitions they do not own", async () => {
    const { owner, admin, outsider } = await setup();
    const platformAdmin = await loginAs("sam@kinectem.demo");
    const competitionName = uniq("Support access");
    const comp = await createCompetition(owner.agent, competitionName);
    createdComps.push(comp.id);

    const deniedSearch = await outsider.agent.get(
      `/api/v1/admin/competitions?q=${encodeURIComponent(competitionName)}`,
    );
    expect(deniedSearch.status).toBe(403);

    const search = await platformAdmin.agent.get(
      `/api/v1/admin/competitions?q=${encodeURIComponent(competitionName)}`,
    );
    expect(search.status).toBe(200);
    expect(search.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: comp.id,
          name: competitionName,
          accessRole: "admin",
        }),
      ]),
    );
    const myCompetitions = await platformAdmin.agent.get(
      "/api/v1/my/competitions",
    );
    expect(myCompetitions.status).toBe(200);
    expect(
      myCompetitions.body.data.some(
        (row: { id: string }) => row.id === comp.id,
      ),
    ).toBe(false);

    const literalWildcards = await platformAdmin.agent.get(
      "/api/v1/admin/competitions?q=%25%25",
    );
    expect(literalWildcards.status).toBe(200);
    expect(
      literalWildcards.body.data.some(
        (row: { id: string }) => row.id === comp.id,
      ),
    ).toBe(false);

    const uuidSearch = await platformAdmin.agent.get(
      `/api/v1/admin/competitions?q=${comp.id}`,
    );
    expect(uuidSearch.status).toBe(200);
    expect(
      uuidSearch.body.data.some((row: { id: string }) => row.id === comp.id),
    ).toBe(true);

    const detail = await platformAdmin.agent.get(`/api/v1/competitions/${comp.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.competition.canManage).toBe(true);

    const outsiderEdit = await outsider.agent
      .patch(`/api/v1/competitions/${comp.id}`)
      .send({ location: "Should not save" });
    expect(outsiderEdit.status).toBe(403);

    const edit = await platformAdmin.agent
      .patch(`/api/v1/competitions/${comp.id}`)
      .send({ location: "Updated by support" });
    expect(edit.status).toBe(200);
    expect(edit.body.location).toBe("Updated by support");

    const game = await platformAdmin.agent
      .post(`/api/v1/competitions/${comp.id}/matches`)
      .send({
        matchNumber: "936",
        matchDate: "2026-08-01",
        division: "Open",
        homeName: "North",
        awayName: "South",
      });
    expect(game.status).toBe(201);

    const bracket = await platformAdmin.agent
      .post(`/api/v1/competitions/${comp.id}/brackets`)
      .send({ label: "Support bracket" });
    expect(bracket.status).toBe(201);

    const addAdmin = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/admins`)
      .send({ userId: admin.user.id });
    expect(addAdmin.status).toBe(201);
    const adminList = await platformAdmin.agent.get(
      `/api/v1/competitions/${comp.id}/admins`,
    );
    expect(adminList.status).toBe(200);
    expect(adminList.body.viewerIsOwner).toBe(true);
    const removeOwner = await platformAdmin.agent.delete(
      `/api/v1/competitions/${comp.id}/admins/${owner.user.id}`,
    );
    expect(removeOwner.status).toBe(409);
    expect(removeOwner.body.code).toBe("OWNER_NOT_REMOVABLE");
    const removeAdmin = await platformAdmin.agent.delete(
      `/api/v1/competitions/${comp.id}/admins/${admin.user.id}`,
    );
    expect(removeAdmin.status).toBe(200);

    const startMasquerade = await platformAdmin.agent.post(
      `/api/v1/admin/masquerade/${outsider.user.id}/start`,
    );
    expect(startMasquerade.status).toBe(200);
    const hiddenWhileMasquerading = await platformAdmin.agent.get(
      `/api/v1/admin/competitions?q=${encodeURIComponent(competitionName)}`,
    );
    expect(hiddenWhileMasquerading.status).toBe(403);
    const blockedEditWhileMasquerading = await platformAdmin.agent
      .patch(`/api/v1/competitions/${comp.id}`)
      .send({ location: "Masquerade must not save" });
    expect(blockedEditWhileMasquerading.status).toBe(403);
    const stopMasquerade = await platformAdmin.agent.post(
      "/api/v1/admin/masquerade/stop",
    );
    expect(stopMasquerade.status).toBe(200);

    const wrongConfirmation = await platformAdmin.agent
      .delete(`/api/v1/competitions/${comp.id}`)
      .send({ confirm: "wrong name" });
    expect(wrongConfirmation.status).toBe(400);

    const deletion = await platformAdmin.agent
      .delete(`/api/v1/competitions/${comp.id}`)
      .send({ confirm: competitionName });
    expect(deletion.status).toBe(200);
    createdComps.splice(createdComps.indexOf(comp.id), 1);
  });

  it("lists the owner first and flags viewerIsOwner", async () => {
    const { owner } = await setup();
    const hub = await createHub(owner.agent, uniq("Hub"));
    createdHubs.push(hub.id);
    const res = await owner.agent.get(`/api/v1/organizers/${hub.id}/admins`);
    expect(res.status).toBe(200);
    expect(res.body.viewerIsOwner).toBe(true);
    expect(res.body.data[0].isOwner).toBe(true);
    expect(res.body.data[0].userId).toBe(owner.user.id);
  });

  it("blocks non-managers from viewing or adding admins", async () => {
    const { owner, admin, outsider } = await setup();
    const comp = await createCompetition(owner.agent, uniq("Comp"));
    createdComps.push(comp.id);
    const list = await outsider.agent.get(`/api/v1/competitions/${comp.id}/admins`);
    expect(list.status).toBe(403);
    const add = await outsider.agent
      .post(`/api/v1/competitions/${comp.id}/admins`)
      .send({ userId: admin.user.id });
    expect(add.status).toBe(403);
  });

  it("lets any admin add another admin, but only the owner remove", async () => {
    const { owner, admin, outsider } = await setup();
    const comp = await createCompetition(owner.agent, uniq("Comp"));
    createdComps.push(comp.id);

    const add = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/admins`)
      .send({ userId: admin.user.id });
    expect(add.status).toBe(201);

    // Admin (non-owner) can add someone else…
    const add2 = await admin.agent
      .post(`/api/v1/competitions/${comp.id}/admins`)
      .send({ userId: outsider.user.id });
    expect(add2.status).toBe(201);

    // …but cannot remove (owner-only).
    const rmByAdmin = await admin.agent.delete(
      `/api/v1/competitions/${comp.id}/admins/${outsider.user.id}`,
    );
    expect(rmByAdmin.status).toBe(403);

    // viewerIsOwner is false for the admin.
    const listAsAdmin = await admin.agent.get(`/api/v1/competitions/${comp.id}/admins`);
    expect(listAsAdmin.status).toBe(200);
    expect(listAsAdmin.body.viewerIsOwner).toBe(false);

    const rmByOwner = await owner.agent.delete(
      `/api/v1/competitions/${comp.id}/admins/${outsider.user.id}`,
    );
    expect(rmByOwner.status).toBe(200);
  });

  it("never removes the owner and rejects duplicate/owner adds", async () => {
    const { owner, admin } = await setup();
    const hub = await createHub(owner.agent, uniq("Hub"));
    createdHubs.push(hub.id);

    const rmOwner = await owner.agent.delete(
      `/api/v1/organizers/${hub.id}/admins/${owner.user.id}`,
    );
    expect(rmOwner.status).toBe(409);
    expect(rmOwner.body.code).toBe("OWNER_NOT_REMOVABLE");

    const addOwner = await owner.agent
      .post(`/api/v1/organizers/${hub.id}/admins`)
      .send({ userId: owner.user.id });
    expect(addOwner.status).toBe(409);
    expect(addOwner.body.code).toBe("ALREADY_OWNER");

    await owner.agent
      .post(`/api/v1/organizers/${hub.id}/admins`)
      .send({ userId: admin.user.id });
    const dup = await owner.agent
      .post(`/api/v1/organizers/${hub.id}/admins`)
      .send({ userId: admin.user.id });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("ALREADY_AN_ADMIN");
  });

  it("gives hub admins rights over hub competitions, including later-attached", async () => {
    const { owner, admin } = await setup();
    const hub = await createHub(owner.agent, uniq("Hub"));
    createdHubs.push(hub.id);
    const attached = await createCompetition(owner.agent, uniq("Attached"), hub.id);
    createdComps.push(attached.id);

    const add = await owner.agent
      .post(`/api/v1/organizers/${hub.id}/admins`)
      .send({ userId: admin.user.id });
    expect(add.status).toBe(201);

    // Hub admin can operate the already-attached competition…
    const patch = await admin.agent
      .patch(`/api/v1/competitions/${attached.id}`)
      .send({ location: "Updated by hub admin" });
    expect(patch.status).toBe(200);

    // …and one attached AFTER the grant.
    const later = await createCompetition(owner.agent, uniq("Later"));
    createdComps.push(later.id);
    const attach = await owner.agent
      .post(`/api/v1/organizers/${hub.id}/competitions`)
      .send({ competitionId: later.id, attach: true });
    expect(attach.status).toBe(200);
    const patchLater = await admin.agent
      .patch(`/api/v1/competitions/${later.id}`)
      .send({ location: "Also managed" });
    expect(patchLater.status).toBe(200);

    // /my lists include the admin'd items with accessRole "admin".
    const myOrgs = await admin.agent.get(`/api/v1/my/organizers`);
    const hubRow = myOrgs.body.data.find((o: { id: string }) => o.id === hub.id);
    expect(hubRow?.accessRole).toBe("admin");
    const myComps = await admin.agent.get(`/api/v1/my/competitions`);
    const ids = myComps.body.data.map((c: { id: string }) => c.id);
    expect(ids).toContain(attached.id);
    expect(ids).toContain(later.id);
    const laterRow = myComps.body.data.find((c: { id: string }) => c.id === later.id);
    expect(laterRow.accessRole).toBe("admin");

    // Hub page exposes viewerCanManage (admin) without viewerIsOwner.
    const hubPage = await admin.agent.get(`/api/v1/organizers/${hub.slug}`);
    expect(hubPage.status).toBe(200);
    expect(hubPage.body.organizer.viewerCanManage).toBe(true);
    expect(hubPage.body.organizer.viewerIsOwner).toBe(false);
  });

  it("keeps per-competition admins scoped to that competition", async () => {
    const { owner, admin } = await setup();
    const compA = await createCompetition(owner.agent, uniq("Comp A"));
    const compB = await createCompetition(owner.agent, uniq("Comp B"));
    createdComps.push(compA.id, compB.id);

    await owner.agent
      .post(`/api/v1/competitions/${compA.id}/admins`)
      .send({ userId: admin.user.id });

    const patchA = await admin.agent
      .patch(`/api/v1/competitions/${compA.id}`)
      .send({ location: "Scoped OK" });
    expect(patchA.status).toBe(200);

    const patchB = await admin.agent
      .patch(`/api/v1/competitions/${compB.id}`)
      .send({ location: "Should fail" });
    expect(patchB.status).toBe(403);

    const myComps = await admin.agent.get(`/api/v1/my/competitions`);
    const ids = myComps.body.data.map((c: { id: string }) => c.id);
    expect(ids).toContain(compA.id);
    expect(ids).not.toContain(compB.id);
  });

  it("blocks minors from being added, accepting invites, and appearing in search", async () => {
    const { owner, admin } = await setup();
    const comp = await createCompetition(owner.agent, uniq("Comp"));
    createdComps.push(comp.id);

    // Temporarily flag the would-be admin as a minor.
    await db.update(users).set({ isMinor: true }).where(eq(users.id, admin.user.id));
    minorFlagged.push(admin.user.id);

    const add = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/admins`)
      .send({ userId: admin.user.id });
    expect(add.status).toBe(403);
    expect(add.body.code).toBe("MINORS_NOT_ELIGIBLE");

    // Invite to the minor's email is blocked up front.
    const invite = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/admin-invites`)
      .send({ email: admin.user.email });
    expect(invite.status).toBe(403);
    expect(invite.body.code).toBe("MINORS_NOT_ELIGIBLE");

    // A minor can never accept an invite addressed to a fresh email.
    const invite2 = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/admin-invites`)
      .send({ email: `t745-${Date.now()}@example.com` });
    expect(invite2.status).toBe(201);
    const token = String(invite2.body.acceptUrl).split("/admin-invites/")[1].split("?")[0];
    const accept = await admin.agent.post(`/api/v1/admin-invites/${token}/accept`);
    expect(accept.status).toBe(403);
    expect(accept.body.code).toBe("MINORS_NOT_ELIGIBLE");

    // Minors never surface in the admin user-search picker.
    const search = await owner.agent.get(
      `/api/v1/competition-admin-user-search?q=${encodeURIComponent(admin.user.firstName)}`,
    );
    expect(search.status).toBe(200);
    expect(
      search.body.data.find((u: { id: string }) => u.id === admin.user.id),
    ).toBeUndefined();
  });

  it("runs the invite lifecycle: create, preview, rotate link, accept (idempotent)", async () => {
    const { owner, admin } = await setup();
    const hub = await createHub(owner.agent, uniq("Hub"));
    createdHubs.push(hub.id);

    const invite = await owner.agent
      .post(`/api/v1/organizers/${hub.id}/admin-invites`)
      .send({ email: admin.user.email });
    expect(invite.status).toBe(201);
    expect(invite.body.status).toBe("pending");
    expect(typeof invite.body.acceptUrl).toBe("string");

    // Duplicate pending invite → 409.
    const dup = await owner.agent
      .post(`/api/v1/organizers/${hub.id}/admin-invites`)
      .send({ email: admin.user.email });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("INVITE_ALREADY_PENDING");

    // Rotate the link — the old token stops working, the new one previews.
    const oldToken = String(invite.body.acceptUrl).split("/admin-invites/")[1];
    const rotate = await owner.agent.post(
      `/api/v1/organizers/${hub.id}/admin-invites/${invite.body.id}/link`,
    );
    expect(rotate.status).toBe(200);
    const newToken = String(rotate.body.acceptUrl).split("/admin-invites/")[1];
    expect(newToken).not.toBe(oldToken);
    const oldPreview = await owner.agent.get(`/api/v1/admin-invites/${oldToken}/preview`);
    expect(oldPreview.status).toBe(404);
    const preview = await owner.agent.get(`/api/v1/admin-invites/${newToken}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.target.kind).toBe("hub");
    expect(preview.body.target.id).toBe(hub.id);

    // Accept grants hub-admin membership; a second accept 410s (resolved).
    const accept = await admin.agent.post(`/api/v1/admin-invites/${newToken}/accept`);
    expect(accept.status).toBe(200);
    expect(accept.body.target.slug).toBe(hub.slug);
    const membership = await db
      .select()
      .from(organizerAdmins)
      .where(eq(organizerAdmins.organizerId, hub.id));
    expect(membership.some((m) => m.userId === admin.user.id)).toBe(true);
    const again = await admin.agent.post(`/api/v1/admin-invites/${newToken}/accept`);
    expect(again.status).toBe(410);
  });

  it("lets a manager withdraw a pending invite; withdrawn invites can't be accepted", async () => {
    const { owner, admin } = await setup();
    const comp = await createCompetition(owner.agent, uniq("Comp"));
    createdComps.push(comp.id);

    const invite = await owner.agent
      .post(`/api/v1/competitions/${comp.id}/admin-invites`)
      .send({ email: `t745-w-${Date.now()}@example.com` });
    expect(invite.status).toBe(201);
    const token = String(invite.body.acceptUrl).split("/admin-invites/")[1];

    const withdraw = await owner.agent.delete(
      `/api/v1/competitions/${comp.id}/admin-invites/${invite.body.id}`,
    );
    expect(withdraw.status).toBe(200);
    expect(withdraw.body.status).toBe("withdrawn");

    const list = await owner.agent.get(`/api/v1/competitions/${comp.id}/admin-invites`);
    expect(list.status).toBe(200);
    expect(
      list.body.data.find((i: { id: string }) => i.id === invite.body.id),
    ).toBeUndefined();

    const accept = await admin.agent.post(`/api/v1/admin-invites/${token}/accept`);
    expect(accept.status).toBe(410);
  });
});
