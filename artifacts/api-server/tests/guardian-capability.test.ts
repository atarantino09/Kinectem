// Task #400 — guardian capability is derived from `users.parentId`,
// not from `role === "parent"`. A coach (or any other role) with at
// least one linked child can use the family dashboard endpoints; a
// user with no linked children gets an empty list, not a 403.

import { describe, expect, it, afterEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { app, loginAs, request } from "./helpers";

async function findUserId(email: string): Promise<string> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) throw new Error(`User ${email} missing from seed`);
  return u.id;
}

async function unlinkChildrenOf(parentId: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.parentId, parentId));
  if (rows.length > 0) {
    await db.update(users).set({ parentId: null }).where(eq(users.parentId, parentId));
  }
  return rows.map((r) => r.id);
}

describe("Task #400 — guardian capability for non-parent roles", () => {
  // Tests adopt children to non-parent users; restore the seed link in teardown
  // so no other test is affected by the temporary reparenting.
  let cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
  });

  it("whoami exposes isGuardian=true and POST /users/me/children works for a coach who has linked a child", async () => {
    const coachId = await findUserId("coach@kinectem.demo");
    const childId = await findUserId("samira@kinectem.demo");
    // Detach Samira from her seed parent so the coach can claim her.
    const [child] = await db
      .select({ parentId: users.parentId })
      .from(users)
      .where(eq(users.id, childId))
      .limit(1);
    const originalParentId = child?.parentId ?? null;
    await db.update(users).set({ parentId: null }).where(eq(users.id, childId));
    cleanups.push(async () => {
      await db
        .update(users)
        .set({ parentId: originalParentId })
        .where(eq(users.id, childId));
    });

    const { agent: coach, user } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    expect(user.role).toBe("coach");

    // Before linking: coach has no linked children, isGuardian=false.
    const before = await coach.get("/api/v1/auth/whoami");
    expect(before.status).toBe(200);
    expect(before.body.isGuardian).toBe(false);
    expect(before.body.linkedChildrenCount).toBe(0);

    // /users/me/children must return an empty list (not 403) for the coach.
    const emptyList = await coach.get("/api/v1/users/me/children");
    expect(emptyList.status).toBe(200);
    expect(Array.isArray(emptyList.body.data)).toBe(true);
    expect(emptyList.body.data.length).toBe(0);

    // Coach links the child via the existing guardian search-and-link endpoint.
    const link = await coach
      .post("/api/v1/users/me/children")
      .send({ childId });
    expect(link.status).toBe(201);
    expect(link.body.id).toBe(childId);

    // After linking: whoami flips to isGuardian=true.
    const after = await coach.get("/api/v1/auth/whoami");
    expect(after.status).toBe(200);
    expect(after.body.isGuardian).toBe(true);
    expect(after.body.linkedChildrenCount).toBe(1);

    // Dashboard endpoint returns the linked child.
    const list = await coach.get("/api/v1/users/me/children");
    expect(list.status).toBe(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(childId);
  });

  it("a user with no linked children sees isGuardian=false and gets an empty list (not 403) from /users/me/children", async () => {
    // Marcus is an athlete with no children of his own.
    const marcusId = await findUserId("marcus@kinectem.demo");
    const stolen = await unlinkChildrenOf(marcusId);
    cleanups.push(async () => {
      for (const id of stolen) {
        await db.update(users).set({ parentId: marcusId }).where(eq(users.id, id));
      }
    });

    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const who = await agent.get("/api/v1/auth/whoami");
    expect(who.status).toBe(200);
    expect(who.body.isGuardian).toBe(false);
    expect(who.body.linkedChildrenCount).toBe(0);

    const list = await agent.get("/api/v1/users/me/children");
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
  });
});
