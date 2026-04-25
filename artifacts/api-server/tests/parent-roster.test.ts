import { describe, expect, it } from "vitest";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  notifications,
  rosterEntries,
  users,
  organizations,
  teams,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";

async function getFootballTeam(): Promise<{ teamId: string; orgId: string }> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, "Westfield Athletic Club"))
    .limit(1);
  if (!org) throw new Error("Westfield org missing from seed");
  const [t] = await db
    .select()
    .from(teams)
    .where(
      and(eq(teams.organizationId, org.id), eq(teams.name, "Varsity Football")),
    )
    .limit(1);
  if (!t) throw new Error("Varsity Football missing from seed");
  return { teamId: t.id, orgId: org.id };
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

describe("parent-controlled team membership", () => {
  it("notifies BOTH the child athlete AND their guardian when added to a team", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");

    const before = Date.now();
    const res = await coach
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: samiraId, position: "player" });
    expect(res.status).toBe(201);

    // Child got the existing notification
    const childRows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, samiraId),
          eq(notifications.kind, "roster_invite"),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(1);
    expect(childRows.length).toBe(1);
    expect(childRows[0].createdAt!.getTime()).toBeGreaterThanOrEqual(before);

    // Parent got the new fan-out notification
    const parentRows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, lisaId),
          eq(notifications.kind, "roster_invite_for_child"),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(1);
    expect(parentRows.length).toBe(1);
    const parentNotif = parentRows[0];
    expect(parentNotif.message).toMatch(/Samira/);
    expect(parentNotif.message).toMatch(/Varsity Football/);
    expect(parentNotif.link).toMatch(/childId=/);
    expect(parentNotif.link).toMatch(/entryId=/);
    expect(parentNotif.link).toMatch(/teamId=/);
  });

  it("does NOT fan out a guardian notification when the athlete has no parent", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    // Marcus is an adult athlete with no parentId. Adding him should
    // produce only his own notification, no fan-out row.
    const marcusId = await findUserId("marcus@kinectem.demo");

    // Marcus is already on the seed roster, so use Jordan instead — also
    // an adult with no parent. If both are seeded, find a roster-less one.
    const candidateId = (await findUserId("jordan@kinectem.demo")) || marcusId;

    // Wipe any preexisting roster entry to make this test idempotent
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, candidateId),
        ),
      );

    // Sanity: candidate truly has no parent before we exercise the path
    const [u] = await db
      .select({ parentId: users.parentId })
      .from(users)
      .where(eq(users.id, candidateId))
      .limit(1);
    expect(u?.parentId).toBeFalsy();

    // Snapshot every existing roster_invite_for_child notification so we can
    // assert no NEW one was created by this invite.
    const before = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.kind, "roster_invite_for_child"));
    const beforeIds = new Set(before.map((n) => n.id));

    const res = await coach
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: candidateId, position: "player" });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    // No new fan-out row anywhere in the table — the parentless branch
    // must never insert a roster_invite_for_child notification.
    const after = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.kind, "roster_invite_for_child"));
    const newOnes = after.filter((n) => !beforeIds.has(n.id));
    expect(newOnes).toHaveLength(0);
  });

  it("lets a real parent accept a child's pending roster spot", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const samiraId = await findUserId("samira@kinectem.demo");

    // Reset Samira on this team so we have a known pending row
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    const created = await coach
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: samiraId, position: "player" });
    expect(created.status).toBe(201);
    const entryId = created.body.id;
    expect(entryId).toBeTruthy();

    // Lisa (Samira's parent) accepts on her behalf
    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const accept = await lisa
      .post(`/api/v1/teams/${teamId}/members/${entryId}/accept`)
      .send({});
    expect(accept.status).toBe(200);

    const [row] = await db
      .select()
      .from(rosterEntries)
      .where(eq(rosterEntries.id, entryId))
      .limit(1);
    expect(row?.status).toBe("accepted");
  });

  it("lets a real parent decline a child's pending roster spot", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const samiraId = await findUserId("samira@kinectem.demo");

    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    const created = await coach
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: samiraId, position: "player" });
    const entryId = created.body.id;

    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const decline = await lisa
      .post(`/api/v1/teams/${teamId}/members/${entryId}/decline`)
      .send({});
    expect(decline.status).toBe(204);

    const rows = await db
      .select()
      .from(rosterEntries)
      .where(eq(rosterEntries.id, entryId))
      .limit(1);
    expect(rows.length).toBe(0);
  });

  it("forbids a stranger from acting on a child's roster spot", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const samiraId = await findUserId("samira@kinectem.demo");

    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    const created = await coach
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: samiraId, position: "player" });
    const entryId = created.body.id;

    // Marcus is unrelated to Samira
    const { agent: stranger } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const accept = await stranger
      .post(`/api/v1/teams/${teamId}/members/${entryId}/accept`)
      .send({});
    expect(accept.status).toBe(403);
    const decline = await stranger
      .post(`/api/v1/teams/${teamId}/members/${entryId}/decline`)
      .send({});
    expect(decline.status).toBe(403);
  });
});

