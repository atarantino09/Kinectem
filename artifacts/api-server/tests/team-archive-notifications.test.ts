// Task #476 — Cover the Task #473 archive/unarchive notification fan-out
// (notifyTeamArchived / notifyTeamUnarchived in src/lib/notifications.ts,
// invoked from POST /teams/:teamId/archive and /unarchive in
// src/routes/teams.ts) with API tests so a future refactor of the
// recipient query cannot silently regress the experience.

import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  notifications,
  organizationAdmins,
  organizations,
  rosterEntries,
  teamFollowers,
  teams,
  users,
} from "@workspace/db";
import { app, loginAs } from "./helpers";

const ARCHIVED_KIND = "team_archived";
const UNARCHIVED_KIND = "team_unarchived";

async function getVarsityFootball(): Promise<{
  teamId: string;
  orgId: string;
}> {
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

async function getNotifs(
  teamId: string,
  kind: string,
): Promise<Array<{ userId: string; link: string | null; actorUserId: string | null }>> {
  return db
    .select({
      userId: notifications.userId,
      link: notifications.link,
      actorUserId: notifications.actorUserId,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, kind),
        eq(notifications.link, `/teams/${teamId}`),
      ),
    );
}

// Compute the expected recipient set straight from live DB rows so the
// assertions stay correct even if seed counts shift. Mirrors the union
// in `fanOutTeamArchiveNotification` (accepted roster ∪ followers ∪
// org admins/owners) minus the actor.
async function computeExpectedRecipients(
  teamId: string,
  organizationId: string,
  actorId: string,
): Promise<Set<string>> {
  const [rosterRows, followerRows, adminRows] = await Promise.all([
    db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.status, "accepted"),
        ),
      ),
    db
      .select({ userId: teamFollowers.userId })
      .from(teamFollowers)
      .where(eq(teamFollowers.teamId, teamId)),
    db
      .select({ userId: organizationAdmins.userId, role: organizationAdmins.role })
      .from(organizationAdmins)
      .where(eq(organizationAdmins.organizationId, organizationId)),
  ]);
  const out = new Set<string>();
  for (const r of rosterRows) if (r.userId !== actorId) out.add(r.userId);
  for (const f of followerRows) if (f.userId !== actorId) out.add(f.userId);
  for (const a of adminRows) {
    if (a.userId === actorId) continue;
    if (a.role === "owner" || a.role === "admin") out.add(a.userId);
  }
  return out;
}

// Insert (or reuse) a brand-new "admin-only" user on the org — not on
// the team's roster, not a follower — so the org-admin branch of the
// fan-out has an exclusive recipient. Returns the new user's id.
async function addAdminOnlyUser(
  organizationId: string,
  email: string,
): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({ name: "Archive Admin Only", role: "admin", email })
    .returning();
  await db.insert(organizationAdmins).values({
    organizationId,
    userId: u.id,
    role: "admin",
  });
  return u.id;
}

