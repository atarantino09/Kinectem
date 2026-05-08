// Task #394 — parent auto-follows child's team and the team surfaces
// under the parent's profile Teams section as a synthesized
// `position: "parent"` row.

import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  organizations,
  rosterEntries,
  rosterInvites,
  teamFollowers,
  teams,
  users,
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

async function countFollow(teamId: string, userId: string): Promise<number> {
  const rows = await db
    .select({ teamId: teamFollowers.teamId })
    .from(teamFollowers)
    .where(
      and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, userId)),
    );
  return rows.length;
}

describe("Task #394 — parent auto-follows child's team", () => {
  it("auto-follows the parent when a coach adds a child to a team (and is idempotent)", async () => {
    const { teamId } = await getFootballTeam();
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");

    // Reset Samira on this team and any prior follow row
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    await db
      .delete(teamFollowers)
      .where(
        and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, lisaId)),
      );

    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const res = await coach
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: samiraId, position: "player" });
    expect(res.status).toBe(201);

    expect(await countFollow(teamId, lisaId)).toBe(1);

    // Re-add (after reset) must not produce a duplicate follow row.
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    const res2 = await coach
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: samiraId, position: "player" });
    expect(res2.status).toBe(201);
    expect(await countFollow(teamId, lisaId)).toBe(1);
  });

  it("does NOT auto-follow when the added user has no parent", async () => {
    const { teamId } = await getFootballTeam();
    const marcusId = await findUserId("marcus@kinectem.demo");

    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, marcusId),
        ),
      );

    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const res = await coach
      .post(`/api/v1/teams/${teamId}/members`)
      .send({ userId: marcusId, position: "player" });
    expect(res.status).toBe(201);

    // Marcus is parent-less; no synthesized parent follow should appear.
    const rows = await db
      .select({ userId: teamFollowers.userId })
      .from(teamFollowers)
      .where(eq(teamFollowers.teamId, teamId));
    // None of the followers should equal Marcus's parent (he has none).
    // Sanity check that no spurious follow row was created for Marcus
    // himself either.
    expect(rows.find((r) => r.userId === marcusId)).toBeUndefined();
  });

  it("auto-follows the parent on the email-invite branch (existing user with parent)", async () => {
    const { teamId } = await getFootballTeam();
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    const [samira] = await db
      .select()
      .from(users)
      .where(eq(users.id, samiraId))
      .limit(1);
    expect(samira?.email).toBeTruthy();

    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    await db
      .delete(teamFollowers)
      .where(
        and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, lisaId)),
      );

    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const res = await coach
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: samira!.email, position: "player" });
    expect(res.status).toBe(201);

    expect(await countFollow(teamId, lisaId)).toBe(1);
  });

  it("auto-follows when a parent accepts an invite and adds a child via /invites/:token/children", async () => {
    const { teamId } = await getFootballTeam();
    const lisaId = await findUserId("lisa@kinectem.demo");

    // Forge a player invite tied to Lisa's email so the parent-inbox
    // flow accepts her as the inviter and lets her add a new child.
    const token = `task394-test-${Date.now()}`;
    await db.insert(rosterInvites).values({
      token,
      teamId,
      invitedEmail: "lisa@kinectem.demo",
      role: "player",
      position: "player",
      status: "pending",
    });

    await db
      .delete(teamFollowers)
      .where(
        and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, lisaId)),
      );

    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const res = await lisa
      .post(`/api/v1/invites/${token}/children`)
      .send({ firstName: "Task394", lastName: "Child" });
    expect(res.status).toBe(201);

    expect(await countFollow(teamId, lisaId)).toBe(1);
  });

  it("backfills follows when a parent links an existing rostered child via POST /users/me/children", async () => {
    const { teamId } = await getFootballTeam();
    const lisaId = await findUserId("lisa@kinectem.demo");

    // Create an unlinked athlete who is already accepted on the team,
    // then have Lisa link them as her child. Backfill must auto-follow.
    const [orphan] = await db
      .insert(users)
      .values({
        name: "Task394 Orphan",
        role: "athlete",
        email: null,
        parentId: null,
      })
      .returning();
    await db.insert(rosterEntries).values({
      teamId,
      userId: orphan.id,
      role: "player",
      status: "accepted",
      position: "player",
    });
    await db
      .delete(teamFollowers)
      .where(
        and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, lisaId)),
      );

    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const res = await lisa
      .post(`/api/v1/users/me/children`)
      .send({ childId: orphan.id });
    expect(res.status).toBe(201);

    expect(await countFollow(teamId, lisaId)).toBe(1);
  });

  it("surfaces the team on the parent's profile as a synthesized position=\"parent\" row", async () => {
    const { teamId, orgId } = await getFootballTeam();
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");

    // Make sure Samira is accepted on the team and the follow row exists.
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    await db.insert(rosterEntries).values({
      teamId,
      userId: samiraId,
      role: "player",
      status: "accepted",
      position: "player",
    });
    await db
      .insert(teamFollowers)
      .values({ teamId, userId: lisaId })
      .onConflictDoNothing();

    // Marcus (a stranger) views Lisa's profile teams — Lisa isn't on
    // any roster, so the only way this team appears is the via-child
    // synthesized row.
    const { agent: marcus } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const res = await marcus.get(`/api/v1/users/${lisaId}/teams`);
    expect(res.status).toBe(200);
    const data = res.body.data as Array<{
      teamId: string;
      role: string;
      position: string | null;
      status: string;
      organization: { id: string };
    }>;
    const row = data.find((d) => d.teamId === teamId);
    expect(row).toBeDefined();
    expect(row?.role).toBe("member");
    expect(row?.position).toBe("parent");
    expect(row?.status).toBe("active");
    expect(row?.organization.id).toBe(orgId);

    // Pending child rosters must NOT surface as a via-child row — only
    // accepted ones count.
    await db
      .update(rosterEntries)
      .set({ status: "pending" })
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    const res2 = await marcus.get(`/api/v1/users/${lisaId}/teams`);
    expect(res2.status).toBe(200);
    const data2 = res2.body.data as Array<{ teamId: string }>;
    expect(data2.find((d) => d.teamId === teamId)).toBeUndefined();
  });

  it("de-dups: a real roster row for the parent wins over the via-child synthesized row", async () => {
    const { teamId } = await getFootballTeam();
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");

    // Child Samira accepted on the team -> would normally synthesize a
    // position="parent" row for Lisa. But Lisa is also herself on the
    // roster (as a coach) — the real row must win on de-dup.
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, samiraId),
        ),
      );
    await db.insert(rosterEntries).values({
      teamId,
      userId: samiraId,
      role: "player",
      status: "accepted",
      position: "player",
    });
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, lisaId),
        ),
      );
    await db.insert(rosterEntries).values({
      teamId,
      userId: lisaId,
      role: "coach",
      status: "accepted",
      position: "coach",
    });
    await db
      .insert(teamFollowers)
      .values({ teamId, userId: lisaId })
      .onConflictDoNothing();

    const { agent: marcus } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const res = await marcus.get(`/api/v1/users/${lisaId}/teams`);
    expect(res.status).toBe(200);
    const data = res.body.data as Array<{
      teamId: string;
      role: string;
      position: string | null;
    }>;
    const rows = data.filter((d) => d.teamId === teamId);
    // Exactly one row for the team — the real roster row, not the
    // synthesized parent row.
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("admin");
    expect(rows[0].position).toBe("coach");
    expect(rows[0].position).not.toBe("parent");

    // Cleanup so other tests aren't surprised by Lisa as a coach.
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, lisaId),
        ),
      );
  });

  it("requires no special auth for /users/:userId/teams (smoke check)", async () => {
    const lisaId = await findUserId("lisa@kinectem.demo");
    const res = await request(app).get(`/api/v1/users/${lisaId}/teams`);
    // 200 unauthenticated path: handler doesn't gate on auth except
    // for the pending-rows carve-out. Just assert it didn't 5xx.
    expect(res.status).toBeLessThan(500);
  });
});
