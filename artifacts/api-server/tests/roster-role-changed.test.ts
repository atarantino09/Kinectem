import { describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  notifications,
  organizations,
  rosterEntries,
  teams,
  users,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";

// Task #536 — Notify a roster member (and their guardian) when a
// coach/admin changes their position via PATCH. Mirrors the existing
// `roster_invite` fan-out tests in parent-roster.test.ts, but for the
// role-change path on an already-active entry.

async function getWestfield(): Promise<string> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, "Westfield Athletic Club"))
    .limit(1);
  if (!org) throw new Error("Westfield org missing from seed");
  return org.id;
}

async function findUserId(email: string): Promise<string> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) throw new Error(`User ${email} missing from seed`);
  return u.id;
}

// Build a fresh team owned by Sam (auto-added as the only Admin) and
// drop in `targetUserId` as a player so we have something to promote.
// Returns the entryId of the freshly-added member so the test can PATCH
// it directly without bumping into seeded rosters.
async function freshTeamWithMember(
  name: string,
  targetUserId: string,
  initialPosition = "player",
): Promise<{
  teamId: string;
  memberId: string;
  sam: { id: string; email: string | null };
}> {
  const orgId = await getWestfield();
  const { agent, user: sam } = await loginAs(
    (u) => u.email === "sam@kinectem.demo",
  );
  const create = await agent
    .post(`/api/v1/organizations/${orgId}/teams`)
    .send({ name, sport: "Soccer" });
  if (create.status !== 201) {
    throw new Error(`Failed to create team ${name}: ${create.text}`);
  }
  const teamId = create.body.id as string;
  const add = await agent
    .post(`/api/v1/teams/${teamId}/members`)
    .send({ userId: targetUserId, position: initialPosition });
  if (add.status !== 201) {
    throw new Error(`Failed to add member: ${add.text}`);
  }
  return { teamId, memberId: add.body.id as string, sam };
}

async function getNotifsSince(
  userId: string,
  kind: string,
  since: number,
): Promise<typeof notifications.$inferSelect[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.userId, userId), eq(notifications.kind, kind)),
    )
    .orderBy(desc(notifications.createdAt));
  return rows.filter((r) => (r.createdAt?.getTime() ?? 0) >= since);
}