describe("Task #476 — team archive notification fan-out", () => {
  it("writes one team_archived notification per accepted roster member, follower, and org admin (excluding the actor)", async () => {
    const { teamId, orgId } = await getVarsityFootball();
    const samId = await findUserId("sam@kinectem.demo");

    // Add a brand-new org admin who is NOT on the roster and NOT a
    // follower so the org-admin branch of the fan-out has an exclusive
    // recipient. A regression that drops the admin query (or that
    // narrows it to "admins who are also rostered") would lose this
    // user from the expected set and fail the assertion below.
    const adminOnlyId = await addAdminOnlyUser(
      orgId,
      `archive-admin-${Date.now()}@kinectem.demo`,
    );

    const expected = await computeExpectedRecipients(teamId, orgId, samId);
    expect(expected.has(adminOnlyId)).toBe(true);
    expect(expected.size).toBeGreaterThan(0);

    const { agent: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const res = await sam.post(`/api/v1/teams/${teamId}/archive`).send({});
    expect(res.status).toBe(200);
    expect(res.body.archivedAt).toBeTruthy();

    const rows = await getNotifs(teamId, ARCHIVED_KIND);
    expect(rows.length).toBe(expected.size);
    expect(new Set(rows.map((r) => r.userId))).toEqual(expected);
    // The admin-only user got exactly one row via the admin branch.
    expect(rows.filter((r) => r.userId === adminOnlyId).length).toBe(1);
    for (const row of rows) {
      expect(row.actorUserId).toBe(samId);
      expect(row.link).toBe(`/teams/${teamId}`);
    }
  });

  it("dedupes a user who is a roster member AND a follower AND an org admin into a single row", async () => {
    const { teamId, orgId } = await getVarsityFootball();
    const samId = await findUserId("sam@kinectem.demo");
    // Coach Davis is seeded as Westfield's org admin (role=admin) AND
    // as Varsity Football's Head Coach on the roster. Add him as a
    // follower too so he qualifies via all three paths simultaneously.
    const coachId = await findUserId("coach@kinectem.demo");
    await db
      .insert(teamFollowers)
      .values({ teamId, userId: coachId })
      .onConflictDoNothing();

    const { agent: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const res = await sam.post(`/api/v1/teams/${teamId}/archive`).send({});
    expect(res.status).toBe(200);

    const coachRows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, coachId),
          eq(notifications.kind, ARCHIVED_KIND),
        ),
      );
    expect(coachRows.length).toBe(1);
    // Sam (the actor) is the org owner — he must still be excluded
    // even though the admin branch would otherwise pull him in.
    expect(coachId).not.toBe(samId);
  });

  it("does NOT notify the acting owner (Sam) about their own archive action", async () => {
    const { teamId } = await getVarsityFootball();
    const samId = await findUserId("sam@kinectem.demo");

    // Sam is seeded as a follower of Varsity Football and as Westfield's
    // org owner — both relationships would otherwise pull him into the
    // recipient set if the actor-exclusion broke.
    const samFollow = await db
      .select({ userId: teamFollowers.userId })
      .from(teamFollowers)
      .where(
        and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, samId)),
      );
    expect(samFollow.length).toBe(1);

    const { agent: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const res = await sam.post(`/api/v1/teams/${teamId}/archive`).send({});
    expect(res.status).toBe(200);

    const samRows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, samId),
          eq(notifications.kind, ARCHIVED_KIND),
        ),
      );
    expect(samRows.length).toBe(0);
  });

  it("re-archiving an already-archived team is a no-op (no duplicate notifications)", async () => {
    const { teamId } = await getVarsityFootball();

    const { agent: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const first = await sam.post(`/api/v1/teams/${teamId}/archive`).send({});
    expect(first.status).toBe(200);
    const firstArchivedAt = first.body.archivedAt as string;
    const firstCount = (await getNotifs(teamId, ARCHIVED_KIND)).length;
    expect(firstCount).toBeGreaterThan(0);

    const second = await sam.post(`/api/v1/teams/${teamId}/archive`).send({});
    expect(second.status).toBe(200);
    // Idempotent: archivedAt is preserved from the original transition.
    expect(second.body.archivedAt).toBe(firstArchivedAt);

    const afterCount = (await getNotifs(teamId, ARCHIVED_KIND)).length;
    expect(afterCount).toBe(firstCount);
  });

  // -------------------------------------------------------------------
  // Symmetric coverage for unarchive
  // -------------------------------------------------------------------

  async function archiveSilently(teamId: string, ownerId: string) {
    // Flip archivedAt directly so we don't have to clean up the
    // archive-side notifications before exercising the unarchive path.
    await db
      .update(teams)
      .set({ archivedAt: new Date(), archivedByUserId: ownerId })
      .where(eq(teams.id, teamId));
  }

  it("unarchive writes one team_unarchived notification per accepted roster member, follower, and org admin (excluding the actor)", async () => {
    const { teamId, orgId } = await getVarsityFootball();
    const samId = await findUserId("sam@kinectem.demo");
    const adminOnlyId = await addAdminOnlyUser(
      orgId,
      `unarchive-admin-${Date.now()}@kinectem.demo`,
    );
    await archiveSilently(teamId, samId);

    const expected = await computeExpectedRecipients(teamId, orgId, samId);
    expect(expected.has(adminOnlyId)).toBe(true);
    expect(expected.size).toBeGreaterThan(0);

    const { agent: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const res = await sam.post(`/api/v1/teams/${teamId}/unarchive`).send({});
    expect(res.status).toBe(200);
    expect(res.body.archivedAt ?? null).toBeNull();

    const rows = await getNotifs(teamId, UNARCHIVED_KIND);
    expect(rows.length).toBe(expected.size);
    expect(new Set(rows.map((r) => r.userId))).toEqual(expected);
    expect(rows.filter((r) => r.userId === adminOnlyId).length).toBe(1);
    for (const row of rows) {
      expect(row.actorUserId).toBe(samId);
      expect(row.link).toBe(`/teams/${teamId}`);
    }
  });

  it("unarchive does NOT notify the acting owner", async () => {
    const { teamId } = await getVarsityFootball();
    const samId = await findUserId("sam@kinectem.demo");
    await archiveSilently(teamId, samId);

    const { agent: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const res = await sam.post(`/api/v1/teams/${teamId}/unarchive`).send({});
    expect(res.status).toBe(200);

    const samRows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, samId),
          eq(notifications.kind, UNARCHIVED_KIND),
        ),
      );
    expect(samRows.length).toBe(0);
  });

  it("unarchive dedupes a user who is a roster member AND a follower AND an org admin into a single row", async () => {
    const { teamId } = await getVarsityFootball();
    const samId = await findUserId("sam@kinectem.demo");
    // Coach Davis is seeded as a Westfield org admin AND on the
    // Varsity Football roster — adding him as a follower covers all
    // three sources at once.
    const coachId = await findUserId("coach@kinectem.demo");
    await db
      .insert(teamFollowers)
      .values({ teamId, userId: coachId })
      .onConflictDoNothing();
    await archiveSilently(teamId, samId);

    const { agent: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const res = await sam.post(`/api/v1/teams/${teamId}/unarchive`).send({});
    expect(res.status).toBe(200);

    const coachRows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, coachId),
          eq(notifications.kind, UNARCHIVED_KIND),
        ),
      );
    expect(coachRows.length).toBe(1);
  });

  it("re-unarchiving an already-active team is a no-op (no duplicate notifications)", async () => {
    const { teamId } = await getVarsityFootball();
    const samId = await findUserId("sam@kinectem.demo");
    await archiveSilently(teamId, samId);

    const { agent: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");
    const first = await sam.post(`/api/v1/teams/${teamId}/unarchive`).send({});
    expect(first.status).toBe(200);
    const firstCount = (await getNotifs(teamId, UNARCHIVED_KIND)).length;
    expect(firstCount).toBeGreaterThan(0);

    const second = await sam.post(`/api/v1/teams/${teamId}/unarchive`).send({});
    expect(second.status).toBe(200);
    expect(second.body.archivedAt ?? null).toBeNull();

    const afterCount = (await getNotifs(teamId, UNARCHIVED_KIND)).length;
    expect(afterCount).toBe(firstCount);
  });
});
