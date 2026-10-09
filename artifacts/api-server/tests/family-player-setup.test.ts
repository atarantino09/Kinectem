import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, users, teams, rosterEntries, rosterInvites, guardianLinks } from "@workspace/db";
import { app, loginAs, request } from "./helpers";
import { FAMILY_SETUP_MIGRATION, similarPlayerNames } from "../src/lib/family-setup";
import { sendGuardianLinkInviteEmail } from "../src/lib/email";

vi.mock("../src/lib/email", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/email")>(),
  sendGuardianLinkInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

beforeAll(async () => { await db.execute(sql.raw(FAMILY_SETUP_MIGRATION)); });
beforeEach(() => { vi.mocked(sendGuardianLinkInviteEmail).mockReset().mockResolvedValue(undefined); });

const player = (firstName = "New", lastName = "FamilyPlayer") => ({ firstName, lastName, setupRequestId: randomUUID() });
const familyUrl = "/api/v1/family/setup/children";

async function sharedInvite(invitedEmail: string | null = null) {
  const [team] = await db.select().from(teams).limit(1);
  const token = `family-test-${randomUUID()}`;
  const [invite] = await db.insert(rosterInvites).values({
    teamId: team!.id, role: "player", position: "player", token, status: "pending", invitedEmail,
  }).returning();
  return { team: team!, invite: invite!, url: `/api/v1/invites/${token}/children` };
}

describe("one shared player per family setup", () => {
  it("requires an authenticated adult and a valid setup request", async () => {
    expect((await request(app).post(familyUrl).send(player())).status).toBe(401);
    const { agent } = await loginAs("lisa@kinectem.demo");
    expect((await agent.post(familyUrl).send({ firstName: "New", lastName: "Child" })).body.code).toBe("SETUP_REQUEST_REQUIRED");
    const { agent: minor } = await loginAs("samira@kinectem.demo");
    expect((await minor.post(familyUrl).send(player())).status).toBe(403);
  });

  it("atomically creates the child and active guardian, and returns the same child on concurrent retries", async () => {
    const { agent, user } = await loginAs("lisa@kinectem.demo");
    const input = player();
    const results = await Promise.all([agent.post(familyUrl).send(input), agent.post(familyUrl).send(input)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0]!.body.child.id).toBe(results[1]!.body.child.id);
    const receipt = await agent.get(`/api/v1/family/setup/requests/${input.setupRequestId}`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.child.id).toBe(results[0]!.body.child.id);
    const { agent: other } = await loginAs("coach@kinectem.demo");
    expect((await other.get(`/api/v1/family/setup/requests/${input.setupRequestId}`)).status).toBe(404);
    const links = await db.select().from(guardianLinks).where(and(
      eq(guardianLinks.childId, results[0]!.body.child.id), eq(guardianLinks.guardianId, user.id),
    ));
    expect(links).toHaveLength(1);
    expect(links[0]!.status).toBe("active");
    const changed = await agent.post(familyUrl).send({ ...input, firstName: "Changed" });
    expect(changed.body.code).toBe("SETUP_REQUEST_REUSED");
  });

  it("warns for an existing family name and allows an explicitly different same-named child", async () => {
    const { agent } = await loginAs("lisa@kinectem.demo");
    const first = await agent.post(familyUrl).send(player("Casey", "SameFamily"));
    const input = player("Casey", "SameFamily");
    const warning = await agent.post(familyUrl).send(input);
    expect(warning.status).toBe(409);
    expect(warning.body.code).toBe("POSSIBLE_DUPLICATE");
    expect(warning.body.child).toBeUndefined();
    const distinct = await agent.post(familyUrl).send({ ...input, confirmDistinctPlayer: true });
    expect(distinct.status).toBe(201);
    expect(distinct.body.child.id).not.toBe(first.body.child.id);
  });

  it("serializes two parents using the same team-chat link without revealing another family's identity", async () => {
    const { agent: mom } = await loginAs("lisa@kinectem.demo");
    const { agent: dad } = await loginAs("coach@kinectem.demo");
    const { url, team } = await sharedInvite();
    const responses = await Promise.all([
      mom.post(url).send(player("Jordan", "SharedLink")),
      dad.post(url).send(player("Jordan", "SharedLink")),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const warning = responses.find((r) => r.status === 409)!;
    expect(warning.body.code).toBe("POSSIBLE_DUPLICATE");
    expect(Object.keys(warning.body).sort()).toEqual(["code", "error"]);
    const roster = await db.select().from(rosterEntries).innerJoin(users, eq(users.id, rosterEntries.userId))
      .where(and(eq(rosterEntries.teamId, team.id), eq(users.name, "Jordan SharedLink")));
    expect(roster).toHaveLength(1);
  });

  it("adds a linked child once, including concurrent requests and browser retries", async () => {
    const { agent } = await loginAs("lisa@kinectem.demo");
    const children = await agent.get("/api/v1/users/me/children");
    const childId = children.body.data[0].id;
    const { url, team } = await sharedInvite();
    const responses = await Promise.all([agent.post(url).send({ childId }), agent.post(url).send({ childId })]);
    expect(responses.every((r) => r.status === 201)).toBe(true);
    const entries = await db.select().from(rosterEntries).where(and(eq(rosterEntries.teamId, team.id), eq(rosterEntries.userId, childId)));
    expect(entries).toHaveLength(1);
  });

  it("does not grant access to an unlinked child by id or name", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");
    const [child] = await db.select().from(users).where(eq(users.email, "samira@kinectem.demo"));
    const { url } = await sharedInvite();
    const result = await agent.post(url).send({ childId: child!.id });
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("Child not found.");
  });

  it("resumes a targeted player invitation only for its recipient", async () => {
    const { agent } = await loginAs("lisa@kinectem.demo");
    const { invite, url } = await sharedInvite("lisa@kinectem.demo");
    const acceptUrl = `/api/v1/invites/${invite.token}/accept`;
    expect((await agent.post(acceptUrl)).body.requiresChildSetup).toBe(true);
    expect((await agent.post(acceptUrl)).body.requiresChildSetup).toBe(true);
    const input = player();
    expect((await agent.post(url).send(input)).status).toBe(201);
    const { agent: other } = await loginAs("coach@kinectem.demo");
    expect((await other.post(url).send(player("Other", "Child"))).status).toBe(403);
  });

  it("blocks archived teams and withdrawn links before creating a child", async () => {
    const { agent } = await loginAs("lisa@kinectem.demo");
    const { url, team, invite } = await sharedInvite();
    await db.update(teams).set({ archivedAt: new Date() }).where(eq(teams.id, team.id));
    expect((await agent.post(url).send(player())).body.code).toBe("INVITE_UNAVAILABLE");
    await db.update(teams).set({ archivedAt: null }).where(eq(teams.id, team.id));
    await db.update(rosterInvites).set({ status: "revoked" }).where(eq(rosterInvites.id, invite.id));
    expect((await agent.post(url).send(player())).body.code).toBe("INVITE_UNAVAILABLE");
  });

  it("retries failed guardian email delivery without another invitation, and deduplicates simultaneous invitations", async () => {
    const { agent } = await loginAs("lisa@kinectem.demo");
    const created = await agent.post(familyUrl).send(player());
    const url = `/api/v1/users/${created.body.child.id}/guardians/invite`;
    const input = { firstName: "Other", lastName: "Parent", email: "other-parent@example.test", relationshipType: "parent" };
    vi.mocked(sendGuardianLinkInviteEmail).mockRejectedValueOnce(new Error("simulated delivery failure"));
    const failed = await agent.post(url).send(input);
    expect(failed.status).toBe(201);
    expect(failed.body.emailSent).toBe(false);
    const responses = await Promise.all([agent.post(url).send(input), agent.post(url).send(input)]);
    expect(responses.every((r) => r.body.id === failed.body.id)).toBe(true);
    const links = await db.select().from(guardianLinks).where(eq(guardianLinks.childId, created.body.child.id));
    expect(links.filter((l) => l.status === "pending")).toHaveLength(1);
    expect(vi.mocked(sendGuardianLinkInviteEmail)).toHaveBeenCalledTimes(2);
    const latest = await agent.post(url).send(input);
    expect(latest.body.emailSent).toBe(true);
    expect(latest.body.status).toBe("pending");
  });

  it("treats normalized and nickname-like names as advisory, not identity", () => {
    expect(similarPlayerNames("Nicolas Rótondo", "Nico Rotondo")).toBe(true);
    expect(similarPlayerNames("Ann Smith", "Anna Smith")).toBe(true);
    expect(similarPlayerNames("Alex Smith", "Alex Jones")).toBe(false);
  });
});