describe("PATCH /teams/:teamId/members/:memberId — role-change notifications", () => {
  it("notifies BOTH the affected member and their linked guardian when the position changes", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    const { agent: sam } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const { teamId, memberId } = await freshTeamWithMember(
      "Role-Change Notify Team",
      samiraId,
      "player",
    );

    const before = Date.now();
    const patch = await sam
      .patch(`/api/v1/teams/${teamId}/members/${memberId}`)
      .send({ position: "author" });
    expect(patch.status).toBe(200);
    expect(patch.body.position).toBe("author");

    const memberRows = await getNotifsSince(
      samiraId,
      "roster_role_changed",
      before,
    );
    expect(memberRows.length).toBe(1);
    const memberNotif = memberRows[0];
    expect(memberNotif.message).toMatch(/Role-Change Notify Team/);
    expect(memberNotif.message).toMatch(/Author/);
    expect(memberNotif.link).toBe(
      `/teams/${teamId}?roster=1&entryId=${memberId}`,
    );

    const parentRows = await getNotifsSince(
      lisaId,
      "roster_role_changed_for_child",
      before,
    );
    expect(parentRows.length).toBe(1);
    const parentNotif = parentRows[0];
    expect(parentNotif.message).toMatch(/Samira/);
    expect(parentNotif.message).toMatch(/Role-Change Notify Team/);
    expect(parentNotif.message).toMatch(/Author/);
    expect(parentNotif.link).toMatch(new RegExp(`childId=${samiraId}`));
    expect(parentNotif.link).toMatch(new RegExp(`entryId=${memberId}`));
    expect(parentNotif.link).toMatch(new RegExp(`teamId=${teamId}`));
  });

  it("does NOT notify when the PATCH only changes jerseyNumber", async () => {
    const marcusId = await findUserId("marcus@kinectem.demo");
    const { teamId, memberId } = await freshTeamWithMember(
      "Jersey-Only Team",
      marcusId,
      "player",
    );
    const { agent: sam } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const before = Date.now();
    const res = await sam
      .patch(`/api/v1/teams/${teamId}/members/${memberId}`)
      .send({ jerseyNumber: 7 });
    expect(res.status).toBe(200);
    expect(res.body.jerseyNumber).toBe(7);

    const memberRows = await getNotifsSince(
      marcusId,
      "roster_role_changed",
      before,
    );
    expect(memberRows).toHaveLength(0);
  });

  it("does NOT notify when the PATCHed position is unchanged", async () => {
    const marcusId = await findUserId("marcus@kinectem.demo");
    const { teamId, memberId } = await freshTeamWithMember(
      "No-Op Position Team",
      marcusId,
      "player",
    );
    const { agent: sam } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const before = Date.now();
    const res = await sam
      .patch(`/api/v1/teams/${teamId}/members/${memberId}`)
      .send({ position: "player" });
    expect(res.status).toBe(200);

    const memberRows = await getNotifsSince(
      marcusId,
      "roster_role_changed",
      before,
    );
    expect(memberRows).toHaveLength(0);
  });

  it("does NOT notify when the actor is editing their own row", async () => {
    // Sam is auto-added as admin to a freshly created team. Add Marcus
    // as a second admin and force his entry to `accepted` so the
    // last-admin guard doesn't block Sam's self-demote.
    const marcusId = await findUserId("marcus@kinectem.demo");
    const { teamId, memberId: marcusMemberId, sam } = await freshTeamWithMember(
      "Self-Edit Team",
      marcusId,
      "admin",
    );
    await db
      .update(rosterEntries)
      .set({ status: "accepted" })
      .where(eq(rosterEntries.id, marcusMemberId));

    const { agent: samAgent } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );

    // Find Sam's own roster entry on this team.
    const members = await request(app).get(`/api/v1/teams/${teamId}/members`);
    const samRow = (members.body.data as Array<{ id: string; userId: string }>)
      .find((m) => m.userId === sam.id);
    expect(samRow).toBeDefined();

    const before = Date.now();
    const res = await samAgent
      .patch(`/api/v1/teams/${teamId}/members/${samRow!.id}`)
      .send({ position: "manager" });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe("manager");

    const selfRows = await getNotifsSince(
      sam.id,
      "roster_role_changed",
      before,
    );
    expect(selfRows).toHaveLength(0);

    // And Marcus shouldn't be pulled in either — the PATCH only changed
    // Sam's own row, not Marcus's.
    const otherRows = await getNotifsSince(
      marcusId,
      "roster_role_changed",
      before,
    );
    expect(otherRows).toHaveLength(0);
  });

  it("masks the actor's name when the actor is a minor", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const marcusId = await findUserId("marcus@kinectem.demo");
    // Set up a team where Marcus is a player and Samira is the only
    // admin doing the role change. Flip Sam to a minor for this test
    // so the write-time masking branch fires, then restore.
    const { agent: sam, user: samUser } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const orgId = await getWestfield();
    const create = await sam
      .post(`/api/v1/organizations/${orgId}/teams`)
      .send({ name: "Minor-Actor Mask Team", sport: "Soccer" });
    expect(create.status).toBe(201);
    const teamId = create.body.id as string;
    const add = await sam
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: marcusId, position: "player" });
    expect(add.status).toBe(201);
    const marcusMemberId = add.body.id as string;

    // Flip the team owner to a minor briefly. Snapshot the full name so
    // we can assert the masked form and so we can restore after.
    const [samBefore] = await db
      .select({ name: users.name, isMinor: users.isMinor })
      .from(users)
      .where(eq(users.id, samUser.id))
      .limit(1);
    expect(samBefore?.name?.trim().split(/\s+/).length).toBeGreaterThan(1);
    await db
      .update(users)
      .set({ isMinor: true })
      .where(eq(users.id, samUser.id));

    try {
      const before = Date.now();
      const res = await sam
        .patch(`/api/v1/teams/${teamId}/members/${marcusMemberId}`)
        .send({ position: "assistant_coach" });
      expect(res.status).toBe(200);

      const memberRows = await getNotifsSince(
        marcusId,
        "roster_role_changed",
        before,
      );
      expect(memberRows.length).toBe(1);
      const parts = (samBefore!.name ?? "").trim().split(/\s+/);
      const first = parts[0];
      const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
      const masked = `${first} ${lastInitial}.`;
      expect(memberRows[0].message?.startsWith(masked)).toBe(true);
      // Full last name must NOT appear.
      expect(memberRows[0].message).not.toMatch(
        new RegExp(parts[parts.length - 1]),
      );
    } finally {
      await db
        .update(users)
        .set({ isMinor: samBefore?.isMinor ?? false })
        .where(eq(users.id, samUser.id));
    }
  });
});