describe("guardian pending team invites", () => {
  it("lets a parent list their child's pending team invites", async () => {
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const samiraId = await findUserId("samira@kinectem.demo");

    // Reset Samira so we have exactly one known pending row on this team
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    const created = await coach
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: samiraId, position: "player" });
    expect(created.status).toBe(201);
    const entryId = created.body.id as string;

    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const res = await lisa.get(
      `/api/v1/users/me/children/${samiraId}/pending-team-invites`,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as Array<{
      entryId: string;
      teamId: string;
      teamName: string;
      organization: { id: string; name: string };
      role: string;
      position: string | null;
      invitedAt: string;
    }>;
    const row = data.find((d) => d.entryId === entryId);
    expect(row).toBeDefined();
    expect(row?.teamId).toBe(teamId);
    expect(row?.teamName).toBe("Varsity Football");
    expect(row?.organization.id).toBe(orgId);
    expect(row?.role).toBe("player");
    expect(row?.invitedAt).toBeTruthy();
  });

  it("forbids a non-guardian from listing a child's pending invites", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const { agent: stranger } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const res = await stranger.get(
      `/api/v1/users/me/children/${samiraId}/pending-team-invites`,
    );
    expect(res.status).toBe(403);
  });

  it("requires an authenticated session to list pending invites", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const res = await request(app).get(
      `/api/v1/users/me/children/${samiraId}/pending-team-invites`,
    );
    expect(res.status).toBe(401);
  });

  it("excludes accepted/declined entries from the pending list", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const samiraId = await findUserId("samira@kinectem.demo");

    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    const created = await coach
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: samiraId, position: "player" });
    const entryId = created.body.id as string;

    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const accept = await lisa
      .post(`/api/v1/teams/${teamId}/members/${entryId}/accept`)
      .send({});
    expect(accept.status).toBe(200);

    const res = await lisa.get(
      `/api/v1/users/me/children/${samiraId}/pending-team-invites`,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as Array<{ entryId: string }>;
    expect(data.find((d) => d.entryId === entryId)).toBeUndefined();
  });
});

describe("email-invite path fan-out to guardians", () => {
  it("notifies the linked parent when a coach emails an existing child by email", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    const [samira] = await db
      .select()
      .from(users)
      .where(eq(users.id, samiraId))
      .limit(1);
    expect(samira?.email).toBeTruthy();

    // Wipe any existing roster entry so the email-invite path takes the
    // "create + fan-out" branch rather than the no-op short-circuit.
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );

    const before = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, lisaId),
          eq(notifications.kind, "roster_invite_for_child"),
        ),
      );
    const beforeIds = new Set(before.map((n) => n.id));

    const res = await coach
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: samira!.email, position: "player" });
    expect(res.status).toBe(201);

    // Pending roster row was created for the matched user.
    const [entry] = await db
      .select()
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      )
      .limit(1);
    expect(entry).toBeDefined();
    expect(entry?.status).toBe("pending");

    // Parent got the new fan-out notification with the right deep-link.
    const after = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, lisaId),
          eq(notifications.kind, "roster_invite_for_child"),
        ),
      )
      .orderBy(desc(notifications.createdAt));
    const newOnes = after.filter((n) => !beforeIds.has(n.id));
    expect(newOnes.length).toBeGreaterThanOrEqual(1);
    const fresh = newOnes[0];
    expect(fresh.message).toMatch(/Samira/);
    expect(fresh.message).toMatch(/Varsity Football/);
    expect(fresh.link).toMatch(/childId=/);
    expect(fresh.link).toMatch(/entryId=/);
    expect(fresh.link).toMatch(/teamId=/);
  });

  it("does not double-fan-out when the existing user already has a roster row", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    const [samira] = await db
      .select()
      .from(users)
      .where(eq(users.id, samiraId))
      .limit(1);

    // Seed the roster row first via the direct-add path (which itself
    // produces a fan-out). The follow-up email invite should NOT add a
    // second notification because there's nothing new to react to.
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    await coach
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: samiraId, position: "player" });

    const before = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, lisaId),
          eq(notifications.kind, "roster_invite_for_child"),
        ),
      );
    const beforeCount = before.length;

    const res = await coach
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: samira!.email, position: "player" });
    expect(res.status).toBe(201);

    const after = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, lisaId),
          eq(notifications.kind, "roster_invite_for_child"),
        ),
      );
    expect(after.length).toBe(beforeCount);
  });
});

