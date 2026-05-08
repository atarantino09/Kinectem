// Task #403 — guardian unlink (`DELETE /users/me/children/:childId`).
// Covers the happy path (parent severs the link, parentId becomes null,
// auto-followed teams are cleaned up) and the auth carve-out (a
// non-guardian cannot unlink someone else's child).

import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  organizations,
  rosterEntries,
  teamFollowers,
  teams,
  users,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";

async function getFootballTeam(): Promise<{ teamId: string }> {
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
  return { teamId: t.id };
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

describe("Task #403 — DELETE /users/me/children/:childId", () => {
  it("lets the linked guardian unlink the child and cleans up auto-followed teams", async () => {
    const { teamId } = await getFootballTeam();
    const lisaId = await findUserId("lisa@kinectem.demo");

    // Build an isolated orphan athlete on the team so we don't disturb
    // other tests' fixtures.
    const [orphan] = await db
      .insert(users)
      .values({
        name: "Task403 Orphan",
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
    // Make sure Lisa is not on this team's roster so the cleanup branch
    // is exercised (no "parent has own roster row" reason to keep
    // following the team).
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, lisaId),
        ),
      );
    await db
      .delete(teamFollowers)
      .where(
        and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, lisaId)),
      );

    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );

    // Link the orphan -> creates the auto-follow row via backfill.
    const linkRes = await lisa
      .post(`/api/v1/users/me/children`)
      .send({ childId: orphan.id });
    expect(linkRes.status).toBe(201);
    const followsBefore = await db
      .select()
      .from(teamFollowers)
      .where(
        and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, lisaId)),
      );
    expect(followsBefore).toHaveLength(1);

    // Unlink it.
    const unlinkRes = await lisa.delete(
      `/api/v1/users/me/children/${orphan.id}`,
    );
    expect(unlinkRes.status).toBe(204);

    const [after] = await db
      .select({ parentId: users.parentId })
      .from(users)
      .where(eq(users.id, orphan.id))
      .limit(1);
    expect(after?.parentId).toBeNull();

    const followsAfter = await db
      .select()
      .from(teamFollowers)
      .where(
        and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, lisaId)),
      );
    expect(followsAfter).toHaveLength(0);
  });

  it("404s when the caller is not the linked guardian (cannot unlink someone else's child)", async () => {
    const lisaId = await findUserId("lisa@kinectem.demo");
    // Fresh child wholly owned by Lisa.
    const [child] = await db
      .insert(users)
      .values({
        name: "Task403 ProtectedChild",
        role: "athlete",
        email: null,
        parentId: lisaId,
      })
      .returning();

    // Marcus is not Lisa and is not this child's parent.
    const { agent: marcus } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const res = await marcus.delete(`/api/v1/users/me/children/${child.id}`);
    expect(res.status).toBe(404);

    // Link unchanged.
    const [stillLinked] = await db
      .select({ parentId: users.parentId })
      .from(users)
      .where(eq(users.id, child.id))
      .limit(1);
    expect(stillLinked?.parentId).toBe(lisaId);

    // Cleanup.
    await db.delete(users).where(eq(users.id, child.id));
  });

  it("requires authentication", async () => {
    const res = await request(app).delete(
      `/api/v1/users/me/children/some-id`,
    );
    expect(res.status).toBe(401);
  });
});
