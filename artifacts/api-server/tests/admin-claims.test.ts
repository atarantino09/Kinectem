// GET /admin/claims — platform-admin claims tracker (extra-spec endpoint).
import { describe, expect, it } from "vitest";
import { findUser, loginAs } from "./helpers";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  organizations,
  organizationAdmins,
  organizationClaimRequests,
} from "@workspace/db";
import { afterEach } from "vitest";

const createdOrgIds: string[] = [];

afterEach(async () => {
  if (createdOrgIds.length) {
    await db
      .delete(organizations)
      .where(inArray(organizations.id, createdOrgIds.splice(0)));
  }
});

describe("GET /api/v1/admin/claims", () => {
  it("returns totals + lists for a platform admin", async () => {
    const adminSeed = await findUser((u) => u.role === "admin" && !!u.email);
    const admin = await loginAs(adminSeed.email!);
    const res = await admin.agent.get("/api/v1/admin/claims");
    expect(res.status).toBe(200);
    expect(res.body.organizations?.totals).toMatchObject({
      seeded: expect.any(Number),
      claimed: expect.any(Number),
    });
    expect(Array.isArray(res.body.organizations.claimed)).toBe(true);
    expect(res.body.competitions?.totals).toMatchObject({
      seeded: expect.any(Number),
      claimed: expect.any(Number),
    });
    expect(Array.isArray(res.body.competitions.claimed)).toBe(true);
    expect(Array.isArray(res.body.slotClaims)).toBe(true);
  });

  it("classifies link claims vs approved-request claims correctly", async () => {
    const adminSeed = await findUser((u) => u.role === "admin" && !!u.email);
    const admin = await loginAs(adminSeed.email!);
    const claimer = await loginAs("coach@kinectem.demo");
    const stamp = Date.now();

    // Org A: seeded with a claim token, owner arrived via the link.
    const [orgA] = await db
      .insert(organizations)
      .values({
        name: `Claims Test Link Org ${stamp}`,
        claimToken: `test-token-${stamp}`,
      })
      .returning();
    createdOrgIds.push(orgA.id);
    await db.insert(organizationAdmins).values({
      organizationId: orgA.id,
      userId: claimer.user.id,
      role: "owner",
    });

    // Org B: owner arrived through an APPROVED claim request.
    const [orgB] = await db
      .insert(organizations)
      .values({ name: `Claims Test Request Org ${stamp}` })
      .returning();
    createdOrgIds.push(orgB.id);
    await db.insert(organizationAdmins).values({
      organizationId: orgB.id,
      userId: claimer.user.id,
      role: "owner",
    });
    const decidedAt = new Date("2026-01-15T12:00:00Z");
    await db.insert(organizationClaimRequests).values({
      organizationId: orgB.id,
      requestedByUserId: claimer.user.id,
      status: "approved",
      decidedAt,
    });

    const res = await admin.agent.get("/api/v1/admin/claims");
    expect(res.status).toBe(200);
    const rows: any[] = res.body.organizations.claimed;
    const a = rows.find((r) => r.id === orgA.id);
    const b = rows.find((r) => r.id === orgB.id);
    expect(a).toBeTruthy();
    expect(a.method).toBe("link");
    expect(b).toBeTruthy();
    expect(b.method).toBe("request");
    expect(new Date(b.claimedAt).toISOString()).toBe(decidedAt.toISOString());
  });

  it("is admin-only", async () => {
    const coach = await loginAs("coach@kinectem.demo");
    const res = await coach.agent.get("/api/v1/admin/claims");
    expect([401, 403]).toContain(res.status);
  });
});