describe("/users/:userId visibility", () => {
  it("hides pending team rows from strangers but shows them to the parent", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const samiraId = await findUserId("samira@kinectem.demo");

    // Make sure Samira has at least one pending row
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    await coach
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: samiraId, position: "player" });

    // Stranger view: should NOT see pending teams
    const { agent: stranger } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const strangerView = await stranger.get(`/api/v1/users/${samiraId}/teams`);
    expect(strangerView.status).toBe(200);
    const strangerTeams = strangerView.body.data as Array<{
      teamId: string;
      status: string;
    }>;
    const strangerHasPending = strangerTeams.some(
      (t) => t.teamId === teamId && t.status === "pending",
    );
    expect(strangerHasPending).toBe(false);

    // Parent view: SHOULD see the pending row with status "pending"
    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const parentView = await lisa.get(`/api/v1/users/${samiraId}/teams`);
    expect(parentView.status).toBe(200);
    const parentTeams = parentView.body.data as Array<{
      teamId: string;
      status: string;
    }>;
    const parentSeesPending = parentTeams.some(
      (t) => t.teamId === teamId && t.status === "pending",
    );
    expect(parentSeesPending).toBe(true);
  });

  it("returns linkedAccounts.children on a parent's profile to any logged-in viewer", async () => {
    const lisaId = await findUserId("lisa@kinectem.demo");
    const samiraId = await findUserId("samira@kinectem.demo");

    // Marcus, an unrelated logged-in user, should still see Lisa's children
    const { agent: marcus } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const res = await marcus.get(`/api/v1/users/${lisaId}`);
    expect(res.status).toBe(200);
    const linked = res.body.linkedAccounts;
    expect(linked).toBeTruthy();
    expect(Array.isArray(linked.children)).toBe(true);
    const childIds = linked.children.map(
      (c: { id: string }) => c.id,
    ) as string[];
    expect(childIds).toContain(samiraId);
    // Strangers should NOT see the parent's own parents (they have none
    // anyway, so just assert the section is empty and the field is the
    // expected shape).
    expect(Array.isArray(linked.parents)).toBe(true);
  });

  it("does NOT leak soft-deleted children through a parent's linkedAccounts", async () => {
    // Create a synthetic deleted child for this test so we don't disturb
    // the seeded family. We mark Lisa as the parent then soft-delete the
    // new child by stamping `deletedAt`. Without the deletedAt filter on
    // the children query, this row would surface to any logged-in viewer
    // through GET /users/<lisaId>.
    const lisaId = await findUserId("lisa@kinectem.demo");
    const [ghost] = await db
      .insert(users)
      .values({
        name: "Ghost Child Carter",
        role: "athlete",
        email: null,
        parentId: lisaId,
        deletedAt: new Date(),
      })
      .returning();
    expect(ghost?.id).toBeTruthy();

    try {
      const { agent: marcus } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      const res = await marcus.get(`/api/v1/users/${lisaId}`);
      expect(res.status).toBe(200);
      const children = (res.body.linkedAccounts?.children ?? []) as Array<{
        id: string;
      }>;
      const ids = children.map((c) => c.id);
      expect(ids).not.toContain(ghost.id);
    } finally {
      // Clean up so the test is idempotent across runs against a shared db.
      await db.delete(users).where(eq(users.id, ghost.id));
    }
  });
});
