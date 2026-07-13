// Task #755 — multi-guardian links: last-guardian invariant, invite
// permissions, and the users.parentId mirror (locked coppa.ts reads it).

import { describe, expect, it, afterEach } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { db, users, guardianLinks } from "@workspace/db";
import { loginAs } from "./helpers";

async function findUserId(email: string): Promise<string> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) throw new Error(`User ${email} missing from seed`);
  return u.id;
}

async function activeLinks(childId: string) {
  return db
    .select()
    .from(guardianLinks)
    .where(
      and(eq(guardianLinks.childId, childId), eq(guardianLinks.status, "active")),
    );
}

async function parentIdOf(childId: string): Promise<string | null> {
  const [u] = await db
    .select({ parentId: users.parentId })
    .from(users)
    .where(eq(users.id, childId))
    .limit(1);
  return u?.parentId ?? null;
}

// Reset Samira's guardian graph to the seed state (Lisa = sole primary
// guardian): drop every link row, then re-fire the parent_id sync trigger.
async function restoreSeedGuardian(childId: string, guardianId: string) {
  await db.delete(guardianLinks).where(eq(guardianLinks.childId, childId));
  await db.update(users).set({ parentId: null }).where(eq(users.id, childId));
  await db
    .update(users)
    .set({ parentId: guardianId })
    .where(eq(users.id, childId));
}

describe("Task #755 — guardian links invariants", () => {
  let cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
  });

  it("legacy unlink (DELETE /users/me/children/:childId) refuses to remove the LAST guardian", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");

    const before = await activeLinks(samiraId);
    expect(before.length).toBe(1);
    expect(before[0]!.guardianId).toBe(lisaId);

    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const res = await lisa.delete(`/api/v1/users/me/children/${samiraId}`);
    expect(res.status).toBe(409);

    // Nothing changed: link still active, mirror intact.
    const after = await activeLinks(samiraId);
    expect(after.length).toBe(1);
    expect(after[0]!.status).toBe("active");
    expect(await parentIdOf(samiraId)).toBe(lisaId);
  });

  it("a NON-primary active guardian can invite another co-parent", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    const marcusId = await findUserId("marcus@kinectem.demo");

    // Make Marcus a second, non-primary active guardian.
    await db.insert(guardianLinks).values({
      childId: samiraId,
      guardianId: marcusId,
      relationshipType: "parent",
      isPrimary: false,
      status: "active",
      consentGrantedAt: new Date(),
      consentMethod: "test_setup",
    });
    cleanups.push(async () => restoreSeedGuardian(samiraId, lisaId));

    const { agent: marcus } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const inviteEmail = `task755-coparent-${Date.now()}@example.com`;
    const res = await marcus
      .post(`/api/v1/users/${samiraId}/guardians/invite`)
      .send({ email: inviteEmail, relationshipType: "parent" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.isPrimary).toBe(false);
  });

  it("parentId mirror follows transfer-primary and survives a legacy detach of the non-primary", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    const marcusId = await findUserId("marcus@kinectem.demo");

    const [marcusLink] = await db
      .insert(guardianLinks)
      .values({
        childId: samiraId,
        guardianId: marcusId,
        relationshipType: "parent",
        isPrimary: false,
        status: "active",
        consentGrantedAt: new Date(),
        consentMethod: "test_setup",
      })
      .returning();
    cleanups.push(async () => restoreSeedGuardian(samiraId, lisaId));

    // Primary (Lisa) transfers the primary role to Marcus → mirror flips.
    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const transfer = await lisa.post(
      `/api/v1/guardian-links/${marcusLink!.id}/transfer-primary`,
    );
    expect(transfer.status).toBe(200);
    expect(transfer.body.isPrimary).toBe(true);
    expect(await parentIdOf(samiraId)).toBe(marcusId);

    // Exactly one primary among the active links.
    const links = await activeLinks(samiraId);
    expect(links.filter((l) => l.isPrimary).length).toBe(1);
    expect(links.find((l) => l.isPrimary)!.guardianId).toBe(marcusId);

    // Lisa (now non-primary) detaches herself via the LEGACY unlink path:
    // allowed (not the last guardian) and the mirror stays on Marcus.
    const detach = await lisa.delete(`/api/v1/users/me/children/${samiraId}`);
    expect(detach.status).toBe(204);
    expect(await parentIdOf(samiraId)).toBe(marcusId);
    const remaining = await activeLinks(samiraId);
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.guardianId).toBe(marcusId);
    expect(remaining[0]!.isPrimary).toBe(true);

    // Lisa's revoked link is really revoked (no lingering live pair).
    const lisaLive = await db
      .select()
      .from(guardianLinks)
      .where(
        and(
          eq(guardianLinks.childId, samiraId),
          eq(guardianLinks.guardianId, lisaId),
          ne(guardianLinks.status, "revoked"),
        ),
      );
    expect(lisaLive.length).toBe(0);
  });
});
